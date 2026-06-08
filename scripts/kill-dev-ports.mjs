#!/usr/bin/env node
/**
 * Kill any process currently listening on the RepoHelm dev ports and
 * block until the OS has actually released each socket.
 *
 * Runs automatically before `pnpm dev` (see the `predev` npm script) so a
 * stale API server or Vite dev server can't block a fresh start with
 * EADDRINUSE.
 *
 * macOS: uses `lsof -iTCP:<port> -sTCP:LISTEN`.
 * Linux: tries `lsof` first, falls back to `fuser -k <port>/tcp`.
 *
 * A missing listener is not an error — the script always exits 0.
 */
import { execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { platform } from "node:os";

const PORTS = [
  Number(process.env.REPOHELM_PORT ?? 4300),
  Number(process.env.VITE_PORT ?? 5173),
];

const isMac = platform() === "darwin";

const RELEASE_TIMEOUT_MS = 5_000;
const RELEASE_POLL_MS = 120;
const SIGTERM_GRACE_MS = 350;
const POST_RELEASE_SETTLE_MS = 500;

function listenPidsViaLsof(port) {
  try {
    const out = execFileSync(
      "lsof",
      ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-Fp"],
      { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
    );
    return out
      .split("\n")
      .filter((l) => l.startsWith("p"))
      .map((l) => Number(l.slice(1)))
      .filter((n) => n > 0);
  } catch {
    return [];
  }
}

async function signalOnPort(port, signal) {
  const pids = listenPidsViaLsof(port);
  const ownAncestorPgids = collectOwnAncestorPgids();
  const killedParents = new Set();
  for (const pid of pids) {
    // 1. Prefer signaling the whole process group so parent watchers like
    //    `tsx watch` die together with their spawned child listener.
    const pgid = readPgid(pid);
    if (pgid && pgid > 1 && !ownAncestorPgids.has(pgid)) {
      try {
        process.kill(-pgid, signal);
        console.log(`[predev] sent ${signal} to pgid ${pgid} (port ${port})`);
        continue;
      } catch {
        /* fall through */
      }
    }
    // 2. Listener shares a pgid with our caller — kill it AND every
    //    descendant we can find (e.g. a tsx-watch parent whose pgid
    //    matches ours).
    const parent = readPpid(pid);
    if (parent && parent > 1 && parent !== pid) {
      signalDescendants(parent, signal, port);
      killedParents.add(parent);
    }
    try {
      process.kill(pid, signal);
      console.log(`[predev] sent ${signal} to pid ${pid} (port ${port})`);
    } catch {
      /* process already gone */
    }
  }
  // Escalate: if a tsx-watch parent is still alive after SIGTERM, it will
  // respawn the listener and defeat the whole exercise. Force-kill it.
  if (signal === "SIGTERM" && killedParents.size > 0) {
    await sleep(SIGTERM_GRACE_MS);
    for (const parent of killedParents) {
      if (isAlive(parent)) {
        signalDescendants(parent, "SIGKILL", port);
        try {
          process.kill(parent, "SIGKILL");
          console.log(`[predev] escalated to SIGKILL for parent pid ${parent} (port ${port})`);
        } catch { /* already gone */ }
      }
    }
    // tsx watch may have respawned a fresh listener during the grace window.
    const respawned = listenPidsViaLsof(port);
    for (const pid of respawned) {
      const pgid = readPgid(pid);
      if (pgid && pgid > 1 && !ownAncestorPgids.has(pgid)) {
        try { process.kill(-pgid, "SIGKILL"); } catch { /* ignore */ }
      }
      try {
        process.kill(pid, "SIGKILL");
        console.log(`[predev] SIGKILL'd respawned listener pid ${pid} (port ${port})`);
      } catch { /* already gone */ }
    }
  }
  return pids.length;
}

function isAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function signalDescendants(rootPid, signal, port) {
  let children;
  try {
    const out = execFileSync("pgrep", ["-P", String(rootPid)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    children = out
      .split("\n")
      .map((s) => Number(s.trim()))
      .filter((n) => n > 0);
  } catch {
    return;
  }
  for (const child of children) {
    signalDescendants(child, signal, port);
    try {
      process.kill(child, signal);
      console.log(`[predev] sent ${signal} to descendant pid ${child} of ${rootPid} (port ${port})`);
    } catch {
      /* already gone */
    }
  }
}

function readPgid(pid) {
  try {
    const out = execFileSync("ps", ["-o", "pgid=", "-p", String(pid)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const n = Number(out.trim());
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

function readPpid(pid) {
  try {
    const out = execFileSync("ps", ["-o", "ppid=", "-p", String(pid)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    const n = Number(out.trim());
    return Number.isFinite(n) && n > 0 ? n : 0;
  } catch {
    return 0;
  }
}

/** Walk this process's ancestry and return every pgid we must NOT signal. */
function collectOwnAncestorPgids() {
  const set = new Set();
  // Always include our own pgid — killing it would take down the caller.
  try {
    const self = Number(execFileSync("ps", ["-o", "pgid=", "-p", String(process.pid)], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim());
    if (self > 0) set.add(self);
  } catch { /* ignore */ }
  // Walk up to (but not including) init: if any ancestor's pgid matches the
  // target, signaling that pgid would also signal the ancestor.
  let cur = process.pid;
  for (let depth = 0; depth < 20 && cur > 1; depth++) {
    try {
      const out = execFileSync("ps", ["-o", "ppid=,pgid=", "-p", String(cur)], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      const [ppidStr, pgidStr] = out.split(/\s+/);
      const ppid = Number(ppidStr);
      const pgid = Number(pgidStr);
      if (pgid > 0) set.add(pgid);
      if (!ppid || ppid <= 1) break;
      cur = ppid;
    } catch {
      break;
    }
  }
  return set;
}

function killOnPortViaFuser(port) {
  try {
    execFileSync("fuser", ["-k", `${port}/tcp`], {
      stdio: ["ignore", "ignore", "ignore"],
    });
    console.log(`[predev] killed listener on port ${port} via fuser`);
  } catch {
    /* no listener or fuser unavailable — ignore */
  }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * True iff we can successfully bind the port on both `0.0.0.0` and `::`.
 * Hono's `@hono/node-server` and Vite bind to both, so we need both free
 * before returning from predev — otherwise the new server can race the
 * kernel's socket teardown and hit EADDRINUSE.
 */
function portBindable(port) {
  const tryHost = (host) =>
    new Promise((resolve) => {
      const server = createServer();
      server.once("error", () => resolve(false));
      server.once("listening", () => {
        server.close(() => resolve(true));
      });
      server.listen({ port, host, exclusive: true });
    });
  return Promise.all([tryHost("0.0.0.0"), tryHost("::")]).then(
    ([a, b]) => a && b,
  );
}

async function waitForPortRelease(port) {
  const start = Date.now();
  while (Date.now() - start < RELEASE_TIMEOUT_MS) {
    // Require both: lsof clears AND we can actually bind.
    const lsofClear = listenPidsViaLsof(port).length === 0;
    if (lsofClear && (await portBindable(port))) return true;
    await sleep(RELEASE_POLL_MS);
  }
  return false;
}

async function freePort(port) {
  if (listenPidsViaLsof(port).length === 0) return;

  // 1. Graceful shutdown.
  await signalOnPort(port, "SIGTERM");

  // 2. Force kill anything still listening.
  if (listenPidsViaLsof(port).length > 0) {
    await signalOnPort(port, "SIGKILL");
  }
  if (!isMac && listenPidsViaLsof(port).length > 0) {
    killOnPortViaFuser(port);
  }

  // 3. Block until the socket is actually reusable.
  const released = await waitForPortRelease(port);
  if (!released) {
    console.warn(
      `[predev] port ${port} still not free after ${RELEASE_TIMEOUT_MS}ms — dev server may hit EADDRINUSE`,
    );
  } else {
    // 4. Extra settle: even after we can bind, the old listener's
    //    TIME_WAIT/CLOSE_WAIT sockets may still be draining. A short
    //    trailing delay prevents the new dev server from racing our probe.
    await sleep(POST_RELEASE_SETTLE_MS);
  }
}

for (const port of PORTS) {
  await freePort(port);
}

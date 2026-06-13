import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitWorktreeManager } from "./git.js";

const run = promisify(execFile);

describe("GitWorktreeManager read helpers", () => {
  let dir: string;
  const git = (args: string[]) => run("git", args, { cwd: dir });
  const mgr = new GitWorktreeManager();

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "git-read-"));
    await git(["init", "-q", "-b", "main"]);
    await git(["config", "user.email", "t@t.dev"]);
    await git(["config", "user.name", "t"]);
    await writeFile(join(dir, "a.txt"), "one\n");
    await git(["add", "."]);
    await git(["commit", "-q", "-m", "first"]);
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  it("resolveRef returns the branch HEAD sha", async () => {
    const head = await mgr.resolveRef(dir, "main");
    expect(head).toMatch(/^[0-9a-f]{40}$/);
  });

  it("countCommitsBetween counts new commits", async () => {
    const before = await mgr.resolveRef(dir, "main");
    await writeFile(join(dir, "b.txt"), "two\n");
    await git(["add", "."]);
    await git(["commit", "-q", "-m", "second"]);
    expect(await mgr.countCommitsBetween(dir, before, "main")).toBe(1);
  });

  it("collectChangesBetween returns commit messages and per-file diffs", async () => {
    const before = await mgr.resolveRef(dir, "main");
    await writeFile(join(dir, "a.txt"), "one\ntwo\n");
    await git(["commit", "-aqm", "edit a"]);
    const changes = await mgr.collectChangesBetween(dir, before, "main");
    expect(changes.commits.map((c) => c.subject)).toContain("edit a");
    expect(changes.files.some((f) => f.path === "a.txt")).toBe(true);
    expect(changes.files.find((f) => f.path === "a.txt")!.diff).toContain("two");
  });

  it("getChangedFiles preserves the first path character from porcelain status", async () => {
    await writeFile(join(dir, "README.md"), "updated\n");
    await writeFile(join(dir, "src.js"), "export const ok = true;\n");
    const changes = await mgr.getChangedFiles("project-1", dir);
    expect(changes.map((file) => file.path).sort()).toEqual(["README.md", "src.js"]);
  });

  it("listTrackedFiles returns committed files", async () => {
    const files = await mgr.listTrackedFiles(dir, "main");
    expect(files).toContain("a.txt");
  });
});

import { spawn } from "node:child_process";
import { extractTokenUsage } from "./runtime-usage.js";

/**
 * A coding-CLI stream event, normalized into the same shape RepoHelm uses for its
 * own `AgentEvent` (type/title/detail/agent). Produced by parsing the streaming
 * stdout of external coding CLIs (Claude Code `--output-format stream-json`,
 * Codex, OpenCode, …) so their tool calls, messages and results surface on the
 * Quest timeline incrementally instead of as a single opaque blob.
 */
export interface CliStreamEvent {
  type:
    | "agent.message"
    | "agent.tool_call"
    | "agent.completed"
    | "agent.output"
    | "agent.file_change"
    | "agent.command"
    | "agent.usage";
  title: string;
  detail: string;
  agent: string;
}

interface AssistantContentBlock {
  type?: string;
  text?: string;
  name?: string;
  input?: unknown;
}

/** A single item in Codex `exec --json` (`item.completed` envelope). */
interface CodexItem {
  id?: string;
  type?: string;
  text?: string;
  command?: string;
  aggregated_output?: string;
  exit_code?: number | null;
  changes?: Array<{ path?: string; kind?: string }>;
  name?: string;
  arguments?: unknown;
  input?: unknown;
}

/**
 * Truncate keeping BOTH the head and the tail. Command/test failures put the
 * decisive error at the end, and the orchestrator feeds recent event details to
 * the lead's recovery decision — so dropping the tail would hide the real cause.
 * The tail is weighted heavier than the head for that reason.
 */
function truncateEnds(value: string, max: number): string {
  if (value.length <= max) return value;
  const headLen = Math.floor(max * 0.3);
  const tailLen = max - headLen;
  const omitted = value.length - headLen - tailLen;
  return `${value.slice(0, headLen)}\n…(省略 ${omitted} 字符)…\n${value.slice(value.length - tailLen)}`;
}

/**
 * Map one Codex `item.completed` payload to a normalized event.
 *
 * Codex `exec --json` emits structured items: `agent_message` (assistant text),
 * `file_change` (edited paths), `command_execution` (shell/test output) and
 * `mcp_tool_call`. We surface diffs and command output as dedicated event types
 * so the Quest timeline shows what the external agent actually did, not a blob.
 */
function parseCodexItem(item: CodexItem, agent: string): CliStreamEvent | undefined {
  switch (item.type) {
    case "agent_message": {
      const text = (item.text ?? "").trim();
      return text ? { type: "agent.message", title: "助手消息", detail: text, agent } : undefined;
    }
    case "reasoning":
      // Model's private chain-of-thought — keep it off the content/timeline.
      return undefined;
    case "file_change": {
      const detail = (item.changes ?? [])
        .map((change) => `${change.kind ?? "edit"} ${change.path ?? "(unknown)"}`)
        .join("\n");
      return { type: "agent.file_change", title: "文件变更", detail: detail || "(no files)", agent };
    }
    case "command_execution": {
      const output = truncateEnds((item.aggregated_output ?? "").trim(), 800);
      const exit = item.exit_code === null || item.exit_code === undefined ? "" : ` (exit ${item.exit_code})`;
      const detail = [item.command, output].filter(Boolean).join("\n");
      return { type: "agent.command", title: `执行命令${exit}`, detail: detail || "(no output)", agent };
    }
    case "mcp_tool_call": {
      const name = item.name ?? "tool";
      const args = item.arguments ?? item.input;
      const detail = args === undefined ? "" : JSON.stringify(args);
      return { type: "agent.tool_call", title: `调用工具: ${name}`, detail, agent };
    }
    default:
      return { type: "agent.output", title: "输出", detail: JSON.stringify(item), agent };
  }
}

/**
 * Parse one line of a coding CLI's streaming stdout into a normalized event.
 *
 * - Claude Code `stream-json` shapes: assistant text → `agent.message`,
 *   assistant `tool_use` → `agent.tool_call`, `result` → `agent.completed`.
 * - Plain (non-JSON) lines and malformed JSON → `agent.output`.
 * - Blank lines and `system` noise → `undefined` (ignored).
 */
export function parseCliStreamLine(line: string, agent: string): CliStreamEvent | undefined {
  const trimmed = line.trim();
  if (!trimmed) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    // Not JSON — surface the raw line as output (covers print-mode CLIs).
    return { type: "agent.output", title: "输出", detail: trimmed, agent };
  }

  if (typeof parsed !== "object" || parsed === null) {
    return { type: "agent.output", title: "输出", detail: trimmed, agent };
  }

  const obj = parsed as {
    type?: string;
    result?: unknown;
    message?: { content?: AssistantContentBlock[] };
    item?: CodexItem;
    error?: unknown;
    usage?: unknown;
  };

  if (obj.type === "system") {
    return undefined;
  }

  // Codex `exec --json` lifecycle envelopes. We only surface `item.completed`
  // (each action emits both `item.started` and `item.completed`; emitting only
  // the latter avoids duplicate timeline entries), and treat thread/turn
  // bookkeeping as noise.
  if (obj.type === "thread.started" || obj.type === "turn.started") {
    return undefined;
  }
  if (obj.type === "turn.completed") {
    const usage = extractTokenUsage(obj.usage);
    return usage
      ? {
          type: "agent.usage",
          title: "Token 使用",
          detail: JSON.stringify(usage),
          agent
        }
      : undefined;
  }
  if (obj.type === "item.started" || obj.type === "item.updated") {
    return undefined;
  }
  if (obj.type === "item.completed" && obj.item && typeof obj.item === "object") {
    return parseCodexItem(obj.item, agent);
  }
  if (obj.type === "error" || obj.type === "turn.failed") {
    const detail =
      (obj as { message?: unknown }).message ?? obj.error ?? obj.result ?? "(unknown error)";
    return {
      type: "agent.output",
      title: "错误",
      detail: typeof detail === "string" ? detail : JSON.stringify(detail),
      agent
    };
  }

  if (obj.type === "result") {
    const detail = typeof obj.result === "string" ? obj.result : JSON.stringify(obj.result ?? "");
    return { type: "agent.completed", title: "执行完成", detail, agent };
  }

  if (obj.type === "assistant" && Array.isArray(obj.message?.content)) {
    const blocks = obj.message!.content!;
    const toolUse = blocks.find((block) => block.type === "tool_use");
    if (toolUse) {
      const name = toolUse.name ?? "tool";
      const input = toolUse.input === undefined ? "" : JSON.stringify(toolUse.input);
      return { type: "agent.tool_call", title: `调用工具: ${name}`, detail: input, agent };
    }
    const textBlock = blocks.find((block) => block.type === "text" && typeof block.text === "string");
    if (textBlock?.text) {
      return { type: "agent.message", title: "助手消息", detail: textBlock.text, agent };
    }
  }

  // Not a recognized streaming envelope — likely a print-mode CLI emitting its whole
  // answer (plan/result payload) as a single JSON line. Preserve it as raw output so
  // it reaches `content` rather than being silently dropped.
  return { type: "agent.output", title: "输出", detail: trimmed, agent };
}

export interface RunStreamingCliOptions {
  command: string;
  args: string[];
  agent: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  signal?: AbortSignal;
  /** Called once per parsed event as it arrives, before the promise resolves. */
  onEvent?: (event: CliStreamEvent) => void;
}

export interface StreamingCliResult {
  content: string;
  events: CliStreamEvent[];
  exitCode: number | null;
  /** Captured stderr — kept for diagnosing CLI auth/model failures. */
  stderr: string;
}

/**
 * Spawn a coding CLI and stream its stdout, parsing each line into a
 * {@link CliStreamEvent} and emitting it via `onEvent` incrementally.
 *
 * Resolves (never rejects) on process exit so callers can inspect `exitCode`
 * alongside any partial events — a non-zero exit is a result, not an exception.
 */
export function runStreamingCli(options: RunStreamingCliOptions): Promise<StreamingCliResult> {
  const { command, args, agent, cwd, env, timeoutMs, signal, onEvent } = options;
  return new Promise<StreamingCliResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, NO_COLOR: "1", ...env },
      detached: true
    });

    const events: CliStreamEvent[] = [];
    let resultText: string | undefined;
    const textParts: string[] = [];
    let buffer = "";
    let stderr = "";
    let settled = false;
    let cancelled = false;

    const handleEvent = (event: CliStreamEvent) => {
      events.push(event);
      if (event.type === "agent.completed") {
        resultText = event.detail;
      } else if (event.type === "agent.message" || event.type === "agent.output") {
        textParts.push(event.detail);
      }
      onEvent?.(event);
    };

    const consumeLine = (line: string) => {
      const event = parseCliStreamLine(line, agent);
      if (event) {
        handleEvent(event);
      }
    };

    const timer = timeoutMs
      ? setTimeout(() => {
          killTree(child, "SIGKILL");
        }, timeoutMs)
      : undefined;
    const onAbort = () => {
      cancelled = true;
      killTree(child, "SIGTERM");
    };
    signal?.addEventListener("abort", onAbort, { once: true });

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      fn();
    };

    child.stdout?.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      let newlineIndex = buffer.indexOf("\n");
      while (newlineIndex !== -1) {
        consumeLine(buffer.slice(0, newlineIndex));
        buffer = buffer.slice(newlineIndex + 1);
        newlineIndex = buffer.indexOf("\n");
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    child.on("error", (error) => finish(() => reject(error)));

    child.on("close", (code) => {
      if (buffer.length > 0) {
        consumeLine(buffer);
      }
      // Fall back to stderr for content when stdout produced nothing parseable,
      // so a stderr-only failure is still diagnosable rather than empty.
      const content = cancelled
        ? "Quest cancelled"
        : (resultText ?? (textParts.length > 0 ? textParts.join("\n") : stderr.trim()));
      finish(() => resolve({ content, events, exitCode: code, stderr }));
    });

    // Close stdin so CLIs that read it (codex exec, opencode run) get EOF.
    child.stdin?.end();
  });
}

function killTree(child: ReturnType<typeof spawn>, signal: NodeJS.Signals): void {
  const pid = child.pid;
  try {
    if (pid) {
      process.kill(-pid, signal);
      return;
    }
  } catch {
    // process group may already be gone
  }
  try {
    child.kill(signal);
  } catch {
    // best effort
  }
}

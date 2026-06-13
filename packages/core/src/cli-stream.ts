import { spawn } from "node:child_process";

/**
 * A coding-CLI stream event, normalized into the same shape RepoHelm uses for its
 * own `AgentEvent` (type/title/detail/agent). Produced by parsing the streaming
 * stdout of external coding CLIs (Claude Code `--output-format stream-json`,
 * Codex, OpenCode, …) so their tool calls, messages and results surface on the
 * Quest timeline incrementally instead of as a single opaque blob.
 */
export interface CliStreamEvent {
  type: "agent.message" | "agent.tool_call" | "agent.completed" | "agent.output";
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

  const obj = parsed as { type?: string; result?: unknown; message?: { content?: AssistantContentBlock[] } };

  if (obj.type === "system") {
    return undefined;
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

  // Recognized JSON envelope but nothing actionable in it → ignore as noise.
  return undefined;
}

export interface RunStreamingCliOptions {
  command: string;
  args: string[];
  agent: string;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  timeoutMs?: number;
  /** Called once per parsed event as it arrives, before the promise resolves. */
  onEvent?: (event: CliStreamEvent) => void;
}

export interface StreamingCliResult {
  content: string;
  events: CliStreamEvent[];
  exitCode: number | null;
}

/**
 * Spawn a coding CLI and stream its stdout, parsing each line into a
 * {@link CliStreamEvent} and emitting it via `onEvent` incrementally.
 *
 * Resolves (never rejects) on process exit so callers can inspect `exitCode`
 * alongside any partial events — a non-zero exit is a result, not an exception.
 */
export function runStreamingCli(options: RunStreamingCliOptions): Promise<StreamingCliResult> {
  const { command, args, agent, cwd, env, timeoutMs, onEvent } = options;
  return new Promise<StreamingCliResult>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd,
      env: { ...process.env, NO_COLOR: "1", ...env }
    });

    const events: CliStreamEvent[] = [];
    let resultText: string | undefined;
    const textParts: string[] = [];
    let buffer = "";
    let settled = false;

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
          child.kill("SIGKILL");
        }, timeoutMs)
      : undefined;

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
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

    child.on("error", (error) => finish(() => reject(error)));

    child.on("close", (code) => {
      if (buffer.length > 0) {
        consumeLine(buffer);
      }
      finish(() => resolve({ content: resultText ?? textParts.join("\n"), events, exitCode: code }));
    });

    // Close stdin so CLIs that read it (codex exec, opencode run) get EOF.
    child.stdin?.end();
  });
}

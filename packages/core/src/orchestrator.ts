import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { RepoHelmService } from "./service.js";
import {
  callLlmWithModelKit,
  type LlmMessage,
  type LlmToolCall,
  type LlmToolSpec
} from "./llm.js";
import {
  buildDelegateHandler,
  DELEGATE_TOOL_NAME,
  delegateToolSpec,
  type DelegateInput
} from "./tools/delegate.js";
import type { ModelKit, Quest, SubAgent, WorktreeState } from "./types.js";

const execFileAsync = promisify(execFile);

const MAX_TOOL_LOOP_ITERATIONS = 8;

/** Minimal backend interface used internally by the orchestrator. */
export interface SubAgentBackend {
  run(input: {
    systemPrompt: string;
    messages: Array<{ role: "user" | "assistant" | "system"; content: string }>;
    tools?: LlmToolSpec[];
    worktrees: WorktreeState[];
    quest: Quest;
  }): Promise<SubAgentBackendResult>;
}

export interface SubAgentBackendResult {
  content: string;
  toolCalls: LlmToolCall[];
  finishReason: string;
  /** Present for CLI backends that emit a one-shot summary. */
  events: Array<{ type: string; title: string; detail: string; agent: string }>;
}

export interface OrchestratorQuestResult {
  entryAgentId: string;
  entryAgentName: string;
  finalContent: string;
  delegations: Array<{ agentId: string; agentName: string; ok: boolean; summary: string }>;
  iterations: number;
}

/**
 * SubAgentOrchestrator - Supervisor + Task Tool pattern.
 *
 * The entry (supervisor) sub-agent runs an LLM loop with a single tool: `delegate`.
 * It decides which worker sub-agents to invoke and when to stop.
 * Workers run a single LLM call (or CLI shot) and return their result.
 */
export class SubAgentOrchestrator {
  constructor(private service: RepoHelmService) {}

  async executeQuest(questId: string): Promise<OrchestratorQuestResult> {
    const entryAgent = await this.service.getEntrySubAgent();
    if (!entryAgent) {
      throw new Error("No entry sub-agent configured");
    }
    const quest = await this.service.getQuest(questId);
    if (!quest) {
      throw new Error(`Quest ${questId} not found`);
    }

    const entryBackend = await this.createBackendFromModelKit(
      await this.requireModelKit(entryAgent)
    );

    const workerCatalog = await this.listWorkers();
    const delegations: OrchestratorQuestResult["delegations"] = [];

    const resolveWorker = async (agentId: string) => {
      return workerCatalog.find((w) => w.id === agentId);
    };
    const invokeWorker = async (
      worker: SubAgent,
      task: string,
      context: Record<string, unknown>
    ) => {
      const result = await this.invokeWorkerAgent(worker, { task, context, quest });
      delegations.push({
        agentId: worker.id,
        agentName: worker.name,
        ok: !result.error,
        summary: result.error ? `error: ${result.error}` : truncate(result.content, 400)
      });
      return result.error
        ? { ok: false, error: result.error }
        : { ok: true, content: result.content };
    };
    const handleDelegate = buildDelegateHandler(resolveWorker, invokeWorker);

    const systemPrompt =
      entryAgent.promptTemplate ??
      "You are the RepoHelm supervisor. You do not write code, specs, or reviews yourself. " +
        "Use the `delegate` tool to assign work to worker sub-agents, then synthesize their results into a concise summary. " +
        "Available workers: " +
        workerCatalog.map((w) => `${w.id} (${w.capabilities.join(",") || "general"})`).join("; ") +
        ".";

    const messages: LlmMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: quest.requirement }
    ];

    let iterations = 0;
    let finalContent = "";

    while (iterations < MAX_TOOL_LOOP_ITERATIONS) {
      iterations += 1;
      const response = await entryBackend.run({
        systemPrompt,
        messages: messages.map((m) => ({
          role: m.role === "tool" ? "assistant" : (m.role as "system" | "user" | "assistant"),
          content: m.content
        })),
        tools: [delegateToolSpec],
        worktrees: quest.worktrees,
        quest
      });

      if (response.toolCalls.length > 0) {
        messages.push({
          role: "assistant",
          content: response.content ?? "",
          tool_calls: response.toolCalls
        });
        for (const call of response.toolCalls) {
          const reply = await this.dispatchToolCall(call, handleDelegate);
          messages.push({
            role: "tool",
            tool_call_id: call.id,
            content: reply
          });
        }
        continue;
      }

      finalContent = response.content || "";
      break;
    }

    if (iterations >= MAX_TOOL_LOOP_ITERATIONS && !finalContent) {
      finalContent =
        "Supervisor reached the maximum iteration limit (" +
        MAX_TOOL_LOOP_ITERATIONS +
        ") without producing a final answer.";
    }

    await this.updateSubAgentUsage(entryAgent.id);

    return {
      entryAgentId: entryAgent.id,
      entryAgentName: entryAgent.name,
      finalContent,
      delegations,
      iterations
    };
  }

  private async dispatchToolCall(
    call: LlmToolCall,
    handleDelegate: (input: DelegateInput) => Promise<string>
  ): Promise<string> {
    if (call.function.name !== DELEGATE_TOOL_NAME) {
      return JSON.stringify({ ok: false, error: `unknown tool ${call.function.name}` });
    }
    let parsed: DelegateInput;
    try {
      parsed = JSON.parse(call.function.arguments || "{}");
    } catch (error) {
      return JSON.stringify({
        ok: false,
        error: `invalid delegate arguments: ${error instanceof Error ? error.message : String(error)}`
      });
    }
    return handleDelegate(parsed);
  }

  private async invokeWorkerAgent(
    worker: SubAgent,
    input: { task: string; context: Record<string, unknown>; quest: Quest }
  ): Promise<{ content: string; error?: string }> {
    try {
      const modelKit = await this.requireModelKit(worker);
      const backend = await this.createBackendFromModelKit(modelKit);
      const systemPrompt =
        worker.promptTemplate ??
        `You are a specialized worker agent named "${worker.name}". ` +
          `Your capabilities: ${worker.capabilities.join(", ") || "general"}. ` +
          `Produce a concise, high-quality result for the task below.`;
      const userContent = input.context && Object.keys(input.context).length > 0
        ? `${input.task}\n\nContext:\n${JSON.stringify(input.context, null, 2)}`
        : input.task;
      const result = await backend.run({
        systemPrompt,
        messages: [{ role: "user", content: userContent }],
        tools: [],
        worktrees: input.quest.worktrees,
        quest: input.quest
      });
      await this.updateSubAgentUsage(worker.id);
      return { content: result.content || "(worker returned no content)" };
    } catch (error) {
      return {
        content: "",
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  private async requireModelKit(agent: SubAgent): Promise<ModelKit> {
    const modelKit = await this.service.getModelKit(agent.modelKitId);
    if (!modelKit) {
      throw new Error(`ModelKit ${agent.modelKitId} not found for agent ${agent.id}`);
    }
    return modelKit;
  }

  private async listWorkers(): Promise<SubAgent[]> {
    const all = await this.service.listSubAgents();
    return all.filter((agent) => agent.mode === "worker");
  }

  private async updateSubAgentUsage(agentId: string): Promise<void> {
    try {
      await this.service.updateSubAgentUsage(agentId);
    } catch {
      // usage stats are best-effort
    }
  }

  /**
   * Build a SubAgentBackend from a ModelKit.
   * - type=byok: uses OpenAI-compatible chat completions with full tool-call loop support.
   * - type=cli:  shells out via the configured external CLI (codex/claude/opencode), one-shot.
   */
  async createBackendFromModelKit(modelKit: ModelKit): Promise<SubAgentBackend> {
    if (modelKit.type === "byok") {
      return this.createByokBackend(modelKit);
    }
    if (modelKit.type === "cli") {
      return this.createCliBackend(modelKit);
    }
    throw new Error(`ModelKit ${modelKit.id} has unsupported type ${(modelKit as { type: string }).type}`);
  }

  private createByokBackend(modelKit: ModelKit): SubAgentBackend {
    return {
      async run(input) {
        const messages: LlmMessage[] = [
          { role: "system", content: input.systemPrompt },
          ...input.messages.map((m) => ({
            role: m.role as LlmMessage["role"],
            content: m.content
          }))
        ];
        const result = await callLlmWithModelKit({
          modelKit,
          messages,
          tools: input.tools && input.tools.length > 0 ? input.tools : undefined
        });
        return {
          content: result.content,
          toolCalls: result.toolCalls,
          finishReason: result.finishReason,
          events: [
            {
              type: "agent.byok.call",
              title: `ModelKit ${modelKit.name} 调用完成`,
              detail: `model=${modelKit.model} finish=${result.finishReason}`,
              agent: modelKit.name
            }
          ]
        };
      }
    };
  }

  private createCliBackend(modelKit: ModelKit): SubAgentBackend {
    const backendId = modelKit.backendId;
    const envVar = resolveCliEnvVar(backendId);
    return {
      async run(input) {
        const command = process.env[envVar];
        if (!command) {
          throw new Error(
            `CLI backend ${backendId} requires environment variable ${envVar} to be set.`
          );
        }
        const prompt = [input.systemPrompt, ...input.messages.map((m) => m.content)]
          .filter(Boolean)
          .join("\n\n---\n\n");
        const { stdout, stderr } = await execFileAsync(command, [prompt], {
          maxBuffer: 10 * 1024 * 1024
        }).catch((error: { stdout?: string; stderr?: string; message?: string }) => {
          throw new Error(
            `CLI backend ${backendId} failed: ${error.message}\n${error.stderr ?? ""}`
          );
        });
        const content = (stdout || "").trim() || (stderr || "").trim();
        return {
          content,
          toolCalls: [],
          finishReason: "stop",
          events: [
            {
              type: "agent.cli.call",
              title: `CLI ${backendId} 调用完成`,
              detail: truncate(content, 200) || "(empty)",
              agent: modelKit.name
            }
          ]
        };
      }
    };
  }
}

function resolveCliEnvVar(backendId: string | undefined): string {
  switch (backendId) {
    case "codex-cli":
      return "REPOHELM_CODEX_COMMAND";
    case "claude-code":
      return "REPOHELM_CLAUDE_COMMAND";
    case "opencode":
      return "REPOHELM_OPENCODE_COMMAND";
    default:
      return "REPOHELM_GENERIC_CLI_COMMAND";
  }
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max - 1) + "…";
}

import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, join } from "node:path";
import { promisify } from "node:util";
import { RepoHelmService } from "./service.js";
import {
  callLlmWithModelKit,
  type LlmMessage,
  type LlmToolCall,
  type LlmToolSpec
} from "./llm.js";
import { assessComplexity, generateOrchestrationPlan } from "./planning.js";
import { QuestWorkspaceManager } from "./quest-workspace.js";
import {
  buildDelegateHandler,
  DELEGATE_TOOL_NAME,
  delegateToolSpec,
  type DelegateInput
} from "./tools/delegate.js";
import { buildFsToolHandlers, extractFilesFromContent, FS_WRITE_TOOL, fsToolSpecs } from "./tools/fs.js";
import {
  resolveContract,
  renderContractSection,
  minimalContract,
  validateMaterialOutput,
  type DependencyResult
} from "./task-contract.js";
import type { ModelKit, OrchestrationPlan, OrchestrationPlanStep, Quest, SubAgent, WorktreeState } from "./types.js";

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
 * SubAgentOrchestrator — Plan-then-Execute orchestration.
 *
 * Phase 1 (generatePlan): Entry agent produces a structured plan.
 * Phase 2 (executeApprovedPlan): Steps are executed in dependency order via delegation.
 */
export class SubAgentOrchestrator {
  readonly questWorkspace: QuestWorkspaceManager;

  constructor(private service: RepoHelmService, questWorkspaceRoot?: string) {
    this.questWorkspace = new QuestWorkspaceManager(
      questWorkspaceRoot ?? service.getRootDir()
    );
  }

  async generatePlan(questId: string): Promise<OrchestrationPlan> {
    const entryAgent = await this.service.getEntrySubAgent();
    if (!entryAgent) {
      throw new Error("No entry sub-agent configured");
    }
    const quest = await this.service.getQuest(questId);
    if (!quest) {
      throw new Error(`Quest ${questId} not found`);
    }

    // Fast-path: simple quests get single-step plan without LLM call
    const complexity = assessComplexity(quest);
    if (complexity.isSimple) {
      return this.createSimplePlan(quest, entryAgent);
    }

    const entryBackend = await this.createBackendFromModelKit(
      await this.requireModelKit(entryAgent)
    );
    const agentPool = await this.listDelegatableAgents(entryAgent.id);

    return generateOrchestrationPlan({
      entryAgent,
      quest,
      agentPool,
      backend: entryBackend
    });
  }

  /**
   * Create a simple single-step plan for straightforward quests.
   */
  private async createSimplePlan(quest: Quest, entryAgent: SubAgent): Promise<OrchestrationPlan> {
    const agentPool = await this.listDelegatableAgents(entryAgent.id);

    // Find best coding agent
    const codingAgent =
      agentPool.find((a) => a.capabilities?.includes("coding")) || agentPool[0];

    if (!codingAgent) {
      throw new Error("No suitable agent found for this quest");
    }

    const projectId = quest.affectedProjectIds[0]!;
    // Keep description single-line: targetProjectId already carries the project
    // context separately. Embedding newlines here would corrupt the plan.md
    // structure (### heading) and break parsePlanMarkdown's regex.
    const description = quest.requirement.replace(/\s*\n\s*/g, " ").trim();

    return {
      questId: quest.id,
      summary: `Single-step implementation for ${quest.title}`,
      steps: [
        {
          id: "step_1",
          description,
          agentId: codingAgent.id,
          agentName: codingAgent.name,
          dependencies: [],
          expectedOutput: "Implementation code and artifacts",
          targetProjectId: projectId,
          contract: minimalContract("Implementation code and artifacts")
        }
      ],
      notes: "Auto-generated simple plan for straightforward task",
      generatedAt: new Date().toISOString()
    };
  }

  async executeApprovedPlan(questId: string, plan: OrchestrationPlan): Promise<OrchestratorQuestResult> {
    const entryAgent = await this.service.getEntrySubAgent();
    if (!entryAgent) {
      throw new Error("No entry sub-agent configured");
    }
    const quest = await this.service.getQuest(questId);
    if (!quest) {
      throw new Error(`Quest ${questId} not found`);
    }

    const agentPool = await this.listDelegatableAgents(entryAgent.id);
    const delegations: OrchestratorQuestResult["delegations"] = [];
    const stepResults = new Map<string, string>();
    const failedSteps = new Set<string>();

    const executed = new Set<string>();
    const stepsToRun = [...plan.steps];

    while (stepsToRun.length > 0) {
      const ready = stepsToRun.filter(
        (step) => step.dependencies.every((dep) => executed.has(dep))
      );
      if (ready.length === 0) {
        break;
      }

      for (const step of ready) {
        const agent = agentPool.find((a) => a.id === step.agentId);
        if (!agent) {
          delegations.push({
            agentId: step.agentId,
            agentName: step.agentName,
            ok: false,
            summary: `agent ${step.agentId} not found in pool`
          });
          failedSteps.add(step.id);
          executed.add(step.id);
          stepsToRun.splice(stepsToRun.indexOf(step), 1);
          continue;
        }

        const failedDependencies = step.dependencies.filter((dep) => failedSteps.has(dep));
        if (failedDependencies.length > 0) {
          const summary = `skipped: dependency failed (${failedDependencies.join(", ")})`;
          delegations.push({
            agentId: agent.id,
            agentName: agent.name,
            ok: false,
            summary
          });
          stepResults.set(step.id, summary);
          failedSteps.add(step.id);
          executed.add(step.id);
          stepsToRun.splice(stepsToRun.indexOf(step), 1);
          continue;
        }

        // Get the target project for this step
        const targetProjectId = step.targetProjectId || quest.affectedProjectIds[0];

        const dependencies: DependencyResult[] = step.dependencies.map((dep) => ({
          stepId: dep,
          result: stepResults.get(dep) || ""
        }));

        const result = await this.invokeWorkerAgent(agent, {
          step,
          dependencies,
          quest,
          targetProjectId
        });
        const material = !result.error
          ? validateMaterialOutput(step, result.writtenFiles ?? [])
          : { ok: false, required: false };
        const stepError = result.error || (!material.ok ? material.reason : undefined);

        const filesNote =
          result.writtenFiles && result.writtenFiles.length > 0
            ? `\n写入文件: ${result.writtenFiles.join(", ")}`
            : "";
        const summary = stepError
          ? `error: ${stepError}${result.content ? `\nWorker output: ${truncate(result.content, 300)}` : ""}`
          : `${truncate(result.content, 400)}${filesNote}`;
        delegations.push({
          agentId: agent.id,
          agentName: agent.name,
          ok: !stepError,
          summary
        });

        if (!stepError) {
          stepResults.set(step.id, result.content);
        } else {
          failedSteps.add(step.id);
        }
        executed.add(step.id);
        stepsToRun.splice(stepsToRun.indexOf(step), 1);
      }
    }

    await this.updateSubAgentUsage(entryAgent.id);

    const finalContent = delegations.length === 0
      ? "No steps were executed."
      : delegations
          .map((d, i) => `${i + 1}. ${d.agentName} (${d.ok ? "ok" : "fail"}): ${d.summary}`)
          .join("\n");

    return {
      entryAgentId: entryAgent.id,
      entryAgentName: entryAgent.name,
      finalContent: `${plan.summary}\n\n---\n\n${finalContent}`,
      delegations,
      iterations: executed.size
    };
  }

  private async listDelegatableAgents(entryAgentId: string): Promise<SubAgent[]> {
    const all = await this.service.listSubAgents();
    return all.filter((agent) => agent.id !== entryAgentId);
  }

  private async invokeWorkerAgent(
    worker: SubAgent,
    input: {
      step: OrchestrationPlanStep;
      dependencies: DependencyResult[];
      quest: Quest;
      targetProjectId?: string;
    }
  ): Promise<{ content: string; error?: string; writtenFiles?: string[] }> {
    try {
      const modelKit = await this.requireModelKit(worker);
      const basePrompt =
        worker.promptTemplate ??
        `You are a specialized worker agent named "${worker.name}". ` +
          `Your capabilities: ${worker.capabilities?.join(", ") || "general"}. ` +
          `Produce a concise, high-quality result for the task below.`;
      const userContent = renderContractSection(
        resolveContract(input.step),
        input.dependencies
      );

      // Find the worktree for the target project, or fall back only when the
      // plan did not specify a target. A stale target must not silently run in
      // another repo's worktree.
      const worktree = input.targetProjectId
        ? input.quest.worktrees.find(
            (item) => item.projectId === input.targetProjectId && item.status === "created" && item.worktreePath
          )
        : input.quest.worktrees.find((item) => item.status === "created" && item.worktreePath);

      if (input.targetProjectId && !worktree) {
        return {
          content: "",
          error: `target project ${input.targetProjectId} has no created worktree`
        };
      }

      let content: string;
      const writtenFiles = new Set<string>();

      if (worktree) {
        const beforeChanges = await readWorktreeChangeSnapshot(worktree.worktreePath);
        const projectDir = basename(worktree.worktreePath);
        const systemPrompt =
          `${basePrompt}\n\n` +
          `You are implementing changes inside an isolated git worktree which IS the project root: "${worktree.worktreePath}". ` +
          `Output EVERY file you create or modify as a fenced code block whose info string is the file path relative to the project root, e.g.:\n` +
          "```index.html\n<full file contents>\n```\n" +
          `Provide complete file contents (not diffs). Keep paths relative to the project root — use "index.html", not "${projectDir}/index.html".`;

        if (modelKit.type === "byok") {
          // Tool-capable models can write files directly via the file-system tools.
          const loop = await this.runWorkerWithFsTools(modelKit, systemPrompt, userContent, worktree.worktreePath);
          content = loop.content || "";
          loop.written.forEach((file) => writtenFiles.add(file));
        } else {
          // CLI / other backends: run in the worktree and capture their answer.
          const backend = await this.createBackendFromModelKit(modelKit);
          const result = await backend.run({
            systemPrompt,
            messages: [{ role: "user", content: userContent }],
            tools: [],
            worktrees: [worktree],
            quest: input.quest
          });
          content = result.content || "";
        }

        // Backend-agnostic safety net: materialize any files described in the answer
        // into the worktree (covers print-mode CLIs and models that emit code blocks).
        const fsHandlers = buildFsToolHandlers(worktree.worktreePath);
        for (const file of extractFilesFromContent(content, projectDir)) {
          await fsHandlers.handle(FS_WRITE_TOOL, { path: file.path, content: file.content });
        }
        fsHandlers.written.forEach((file) => writtenFiles.add(file));
        const afterChanges = await readWorktreeChangeSnapshot(worktree.worktreePath);
        for (const file of changedPathsSince(beforeChanges, afterChanges)) {
          writtenFiles.add(file);
        }

        if (!content) {
          content = writtenFiles.size > 0 ? `Wrote ${writtenFiles.size} file(s).` : "(worker returned no content)";
        }
      } else {
        const backend = await this.createBackendFromModelKit(modelKit);
        const result = await backend.run({
          systemPrompt: basePrompt,
          messages: [{ role: "user", content: userContent }],
          tools: [],
          worktrees: input.quest.worktrees,
          quest: input.quest
        });
        content = result.content || "(worker returned no content)";
      }

      await this.updateSubAgentUsage(worker.id);

      if (input.step.id) {
        await this.questWorkspace.writeWorkerArtifact(
          input.quest.id,
          input.step.id,
          worker.name,
          content
        );
      }
      return { content, writtenFiles: [...writtenFiles] };
    } catch (error) {
      return {
        content: "",
        error: error instanceof Error ? error.message : String(error)
      };
    }
  }

  /**
   * Run a worker BYOK model in a bounded tool-calling loop, letting it write real
   * files into the worktree. Returns the worker's final text and the list of files
   * it created/overwrote (worktree-relative paths).
   */
  private async runWorkerWithFsTools(
    modelKit: ModelKit,
    systemPrompt: string,
    userContent: string,
    worktreeRoot: string
  ): Promise<{ content: string; written: string[] }> {
    const fs = buildFsToolHandlers(worktreeRoot);
    const messages: LlmMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent }
    ];
    let finalContent = "";
    for (let i = 0; i < MAX_TOOL_LOOP_ITERATIONS; i++) {
      const result = await callLlmWithModelKit({ modelKit, messages, tools: fsToolSpecs });
      if (result.content) {
        finalContent = result.content;
      }
      if (!result.toolCalls || result.toolCalls.length === 0) {
        break;
      }
      messages.push({ role: "assistant", content: result.content ?? "", tool_calls: result.toolCalls });
      for (const call of result.toolCalls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || "{}");
        } catch {
          args = {};
        }
        const output = await fs.handle(call.function.name, args);
        messages.push({ role: "tool", tool_call_id: call.id, content: output });
      }
    }
    return { content: finalContent, written: [...fs.written] };
  }

  private async requireModelKit(agent: SubAgent): Promise<ModelKit> {
    const modelKit = await this.service.getModelKit(agent.modelKitId);
    if (!modelKit) {
      throw new Error(`ModelKit ${agent.modelKitId} not found for agent ${agent.id}`);
    }
    return modelKit;
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
    return {
      run: async (input) => {
        const envVar = resolveCliEnvVar(backendId);
        let command = process.env[envVar];
        let cliArgs: string[] = [];

        // Run the CLI inside the created worktree so any edits it makes land there.
        const createdWorktree = input.worktrees.find((item) => item.status === "created" && item.worktreePath);
        // The full prompt must carry the system instructions (worktree path + output
        // convention), not just the task — earlier this was dropped on the CLI path.
        const prompt = [input.systemPrompt, ...input.messages.map((m) => m.content)]
          .filter(Boolean)
          .join("\n\n---\n\n");

        if (!command && backendId) {
          command = await this.service.resolveCliCommand(backendId);
          const def = this.service.getCliDefinition(backendId);
          const model = modelKit.model !== "default" ? modelKit.model : undefined;
          // Prefer the edit-capable `exec` invocation when we have a worktree to write into.
          const builder = createdWorktree && def?.exec ? def.exec : def?.ping;
          if (builder) {
            cliArgs = builder.build(prompt, model);
          }
        }

        if (!command) {
          throw new Error(
            `CLI backend ${backendId} not found. Install it or set ${envVar} environment variable.`
          );
        }

        if (cliArgs.length === 0) {
          cliArgs = [prompt];
        }

        const { stdout, stderr } = await execFileAsync(command, cliArgs, {
          maxBuffer: 10 * 1024 * 1024,
          cwd: createdWorktree?.worktreePath
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

async function readWorktreeChangeSnapshot(worktreePath: string): Promise<Map<string, string>> {
  const paths = new Set<string>();
  await addGitSnapshotPaths(paths, worktreePath, ["status", "--porcelain=v1", "--untracked-files=all"], "status");
  await addGitSnapshotPaths(paths, worktreePath, ["diff", "--name-only"], "name-only");
  await addGitSnapshotPaths(paths, worktreePath, ["diff", "--cached", "--name-only"], "name-only");

  const snapshot = new Map<string, string>();
  for (const path of paths) {
    snapshot.set(path, await fileSignature(worktreePath, path));
  }
  return snapshot;
}

async function addGitSnapshotPaths(
  paths: Set<string>,
  worktreePath: string,
  args: string[],
  mode: "status" | "name-only"
): Promise<void> {
  const { stdout } = await execFileAsync("git", args, { cwd: worktreePath });
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const path = mode === "status" ? pathFromGitStatusLine(trimmed) : cleanGitPath(trimmed);
    if (path) paths.add(path);
  }
}

function changedPathsSince(before: Map<string, string>, after: Map<string, string>): string[] {
  const paths = new Set<string>();
  const allPaths = new Set([...before.keys(), ...after.keys()]);
  for (const path of allPaths) {
    if (before.get(path) !== after.get(path)) {
      paths.add(path);
    }
  }
  return [...paths].sort();
}

async function fileSignature(worktreePath: string, path: string): Promise<string> {
  try {
    const content = await readFile(join(worktreePath, path));
    return createHash("sha256").update(content).digest("hex");
  } catch {
    return "<missing>";
  }
}

function pathFromGitStatusLine(line: string): string {
  const porcelainPath = line.slice(3);
  const renamedPath = porcelainPath.includes(" -> ")
    ? porcelainPath.split(" -> ").pop() ?? porcelainPath
    : porcelainPath;
  return cleanGitPath(renamedPath);
}

function cleanGitPath(path: string): string {
  return path.trim().replace(/^"|"$/g, "");
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max - 1) + "…";
}

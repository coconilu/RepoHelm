import { execFile } from "node:child_process";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, join } from "node:path";
import { promisify } from "node:util";
import { RepoHelmService } from "./service.js";
import {
  callLlmWithModelKit,
  type LlmMessage,
  type LlmToolCall,
  type LlmToolSpec
} from "./llm.js";
import { assessComplexity, generateOrchestrationPlan } from "./planning.js";
import { buildDelegationPrompt, runDelegationLoop } from "./delegation.js";
import { QuestWorkspaceManager } from "./quest-workspace.js";
import { type DelegateInput } from "./tools/delegate.js";
import { buildFsToolHandlers, extractFilesFromContent, FS_WRITE_TOOL } from "./tools/fs.js";
import { buildWorkerToolsetAsync } from "./tools/worker-tools.js";
import { createMcpToolset, type McpToolset } from "./mcp-runtime.js";
import { createSandboxRuntime } from "./sandbox.js";
import { extractTokenUsage, runtimeUsageEvent } from "./runtime-usage.js";
import { runStreamingCli } from "./cli-stream.js";
import {
  resolveContract,
  renderContractSection,
  minimalContract,
  validateMaterialOutput,
  type DependencyResult
} from "./task-contract.js";
import {
  buildLeadDecisionPrompt,
  parseLeadDecision,
  type LeadDecision
} from "./lead-decision.js";
import type {
  AgentEventPhase,
  AgentEventSeverity,
  AgentEventVisibility,
  CollaborationTraceEdge,
  ModelKit,
  OrchestrationPlan,
  OrchestrationPlanStep,
  Quest,
  SubAgent,
  WorktreeState
} from "./types.js";

const execFileAsync = promisify(execFile);

const MAX_TOOL_LOOP_ITERATIONS = 8;

/**
 * Whether `agent` can receive delegated subtasks (plan steps or runtime delegate
 * calls) from the entry agent. Excludes the entry itself and the built-in system
 * agents (`mode: "system"` — kb / habits / failure-experience), which are driven
 * via `invokeSystemAgent`, not the orchestration worker pool. Legacy agents with
 * no `mode` set are treated as workers (backward compatible).
 */
export function isDelegatableWorker(agent: SubAgent, entryAgentId: string): boolean {
  return agent.id !== entryAgentId && agent.mode !== "entry" && agent.mode !== "system";
}

/** One delegate-tool call's outcome in delegate mode (success OR any failure:
 *  malformed call, unknown/non-worker agent, invalid target, worker error, or
 *  missing required material output). The full sequence is the audit trail. */
export interface DelegateAttempt {
  agentId: string;
  agentName: string;
  task: string;
  /** The project this attempt targeted (resolved fallback for ran attempts; the
   *  raw/declared value for an attempt rejected on a bad target). Part of subtask
   *  identity, so a rejection only folds away when the SAME (target, task) succeeds. */
  targetProjectId: string;
  ok: boolean;
  error?: string;
  content: string;
  writtenFiles: string[];
  events: BackendEvent[];
}

/** Identity of a logical subtask: the (target project, task) pair. Same pair ⇒ the
 *  same work, so a retry folds — INCLUDING a reassignment to a different worker (the
 *  executing agent is deliberately NOT part of identity, mirroring the plan path's
 *  reassign-then-recover). A different project (even with identical task text, as in
 *  a multi-repo quest delegating "Update README" to two repos) is a DISTINCT subtask
 *  and must not be folded. The key is a JSON tuple — plain ASCII, no control-char
 *  separators (a stray NUL would turn the source file binary). */
function delegateKey(a: DelegateAttempt): string {
  return JSON.stringify([a.targetProjectId, a.task.trim()]);
}

/**
 * Collapse a sequence of delegate attempts into one terminal outcome per logical
 * subtask — identified by (target project, task), NOT the executing agent — so the
 * quest's blocked/ready decision is recovery-aware AND never masks a real failure:
 *
 * - A later success of the SAME (target, task) supersedes an earlier failure of that
 *   subtask (success is sticky), INCLUDING a reassignment to a different worker, or an
 *   unknown-agent/missing-arg rejection later retried correctly against the same target.
 * - A failure whose (target, task) NEVER succeeds is preserved and blocks delivery —
 *   so an identical task against a DIFFERENT project (multi-repo quest), or a rejection
 *   on an invalid/declared-wrong target (which can never match a valid success), is a
 *   distinct unrecovered subtask, not swallowed by some sibling success.
 *
 * Every attempt's events are retained for the audit trail.
 */
export function foldDelegations(attempts: DelegateAttempt[]): OrchestratorQuestResult["delegations"] {
  const order: string[] = [];
  const finalByKey = new Map<string, DelegateAttempt>();
  const failuresByKey = new Map<string, number>();
  for (const attempt of attempts) {
    const key = delegateKey(attempt);
    const prev = finalByKey.get(key);
    if (!prev) order.push(key);
    // Upgrade a failure to a later success, or replace a failure with a newer
    // failure — but never downgrade a recorded success back to a failure.
    if (!prev || attempt.ok || !prev.ok) finalByKey.set(key, attempt);
    if (!attempt.ok) failuresByKey.set(key, (failuresByKey.get(key) ?? 0) + 1);
  }
  return order.map((key) => {
    const final = finalByKey.get(key)!;
    const events = attempts.filter((a) => delegateKey(a) === key).flatMap((a) => a.events);
    const priorFailures = (failuresByKey.get(key) ?? 0) - (final.ok ? 0 : 1);
    const recoveryNote =
      priorFailures > 0
        ? `\n恢复记录: 该子任务先经历 ${priorFailures} 次失败后${final.ok ? "成功" : "仍失败"}`
        : "";
    const summary = final.ok
      ? `${truncate(final.content, 400)}${final.writtenFiles.length ? `\n写入文件: ${final.writtenFiles.join(", ")}` : ""}${recoveryNote}`
      : `error: ${final.error}${final.content ? `\nWorker output: ${truncate(final.content, 300)}` : ""}${recoveryNote}`;
    return { agentId: final.agentId, agentName: final.agentName, ok: final.ok, summary, events };
  });
}

/**
 * Deterministic hard cap on how many times a single plan step may run (initial
 * attempt + lead-driven retries/reassigns/revisions). The orchestrator enforces
 * this regardless of what the lead chooses, so a step always terminates.
 */
const MAX_STEP_ATTEMPTS = 3;

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

/** A fine-grained execution event (tool call, message, command output, …). */
export interface BackendEvent {
  type: string;
  title: string;
  detail: string;
  agent: string;
  phase?: AgentEventPhase;
  visibility?: AgentEventVisibility;
  severity?: AgentEventSeverity;
  stepId?: string;
  projectId?: string;
  collaboration?: CollaborationTraceEdge;
}

function collaborationEdgeEvent(input: {
  title: string;
  agent: string;
  detail?: string;
  stepId?: string;
  projectId?: string;
  collaboration: CollaborationTraceEdge;
}): BackendEvent {
  return {
    type: "collaboration.edge",
    title: input.title,
    detail: input.detail ?? JSON.stringify(input.collaboration),
    agent: input.agent,
    phase: "execute",
    visibility: "process",
    severity: "info",
    ...(input.stepId ? { stepId: input.stepId } : {}),
    ...(input.projectId ? { projectId: input.projectId } : {}),
    collaboration: input.collaboration
  };
}

export interface SubAgentBackendResult {
  content: string;
  toolCalls: LlmToolCall[];
  finishReason: string;
  events: BackendEvent[];
}

export interface OrchestratorQuestResult {
  entryAgentId: string;
  entryAgentName: string;
  finalContent: string;
  delegations: Array<{ agentId: string; agentName: string; ok: boolean; summary: string; events?: BackendEvent[] }>;
  iterations: number;
  /** Events emitted by the entry agent itself (delegate-mode loop): its tool
   *  calls and messages, surfaced on the timeline ahead of the worker events. */
  entryEvents?: BackendEvent[];
}

/**
 * SubAgentOrchestrator — Plan-then-Execute orchestration.
 *
 * Phase 1 (generatePlan): Entry agent produces a structured plan.
 * Phase 2 (executeApprovedPlan): Steps are executed in dependency order via delegation.
 */
export class SubAgentOrchestrator {
  readonly questWorkspace: QuestWorkspaceManager;
  private sharedMcpToolsetPromise?: Promise<McpToolset | undefined>;

  constructor(private service: RepoHelmService, questWorkspaceRoot?: string) {
    this.questWorkspace = new QuestWorkspaceManager(
      questWorkspaceRoot ?? service.getRootDir()
    );
  }

  private questSignal(questId: string | undefined): AbortSignal | undefined {
    const maybeService = this.service as RepoHelmService & {
      getQuestAbortSignal?: (questId: string) => AbortSignal | undefined;
    };
    return questId && typeof maybeService.getQuestAbortSignal === "function"
      ? maybeService.getQuestAbortSignal(questId)
      : undefined;
  }

  private assertNotCancelled(questId: string | undefined): void {
    const maybeService = this.service as RepoHelmService & {
      assertQuestNotCancelled?: (questId: string) => void;
    };
    if (questId && typeof maybeService.assertQuestNotCancelled === "function") {
      maybeService.assertQuestNotCancelled(questId);
    }
  }

  private async sandboxRuntimeId(): Promise<"local-worktree" | "cubesandbox"> {
    const maybeService = this.service as RepoHelmService & {
      getSandboxRuntimeId?: () => Promise<"local-worktree" | "cubesandbox">;
    };
    return typeof maybeService.getSandboxRuntimeId === "function"
      ? maybeService.getSandboxRuntimeId()
      : "local-worktree";
  }

  private async approvedMcpServers(): Promise<Awaited<ReturnType<RepoHelmService["listApprovedMcpServers"]>>> {
    const maybeService = this.service as RepoHelmService & {
      listApprovedMcpServers?: RepoHelmService["listApprovedMcpServers"];
    };
    return typeof maybeService.listApprovedMcpServers === "function"
      ? maybeService.listApprovedMcpServers()
      : [];
  }

  private async sharedMcpToolset(): Promise<McpToolset | undefined> {
    this.sharedMcpToolsetPromise ??= this.approvedMcpServers().then((servers) =>
      servers.length > 0 ? createMcpToolset(servers) : undefined
    );
    return this.sharedMcpToolsetPromise;
  }

  private async disposeSharedMcpToolset(): Promise<void> {
    const promise = this.sharedMcpToolsetPromise;
    this.sharedMcpToolsetPromise = undefined;
    const toolset = await promise?.catch(() => undefined);
    await toolset?.dispose();
  }

  private async withSharedMcpToolset<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run();
    } finally {
      await this.disposeSharedMcpToolset();
    }
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

    // Resolve the affected projects so the planner can target a specific worktree by ID
    // (see PlanGeneratorInput.projects). Without this, multi-project plans cannot assign
    // different steps to different repos.
    const state = await this.service.getState();
    const projects = quest.affectedProjectIds
      .map((id) => state.projects.find((p) => p.id === id))
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .map((p) => ({ id: p.id, name: p.name }));

    return generateOrchestrationPlan({
      entryAgent,
      quest,
      agentPool,
      backend: entryBackend,
      projects
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
    return this.withSharedMcpToolset(() => this.executeApprovedPlanInner(questId, plan));
  }

  private async executeApprovedPlanInner(questId: string, plan: OrchestrationPlan): Promise<OrchestratorQuestResult> {
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
    let aborted = false;

    while (stepsToRun.length > 0 && !aborted) {
      this.assertNotCancelled(questId);
      const ready = stepsToRun.filter(
        (step) => step.dependencies.every((dep) => executed.has(dep))
      );
      if (ready.length === 0) {
        break;
      }

      for (const step of ready) {
        this.assertNotCancelled(questId);
        const failedDependencies = step.dependencies.filter((dep) => failedSteps.has(dep));
        if (failedDependencies.length > 0) {
          const summary = `skipped: dependency failed (${failedDependencies.join(", ")})`;
          delegations.push({
            agentId: step.agentId,
            agentName: step.agentName,
            ok: false,
            summary
          });
          stepResults.set(step.id, summary);
          failedSteps.add(step.id);
          executed.add(step.id);
          stepsToRun.splice(stepsToRun.indexOf(step), 1);
          continue;
        }

        // Deterministic recovery loop: run the step, and on a non-clean outcome
        // (worker error OR missing material output) let the lead agent pick a
        // bounded action — retry / reassign / revise / skip / abort. The
        // orchestrator enforces MAX_STEP_ATTEMPTS, so the step always terminates,
        // and records EXACTLY ONE delegation reflecting the final outcome (a
        // recovered step is "ok"), folding the recovery trail into its summary.
        const outcome = await this.runStepWithRecovery(step, {
          quest,
          agentPool,
          entryAgent,
          dependencies: step.dependencies.map((dep) => ({
            stepId: dep,
            result: stepResults.get(dep) || ""
          }))
        });

        delegations.push({
          agentId: outcome.agentId,
          agentName: outcome.agentName,
          ok: outcome.ok,
          summary: outcome.summary,
          events: outcome.events
        });
        if (outcome.ok) {
          stepResults.set(step.id, outcome.content);
        } else {
          failedSteps.add(step.id);
        }
        executed.add(step.id);
        stepsToRun.splice(stepsToRun.indexOf(step), 1);
        if (outcome.aborted) {
          aborted = true;
          break;
        }
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

  /**
   * Delegate-mode execution: the entry agent runs in a tool-calling loop whose
   * only tool is `delegate`, deciding AT RUNTIME which worker handles each
   * subtask (vs the static, pre-approved DAG of executeApprovedPlan). Each
   * delegate call is routed to the named worker via the existing
   * invokeWorkerAgent path; the worker's result is threaded back so the entry
   * can adapt — delegate again, to a different worker, with a new task.
   *
   * Requires a BYOK entry ModelKit (the loop is driven by callLlmWithModelKit
   * tool calls). Returns the same OrchestratorQuestResult shape as the plan path
   * so persistence is shared.
   */
  async executeDelegated(questId: string): Promise<OrchestratorQuestResult> {
    return this.withSharedMcpToolset(() => this.executeDelegatedInner(questId));
  }

  private async executeDelegatedInner(questId: string): Promise<OrchestratorQuestResult> {
    const entryAgent = await this.service.getEntrySubAgent();
    if (!entryAgent) {
      throw new Error("No entry sub-agent configured");
    }
    const quest = await this.service.getQuest(questId);
    if (!quest) {
      throw new Error(`Quest ${questId} not found`);
    }
    const modelKit = await this.requireModelKit(entryAgent);
    if (modelKit.type !== "byok") {
      throw new Error(
        `Delegate mode requires a BYOK entry ModelKit; agent ${entryAgent.id} uses ${modelKit.type}`
      );
    }

    const agentPool = await this.listDelegatableAgents(entryAgent.id);
    const state = await this.service.getState();
    const projects = quest.affectedProjectIds
      .map((id) => state.projects.find((p) => p.id === id))
      .filter((p): p is NonNullable<typeof p> => Boolean(p))
      .map((p) => ({ id: p.id, name: p.name }));
    const validProjectIds = new Set(quest.affectedProjectIds);

    // Every delegate call's outcome (success OR any kind of failure). The delegate
    // routing is inlined here rather than via buildDelegateHandler so the tool
    // message's OUTER `ok` is truthful (a semantic failure is ok:false, not an
    // ok:true envelope hiding result.error) and EVERY failure — including the
    // pre-worker validations (malformed call / unknown agent / invalid target) —
    // lands in this trail instead of being silently dropped.
    const attempts: DelegateAttempt[] = [];
    let delegateSeq = 0;

    const onDelegate = async (input: DelegateInput): Promise<string> => {
      const agentId = typeof input?.agentId === "string" ? input.agentId : "";
      const task = typeof input?.task === "string" ? input.task : "";
      const context = (input?.context ?? {}) as Record<string, unknown>;
      const rawTarget = typeof context.targetProjectId === "string" ? context.targetProjectId : undefined;
      // Identity target used for recovery folding (see foldDelegations). An omitted
      // target normalizes to the default (sole/first affected) project — exactly what
      // a ran attempt resolves to — so a rejection on the default target (unknown
      // agent / missing arg with no target passed) folds into a later success there.
      // A present-but-invalid target keeps its raw value: it can never match a valid
      // success, so it stays a distinct, unrecoverable subtask (does not edit the
      // wrong repo, and is not masked by an unrelated success).
      const declaredTarget = rawTarget ?? quest.affectedProjectIds[0] ?? "";

      // Record a failed attempt and return a tool message with a truthful ok:false.
      const fail = (
        agentName: string,
        error: string,
        targetProjectId: string,
        content = "",
        writtenFiles: string[] = [],
        events: BackendEvent[] = []
      ): string => {
        attempts.push({ agentId: agentId || "?", agentName, task, targetProjectId, ok: false, error, content, writtenFiles, events });
        return JSON.stringify({ ok: false, agentId, agentName, error, ...(content ? { content } : {}) });
      };

      if (!agentId) return fail("?", "agentId is required", declaredTarget);
      if (!task) return fail(agentId, "task is required", declaredTarget);
      const worker = agentPool.find((a) => a.id === agentId);
      if (!worker) {
        // agentPool already excludes the entry and system agents, so delegating to
        // any of them surfaces here as "not a delegatable worker".
        return fail(agentId, `agent ${agentId} not found or not a delegatable worker`, declaredTarget);
      }

      // A present-but-invalid target must NOT silently fall back to the default
      // project — that would edit the wrong repo — so fail it (keeping its raw value
      // as identity); the supervisor can re-delegate with the right id.
      if (rawTarget !== undefined && !validProjectIds.has(rawTarget)) {
        return fail(worker.name, `invalid targetProjectId "${rawTarget}": not an affected project of this quest`, declaredTarget);
      }
      const targetProjectId = declaredTarget;

      const step: OrchestrationPlanStep = {
        id: `delegate_${++delegateSeq}`,
        description: task,
        agentId: worker.id,
        agentName: worker.name,
        dependencies: [],
        expectedOutput: "",
        targetProjectId,
        contract: minimalContract(task)
      };
      const res = await this.invokeWorkerAgent(worker, { step, dependencies: [], quest, targetProjectId });
      const writtenFiles = res.writtenFiles ?? [];
      // Same material-output guard as the plan path (runStepWithRecovery): a task
      // that implies file changes but produced none is a failure; pure research /
      // text tasks are not "required" and stay ok with no files.
      const material = !res.error ? validateMaterialOutput(step, writtenFiles) : { ok: false, required: false };
      const failReason = res.error ?? (!material.ok ? material.reason : undefined);
      if (failReason) {
        return fail(worker.name, failReason, targetProjectId, res.content, writtenFiles, res.events ?? []);
      }
      attempts.push({
        agentId: worker.id,
        agentName: worker.name,
        task,
        targetProjectId,
        ok: true,
        content: res.content,
        writtenFiles,
        events: res.events ?? []
      });
      return JSON.stringify({ ok: true, agentId: worker.id, agentName: worker.name, result: { content: res.content, writtenFiles } });
    };

    const { system, user } = buildDelegationPrompt({
      entryAgent: { name: entryAgent.name, promptTemplate: entryAgent.promptTemplate },
      quest: { title: quest.title, requirement: quest.requirement },
      agentPool,
      projects
    });

    const loop = await runDelegationLoop(system, user, {
      callModel: async (messages, tools) => {
        this.assertNotCancelled(questId);
        const result = await callLlmWithModelKit({
          modelKit,
          messages,
          tools,
          signal: this.questSignal(questId)
        });
        const usage = runtimeUsageEvent(modelKit, result.usage, entryAgent.name, "delegate-loop");
        return { content: result.content, toolCalls: result.toolCalls, events: usage ? [usage] : [] };
      },
      onDelegate,
      maxIterations: MAX_TOOL_LOOP_ITERATIONS,
      agentName: entryAgent.name
    });

    await this.updateSubAgentUsage(entryAgent.id);

    // Collapse retries into one terminal outcome per subtask (recovery-aware), so a
    // failure the supervisor later recovered does not permanently block the quest.
    const delegations = foldDelegations(attempts);
    const summaryLines =
      delegations.length === 0
        ? "No delegations were made."
        : delegations
            .map((d, i) => `${i + 1}. ${d.agentName} (${d.ok ? "ok" : "fail"}): ${d.summary}`)
            .join("\n");
    const finalContent = `${loop.finalContent || "(supervisor produced no summary)"}\n\n---\n\n${summaryLines}`;

    return {
      entryAgentId: entryAgent.id,
      entryAgentName: entryAgent.name,
      finalContent,
      delegations,
      iterations: delegations.length,
      entryEvents: loop.events
    };
  }

  /**
   * Run a single plan step under the lead agent's dynamic supervision. Each
   * attempt runs the worker; if it does not cleanly produce required material
   * output, the lead chooses a bounded recovery action. The attempt cap is
   * enforced here (not by the lead), guaranteeing termination. Returns a single
   * terminal outcome (the recovery history lives in `summary`).
   */
  private async runStepWithRecovery(
    step: OrchestrationPlanStep,
    ctx: {
      quest: Quest;
      agentPool: SubAgent[];
      entryAgent: SubAgent;
      dependencies: DependencyResult[];
    }
  ): Promise<{
    ok: boolean;
    aborted: boolean;
    content: string;
    agentId: string;
    agentName: string;
    summary: string;
    events: BackendEvent[];
  }> {
    let effectiveStep: OrchestrationPlanStep = step;
    const events: BackendEvent[] = [];
    const recovery: string[] = [];
    let attempt = 0;

    while (true) {
      this.assertNotCancelled(ctx.quest.id);
      attempt++;
      const agent = ctx.agentPool.find((a) => a.id === effectiveStep.agentId);
      const agentLabel = agent?.name ?? effectiveStep.agentName;
      const targetProjectId = effectiveStep.targetProjectId || ctx.quest.affectedProjectIds[0];
      events.push(collaborationEdgeEvent({
        title: attempt > 1 ? "重新委派任务" : "委派计划步骤",
        detail: `${ctx.entryAgent.name} delegated ${effectiveStep.id} to ${agentLabel}.`,
        agent: ctx.entryAgent.name,
        stepId: effectiveStep.id,
        projectId: targetProjectId,
        collaboration: {
          kind: "delegate",
          evidence: "actual",
          label: attempt > 1 ? "重新委派" : "实际委派",
          sourceAgentId: ctx.entryAgent.id,
          sourceAgentName: ctx.entryAgent.name,
          targetAgentId: effectiveStep.agentId,
          targetAgentName: agentLabel,
          targetStepId: effectiveStep.id,
          targetProjectId,
          correlationId: `${ctx.quest.id}:${effectiveStep.id}:attempt_${attempt}`
        }
      }));

      // Snapshot the worktree BEFORE this attempt so we can both detect the
      // attempt's real disk changes (even when a CLI errors out before our own
      // accounting runs) and roll them back if the attempt fails and recovery
      // continues. A missing agent runs no worker, so there is nothing to snapshot.
      const worktree = agent
        ? this.resolveWorktreeForStep(ctx.quest, targetProjectId)
        : undefined;
      const baselineSig = worktree?.worktreePath
        ? await readWorktreeChangeSnapshot(worktree.worktreePath)
        : undefined;
      const baselineContent = worktree?.worktreePath && baselineSig
        ? await this.captureWorktreeContents(worktree.worktreePath, baselineSig)
        : undefined;

      let result: { content: string; error?: string; writtenFiles?: string[]; events?: BackendEvent[] };
      let stepError: string | undefined;
      if (!agent) {
        // P2: a missing agent (stale/hallucinated plan id) is no longer a dead end
        // — it flows through the same recovery decision so the lead can reassign to
        // a valid worker, degrading to skip only when none fits.
        result = { content: "", writtenFiles: [] };
        stepError = `agent ${effectiveStep.agentId} not found in pool`;
      } else {
        result = await this.invokeWorkerAgent(agent, {
          step: effectiveStep,
          dependencies: ctx.dependencies,
          quest: ctx.quest,
          targetProjectId
        });
        if (result.events) events.push(...result.events);
        const material = !result.error
          ? validateMaterialOutput(effectiveStep, result.writtenFiles ?? [])
          : { ok: false, required: false };
        stepError = result.error || (!material.ok ? material.reason : undefined);
      }

      if (!stepError) {
        return {
          ok: true,
          aborted: false,
          content: result.content,
          agentId: agent!.id,
          agentName: agent!.name,
          summary: this.recoverySummary(true, result.content, undefined, result.writtenFiles ?? [], recovery),
          events
        };
      }

      // The attempt's true disk footprint (covers files a CLI wrote before exiting
      // non-zero, which our normal writtenFiles accounting misses).
      const attemptChanged = worktree?.worktreePath && baselineSig
        ? changedPathsSince(baselineSig, await readWorktreeChangeSnapshot(worktree.worktreePath))
        : result.writtenFiles ?? [];

      // Enforce the deterministic cap BEFORE consulting the lead, so the lead can
      // never drive an unbounded retry loop. Residue on a terminally-failed step is
      // left in place: the quest is blocked (hasFailures), so it is never delivered.
      if (attempt >= MAX_STEP_ATTEMPTS) {
        recovery.push(`attempt ${attempt} (${agentLabel}) failed (max attempts reached): ${truncate(stepError, 160)}`);
        return {
          ok: false,
          aborted: false,
          content: result.content,
          agentId: agent?.id ?? effectiveStep.agentId,
          agentName: agentLabel,
          summary: this.recoverySummary(false, result.content, stepError, attemptChanged, recovery),
          events
        };
      }

      const decision = await this.decideRecovery({
        quest: ctx.quest,
        step: effectiveStep,
        agentName: agentLabel,
        error: stepError,
        workerOutput: result.content,
        writtenFiles: attemptChanged,
        attempt,
        agentPool: ctx.agentPool,
        entryAgent: ctx.entryAgent
      });
      const reasonNote = decision.reason ? `: ${decision.reason}` : "";

      if (decision.action === "skip") {
        recovery.push(`attempt ${attempt} (${agentLabel}) failed; lead chose skip${reasonNote}`);
        return {
          ok: false,
          aborted: false,
          content: result.content,
          agentId: agent?.id ?? effectiveStep.agentId,
          agentName: agentLabel,
          summary: this.recoverySummary(false, result.content, stepError, attemptChanged, recovery),
          events
        };
      }
      if (decision.action === "abort") {
        recovery.push(`attempt ${attempt} (${agentLabel}) failed; lead aborted the plan${reasonNote}`);
        return {
          ok: false,
          aborted: true,
          content: result.content,
          agentId: agent?.id ?? effectiveStep.agentId,
          agentName: agentLabel,
          summary: this.recoverySummary(false, result.content, stepError, attemptChanged, recovery),
          events
        };
      }

      // P1: recovery continues (retry / reassign / revise). Discard this failed
      // attempt's worktree changes first, so a later successful attempt cannot
      // smuggle the failed residue into delivery.
      if (worktree?.worktreePath && attemptChanged.length > 0) {
        await this.rollbackFailedAttempt(worktree.worktreePath, attemptChanged, baselineContent ?? new Map());
      }

      if (decision.action === "reassign" && decision.reassignTo) {
        const target = ctx.agentPool.find((a) => a.id === decision.reassignTo);
        if (target) {
          recovery.push(`attempt ${attempt} (${agentLabel}) failed; lead reassigned to ${target.name}`);
          effectiveStep = {
            ...effectiveStep,
            agentId: target.id,
            agentName: target.name,
            ...(decision.feedback
              ? { description: this.appendLeadFeedback(effectiveStep.description, decision.feedback) }
              : {})
          };
          continue;
        }
      }
      if (decision.action === "revise") {
        const revised = decision.revisedDescription || effectiveStep.description;
        recovery.push(`attempt ${attempt} (${agentLabel}) failed; lead revised the task`);
        effectiveStep = {
          ...effectiveStep,
          description: decision.feedback ? this.appendLeadFeedback(revised, decision.feedback) : revised
        };
        continue;
      }

      // Default / "retry": re-run the same step, optionally with appended guidance.
      recovery.push(`attempt ${attempt} (${agentLabel}) failed; lead chose retry${reasonNote}`);
      if (decision.feedback) {
        effectiveStep = {
          ...effectiveStep,
          description: this.appendLeadFeedback(effectiveStep.description, decision.feedback)
        };
      }
    }
  }

  /** Resolve the created worktree a step should run in (target project, else any). */
  private resolveWorktreeForStep(quest: Quest, targetProjectId: string | undefined): WorktreeState | undefined {
    return targetProjectId
      ? quest.worktrees.find(
          (item) => item.projectId === targetProjectId && item.status === "created" && item.worktreePath
        )
      : quest.worktrees.find((item) => item.status === "created" && item.worktreePath);
  }

  /** Capture the current content (or null when absent) of a set of worktree paths. */
  private async captureWorktreeContents(
    worktreePath: string,
    sig: Map<string, string>
  ): Promise<Map<string, Buffer | null>> {
    const out = new Map<string, Buffer | null>();
    for (const path of sig.keys()) {
      try {
        out.set(path, await readFile(join(worktreePath, path)));
      } catch {
        out.set(path, null);
      }
    }
    return out;
  }

  /**
   * Discard a failed attempt's file changes. `baseline` carries the pre-attempt
   * content of paths that were ALREADY modified before this attempt, so we restore
   * (not destroy) an upstream step's uncommitted work to the same file. Paths
   * absent from the baseline were clean (== HEAD) or newly created, so we restore
   * them from HEAD or, if untracked, delete them.
   */
  private async rollbackFailedAttempt(
    worktreePath: string,
    changedPaths: string[],
    baseline: Map<string, Buffer | null>
  ): Promise<void> {
    for (const path of changedPaths) {
      const abs = join(worktreePath, path);
      // Unstage first: the change snapshot counts `git diff --cached`, so an
      // attempt that `git add`ed a file leaves a staged residue (`AD <path>`)
      // that a worktree-only restore can't clear. Reset the index entry to HEAD
      // (drops it for a new file) before touching the working tree.
      await execFileAsync("git", ["reset", "-q", "HEAD", "--", path], { cwd: worktreePath }).catch(() => {});
      if (baseline.has(path)) {
        const content = baseline.get(path)!;
        if (content === null) {
          await rm(abs, { force: true });
        } else {
          await mkdir(dirname(abs), { recursive: true });
          await writeFile(abs, content);
        }
        continue;
      }
      try {
        await execFileAsync("git", ["checkout", "HEAD", "--", path], { cwd: worktreePath });
      } catch {
        await rm(abs, { force: true });
      }
    }
  }

  /** Append lead guidance to a step description for the next attempt. */
  private appendLeadFeedback(description: string, feedback: string): string {
    return `${description}\n\n[Lead feedback] ${feedback}`;
  }

  /** Compose a step's delegation summary, including the recovery trail if any. */
  private recoverySummary(
    ok: boolean,
    content: string,
    error: string | undefined,
    writtenFiles: string[],
    recovery: string[]
  ): string {
    const recoveryNote = recovery.length > 0 ? `\n恢复记录: ${recovery.join("; ")}` : "";
    if (ok) {
      const filesNote = writtenFiles.length > 0 ? `\n写入文件: ${writtenFiles.join(", ")}` : "";
      return `${truncate(content, 400)}${filesNote}${recoveryNote}`;
    }
    return `error: ${error}${content ? `\nWorker output: ${truncate(content, 300)}` : ""}${recoveryNote}`;
  }

  /**
   * Ask the lead agent (entry agent's ModelKit) for a bounded recovery decision.
   * Degrades to `skip` — the legacy "mark failed + skip downstream" behavior — on
   * any error, missing ModelKit, or unparseable response, keeping the feature
   * strictly additive.
   */
  private async decideRecovery(input: {
    quest: Quest;
    step: OrchestrationPlanStep;
    agentName: string;
    error: string;
    workerOutput: string;
    writtenFiles: string[];
    attempt: number;
    agentPool: SubAgent[];
    entryAgent: SubAgent;
  }): Promise<LeadDecision> {
    try {
      const modelKit = await this.service.getModelKit(input.entryAgent.modelKitId);
      if (!modelKit) {
        return { action: "skip" };
      }
      const backend = await this.createBackendFromModelKit(modelKit);
      const { system, user } = buildLeadDecisionPrompt({
        quest: { title: input.quest.title, requirement: input.quest.requirement },
        step: { id: input.step.id, description: input.step.description, agentName: input.agentName },
        error: input.error,
        workerOutput: input.workerOutput,
        writtenFiles: input.writtenFiles,
        attempt: input.attempt,
        maxAttempts: MAX_STEP_ATTEMPTS,
        agentPool: input.agentPool.map((a) => ({ id: a.id, name: a.name, capabilities: a.capabilities }))
      });
      const result = await backend.run({
        systemPrompt: system,
        messages: [{ role: "user", content: user }],
        tools: [],
        worktrees: input.quest.worktrees,
        quest: input.quest
      });
      const poolIds = new Set(input.agentPool.map((a) => a.id));
      return parseLeadDecision(result.content, poolIds);
    } catch {
      return { action: "skip" };
    }
  }

  private async listDelegatableAgents(entryAgentId: string): Promise<SubAgent[]> {
    const all = await this.service.listSubAgents();
    return all.filter((agent) => isDelegatableWorker(agent, entryAgentId));
  }

  private async invokeWorkerAgent(
    worker: SubAgent,
    input: {
      step: OrchestrationPlanStep;
      dependencies: DependencyResult[];
      quest: Quest;
      targetProjectId?: string;
    }
  ): Promise<{ content: string; error?: string; writtenFiles?: string[]; events?: BackendEvent[] }> {
    const workerEvents: BackendEvent[] = [];
    try {
      this.assertNotCancelled(input.quest.id);
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
      const worktree = this.resolveWorktreeForStep(input.quest, input.targetProjectId);

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
        const worktreeIntro =
          `${basePrompt}\n\n` +
          `You are implementing changes inside an isolated git worktree which IS the project root: "${worktree.worktreePath}". ` +
          `Keep paths relative to the project root — use "index.html", not "${projectDir}/index.html".`;

        if (modelKit.type === "byok") {
          // Tool-capable models MUST make file changes by calling the file-system
          // tools (write_file / edit_file) and verify via the allowlist-gated
          // run_command tool. Telling them to emit code blocks instead — and then
          // scraping those blocks out of prose — is the brittle path issue #3
          // removes. Code blocks in prose are NOT saved for these workers.
          const toolPrompt =
            `${worktreeIntro}\n\n` +
            `Make EVERY file change by calling the write_file tool (full file contents, not diffs) or edit_file tool (surgical edits). ` +
            `Do NOT paste file contents as fenced code blocks in your reply — prose code blocks are not saved. ` +
            `Use run_command to run tests/build/lint and react to failures before finishing.`;
          const isAllowed = this.resolveCommandGate();
          const loop = await this.runWorkerWithFsTools(
            modelKit,
            toolPrompt,
            userContent,
            worktree.worktreePath,
            worker.name,
            isAllowed,
            input.quest.id
          );
          content = loop.content || "";
          loop.written.forEach((file) => writtenFiles.add(file));
          workerEvents.push(...loop.events);
        } else {
          // CLI / print-mode backends cannot call our tools, so they signal file
          // changes by emitting path-tagged fenced code blocks (materialized below)
          // or by editing the worktree directly (caught by the snapshot diff).
          const codeBlockPrompt =
            `${worktreeIntro}\n\n` +
            `Output EVERY file you create or modify as a fenced code block whose info string is the file path relative to the project root, e.g.:\n` +
            "```index.html\n<full file contents>\n```\n" +
            `Provide complete file contents (not diffs).`;
          const backend = await this.createBackendFromModelKit(modelKit);
          const result = await backend.run({
            systemPrompt: codeBlockPrompt,
            messages: [{ role: "user", content: userContent }],
            tools: [],
            worktrees: [worktree],
            quest: input.quest
          });
          content = result.content || "";
          workerEvents.push(...result.events);
        }

        // Count direct edits to the worktree (CLI backends, or commands that wrote
        // files) BEFORE deciding on the prose fallback, so "produced nothing" reflects
        // tool writes AND direct edits — not just write_file/edit_file calls.
        const afterChanges = await readWorktreeChangeSnapshot(worktree.worktreePath);
        for (const file of changedPathsSince(beforeChanges, afterChanges)) {
          writtenFiles.add(file);
        }

        // True fallback (issue #3): only scrape files out of the worker's prose when
        // it produced NOTHING through tools or direct edits. Tool-capable workers
        // write via write_file/edit_file, so their prose is not parsed — that
        // prose-path guessing was brittle and masked "the model didn't use its tools".
        if (writtenFiles.size === 0) {
          const fsHandlers = buildFsToolHandlers(worktree.worktreePath);
          for (const file of extractFilesFromContent(content, projectDir)) {
            await fsHandlers.handle(FS_WRITE_TOOL, { path: file.path, content: file.content });
          }
          fsHandlers.written.forEach((file) => writtenFiles.add(file));
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
        workerEvents.push(...result.events);
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
      return { content, writtenFiles: [...writtenFiles], events: workerEvents };
    } catch (error) {
      return {
        content: "",
        error: error instanceof Error ? error.message : String(error),
        events: workerEvents
      };
    }
  }

  /**
   * Run a worker BYOK model in a bounded tool-calling loop, letting it write real
   * files into the worktree and run allowlisted commands. Returns the worker's
   * final text, the files it created/overwrote, and one event per tool call so
   * the orchestrator can surface them on the Quest timeline.
   */
  private async runWorkerWithFsTools(
    modelKit: ModelKit,
    systemPrompt: string,
    userContent: string,
    worktreeRoot: string,
    agentName: string,
    isAllowed?: (command: string) => boolean | Promise<boolean>,
    questId?: string
  ): Promise<{ content: string; written: string[]; events: BackendEvent[] }> {
    const sandboxRuntimeId = await this.sandboxRuntimeId();
    const signal = questId ? this.questSignal(questId) : undefined;
    const tools = await buildWorkerToolsetAsync(worktreeRoot, {
      isAllowed,
      enableWeb: process.env.REPOHELM_ENABLE_WEB === "1",
      allowLoopback: process.env.REPOHELM_WEB_ALLOW_LOOPBACK === "1",
      resolveHost: async (hostname: string) => {
        const { lookup } = await import("node:dns/promises");
        const records = await lookup(hostname, { all: true });
        return records.map((r) => r.address);
      },
      runtime: createSandboxRuntime(sandboxRuntimeId),
      signal,
      mcpToolset: await this.sharedMcpToolset()
    });
    const events: BackendEvent[] = [];
    const messages: LlmMessage[] = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userContent }
    ];
    let finalContent = "";
    try {
      for (let i = 0; i < MAX_TOOL_LOOP_ITERATIONS; i++) {
        if (questId) {
          this.assertNotCancelled(questId);
        }
        const result = await callLlmWithModelKit({
          modelKit,
          messages,
          tools: tools.specs,
          signal
        });
        const usage = runtimeUsageEvent(modelKit, result.usage, agentName, "worker-tool-loop");
        if (usage) {
          events.push(usage);
        }
        if (result.content) {
          finalContent = result.content;
          events.push({
            type: "agent.message",
            title: "助手消息",
            detail: truncate(result.content, 500),
            agent: agentName,
            phase: "execute",
            visibility: "process",
            severity: "info"
          });
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
          events.push({
            type: "agent.tool_call",
            title: `调用工具: ${call.function.name}`,
            detail: truncate(call.function.arguments || "", 300),
            agent: agentName,
            phase: "execute",
            visibility: "audit",
            severity: "info"
          });
          const output = await tools.handle(call.function.name, args);
          messages.push({ role: "tool", tool_call_id: call.id, content: output });
        }
      }
    } finally {
      // Kill any background processes the worker left running.
      await tools.dispose();
    }
    return { content: finalContent, written: [...tools.written], events };
  }

  /**
   * Build the command gate for the worker `run_command` tool. Each command is
   * evaluated against the security-policy allowlist AND recorded in the audit
   * log via the service, so every execution attempt is captured. Defaults to
   * deny on any error.
   */
  private resolveCommandGate(): (command: string) => Promise<boolean> {
    return (command: string) =>
      this.service.authorizeCommand(command, "worker run_command").catch(() => false);
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
      run: async (input) => {
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
          tools: input.tools && input.tools.length > 0 ? input.tools : undefined,
          signal: input.quest?.id ? this.questSignal(input.quest.id) : undefined
        });
        const usage = runtimeUsageEvent(modelKit, result.usage, modelKit.name, "byok-backend");
        return {
          content: result.content,
          toolCalls: result.toolCalls,
          finishReason: result.finishReason,
          events: [
            ...(usage ? [usage] : []),
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

        // Stream the CLI's stdout so its tool calls / messages / result surface on
        // the timeline incrementally instead of as a single opaque blob.
        const stream = await runStreamingCli({
          command,
          args: cliArgs,
          agent: modelKit.name,
          cwd: createdWorktree?.worktreePath,
          timeoutMs: Number(process.env.REPOHELM_AGENT_TIMEOUT_MS ?? 120_000),
          signal: input.quest?.id ? this.questSignal(input.quest.id) : undefined
        });
        if (input.quest?.id) {
          this.assertNotCancelled(input.quest.id);
        }
        if (stream.exitCode !== 0 && stream.exitCode !== null) {
          const tail = stream.events.slice(-3).map((event) => event.detail).filter(Boolean).join("\n");
          const stderrTail = stream.stderr.trim().slice(-500);
          throw new Error(
            `CLI backend ${backendId} failed (exit ${stream.exitCode})\n${tail}${stderrTail ? `\nstderr: ${stderrTail}` : ""}`
          );
        }
        const content = stream.content.trim();
        // Fall back to a single completion event only when the CLI emitted nothing
        // parseable (e.g. a silent print-mode CLI), so the step still has a record.
        const enrichedEvents = stream.events.map((event) => {
          if (event.type !== "agent.usage") {
            return event;
          }
          let rawUsage: unknown;
          try {
            rawUsage = JSON.parse(event.detail);
          } catch {
            rawUsage = undefined;
          }
          const usage = extractTokenUsage(rawUsage);
          const enriched = runtimeUsageEvent(modelKit, usage, modelKit.name, "cli-stream");
          return enriched ?? event;
        });
        const events =
          enrichedEvents.length > 0
            ? enrichedEvents
            : [
                {
                  type: "agent.cli.call",
                  title: `CLI ${backendId} 调用完成`,
                  detail: truncate(content, 200) || "(empty)",
                  agent: modelKit.name
                }
              ];
        return {
          content,
          toolCalls: [],
          finishReason: "stop",
          events
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
    const linePaths = mode === "status" ? pathsFromGitStatusLine(trimmed) : [cleanGitPath(trimmed)];
    for (const path of linePaths) {
      if (path) paths.add(path);
    }
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

/**
 * Paths touched by a porcelain status line. A rename/copy line is
 * `R  old -> new`; we return BOTH sides — rolling back only the destination
 * would leave the source's staged deletion (`D old`) as undelivered residue.
 */
function pathsFromGitStatusLine(line: string): string[] {
  const porcelainPath = line.slice(3);
  if (porcelainPath.includes(" -> ")) {
    return porcelainPath
      .split(" -> ")
      .map((part) => cleanGitPath(part))
      .filter((part) => part.length > 0);
  }
  const cleaned = cleanGitPath(porcelainPath);
  return cleaned ? [cleaned] : [];
}

function cleanGitPath(path: string): string {
  return path.trim().replace(/^"|"$/g, "");
}

function truncate(value: string, max: number): string {
  if (value.length <= max) return value;
  return value.slice(0, max - 1) + "…";
}

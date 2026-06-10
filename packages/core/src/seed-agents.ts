import type { RepoHelmService } from "./service.js";
import type { CreateSubAgentInput, ModelKit, SubAgent } from "./types.js";

/**
 * Built-in seed sub-agents. Supervisor is the entry; the rest are workers.
 * Each binds to the same default ModelKit (prefer BYOK, fall back to first available).
 */
const SEED_AGENTS: Array<Omit<CreateSubAgentInput, "modelKitId"> & { id: string }> = [
  {
    id: "supervisor",
    name: "Supervisor",
    role: "Entry supervisor that decomposes requests and aggregates worker results.",
    capabilities: ["planning"],
    mode: "entry",
    permissions: { allowedTools: ["delegate"], deniedTools: [] },
    promptTemplate:
      "You are the RepoHelm Supervisor. Your only job is to plan, delegate, and summarize.\n" +
      "- Do NOT write code, specifications, or reviews yourself.\n" +
      "- Use the `delegate` tool to assign focused subtasks to worker sub-agents.\n" +
      "- After delegating, synthesize worker results into a concise final summary for the user.\n" +
      "- If a worker reports an error, decide whether to retry with a clearer task or escalate in the summary.\n" +
      "- Stop and produce the final summary once you have enough information; do not loop unnecessarily."
  },
  {
    id: "spec-writer",
    name: "Spec Writer",
    role: "Produces lightweight specifications and requirements breakdowns.",
    capabilities: ["requirements", "specification"],
    mode: "worker",
    permissions: { allowedTools: [], deniedTools: [] },
    promptTemplate:
      "You are a Spec Writer worker. Given a task, produce a clear, concise specification: goals, scope, constraints, acceptance criteria. Do not implement code."
  },
  {
    id: "coder",
    name: "Coder",
    role: "Implements code and plans concrete file-level changes.",
    capabilities: ["coding", "planning"],
    mode: "worker",
    permissions: { allowedTools: [], deniedTools: [] },
    promptTemplate:
      "You are a Coder worker. Given a task, output concrete implementation steps and file changes. Include short code snippets when they clarify intent. Stay focused on the requested scope."
  },
  {
    id: "reviewer",
    name: "Reviewer",
    role: "Reviews plans and code for quality, correctness, and security.",
    capabilities: ["review"],
    mode: "worker",
    permissions: { allowedTools: [], deniedTools: [] },
    promptTemplate:
      "You are a Reviewer worker. Given a task and its output, review for correctness, clarity, security, and testability. Return a concise list of findings and suggested improvements."
  },
  {
    id: "kb-agent",
    name: "知识库助手",
    role: "系统知识库 Agent,管理项目知识:索引仓库、回答知识查询、总结 Quest 学习。",
    capabilities: ["knowledge", "search", "indexing", "summarization"],
    mode: "system",
    systemRole: "knowledge",
    permissions: {
      allowedTools: [
        "search_knowledge",
        "read_knowledge",
        "write_knowledge",
        "index_knowledge",
        "get_knowledge_context"
      ],
      deniedTools: ["delegate", "write_file", "read_file", "list_files"]
    },
    promptTemplate: `You are the Knowledge Base Agent (知识库助手) for RepoHelm.
Your job is to provide accurate, contextual answers about the codebase using the project knowledge base.

When answering a question:
1. Use "search_knowledge" to find relevant wiki pages and documentation across projects
2. Use "read_knowledge" to fetch the full content of a specific wiki page when needed
3. Synthesize findings into a clear, structured answer in Chinese
4. Always cite sources: project name and wiki page slug
5. If the knowledge base lacks the needed information, suggest indexing the relevant project with "index_knowledge"

When updating knowledge (after a Quest or on request):
1. Use "get_knowledge_context" to understand what changed
2. Use "write_knowledge" to update affected wiki pages — merge new information rather than append
3. Keep pages focused and current

Available wiki page types per project: overview (概览), architecture (架构), modules (模块), key-flows (关键流程), conventions (约定), decisions (决策日志).

Be concise. Answer in Chinese. Prefer searching over guessing.`
  },
  {
    id: "habits-agent",
    name: "用户习惯助手",
    role: "系统用户习惯 Agent,观察并建模用户偏好:编码风格、命名习惯、架构倾向、工作流偏好。",
    capabilities: ["user-modeling", "preferences", "patterns"],
    mode: "system",
    systemRole: "habits",
    permissions: {
      allowedTools: ["record_preference", "get_user_profile", "suggest_conventions"],
      deniedTools: ["delegate", "write_file", "read_file", "list_files"]
    },
    promptTemplate: `You are the User Habits Agent (用户习惯助手) for RepoHelm.

Your job is to build and maintain a profile of the user's preferences and habits so future agent outputs align with their expectations.

When observing a correction or preference signal:
1. Use "record_preference" to store the preference with an appropriate confidence level
2. If a new observation contradicts an existing preference, lower the old one's confidence
3. Be conservative: only record when the signal is clear and consistent across multiple interactions

Preference categories to watch for:
- coding_style: 引号、分号、缩进、格式化、命名规范
- naming: 变量/函数/文件命名风格
- architecture: FP vs OOP, 文件结构, 依赖模式
- tooling: 测试框架、构建工具、lint 规则
- workflow: 提交风格、PR 规范、审查习惯

When consulted before a task:
1. Use "get_user_profile" to retrieve relevant preferences by category
2. Use "suggest_conventions" to produce guidance text for the executing agent

Answer in Chinese. Only record when confident.`
  },
  {
    id: "failure-experience-agent",
    name: "失败经验助手",
    role: "系统失败经验 Agent,捕获 Quest 失败模式,分析根因,提供缓解方案,防止重复踩坑。",
    capabilities: ["error-analysis", "root-cause", "mitigation", "learning"],
    mode: "system",
    systemRole: "failure-experience",
    permissions: {
      allowedTools: ["record_failure", "search_failures", "check_risk"],
      deniedTools: ["delegate", "write_file", "read_file", "list_files"]
    },
    promptTemplate: `You are the Failure Experience Agent (失败经验助手) for RepoHelm.

Your job is to ensure the system learns from every mistake and prevents recurrence.

When a failure occurs (test failure, build error, validation fail, user rejection of a plan):
1. Analyze the root cause deeply — ask WHY it happened, not just WHAT happened
2. Use "record_failure" to store the pattern with:
   - A clear category (type_error, test_failure, build_error, logic_bug, architecture, security, performance, other)
   - The root cause analysis
   - A concrete, actionable mitigation — "be more careful" is not a mitigation
   - Signal keywords to detect similar situations in the future
3. Always check for similar past failures using "search_failures" before recording — merge if found

When consulted before a new Quest or similar task:
1. Use "search_failures" to find past failures with matching signals or context
2. Use "check_risk" to return relevant warnings for the executing agent
3. Prioritize by severity: high > medium > low

Key principle: every recorded failure MUST have a concrete mitigation.
"代码写错了" is not enough — explain HOW to avoid it next time.

Answer in Chinese. Be specific and actionable.`
  }
];

export interface SeedResult {
  seeded: boolean;
  reason?: string;
  agents: Array<{ id: string; name: string }>;
  defaultModelKitId?: string;
}

/**
 * Pick a default ModelKit for seed agents: prefer the first BYOK kit, else the first kit.
 * Returns undefined when no ModelKit is available (seed will be skipped).
 */
export function pickDefaultModelKit(modelKits: ModelKit[]): ModelKit | undefined {
  if (modelKits.length === 0) return undefined;
  const byok = modelKits.find((k) => k.type === "byok");
  return byok ?? modelKits[0];
}

/**
 * Seed the built-in sub-agents. Idempotent and incremental:
 * - Only creates agents that don't already exist (by id).
 * - If no ModelKit is available, seeding is skipped and reason is populated.
 * - Sets supervisor as the entry SubAgent on first run (only if entrySubAgentId is unset).
 *
 * The optional `rawStateReader` is used during bootstrap to avoid recursive
 * getState() calls (which would re-enter bootstrap).
 */
export async function seedBuiltInSubAgents(
  service: RepoHelmService,
  rawStateReader?: () => Promise<{
    subAgents: Record<string, SubAgent>;
    engine: { modelKits: Record<string, ModelKit> };
    entrySubAgentId?: string;
  }>
): Promise<SeedResult> {
  const rawState = rawStateReader ? await rawStateReader() : undefined;
  const existing: SubAgent[] = rawState
    ? Object.values(rawState.subAgents)
    : await service.listSubAgents();

  const existingIds = new Set(existing.map((a) => a.id));
  const missingAgents = SEED_AGENTS.filter((seed) => !existingIds.has(seed.id));

  if (missingAgents.length === 0) {
    return {
      seeded: false,
      reason: "all built-in agents already exist",
      agents: existing.map((a) => ({ id: a.id, name: a.name }))
    };
  }

  const modelKits: ModelKit[] = rawState
    ? Object.values(rawState.engine.modelKits)
    : await service.listModelKits();
  const defaultKit = pickDefaultModelKit(modelKits);
  if (!defaultKit) {
    return {
      seeded: false,
      reason: "no ModelKit configured; create a BYOK or CLI ModelKit in Settings to enable seed agents",
      agents: []
    };
  }

  const created: Array<{ id: string; name: string }> = [];
  for (const seed of missingAgents) {
    const agent = await service.createSubAgent({ ...seed, modelKitId: defaultKit.id });
    created.push({ id: agent.id, name: agent.name });
  }

  // Set supervisor as entry agent only if it was just created and no entry is set
  const entrySubAgentId = rawState?.entrySubAgentId ?? (await (async () => {
    const entry = await service.getEntrySubAgent();
    return entry?.id;
  })());
  if (!entrySubAgentId && created.some((a) => a.id === "supervisor")) {
    await service.setEntrySubAgent("supervisor");
  }

  return {
    seeded: true,
    agents: [...existing.map((a) => ({ id: a.id, name: a.name })), ...created],
    defaultModelKitId: defaultKit.id
  };
}

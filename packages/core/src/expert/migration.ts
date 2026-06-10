import type { Quest, OrchestrationPlan, ChangedFile } from "../types.js";
import type { ExpertSession, ExpertTaskNode, ExpertTask, TaskArtifact, ExpertSessionStatus } from "./types.js";

const STATUS_MAP: Record<string, ExpertSessionStatus> = {
  ready: "completed", executing: "executing", planning: "analyzing", blocked: "failed", delivered: "completed",
};

export function migrateQuestToSession(quest: Quest, plan: OrchestrationPlan | null): ExpertSession {
  const status = STATUS_MAP[quest.status] || "completed";
  const children: ExpertTaskNode[] = [];
  const flatTasks: ExpertTask[] = [];

  if (plan) {
    for (const step of plan.steps) {
      const nodeStatus = status === "completed" ? "completed" : "pending";
      const node: ExpertTaskNode = {
        id: step.id, title: step.description, type: "implementation", status: nodeStatus,
        assignedAgentId: step.agentId, assignedAgentName: step.agentName,
        children: [], dependencies: step.dependencies, artifacts: [],
        description: step.description, expectedOutput: step.expectedOutput,
      };
      children.push(node);
      flatTasks.push({
        id: step.id, nodeId: step.id, title: step.description, description: step.description,
        type: "implementation", status: nodeStatus,
        assignedAgentId: step.agentId, assignedAgentName: step.agentName, artifacts: [],
      });
    }
  }

  const rootNode: ExpertTaskNode = {
    id: "root", title: quest.title, type: "root",
    status: status === "completed" ? "completed" : "pending",
    children, dependencies: [], artifacts: [],
    description: quest.requirement, expectedOutput: quest.agentSummary || "", summary: quest.agentSummary,
  };

  const artifacts = migrateChangedFiles(quest.changedFiles);
  distributeArtifacts(children, artifacts, plan);
  for (const task of flatTasks) {
    const node = children.find((c) => c.id === task.nodeId);
    if (node) task.artifacts = node.artifacts;
  }

  return {
    id: `expert_${quest.id}`, questId: quest.id, status,
    entryAgentId: quest.entrySubAgentId || "supervisor",
    taskTree: rootNode, flatTasks, acceptanceTests: [], research: [],
    agentPool: { prototypes: [], dynamicAgents: [], activeAgents: [] },
    createdAt: quest.createdAt,
    confirmedAt: (quest as any).planApproval?.approvedAt,
    completedAt: status === "completed" ? quest.updatedAt : undefined,
    errors: [],
  };
}

function migrateChangedFiles(files: Array<ChangedFile | string>): TaskArtifact[] {
  return files.map((file, idx) => {
    if (typeof file === "string") {
      return { id: `artifact_${idx}`, taskId: "", type: "file_change" as const, filePath: file, summary: file, createdAt: new Date().toISOString() };
    }
    return { id: `artifact_${idx}`, taskId: "", type: "file_change" as const, filePath: file.path, projectId: file.projectId, summary: `${file.status}: ${file.path}`, diff: file.diff, createdAt: new Date().toISOString() };
  });
}

function distributeArtifacts(nodes: ExpertTaskNode[], artifacts: TaskArtifact[], plan: OrchestrationPlan | null): void {
  if (!plan) return;
  for (let i = 0; i < Math.min(artifacts.length, nodes.length); i++) {
    artifacts[i].taskId = nodes[i].id;
    nodes[i].artifacts.push(artifacts[i]);
  }
}

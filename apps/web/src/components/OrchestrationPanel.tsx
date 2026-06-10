import React from "react";
import type { ExpertSession, ExpertTaskNode } from "../api";

function TaskTreeNode({ node, depth = 0 }: { node: ExpertTaskNode; depth?: number }) {
  const icons: Record<string, string> = { pending: "○", in_progress: "◉", completed: "●", failed: "✗", skipped: "—" };
  return (
    <div style={{ marginLeft: depth * 16 }}>
      <div className="expert-task-node">
        <span>{icons[node.status] || "○"}</span>
        <span>{node.title}</span>
        {node.assignedAgentName && <span className="expert-agent-name">{node.assignedAgentName}</span>}
      </div>
      {node.children.map((c) => <TaskTreeNode key={c.id} node={c} depth={depth + 1} />)}
    </div>
  );
}

export function OrchestrationPanel({ session }: { session: ExpertSession }) {
  return (
    <div className="inspector-stack">
      <section className="inspector-section">
        <h3>Agent 示意图</h3>
        <div className="expert-agent-diagram">
          <div className="expert-entry-agent">{session.entryAgentId}</div>
          <div className="expert-worker-agents">
            {session.agentPool.activeAgents.map((id) => <span key={id} className="expert-worker-agent">{id}</span>)}
          </div>
        </div>
      </section>
      <section className="inspector-section">
        <h3>任务树</h3>
        <TaskTreeNode node={session.taskTree} />
      </section>
    </div>
  );
}

import React from "react";
import type { ExpertTask } from "../api";

const icons: Record<string, string> = { pending: "○", in_progress: "◉", completed: "●", failed: "✗", skipped: "—" };

export function ProgressPanel({ tasks }: { tasks: ExpertTask[] }) {
  return (
    <div className="inspector-stack">
      <section className="inspector-section">
        <h3>任务进展 ({tasks.length})</h3>
        {tasks.map((t) => (
          <div key={t.id} className="expert-progress-row">
            <span>{icons[t.status] || "○"}</span>
            {t.assignedAgentName && <span className="expert-avatar">{t.assignedAgentName[0]}</span>}
            <span>{t.title}</span>
            <span className={`expert-status-badge expert-status-${t.status}`}>{t.status}</span>
          </div>
        ))}
      </section>
    </div>
  );
}

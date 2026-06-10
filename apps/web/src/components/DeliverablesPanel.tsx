import React, { useState } from "react";
import type { ExpertTask, TaskArtifact } from "../api";

function DiffView({ artifact }: { artifact: TaskArtifact }) {
  if (!artifact.diff) return <p>无 diff 内容</p>;
  return (
    <div className="expert-diff-viewer">
      {artifact.diff.split("\n").map((line, i) => (
        <div key={i} className={`expert-diff-line ${line.startsWith("+") ? "add" : line.startsWith("-") ? "remove" : "context"}`}>
          <span className="diff-num">{i + 1}</span><span>{line}</span>
        </div>
      ))}
    </div>
  );
}

export function DeliverablesPanel({ tasks }: { tasks: ExpertTask[] }) {
  const [selected, setSelected] = useState<TaskArtifact | null>(null);
  const files = tasks.flatMap((t) => t.artifacts).filter((a) => a.type === "file_change");
  return (
    <div className="inspector-stack">
      <section className="inspector-section">
        <h3>变更文件 ({files.length})</h3>
        {files.map((f) => (
          <button key={f.id} className={`expert-file-item ${selected?.id === f.id ? "selected" : ""}`} onClick={() => setSelected(f)}>
            <span>{f.filePath}</span><span>{f.summary}</span>
          </button>
        ))}
      </section>
      {selected && <section className="inspector-section"><h3>Diff: {selected.filePath}</h3><DiffView artifact={selected} /></section>}
    </div>
  );
}

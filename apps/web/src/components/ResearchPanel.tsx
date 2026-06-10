import React from "react";
import type { CodeResearchResult } from "../api";

const labels: Record<string, string> = { reusable_function: "🔧 可复用函数", existing_logic: "📖 当前逻辑", proposed_change: "💡 建议变更", related_code: "🗂️ 相关代码" };

export function ResearchPanel({ research }: { research: CodeResearchResult[] }) {
  const grouped = research.reduce((acc, item) => { acc[item.type] = acc[item.type] || []; acc[item.type].push(item); return acc; }, {} as Record<string, CodeResearchResult[]>);
  return (
    <div className="inspector-stack">
      {Object.entries(grouped).map(([type, items]) => (
        <section key={type} className="inspector-section">
          <h3>{labels[type] || type} ({items.length})</h3>
          {items.map((item) => (
            <div key={item.id} className="expert-research-card">
              <div className="expert-research-header"><span>{item.title}</span>{item.filePath && <span>{item.filePath}</span>}</div>
              {item.codeSnippet && <pre className="expert-research-code">{item.codeSnippet}</pre>}
              <p>{item.summary}</p>
              {item.proposedLogic && <div><strong>未来逻辑：</strong><p>{item.proposedLogic}</p></div>}
              {item.reasoning && <div><strong>理由：</strong><p>{item.reasoning}</p></div>}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}

import React from "react";
import type { CodeResearchResult } from "../api";

export function ReferencesPanel({ research, preferences, failurePatterns }: {
  research: CodeResearchResult[];
  preferences?: Array<{ category: string; key: string; value: string; confidence: number }>;
  failurePatterns?: Array<{ scenario: string; lesson: string }>;
}) {
  const knowledgeItems = research.filter((r) => r.type === "related_code");
  return (
    <div className="inspector-stack">
      {knowledgeItems.length > 0 && (
        <section className="inspector-section">
          <h3>知识库引用</h3>
          {knowledgeItems.map((item) => (
            <div key={item.id}><span>{item.title}</span><p>{item.summary.slice(0, 200)}</p></div>
          ))}
        </section>
      )}
      {preferences && preferences.length > 0 && (
        <section className="inspector-section">
          <h3>用户习惯</h3>
          {preferences.map((p) => (
            <div key={p.key}><span>{p.category}: {p.key}</span><span>{p.value}</span></div>
          ))}
        </section>
      )}
      {failurePatterns && failurePatterns.length > 0 && (
        <section className="inspector-section">
          <h3>反例（失败经验）</h3>
          {failurePatterns.map((p, i) => (
            <div key={i}><span>{p.scenario}</span><p>{p.lesson}</p></div>
          ))}
        </section>
      )}
    </div>
  );
}

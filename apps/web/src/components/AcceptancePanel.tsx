import React from "react";
import type { AcceptanceTest } from "../api";

const colors: Record<string, string> = { draft: "var(--text-faint)", confirmed: "var(--accent)", generated: "var(--text)", passing: "#4ade80", failing: "#f87171" };

export function AcceptancePanel({ tests, onConfirm }: { tests: AcceptanceTest[]; onConfirm?: (id: string) => void }) {
  return (
    <div className="inspector-stack">
      <section className="inspector-section">
        <h3>验收用例 ({tests.length})</h3>
        {tests.map((t) => (
          <div key={t.id} className="expert-acceptance-card">
            <div className="expert-acceptance-header">
              <span>{t.title}</span>
              <span style={{ color: colors[t.status] }}>{t.status}</span>
            </div>
            <p>{t.description}</p>
            <span className="expert-test-type">{t.testType}</span>
            {t.status === "draft" && onConfirm && <button onClick={() => onConfirm(t.id)}>确认</button>}
            {t.testOutput && <pre>{t.testOutput}</pre>}
          </div>
        ))}
      </section>
    </div>
  );
}

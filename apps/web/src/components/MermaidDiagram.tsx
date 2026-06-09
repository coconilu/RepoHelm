import { useEffect, useRef, useState } from "react";
import mermaid from "mermaid";

let diagramCounter = 0;

export function MermaidDiagram({ code, theme }: { code: string; theme: "light" | "dark" }) {
  const [svg, setSvg] = useState("");
  const [error, setError] = useState("");
  const idRef = useRef(`mermaid-${(diagramCounter += 1)}`);

  useEffect(() => {
    let cancelled = false;
    mermaid.initialize({
      startOnLoad: false,
      theme: theme === "dark" ? "dark" : "default",
      securityLevel: "strict"
    });
    mermaid
      .render(idRef.current, code)
      .then((result) => {
        if (!cancelled) {
          setSvg(result.svg);
          setError("");
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setSvg("");
          setError(err instanceof Error ? err.message : String(err));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [code, theme]);

  if (error) {
    return (
      <div className="mermaid-fallback">
        <p className="mermaid-error">图表渲染失败:{error}</p>
        <pre>{code}</pre>
      </div>
    );
  }
  return <div className="mermaid-diagram" dangerouslySetInnerHTML={{ __html: svg }} />;
}

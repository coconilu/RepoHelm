import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { MermaidDiagram } from "./MermaidDiagram";

export function MarkdownView({ body, theme }: { body: string; theme: "light" | "dark" }) {
  return (
    <div className="markdown-body">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className, children, ...props }) {
            const text = String(children ?? "").replace(/\n$/, "");
            if (/\blanguage-mermaid\b/.test(className ?? "")) {
              return <MermaidDiagram code={text} theme={theme} />;
            }
            return (
              <code className={className} {...props}>
                {children}
              </code>
            );
          }
        }}
      >
        {body}
      </ReactMarkdown>
    </div>
  );
}

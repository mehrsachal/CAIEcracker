import katex from "katex";
import "katex/dist/katex.min.css";
import { useMemo } from "react";

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function inline(s: string) {
  return esc(s).replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>").replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<em>$2</em>");
}

/** Light Markdown + LaTeX ($...$) renderer for AI-transcribed question text. */
export function renderRich(src: string): string {
  const parts = src.split(/(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g);
  const html = parts.map((p) => {
    const block = p.startsWith("$$");
    if (p.startsWith("$") && p.endsWith("$") && p.length > 2) {
      try { return katex.renderToString(p.slice(block ? 2 : 1, block ? -2 : -1), { throwOnError: false, displayMode: block }); }
      catch { return esc(p); }
    }
    return inline(p);
  }).join("");
  return html.split(/\n{2,}/).map((para) => `<p>${para.replace(/\n/g, "<br/>")}</p>`).join("");
}

export function Rich({ text, className = "" }: { text: string; className?: string }) {
  const html = useMemo(() => renderRich(text || ""), [text]);
  return <div className={`rich ${className}`} dangerouslySetInnerHTML={{ __html: html }} />;
}

import type { ReactNode } from "react";
import { parseRich, type Inline } from "@/lib/website/sanitize";

function inl(c: Inline[]): ReactNode[] {
  return c.map((x, i) =>
    x.t === "b" ? (
      <strong key={i}>{x.v}</strong>
    ) : x.t === "a" ? (
      <a key={i} href={x.href} rel={x.href.startsWith("http") ? "noopener" : undefined}>
        {x.v}
      </a>
    ) : (
      <span key={i}>{x.v}</span>
    ),
  );
}
/** Renders the engine's rich-text format. Never HTML: text is escaped by React and links pass safeUrl. */
export function Rich({ text, className }: { text: string; className?: string }) {
  if (!text.trim()) return null;
  return (
    <div className={className ?? "sw-prose"}>
      {parseRich(text).map((n, i) =>
        n.t === "ul" ? (
          <ul key={i}>
            {n.items.map((it, j) => (
              <li key={j}>{inl(it)}</li>
            ))}
          </ul>
        ) : n.t === "h" ? (
          <h3 key={i} className="sw-h3">
            {inl(n.c)}
          </h3>
        ) : (
          <p key={i}>{inl(n.c)}</p>
        ),
      )}
    </div>
  );
}

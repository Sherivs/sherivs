/**
 * Renders structured content blocks. Bodies are data (never HTML), so nothing in a
 * content record can inject markup; every block maps to a fixed, styled element.
 */
import { AlertTriangle, Info } from "lucide-react";
import type { ContentBlock } from "@/lib/sherivs/content";

export function ContentBody({ blocks }: { blocks: readonly ContentBlock[] }) {
  return (
    <div className="sv-prose grid gap-5">
      {blocks.map((b, i) => {
        const key = `${b.type}-${i}`;
        switch (b.type) {
          case "p":
            return (
              <p key={key} className="sv-body">
                {b.text}
              </p>
            );
          case "h2":
            return (
              <h2 key={key} className="sv-h2 mt-6">
                {b.text}
              </h2>
            );
          case "h3":
            return (
              <h3 key={key} className="sv-h3 mt-4">
                {b.text}
              </h3>
            );
          case "ul":
            return (
              <ul key={key} className="sv-body grid list-disc gap-2 pl-6 marker:text-[color:var(--sv-text-3)]">
                {b.items.map((it) => (
                  <li key={it}>{it}</li>
                ))}
              </ul>
            );
          case "code":
            return (
              <pre key={key} className="sv-inset sv-code overflow-x-auto p-4" tabIndex={0}>
                <code>{b.text}</code>
              </pre>
            );
          case "callout": {
            const Icon = b.tone === "warning" ? AlertTriangle : Info;
            return (
              <aside key={key} className="sv-inset flex gap-3 p-4" role="note">
                <Icon aria-hidden className="mt-0.5 size-4 shrink-0 text-[color:var(--sv-text-2)]" />
                <p className="sv-small">
                  <span className="sv-label mr-2">{b.tone === "warning" ? "Warning" : "Note"}</span>
                  {b.text}
                </p>
              </aside>
            );
          }
        }
      })}
    </div>
  );
}

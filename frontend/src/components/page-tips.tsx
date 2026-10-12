/**
 * Sherivs — per-page tips (guide surface).
 *
 * Renders a collapsible guidance card inside PortalPage whenever guidance
 * exists for the current route. Content-only: never changes behavior,
 * capability or authorization.
 */
import { Lightbulb } from "lucide-react";
import { useLocation } from "@tanstack/react-router";
import { findTipsForPath } from "@/lib/guidance/page-tips";

export function PageTips() {
  const location = useLocation();
  const tips = findTipsForPath(location.pathname);
  if (!tips) return null;

  return (
    <details className="mb-5 rounded-lg border border-border bg-muted/20 px-4 py-2.5">
      <summary className="flex cursor-pointer items-center gap-2 text-xs font-medium text-muted-foreground hover:text-foreground">
        <Lightbulb className="size-3.5 shrink-0" aria-hidden="true" />
        <span>Need a hand on this page?</span>
        <span className="text-[10px] normal-case tracking-normal text-muted-foreground/70">
          — tips for {tips.title}
        </span>
      </summary>
      <ul className="mt-2.5 list-disc space-y-1.5 pl-4 text-xs text-muted-foreground">
        {tips.tips.map((tip) => (
          <li key={tip}>{tip}</li>
        ))}
      </ul>
    </details>
  );
}

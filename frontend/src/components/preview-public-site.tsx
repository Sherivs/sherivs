import { ExternalLink } from "lucide-react";
import { useApp } from "@/contexts/app-context";

/**
 * Small card that links to the school's public site in a new tab.
 * Rendered on every role dashboard so any user can preview the live
 * public site their school presents to visitors.
 */
export function PreviewPublicSiteCard() {
  const { school } = useApp();
  if (!school?.slug) return null;
  const href = `/?school=${school.slug}`;
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="mb-6 flex items-center justify-between gap-4 rounded-lg border border-primary/40 bg-primary/10 p-4 transition hover:bg-primary/20"
    >
      <div className="min-w-0">
        <div className="font-display text-sm font-semibold text-primary">Preview public site</div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          Open {school.name}'s public website in a new tab
        </div>
      </div>
      <ExternalLink className="h-4 w-4 shrink-0 text-primary" />
    </a>
  );
}

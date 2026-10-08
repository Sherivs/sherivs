/**
 * Sherivs system states — one component for every non-happy path.
 *
 * Each state says what happened, why (when known), and the next safe action. States
 * never invent data to fill space and never imply work is happening when it is not.
 */
import type { ReactNode } from "react";
import {
  AlertTriangle,
  Ban,
  Clock3,
  Inbox,
  Loader2,
  Lock,
  SearchX,
  WifiOff,
  Wrench,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type SystemStateKind =
  | "loading"
  | "empty"
  | "error"
  | "offline"
  | "unauthorized"
  | "forbidden"
  | "expired"
  | "not-found"
  | "maintenance";

const STATE_META: Record<SystemStateKind, { icon: LucideIcon; label: string; tone: string }> = {
  loading: { icon: Loader2, label: "Loading", tone: "var(--sx-observation)" },
  empty: { icon: Inbox, label: "Nothing here yet", tone: "var(--sx-observation)" },
  error: { icon: AlertTriangle, label: "Error", tone: "var(--sx-danger)" },
  offline: { icon: WifiOff, label: "Offline", tone: "var(--sx-action)" },
  unauthorized: { icon: Lock, label: "Sign-in required", tone: "var(--sx-action)" },
  forbidden: { icon: Ban, label: "Not permitted", tone: "var(--sx-danger)" },
  expired: { icon: Clock3, label: "Session expired", tone: "var(--sx-action)" },
  "not-found": { icon: SearchX, label: "Not found", tone: "var(--sx-observation)" },
  maintenance: { icon: Wrench, label: "Maintenance", tone: "var(--sx-action)" },
};

export function SystemState({
  kind,
  title,
  description,
  actions,
  className,
  headingLevel = "h2",
}: {
  kind: SystemStateKind;
  title: string;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
  headingLevel?: "h1" | "h2" | "h3";
}) {
  const meta = STATE_META[kind];
  const Icon = meta.icon;
  const Heading = headingLevel;
  const live =
    kind === "loading"
      ? "polite"
      : kind === "error" || kind === "offline"
        ? "assertive"
        : undefined;
  return (
    <div
      role={kind === "error" ? "alert" : "status"}
      aria-live={live}
      aria-busy={kind === "loading" || undefined}
      className={cn("grid max-w-xl gap-4", className)}
    >
      <span className="inline-flex items-center gap-2.5" style={{ color: meta.tone }}>
        <Icon aria-hidden="true" className={cn("size-4", kind === "loading" && "animate-spin")} />
        <span className="sx-label" style={{ color: meta.tone }}>
          {meta.label}
        </span>
      </span>
      <Heading className="sx-h3">{title}</Heading>
      {description && <div className="sx-body text-sx-muted">{description}</div>}
      {actions && <div className="mt-2 flex flex-wrap items-center gap-3">{actions}</div>}
    </div>
  );
}

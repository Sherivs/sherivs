/**
 * StateView — one component family for every non-happy-path state.
 *
 * Covers: loading, empty, partial, stale, success, warning, error, offline,
 * unauthorized (no session), forbidden (session, no permission), expired,
 * notFound, maintenance. Each has distinct semantics: errors are announced
 * (role="alert"), loading is a polite status, and "forbidden" never leaks what
 * exists behind it.
 */
import type { ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileQuestion,
  Inbox,
  Loader2,
  Lock,
  ShieldAlert,
  Hourglass,
  Wrench,
  WifiOff,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const STATE_KINDS = [
  "loading",
  "empty",
  "partial",
  "stale",
  "success",
  "warning",
  "error",
  "offline",
  "unauthorized",
  "forbidden",
  "expired",
  "notFound",
  "maintenance",
] as const;
export type StateKind = (typeof STATE_KINDS)[number];

interface StateMeta {
  icon: LucideIcon;
  title: string;
  description: string;
  role: "status" | "alert" | undefined;
  tone: string;
}

export const STATE_META: Record<StateKind, StateMeta> = {
  loading: { icon: Loader2, title: "Loading", description: "Fetching the latest information.", role: "status", tone: "var(--sv-text-2)" },
  empty: { icon: Inbox, title: "Nothing here yet", description: "There is no data to show.", role: undefined, tone: "var(--sv-text-2)" },
  partial: { icon: AlertTriangle, title: "Showing partial results", description: "Some information could not be loaded.", role: "status", tone: "var(--sv-warning)" },
  stale: { icon: Clock, title: "This may be out of date", description: "Showing the last known information.", role: "status", tone: "var(--sv-warning)" },
  success: { icon: CheckCircle2, title: "Done", description: "The change was saved.", role: "status", tone: "var(--sv-success)" },
  warning: { icon: AlertTriangle, title: "Check this before continuing", description: "Something needs your attention.", role: "status", tone: "var(--sv-warning)" },
  error: { icon: XCircle, title: "Something went wrong", description: "The request could not be completed.", role: "alert", tone: "var(--sv-danger)" },
  offline: { icon: WifiOff, title: "You're offline", description: "Reconnect to see current information.", role: "status", tone: "var(--sv-warning)" },
  unauthorized: { icon: Lock, title: "Sign in to continue", description: "This page needs a signed-in account.", role: undefined, tone: "var(--sv-text-2)" },
  forbidden: { icon: ShieldAlert, title: "You don't have access", description: "Your role doesn't include this area. Ask an administrator if you need it.", role: undefined, tone: "var(--sv-text-2)" },
  expired: { icon: Hourglass, title: "Your session has expired", description: "Sign in again to continue where you left off.", role: "alert", tone: "var(--sv-warning)" },
  notFound: { icon: FileQuestion, title: "Page not found", description: "This address doesn't exist, or has moved.", role: undefined, tone: "var(--sv-text-2)" },
  maintenance: { icon: Wrench, title: "Scheduled maintenance", description: "This area is temporarily unavailable.", role: "status", tone: "var(--sv-warning)" },
};

export interface StateViewProps {
  kind: StateKind;
  title?: string;
  description?: ReactNode;
  /** Primary and secondary actions (buttons or links). */
  actions?: ReactNode;
  /** Renders inline within a card/section rather than as a page-level block. */
  compact?: boolean;
  /** Technical detail, shown for errors only; callers must not pass secrets. */
  detail?: string;
  className?: string;
}

export function StateView({ kind, title, description, actions, compact, detail, className }: StateViewProps) {
  const meta = STATE_META[kind];
  const Icon = meta.icon;
  return (
    <div
      role={meta.role}
      aria-live={meta.role === "alert" ? "assertive" : meta.role === "status" ? "polite" : undefined}
      aria-busy={kind === "loading" ? true : undefined}
      data-state-kind={kind}
      className={cn(
        "mx-auto flex flex-col items-center text-center",
        compact ? "gap-2 px-4 py-8" : "min-h-[40vh] justify-center gap-3 px-6 py-16",
        className,
      )}
    >
      <span
        className="grid size-10 place-items-center rounded-[var(--sv-radius-lg)] border border-[color:var(--sv-line-strong)] bg-[color:var(--sv-raised)]"
        style={{ color: meta.tone }}
      >
        <Icon aria-hidden className={cn("size-5", kind === "loading" && "motion-safe:animate-spin")} strokeWidth={1.75} />
      </span>
      <h2 className={cn("sv-h3", compact && "!text-base")}>{title ?? meta.title}</h2>
      <p className="sv-small max-w-md text-[color:var(--sv-text-2)]">{description ?? meta.description}</p>
      {kind === "error" && detail ? (
        <p className="sv-code max-w-md break-words rounded-[var(--sv-radius-md)] border border-[color:var(--sv-line)] bg-[color:var(--sv-ground)] px-3 py-2 text-[color:var(--sv-text-3)]">
          {detail}
        </p>
      ) : null}
      {actions ? <div className="mt-2 flex flex-wrap items-center justify-center gap-2">{actions}</div> : null}
    </div>
  );
}

/** Skeleton for list/detail content while loading; honours reduced motion via .sv-skeleton. */
export function SkeletonLines({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("grid gap-2", className)} aria-hidden>
      {Array.from({ length: lines }, (_, i) => (
        <div key={i} className="sv-skeleton h-3" style={{ width: `${100 - ((i * 17) % 45)}%` }} />
      ))}
    </div>
  );
}

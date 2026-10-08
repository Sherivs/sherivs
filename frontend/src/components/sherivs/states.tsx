/**
 * SystemState — one component for every non-happy-path state.
 *
 * Every important surface must handle: loading, empty, partial, stale, error,
 * offline, unauthorized (not signed in), forbidden (signed in, not allowed),
 * expired, not-found, maintenance, success and warning. Each kind carries its
 * own semantics: `alert` for failures, `status` for passive changes, and
 * `aria-busy` for loading, so assistive technology hears what sighted users see.
 */
import type { ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  CircleSlash,
  Clock,
  FileQuestion,
  Hourglass,
  Inbox,
  Loader2,
  Lock,
  ServerCrash,
  Wrench,
  WifiOff,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const SYSTEM_STATE_KINDS = [
  "loading",
  "empty",
  "partial",
  "stale",
  "error",
  "offline",
  "unauthorized",
  "forbidden",
  "expired",
  "not-found",
  "maintenance",
  "success",
  "warning",
] as const;
export type SystemStateKind = (typeof SYSTEM_STATE_KINDS)[number];

interface KindMeta {
  readonly title: string;
  readonly description: string;
  readonly icon: typeof Inbox;
  readonly tone: "neutral" | "info" | "success" | "warning" | "danger";
  readonly role: "alert" | "status" | undefined;
}

export const SYSTEM_STATE_META: Readonly<Record<SystemStateKind, KindMeta>> = {
  loading: { title: "Loading", description: "Fetching the latest information.", icon: Loader2, tone: "info", role: "status" },
  empty: { title: "Nothing here yet", description: "There is no data to show for this view.", icon: Inbox, tone: "neutral", role: undefined },
  partial: { title: "Some data is unavailable", description: "Part of this view could not be loaded. What is shown is accurate but incomplete.", icon: CircleSlash, tone: "warning", role: "status" },
  stale: { title: "This information may be out of date", description: "It was last refreshed a while ago. Refresh to see the current state.", icon: Clock, tone: "warning", role: "status" },
  error: { title: "Something went wrong", description: "The request failed. Nothing has been changed.", icon: ServerCrash, tone: "danger", role: "alert" },
  offline: { title: "You are offline", description: "Reconnect to see current data. Anything already on screen is a snapshot.", icon: WifiOff, tone: "warning", role: "status" },
  unauthorized: { title: "Sign in to continue", description: "This area requires you to sign in.", icon: Lock, tone: "neutral", role: undefined },
  forbidden: { title: "You do not have access", description: "Your account is signed in, but your role does not allow this. Ask an administrator if you need it.", icon: Lock, tone: "danger", role: "alert" },
  expired: { title: "Your session has expired", description: "For your security you have been signed out. Sign in again to continue.", icon: Hourglass, tone: "warning", role: "alert" },
  "not-found": { title: "Page not found", description: "The page you are looking for does not exist or has moved.", icon: FileQuestion, tone: "neutral", role: undefined },
  maintenance: { title: "Scheduled maintenance", description: "This service is temporarily unavailable while we make improvements.", icon: Wrench, tone: "info", role: "status" },
  success: { title: "Done", description: "The change was saved.", icon: CheckCircle2, tone: "success", role: "status" },
  warning: { title: "Check before continuing", description: "There is something to review.", icon: AlertTriangle, tone: "warning", role: "status" },
};

const TONE: Record<KindMeta["tone"], string> = {
  neutral: "text-sv-text-subtle",
  info: "text-sv-info",
  success: "text-sv-success",
  warning: "text-sv-warning",
  danger: "text-sv-danger",
};

export function SystemState({
  kind,
  title,
  description,
  action,
  compact = false,
  className,
}: {
  kind: SystemStateKind;
  title?: string;
  description?: ReactNode;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  const meta = SYSTEM_STATE_META[kind];
  const Icon = meta.icon;
  return (
    <div
      role={meta.role}
      aria-busy={kind === "loading" ? true : undefined}
      data-state-kind={kind}
      className={cn(
        "mx-auto flex max-w-xl flex-col items-start gap-3 border border-dashed border-sv-border-strong bg-sv-surface-1 text-sv-text",
        "rounded-[var(--sv-radius-lg)]",
        compact ? "p-4" : "p-8",
        className,
      )}
    >
      <Icon
        aria-hidden="true"
        className={cn("size-6", TONE[meta.tone], kind === "loading" && "animate-spin motion-reduce:animate-none")}
      />
      <h2 className="sv-h4">{title ?? meta.title}</h2>
      <p className="sv-small text-sv-text-muted">{description ?? meta.description}</p>
      {action && <div className="mt-1">{action}</div>}
    </div>
  );
}

import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import {
  CircleAlert,
  Inbox,
  LoaderCircle,
  Lock,
  WifiOff,
} from "@/components/sherivs/sherivs-icons";
import { cn } from "@/lib/utils";

/**
 * Sherivs system states (V1).
 *
 * Every consequential surface must handle the full state matrix — not just
 * the happy path. These states share one visual language and are announced
 * to assistive technology where the state change is dynamic.
 */

function StateShell({
  icon,
  title,
  body,
  action,
  tone = "neutral",
  live = false,
}: {
  icon: ReactNode;
  title: string;
  body?: string;
  action?: ReactNode;
  tone?: "neutral" | "danger" | "warning";
  live?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center px-6 py-14 text-center",
        tone === "danger" && "text-red-500",
      )}
      {...(live ? { role: "status", "aria-live": "polite" as const } : {})}
    >
      <div
        className="mb-4 grid size-14 place-items-center rounded-2xl border border-border bg-muted/30 text-muted-foreground"
        aria-hidden="true"
      >
        {icon}
      </div>
      <h2 className="font-display text-lg font-semibold text-foreground">{title}</h2>
      {body && (
        <p className="mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">{body}</p>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function LoadingState({ label = "Loading" }: { label?: string }) {
  return (
    <div role="status" aria-live="polite" aria-label={label} className="flex flex-col gap-3 py-8">
      <span className="flex items-center gap-2 text-sm text-muted-foreground">
        <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
        {label}…
      </span>
      <div className="sherivs-shimmer h-4 w-2/3 rounded-md" aria-hidden="true" />
      <div className="sherivs-shimmer h-4 w-1/2 rounded-md" aria-hidden="true" />
      <div className="sherivs-shimmer h-24 w-full rounded-xl" aria-hidden="true" />
    </div>
  );
}

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body?: string;
  action?: ReactNode;
}) {
  return (
    <StateShell
      icon={<Inbox className="size-6" />}
      title={title}
      body={body ?? "There is nothing here yet. When there is, it will appear in this view."}
      action={action}
    />
  );
}

export function ErrorState({
  title = "Something went wrong",
  body = "The view could not be loaded. Your data is unaffected — try again.",
  onRetry,
}: {
  title?: string;
  body?: string;
  onRetry?: () => void;
}) {
  return (
    <StateShell
      live
      tone="danger"
      icon={<CircleAlert className="size-6" />}
      title={title}
      body={body}
      action={
        onRetry ? (
          <button
            type="button"
            onClick={onRetry}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            Try again
          </button>
        ) : undefined
      }
    />
  );
}

export function OfflineState({
  body = "You are offline. Changes you are allowed to make will queue and sync when the connection returns.",
}: {
  body?: string;
}) {
  return (
    <StateShell live icon={<WifiOff className="size-6" />} title="You are offline" body={body} />
  );
}

export function ForbiddenState({
  body = "Your role does not include this view. If you need it, ask your organization administrator to review your permissions.",
}: {
  body?: string;
}) {
  return (
    <StateShell
      icon={<Lock className="size-6" />}
      title="Not permitted"
      body={body}
      action={
        <Link
          to="/"
          className="rounded-md border border-border px-4 py-2 text-sm font-semibold hover:bg-accent"
        >
          Back to home
        </Link>
      }
    />
  );
}

export function NotFoundState({
  title = "Page not found",
  body = "The address may have changed, or the item may have been removed.",
}: {
  title?: string;
  body?: string;
}) {
  return (
    <StateShell
      icon={<CircleAlert className="size-6" />}
      title={title}
      body={body}
      action={
        <Link
          to="/sherivs"
          className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground hover:opacity-90"
        >
          Go to Sherivs home
        </Link>
      }
    />
  );
}

/** AI reasoning is a real backend state — never animate "thinking" without one. */
export function ReasoningState({
  phase,
  detail,
}: {
  phase: "gathering" | "checking" | "verifying";
  detail?: string;
}) {
  const labels = {
    gathering: "Gathering authorized context",
    checking: "Checking policy",
    verifying: "Verifying against evidence",
  } as const;
  return (
    <div
      role="status"
      aria-live="polite"
      className="flex items-center gap-2 text-sm text-muted-foreground"
    >
      <LoaderCircle className="size-4 animate-spin" aria-hidden="true" />
      {labels[phase]}
      {detail ? ` — ${detail}` : ""}
    </div>
  );
}

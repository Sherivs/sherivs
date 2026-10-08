/**
 * Sherivs primitives — the small vocabulary every surface composes
 * (SHERIVS_COMPONENT_CATALOG.md §CONTENT, §DATA, §SYSTEM).
 *
 * Every primitive renders from `--sh-*` tokens via the `.sh-*` classes in
 * styles/sherivs-primitives.css or the Tailwind theme bridge. None of them
 * fetch data, invent numbers, or decide authorization.
 */
import type { ElementType, ReactNode } from "react";
import {
  AlertTriangle,
  CircleSlash,
  Inbox,
  Loader2,
  Lock,
  SearchX,
  WifiOff,
  type LucideIcon,
} from "lucide-react";
import type { PlaneOfMeaning, StatusTone } from "@/lib/experience/design-tokens";
import { cn } from "@/lib/utils";

/* ── Editorial ─────────────────────────────────────────────────────── */

/** Small uppercase label that precedes a heading. */
export function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return <p className={cn("sh-label", className)}>{children}</p>;
}

/** Monospace section number — the spine of the public narrative ("03 / 12"). */
export function SectionIndex({
  index,
  total,
  className,
}: {
  index: number;
  total?: number;
  className?: string;
}) {
  const n = String(index).padStart(2, "0");
  return (
    <span className={cn("sh-index", className)} aria-hidden="true">
      {total ? `${n} / ${String(total).padStart(2, "0")}` : n}
    </span>
  );
}

export function SectionHeading({
  id,
  index,
  total,
  eyebrow,
  title,
  lead,
  as: Tag = "h2",
  className,
  align = "start",
}: {
  id: string;
  index?: number;
  total?: number;
  eyebrow?: string;
  title: string;
  lead?: string;
  as?: "h1" | "h2" | "h3";
  className?: string;
  align?: "start" | "center";
}) {
  return (
    <div className={cn("max-w-3xl", align === "center" && "mx-auto text-center", className)}>
      {(index !== undefined || eyebrow) && (
        <div
          className={cn(
            "flex items-center gap-3",
            align === "center" && "justify-center",
          )}
        >
          {index !== undefined && <SectionIndex index={index} total={total} />}
          {eyebrow && <Eyebrow>{eyebrow}</Eyebrow>}
        </div>
      )}
      <Tag id={id} className={cn("mt-3", Tag === "h1" ? "sh-h1" : Tag === "h2" ? "sh-h2" : "sh-h3")}>
        {title}
      </Tag>
      {lead && <p className="sh-body-lg mt-4 text-ink-2 sh-prose">{lead}</p>}
    </div>
  );
}

/* ── Semantic chips / planes ───────────────────────────────────────── */

const PLANE_LABEL: Record<PlaneOfMeaning, string> = {
  reality: "Reality",
  intel: "Intelligence",
  action: "Action",
  evidence: "Evidence",
};

export function Chip({
  tone = "neutral",
  children,
  dot = false,
  className,
  live = false,
}: {
  tone?: StatusTone;
  children: ReactNode;
  dot?: boolean;
  className?: string;
  /** Only set when the underlying system state is genuinely live. */
  live?: boolean;
}) {
  return (
    <span className={cn("sh-chip", `sh-tone-${tone}`, className)}>
      {dot && <span className={cn("sh-chip-dot", live && "sh-live")} aria-hidden="true" />}
      {children}
    </span>
  );
}

/** Labels a block as belonging to one of the four planes of meaning. */
export function PlaneLabel({ plane, className }: { plane: PlaneOfMeaning; className?: string }) {
  return (
    <Chip tone={plane} dot className={className}>
      {PLANE_LABEL[plane]}
    </Chip>
  );
}

/* ── Surfaces ─────────────────────────────────────────────────────── */

export function Panel({
  as: Tag = "div",
  tone,
  raised = false,
  className,
  children,
  ...rest
}: {
  as?: ElementType;
  /** Adds a 2px leading rail in the plane/status tone. */
  tone?: StatusTone;
  raised?: boolean;
  className?: string;
  children: ReactNode;
  [key: string]: unknown;
}) {
  return (
    <Tag
      className={cn(
        raised ? "sh-panel-raised" : "sh-panel",
        tone && `sh-rail sh-tone-${tone}`,
        "p-5 sm:p-6",
        className,
      )}
      {...rest}
    >
      {children}
    </Tag>
  );
}

export function Inset({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn("sh-inset p-4", className)}>{children}</div>;
}

/* ── Data ─────────────────────────────────────────────────────────── */

export function Metric({
  label,
  value,
  hint,
  tone,
  className,
}: {
  label: string;
  /** Pre-formatted value. Render "—" for unknown; never a placeholder number. */
  value: string | number | null | undefined;
  hint?: string;
  tone?: StatusTone;
  className?: string;
}) {
  const rendered = value === null || value === undefined || value === "" ? "—" : String(value);
  return (
    <div className={cn("min-w-0", className)}>
      <div className="sh-label truncate">{label}</div>
      <div className={cn("sh-metric mt-1.5 truncate", tone && `sh-tone-${tone}`)} style={tone ? { color: "var(--sh-tone)" } : undefined}>
        {rendered}
      </div>
      {hint && <div className="sh-caption mt-1 truncate">{hint}</div>}
    </div>
  );
}

/** Confidence as a precise, labelled meter — never a vague glow. */
export function ConfidenceMeter({
  value,
  label = "Confidence",
  className,
}: {
  /** 0..1; null when not computed. */
  value: number | null;
  label?: string;
  className?: string;
}) {
  const pct = value === null ? null : Math.round(Math.min(1, Math.max(0, value)) * 100);
  const tone: StatusTone =
    pct === null ? "neutral" : pct >= 80 ? "success" : pct >= 50 ? "warning" : "danger";
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <span className="sh-label">{label}</span>
      <span
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct ?? undefined}
        aria-valuetext={pct === null ? "not computed" : `${pct} percent`}
        className={cn("relative h-1.5 w-28 overflow-hidden rounded-full bg-plane-3", `sh-tone-${tone}`)}
      >
        {pct !== null && (
          <span
            className="absolute inset-y-0 left-0 rounded-full"
            style={{ width: `${pct}%`, background: "var(--sh-tone)" }}
          />
        )}
      </span>
      <span className="sh-data text-ink-2">{pct === null ? "—" : `${pct}%`}</span>
    </div>
  );
}

/**
 * Evidence mark — provenance made visible: who/what produced a statement,
 * when, and whether it has been verified. The visual contract for trust.
 */
export function EvidenceMark({
  source,
  actor,
  at,
  verified,
  aiGenerated = false,
  className,
}: {
  source: string;
  actor?: string;
  at?: string;
  verified: boolean | null;
  aiGenerated?: boolean;
  className?: string;
}) {
  return (
    <div className={cn("sh-rail sh-tone-evidence pl-3 text-ink-2", className)}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <span className="sh-label text-evidence">Evidence</span>
        <span className="sh-small text-ink-1">{source}</span>
        {actor && <span className="sh-small">by {actor}</span>}
        {at && (
          <time className="sh-code text-ink-3" dateTime={at}>
            {at}
          </time>
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap gap-1.5">
        <Chip tone={verified === true ? "success" : verified === false ? "warning" : "neutral"} dot>
          {verified === true ? "Verified" : verified === false ? "Unverified" : "Verification pending"}
        </Chip>
        {aiGenerated && <Chip tone="intel">AI-generated</Chip>}
      </div>
    </div>
  );
}

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cn(
        "sh-code inline-flex h-5 min-w-5 items-center justify-center rounded-[var(--sh-radius-xs)] border border-line-2 bg-plane-3 px-1.5 text-[0.6875rem] text-ink-2",
        className,
      )}
    >
      {children}
    </kbd>
  );
}

/* ── System states ────────────────────────────────────────────────── */

export type SystemStateKind =
  | "loading"
  | "empty"
  | "error"
  | "offline"
  | "forbidden"
  | "not-found"
  | "unavailable";

const STATE_ICON: Record<SystemStateKind, LucideIcon> = {
  loading: Loader2,
  empty: Inbox,
  error: AlertTriangle,
  offline: WifiOff,
  forbidden: Lock,
  "not-found": SearchX,
  unavailable: CircleSlash,
};

const STATE_TONE: Record<SystemStateKind, StatusTone> = {
  loading: "neutral",
  empty: "neutral",
  error: "danger",
  offline: "warning",
  forbidden: "warning",
  "not-found": "neutral",
  unavailable: "neutral",
};

/**
 * One component for every non-happy path. Honest by construction: it says
 * what the system knows and offers only real actions.
 */
export function StateBlock({
  kind,
  title,
  description,
  action,
  compact = false,
  className,
}: {
  kind: SystemStateKind;
  title: string;
  description?: string;
  action?: ReactNode;
  compact?: boolean;
  className?: string;
}) {
  const Icon = STATE_ICON[kind];
  const tone = STATE_TONE[kind];
  return (
    <div
      role={kind === "error" ? "alert" : kind === "loading" ? "status" : undefined}
      aria-busy={kind === "loading" || undefined}
      className={cn(
        "sh-inset flex flex-col items-start gap-3 text-left",
        compact ? "p-4" : "p-6 sm:p-8",
        `sh-tone-${tone}`,
        className,
      )}
    >
      <span
        className="grid size-9 place-items-center rounded-[var(--sh-radius-md)] border border-line-1 bg-plane-2"
        style={{ color: "var(--sh-tone)" }}
        aria-hidden="true"
      >
        <Icon className={cn("size-4", kind === "loading" && "animate-spin")} />
      </span>
      <div className="min-w-0">
        <p className="sh-h4 text-ink-1">{title}</p>
        {description && <p className="sh-small mt-1 text-ink-3 sh-prose">{description}</p>}
      </div>
      {action && <div className="flex flex-wrap gap-2">{action}</div>}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("sh-skeleton", className)} aria-hidden="true" />;
}

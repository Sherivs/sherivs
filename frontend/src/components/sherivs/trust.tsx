/**
 * Trust primitives — making evidence, provenance and confidence visible.
 *
 * Contract (see SHERIVS_EXPERIENCE_CONSTITUTION.md §Trust):
 *  - A statement's epistemic kind is always shown as TEXT + glyph + rule, never colour alone.
 *  - Confidence is shown only when it was assessed; otherwise the UI says "Not assessed".
 *  - Nothing here animates. "Processing" is an explicit prop that callers set from a
 *    real in-flight request; a component never decides to look busy.
 */
import type { ReactNode } from "react";
import { ArrowRight, Compass, Eye, FileCheck2, ShieldCheck, Waypoints, type LucideIcon } from "lucide-react";
import { EPISTEMIC_KINDS, PLANES, PLANE_TO_KIND, type EpistemicKind, type Plane } from "@/lib/sherivs/tokens";
import { cn } from "@/lib/utils";

const KIND_META: Record<EpistemicKind, { label: string; icon: LucideIcon; gloss: string }> = {
  observation: { label: "Observation", icon: Eye, gloss: "Read from a record or event" },
  inference: { label: "Inference", icon: Waypoints, gloss: "Derived; may be wrong" },
  recommendation: { label: "Recommendation", icon: Compass, gloss: "Suggested; does nothing until approved" },
  action: { label: "Action", icon: ArrowRight, gloss: "Carried out under a named authority" },
  evidence: { label: "Evidence", icon: FileCheck2, gloss: "Captured proof with source and time" },
  verification: { label: "Verification", icon: ShieldCheck, gloss: "Independent check of an outcome" },
};

export function epistemicLabel(kind: EpistemicKind): string {
  return KIND_META[kind].label;
}

export function EpistemicLabel({ kind, className }: { kind: EpistemicKind; className?: string }) {
  const { label, icon: Icon } = KIND_META[kind];
  return (
    <span className={cn("sv-label sv-kind-label", className)} style={{ ["--kind" as string]: `var(--sv-kind-${kind})` }}>
      <Icon aria-hidden className="size-3.5" strokeWidth={1.75} />
      {label}
    </span>
  );
}

export interface EpistemicBlockProps {
  kind: EpistemicKind;
  title?: string;
  children: ReactNode;
  /** 0–1. Omit when confidence was not assessed. */
  confidence?: number | null;
  source?: string;
  at?: string;
  className?: string;
}

/** A statement with its epistemic status, confidence and provenance attached. */
export function EpistemicBlock({ kind, title, children, confidence, source, at, className }: EpistemicBlockProps) {
  return (
    <section className={cn("sv-kind", className)} data-kind={kind} aria-label={`${KIND_META[kind].label}${title ? `: ${title}` : ""}`}>
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
        <EpistemicLabel kind={kind} />
        {kind === "inference" || kind === "recommendation" ? <ConfidenceMeter value={confidence ?? null} compact /> : null}
      </div>
      {title ? <h4 className="sv-h4 mt-1.5">{title}</h4> : null}
      <div className="sv-small mt-1.5 text-[color:var(--sv-text-2)]">{children}</div>
      {source || at ? (
        <p className="sv-caption mt-2 flex flex-wrap gap-x-3 text-[color:var(--sv-text-3)]">
          {source ? <span>Source: {source}</span> : null}
          {at ? <time dateTime={at}>{at}</time> : null}
        </p>
      ) : null}
    </section>
  );
}

/** Confidence as a number with its basis. Unassessed is stated, never defaulted. */
export function ConfidenceMeter({
  value,
  basis,
  compact,
  className,
}: {
  value: number | null;
  basis?: string;
  compact?: boolean;
  className?: string;
}) {
  if (value === null || Number.isNaN(value)) {
    return (
      <span className={cn("sv-caption text-[color:var(--sv-text-3)]", className)}>Confidence: not assessed</span>
    );
  }
  const pct = Math.round(Math.min(1, Math.max(0, value)) * 100);
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span
        role="meter"
        aria-label="Confidence"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct}
        aria-valuetext={`${pct} percent${basis ? `, ${basis}` : ""}`}
        className={cn("relative h-1 overflow-hidden rounded-full bg-[color:var(--sv-line-strong)]", compact ? "w-14" : "w-24")}
      >
        <span className="absolute inset-y-0 left-0 bg-[color:var(--sv-text-2)]" style={{ width: `${pct}%` }} />
      </span>
      <span className="sv-data text-[color:var(--sv-text-2)]">{pct}%</span>
      {basis && !compact ? <span className="sv-caption text-[color:var(--sv-text-3)]">{basis}</span> : null}
    </span>
  );
}

export type VerificationState = "unverified" | "pending" | "verified" | "failed" | "expired";

const VERIFICATION_COPY: Record<VerificationState, { label: string; tone: string }> = {
  unverified: { label: "Not verified", tone: "var(--sv-text-3)" },
  pending: { label: "Verification pending", tone: "var(--sv-warning)" },
  verified: { label: "Verified", tone: "var(--sv-success)" },
  failed: { label: "Verification failed", tone: "var(--sv-danger)" },
  expired: { label: "Verification expired", tone: "var(--sv-warning)" },
};

export function VerificationBadge({ state, by, at }: { state: VerificationState; by?: string; at?: string }) {
  const { label, tone } = VERIFICATION_COPY[state];
  return (
    <span
      className="sv-caption inline-flex items-center gap-1.5 rounded-[var(--sv-radius-sm)] border border-[color:var(--sv-line-strong)] px-2 py-0.5"
      style={{ color: tone }}
    >
      <ShieldCheck aria-hidden className="size-3.5" strokeWidth={1.75} />
      <span>{label}</span>
      {by ? <span className="text-[color:var(--sv-text-3)]">· {by}</span> : null}
      {at ? <time dateTime={at} className="text-[color:var(--sv-text-3)]">· {at}</time> : null}
    </span>
  );
}

export interface ProvenanceFields {
  actor?: string;
  worker?: string;
  model?: string;
  action?: string;
  source?: string;
  at?: string;
  outcome?: string;
}

/** A compact provenance line: who/what/when. Renders only the fields supplied. */
export function ProvenanceLine({ actor, worker, model, action, source, at, outcome }: ProvenanceFields) {
  const parts: Array<[string, string]> = [];
  if (actor) parts.push(["Actor", actor]);
  if (worker) parts.push(["Worker", worker]);
  if (model) parts.push(["Model", model]);
  if (action) parts.push(["Action", action]);
  if (source) parts.push(["Source", source]);
  if (outcome) parts.push(["Outcome", outcome]);
  if (parts.length === 0 && !at) return null;
  return (
    <dl className="sv-caption flex flex-wrap gap-x-4 gap-y-1 text-[color:var(--sv-text-3)]">
      {parts.map(([k, v]) => (
        <div key={k} className="flex gap-1.5">
          <dt className="sv-label !tracking-[0.1em]">{k}</dt>
          <dd className="text-[color:var(--sv-text-2)]">{v}</dd>
        </div>
      ))}
      {at ? (
        <div className="flex gap-1.5">
          <dt className="sv-label !tracking-[0.1em]">At</dt>
          <dd>
            <time dateTime={at} className="text-[color:var(--sv-text-2)]">
              {at}
            </time>
          </dd>
        </div>
      ) : null}
    </dl>
  );
}

/** Reality → Intelligence → Action → Evidence, as a vertical rail. */
export function PlaneRail({
  items,
  className,
}: {
  items: readonly { plane: Plane; title: string; text: string }[];
  className?: string;
}) {
  return (
    <ol className={cn("grid gap-8", className)}>
      {items.map((item) => (
        <li key={item.plane} className="sv-plane" data-plane={item.plane}>
          <p className="sv-label" style={{ color: `var(--sv-kind-${PLANE_TO_KIND[item.plane]})` }}>
            {item.plane}
          </p>
          <h3 className="sv-h3 mt-1">{item.title}</h3>
          <p className="sv-small mt-1 max-w-prose text-[color:var(--sv-text-2)]">{item.text}</p>
        </li>
      ))}
    </ol>
  );
}

export { EPISTEMIC_KINDS, PLANES };

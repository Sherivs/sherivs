/**
 * Trust primitives: statement kinds, confidence, provenance, verification.
 *
 * These make trust visible. They display only what they are given — confidence
 * is omitted when not supplied, "in progress" pulses only when `live` is true
 * (i.e. the backend is genuinely working), and nothing here invents data.
 */
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  STATEMENT_KIND_META,
  VERIFICATION_STATE_META,
  confidenceBand,
  confidencePercent,
  type ProvenanceStep,
  type StatementKind,
  type VerificationStateName,
} from "@/lib/experience-system/evidence-model";

export function StatementBadge({ kind, className }: { kind: StatementKind; className?: string }) {
  const meta = STATEMENT_KIND_META[kind];
  return (
    <span
      data-plane={meta.plane}
      title={meta.trust}
      className={cn("sv-plane-marker sv-label text-sv-text-muted", className)}
    >
      {meta.label}
      <span className="sr-only">. {meta.trust}.</span>
    </span>
  );
}

export function ConfidenceMeter({
  score,
  label = "Confidence",
  className,
}: {
  score: number | null | undefined;
  label?: string;
  className?: string;
}) {
  const band = confidenceBand(score);
  if (band === null || typeof score !== "number") return null;
  return (
    <div className={cn("flex items-center gap-3", className)}>
      <span className="sv-caption text-sv-text-subtle">{label}</span>
      <div
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={Math.round(score * 100)}
        aria-valuetext={`${confidencePercent(score)}, ${band}`}
        className="h-1.5 w-24 bg-sv-border"
      >
        <div
          className="h-full bg-sv-accent"
          style={{ width: confidencePercent(score) }}
        />
      </div>
      <span className="sv-data text-sv-text-muted">{confidencePercent(score)}</span>
    </div>
  );
}

export function VerificationState({
  state,
  className,
}: {
  state: VerificationStateName;
  className?: string;
}) {
  const meta = VERIFICATION_STATE_META[state];
  return (
    <span
      className={cn("sv-state", className)}
      data-state={state === "pending" ? "loading" : state === "verified" ? "verified" : state === "failed" ? "error" : state === "stale" ? "stale" : undefined}
      data-live={meta.live ? "true" : undefined}
    >
      {meta.label}
    </span>
  );
}

/** Ordered provenance: where something came from and who handled it. */
export function ProvenanceTrace({
  steps,
  timeZone,
  locale = "en",
  className,
}: {
  steps: readonly ProvenanceStep[];
  timeZone?: string;
  locale?: string;
  className?: string;
}) {
  if (steps.length === 0) return null;
  return (
    <ol aria-label="Provenance" className={cn("sv-trace", className)}>
      {steps.map((step, i) => (
        <li key={`${step.label}-${i}`} data-plane={step.plane}>
          <p className="font-medium">{step.label}</p>
          {step.detail && <p className="sv-small text-sv-text-muted">{step.detail}</p>}
          {step.at && (
            <time className="sv-caption sv-data text-sv-text-subtle" dateTime={step.at}>
              {new Intl.DateTimeFormat(locale, {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone,
              }).format(new Date(step.at))}
            </time>
          )}
        </li>
      ))}
    </ol>
  );
}

export function EvidenceChip({
  source,
  actor,
  children,
  className,
}: {
  source: string;
  actor?: string;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <span
      data-plane="evidence"
      className={cn(
        "sv-caption inline-flex items-center gap-2 border border-sv-border px-2 py-1 rounded-[var(--sv-radius-sm)]",
        className,
      )}
    >
      <span aria-hidden="true" className="sv-plane-marker" />
      <span className="font-medium">{source}</span>
      {actor && <span className="text-sv-text-subtle">· {actor}</span>}
      {children}
    </span>
  );
}

/**
 * A single AI/system statement with its kind, optional confidence, evidence and
 * verification. The kind decides the visual treatment; the content is plain text.
 */
export function AiStatement({
  kind,
  children,
  confidence,
  evidence,
  verification,
  className,
}: {
  kind: StatementKind;
  children: ReactNode;
  confidence?: number | null;
  evidence?: ReactNode;
  verification?: VerificationStateName;
  className?: string;
}) {
  const meta = STATEMENT_KIND_META[kind];
  return (
    <article
      data-plane={meta.plane}
      aria-label={`${meta.label}: ${meta.trust}`}
      className={cn(
        "border-l-2 border-[var(--plane)] bg-sv-surface-1 py-3 pl-4 pr-3 rounded-r-[var(--sv-radius-md)]",
        className,
      )}
    >
      <StatementBadge kind={kind} />
      <div className="mt-1.5">{children}</div>
      {(confidence != null || verification || evidence) && (
        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2">
          <ConfidenceMeter score={confidence} />
          {verification && <VerificationState state={verification} />}
          {evidence}
        </div>
      )}
    </article>
  );
}

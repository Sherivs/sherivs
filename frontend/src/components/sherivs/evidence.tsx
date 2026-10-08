import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  Eye,
  FileCheck2,
  Fingerprint,
  ScanEye,
  ShieldCheck,
  Sparkles,
} from "@/components/sherivs/sherivs-icons";

/**
 * Evidence & verification primitives (V1).
 *
 * AI responses and mission outcomes must visually distinguish what kind of
 * statement is being made. These primitives make trust visible: observation
 * vs inference vs recommendation vs action, each with provenance.
 */

export type IntelligenceKind =
  "observation" | "inference" | "recommendation" | "action" | "evidence" | "verification";

const KIND_STYLES: Record<
  IntelligenceKind,
  { label: string; className: string; Icon: typeof Eye }
> = {
  observation: {
    label: "Observation",
    className: "border-sky-500/30 bg-sky-500/10 text-sky-600 dark:text-sky-300",
    Icon: Eye,
  },
  inference: {
    label: "Inference",
    className: "border-violet-500/30 bg-violet-500/10 text-violet-600 dark:text-violet-300",
    Icon: Sparkles,
  },
  recommendation: {
    label: "Recommendation",
    className: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300",
    Icon: ScanEye,
  },
  action: {
    label: "Action",
    className: "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-300",
    Icon: FileCheck2,
  },
  evidence: {
    label: "Evidence",
    className: "border-teal-500/30 bg-teal-500/10 text-teal-600 dark:text-teal-300",
    Icon: Fingerprint,
  },
  verification: {
    label: "Verified",
    className: "border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-300",
    Icon: ShieldCheck,
  },
};

export function IntelligenceBadge({ kind }: { kind: IntelligenceKind }) {
  const { label, className, Icon } = KIND_STYLES[kind];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold",
        className,
      )}
    >
      <Icon className="size-3.5" aria-hidden="true" />
      {label}
    </span>
  );
}

export interface ProvenanceProps {
  actor: string;
  timestamp: string;
  source?: string;
  confidence?: number;
  children?: ReactNode;
}

/** Who said it, when, from what source, with what confidence. */
export function Provenance({ actor, timestamp, source, confidence, children }: ProvenanceProps) {
  return (
    <figure className="rounded-xl border border-border p-4">
      {children && <div className="text-sm leading-relaxed">{children}</div>}
      <figcaption className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-3 text-xs text-muted-foreground">
        <span>
          Actor: <span className="font-medium text-foreground">{actor}</span>
        </span>
        <time dateTime={timestamp}>{timestamp}</time>
        {source && <span>Source: {source}</span>}
        {typeof confidence === "number" && <ConfidenceMeter value={confidence} />}
      </figcaption>
    </figure>
  );
}

export function ConfidenceMeter({ value }: { value: number }) {
  const clamped = Math.min(100, Math.max(0, Math.round(value)));
  return (
    <span
      className="inline-flex items-center gap-2"
      role="meter"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={clamped}
      aria-label={`Confidence ${clamped} percent`}
    >
      <span className="h-1.5 w-16 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        <span className="block h-full rounded-full bg-primary" style={{ width: `${clamped}%` }} />
      </span>
      {clamped}%
    </span>
  );
}

export function VerificationState({
  state,
  detail,
}: {
  state: "pending" | "approved" | "rejected" | "expired";
  detail?: string;
}) {
  const styles: Record<string, string> = {
    pending: "border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300",
    approved: "border-green-500/30 bg-green-500/10 text-green-600 dark:text-green-300",
    rejected: "border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-300",
    expired: "border-muted bg-muted/30 text-muted-foreground",
  };
  return (
    <p
      className={cn(
        "inline-flex rounded-md border px-2.5 py-1 text-xs font-semibold",
        styles[state],
      )}
    >
      {state.charAt(0).toUpperCase() + state.slice(1)}
      {detail ? ` — ${detail}` : ""}
    </p>
  );
}

/**
 * Visual primitives that make trust visible: evidence, confidence, provenance.
 * These are presentation atoms. They never assert verification that did not happen.
 */
export type IntelligenceKind =
  | "observation"
  | "inference"
  | "recommendation"
  | "action"
  | "evidence"
  | "verification";

const KIND_LABEL: Record<IntelligenceKind, string> = {
  observation: "Observation",
  inference: "Inference",
  recommendation: "Recommendation",
  action: "Action",
  evidence: "Evidence",
  verification: "Verification",
};

export function IntelligenceKindBadge({ kind }: { kind: IntelligenceKind }) {
  return (
    <span
      data-kind={kind}
      className="inline-flex items-center rounded-sm border border-border px-2 py-0.5 font-mono text-[0.65rem] uppercase tracking-[0.16em] text-muted-foreground"
    >
      {KIND_LABEL[kind]}
    </span>
  );
}

export function ConfidenceMeter({
  value,
  label = "Confidence",
}: {
  value: number;
  label?: string;
}) {
  const clamped = Math.max(0, Math.min(1, value));
  const pct = Math.round(clamped * 100);
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-xs">
        <span className="uppercase tracking-[0.16em] text-muted-foreground">{label}</span>
        <span className="font-mono tabular-nums">{pct}%</span>
      </div>
      <div className="mt-1 h-1 bg-muted" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={label}>
        <div className="h-full bg-foreground" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function ProvenanceLine({
  actor,
  at,
  source,
}: {
  actor: string;
  at: string;
  source: string;
}) {
  return (
    <p className="font-mono text-[0.7rem] leading-relaxed text-muted-foreground">
      {actor} · {at} · {source}
    </p>
  );
}

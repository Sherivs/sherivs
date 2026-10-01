/**
 * CoreGrid — first SLO/SLI set for the governed loop
 * (V1CAP-077 / MISSION-R-102 T2; E-101; hardening L-H-027).
 *
 * Five loop-stage SLIs, each bound to one stage of the governed loop, each
 * with an objective threshold and a declared measurement provenance hook over
 * the verified observability foundation (structured redacting logs, health
 * report, adapter policy events). Evaluation is a PURE function: given SLI
 * samples it returns met / violated / insufficient_data with per-sample
 * evidence — it never mutates, never reaches I/O, and never claims "met" on
 * insufficient data (fail-closed reporting).
 *
 * Error budgets are a simple burn calculation at the sample level: a sample
 * is "bad" when it individually breaches the SLI's sample bound; the budget
 * allows `budgetFraction` of the samples to be bad; burn rate is bad/allowed.
 * Security-relevant zero-tolerance SLIs carry a budget of 0 — any breach
 * exhausts the budget (budget exhaustion triggers review, not silent
 * degradation).
 *
 * Pure contract module: no I/O, no provider imports, no secrets.
 */

import type { LoopStage } from "./failure-architecture";

/* ─────────────────────────────────────────────────────────────
 * Vocabulary
 * ────────────────────────────────────────────────────────────*/

export type SliId =
  | "mission_admission_latency"
  | "evidence_capture_success_rate"
  | "verification_pass_rate"
  | "memory_retrieval_authorization_rate"
  | "command_idempotency_collision_rate";

export const SLI_IDS: readonly SliId[] = [
  "mission_admission_latency",
  "evidence_capture_success_rate",
  "verification_pass_rate",
  "memory_retrieval_authorization_rate",
  "command_idempotency_collision_rate",
];

export type SliKind = "latency" | "rate";
export type SliDirection = "lower_is_better" | "higher_is_better";
/** How the sample window aggregates into one observed value. */
export type SliAggregation = "p95" | "mean";

export interface SliDefinition {
  id: SliId;
  /** The loop stage the SLI observes. */
  stage: LoopStage;
  kind: SliKind;
  direction: SliDirection;
  aggregation: SliAggregation;
  description: string;
  /**
   * Where samples come from (measurement provenance vocabulary over the
   * observability foundation): the emitted field/event a collector reads.
   */
  measurement: string;
  unit: "ms" | "ratio";
  /** Minimum samples before an objective may be evaluated at all. */
  minSamples: number;
}

export interface SloDefinition {
  sli: SliId;
  /** Human-stated objective. */
  objective: string;
  /**
   * Objective threshold. lower_is_better: met when observed <= threshold.
   * higher_is_better: met when observed >= threshold. Inclusive boundary:
   * exactly at the threshold is MET.
   */
  threshold: number;
  /**
   * Error budget: the fraction of samples allowed to individually breach the
   * sample bound. 0 = zero tolerance (any breach exhausts the budget).
   */
  errorBudgetFraction: number;
}

/* ─────────────────────────────────────────────────────────────
 * Catalogue (the first SLO/SLI set)
 * ────────────────────────────────────────────────────────────*/

const MISSION_ADMISSION_LATENCY_MS = 2_000;

export const SLI_CATALOGUE: readonly SliDefinition[] = [
  {
    id: "mission_admission_latency",
    stage: "mission",
    kind: "latency",
    direction: "lower_is_better",
    aggregation: "p95",
    description:
      "Latency of governed mission admission (request received → idempotent admission recorded), at the 95th percentile.",
    measurement: "structured-log admission line `duration_ms` on component `foundation-loop`",
    unit: "ms",
    minSamples: 20,
  },
  {
    id: "evidence_capture_success_rate",
    stage: "evidence",
    kind: "rate",
    direction: "higher_is_better",
    aggregation: "mean",
    description:
      "Share of consequential loop steps for which evidence capture succeeds (1 = captured, 0 = missing/refused).",
    measurement: "evidence tail records per admitted execution (foundation-loop evidence capture)",
    unit: "ratio",
    minSamples: 50,
  },
  {
    id: "verification_pass_rate",
    stage: "verification",
    kind: "rate",
    direction: "higher_is_better",
    aggregation: "mean",
    description:
      "Share of verifications that pass their invariants on first evaluation (1 = pass, 0 = fail/refusal).",
    measurement: "verification records with verdict per completed execution",
    unit: "ratio",
    minSamples: 50,
  },
  {
    id: "memory_retrieval_authorization_rate",
    stage: "memory",
    kind: "rate",
    direction: "higher_is_better",
    aggregation: "mean",
    description:
      "Share of memory retrievals that pass memory-scope authorization (1 = authorized, 0 = denied). Zero tolerance: any unauthorized retrieval is a security incident.",
    measurement: "memory-scope authorization decisions per retrieval attempt",
    unit: "ratio",
    minSamples: 50,
  },
  {
    id: "command_idempotency_collision_rate",
    stage: "action",
    kind: "rate",
    direction: "lower_is_better",
    aggregation: "mean",
    description:
      "Share of consequential commands whose idempotency key conflicts — same key, different content (replay attacks). Zero tolerance: every conflict is a security event (J-030).",
    measurement: "idempotency-key conflict refusals per consequential command admission",
    unit: "ratio",
    minSamples: 50,
  },
];

export const SLO_CATALOGUE: readonly SloDefinition[] = [
  {
    sli: "mission_admission_latency",
    objective: "95% of governed mission admissions record within 2 seconds",
    threshold: MISSION_ADMISSION_LATENCY_MS,
    errorBudgetFraction: 0.05,
  },
  {
    sli: "evidence_capture_success_rate",
    objective: "Evidence capture succeeds for at least 99% of consequential loop steps",
    threshold: 0.99,
    errorBudgetFraction: 0.01,
  },
  {
    sli: "verification_pass_rate",
    objective: "At least 98% of verifications pass their invariants on first evaluation",
    threshold: 0.98,
    errorBudgetFraction: 0.02,
  },
  {
    sli: "memory_retrieval_authorization_rate",
    objective: "100% of memory retrievals pass memory-scope authorization (zero tolerance)",
    threshold: 1,
    errorBudgetFraction: 0,
  },
  {
    sli: "command_idempotency_collision_rate",
    objective: "No idempotency-key conflicts on consequential commands (zero tolerance)",
    threshold: 0,
    errorBudgetFraction: 0,
  },
];

export function sliDefinition(id: SliId): SliDefinition {
  const def = SLI_CATALOGUE.find((candidate) => candidate.id === id);
  if (!def) throw new TypeError(`no SLI definition for id "${id}"`);
  return def;
}

export function sloDefinition(id: SliId): SloDefinition {
  const def = SLO_CATALOGUE.find((candidate) => candidate.sli === id);
  if (!def) throw new TypeError(`no SLO definition for SLI "${id}"`);
  return def;
}

/** SLIs bound to one loop stage (explicit coverage view, no silent gaps). */
export function slisForStage(stage: LoopStage): readonly SliDefinition[] {
  return SLI_CATALOGUE.filter((def) => def.stage === stage);
}

export interface StageSliCoverage {
  stage: LoopStage;
  covered: boolean;
  slis: readonly SliId[];
}

/** Explicit per-stage coverage of the SLI set — gaps are named, never silent. */
export function stageSliCoverage(allStages: readonly LoopStage[]): readonly StageSliCoverage[] {
  return allStages.map((stage) => ({
    stage,
    covered: slisForStage(stage).length > 0,
    slis: slisForStage(stage).map((def) => def.id),
  }));
}

/* ─────────────────────────────────────────────────────────────
 * Samples
 * ────────────────────────────────────────────────────────────*/

export interface SliSample {
  sli: SliId;
  /** Observed value: ms for latency SLIs, 0/1 outcome for rate SLIs. */
  value: number;
  /** ISO-8601 observation timestamp. */
  at: string;
  /** Tenant scope of the sample; null for platform-wide samples. */
  tenantId: string | null;
  /** Provenance reference to the emitting log line / record. */
  ref: string | null;
}

/* ─────────────────────────────────────────────────────────────
 * Evaluation (pure)
 * ────────────────────────────────────────────────────────────*/

export type SloEvaluationStatus = "met" | "violated" | "insufficient_data";

export interface SloEvaluationEvidence {
  at: string;
  value: number;
  ref: string | null;
  /** True when the sample was dropped as invalid (non-finite / out of range). */
  invalid: boolean;
}

export interface SloEvaluation {
  sli: SliId;
  status: SloEvaluationStatus;
  objective: string;
  threshold: number;
  aggregation: SliAggregation;
  direction: SliDirection;
  /** Aggregated observed value; null while insufficient_data. */
  observed: number | null;
  /** Valid sample count used for aggregation. */
  sampleCount: number;
  /** Samples dropped as invalid (fail-closed accounting, never silently). */
  invalidCount: number;
  /** Samples attributed to other SLIs and ignored. */
  foreignCount: number;
  evidence: readonly SloEvaluationEvidence[];
  reason: string;
}

function isValidSampleValue(def: SliDefinition, value: number): boolean {
  if (!Number.isFinite(value)) return false;
  if (def.kind === "latency") return value >= 0;
  return value >= 0 && value <= 1;
}

/** Nearest-rank p95 of a non-empty sorted-ascending input. */
export function percentile95(values: readonly number[]): number {
  if (values.length === 0) throw new TypeError("percentile95 requires at least one value");
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil(0.95 * sorted.length);
  return sorted[Math.min(Math.max(rank, 1), sorted.length) - 1];
}

/**
 * Evaluate one SLO over a window of samples. Pure: same inputs → same
 * result. Samples for other SLIs and invalid samples are excluded with
 * explicit counts. Below `minSamples` valid samples the status is
 * `insufficient_data` — never "met" (fail-closed reporting).
 */
export function evaluateSlo(sli: SliId, samples: readonly SliSample[]): SloEvaluation {
  const def = sliDefinition(sli);
  const slo = sloDefinition(sli);

  let foreignCount = 0;
  let invalidCount = 0;
  const valid: { value: number; evidence: SloEvaluationEvidence }[] = [];
  const evidence: SloEvaluationEvidence[] = [];

  for (const sample of samples) {
    if (sample.sli !== sli) {
      foreignCount += 1;
      evidence.push({ at: sample.at, value: sample.value, ref: sample.ref, invalid: false });
      continue;
    }
    const invalid = !isValidSampleValue(def, sample.value);
    if (invalid) invalidCount += 1;
    evidence.push({ at: sample.at, value: sample.value, ref: sample.ref, invalid });
    if (!invalid) valid.push({ value: sample.value, evidence: evidence[evidence.length - 1] });
  }

  const base = {
    sli,
    objective: slo.objective,
    threshold: slo.threshold,
    aggregation: def.aggregation,
    direction: def.direction,
    sampleCount: valid.length,
    invalidCount,
    foreignCount,
    evidence,
  };

  if (valid.length < def.minSamples) {
    return {
      ...base,
      status: "insufficient_data",
      observed: null,
      reason: `only ${valid.length} valid sample(s); the objective requires ${def.minSamples} — reporting insufficient_data rather than claiming met`,
    };
  }

  const observed =
    def.aggregation === "p95"
      ? percentile95(valid.map((entry) => entry.value))
      : valid.reduce((sum, entry) => sum + entry.value, 0) / valid.length;

  const met =
    def.direction === "lower_is_better" ? observed <= slo.threshold : observed >= slo.threshold;

  return {
    ...base,
    status: met ? "met" : "violated",
    observed,
    reason: met
      ? `observed ${def.aggregation} ${observed} ${def.unit} ${met ? "<=" : ">="} threshold ${slo.threshold} ${def.unit}`
      : `observed ${def.aggregation} ${observed} ${def.unit} breached the ${slo.threshold} ${def.unit} threshold`,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Error budget (simple burn calculation)
 * ────────────────────────────────────────────────────────────*/

export interface ErrorBudgetResult {
  sli: SliId;
  /** Total samples counted (valid + invalid are both counted as exposure). */
  total: number;
  /** Samples that individually breached the sample bound. */
  bad: number;
  /** Allowed bad samples = floor(total * budgetFraction). */
  allowed: number;
  remaining: number;
  /** bad / allowed; null when allowed is 0 (zero-tolerance budgets). */
  burnRate: number | null;
  exhausted: boolean;
  exhaustedReason: string | null;
}

/**
 * The per-sample bound: an individual sample is "bad" when it breaches the
 * SLI's sample-level requirement (latency above threshold; outcome 0 for
 * success/authorization rates; any collision for the collision rate).
 */
export function isBadSample(sli: SliId, value: number): boolean {
  const def = sliDefinition(sli);
  const slo = sloDefinition(sli);
  if (!isValidSampleValue(def, value)) return true;
  if (def.kind === "latency") return value > slo.threshold;
  if (def.direction === "higher_is_better") return value < 1;
  return value > 0;
}

/**
 * Simple error-budget burn over a window of samples: `allowed = floor(total *
 * budgetFraction)` bad samples; the budget is exhausted when `bad > allowed`.
 * Invalid samples count as bad (fail-closed: bad data burns budget, it never
 * counts as good). Exhaustion triggers review — never silent degradation.
 */
export function computeErrorBudget(sli: SliId, samples: readonly SliSample[]): ErrorBudgetResult {
  const slo = sloDefinition(sli);
  const mine = samples.filter((sample) => sample.sli === sli);
  const total = mine.length;
  const bad = mine.filter((sample) => isBadSample(sli, sample.value)).length;
  const allowed = Math.floor(total * slo.errorBudgetFraction);
  const remaining = Math.max(0, allowed - bad);
  const exhausted = bad > allowed;
  return {
    sli,
    total,
    bad,
    allowed,
    remaining,
    burnRate: allowed === 0 ? null : bad / allowed,
    exhausted,
    exhaustedReason: exhausted
      ? slo.errorBudgetFraction === 0
        ? `zero-tolerance budget: ${bad} bad sample(s) with an allowed budget of 0 — review required, not silent degradation`
        : `${bad} bad sample(s) exceed the allowed ${allowed} (budget fraction ${slo.errorBudgetFraction}) — review required, not silent degradation`
      : null,
  };
}
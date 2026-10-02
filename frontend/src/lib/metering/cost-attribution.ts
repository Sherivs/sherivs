/**
 * CoreGrid — cost attribution: usage-ledger roll-up to mission & tenant
 * (J-043 / V1CAP-078, MISSION-R-70; E-051 workforce economics, AGENTS §20
 * gateway cost tracking).
 *
 * PURE module: no I/O, no provider imports, no environment reads. This is the
 * roll-up arithmetic OVER the Part 49 usage ledger
 * (`metering/usage-ledger.ts`): it attributes every usage record to
 * (tenant, mission, actor, model, purpose) dimensions and produces the
 * per-dimension cost roll-ups that quotas (J-031), billing (phase 13) and
 * per-tenant rate limits consume.
 *
 * Design laws honored here:
 * - J-043 / V1CAP-078: a usage record missing mission or tenant attribution
 *   is a DATA DEFECT. It is surfaced in an explicit unattributed bucket and
 *   fails the roll-up's integrity check — never silently absorbed, never
 *   guessed. Quota evaluation refuses (fail closed) on a roll-up that is not
 *   integral, so enforcement never runs on a defective ledger.
 * - Conservation: attribution is a PARTITION — every in-scope record lands in
 *   exactly one bucket per dimension, so every dimension's bucket sums
 *   reconcile to the grand total. No record is double-counted within a
 *   roll-up, and the half-open period [from, to) means adjacent periods can
 *   never both count the same record.
 * - Bi-temporality: `at` is VALID time (when the invocation happened);
 *   `recordedAt` (optional record extension) is TRANSACTION time (when the
 *   row entered the ledger). A declared period may bound either or both; a
 *   record missing a required temporal coordinate is a defect, never guessed.
 * - Part 9 (canonical truth): token counts are observed reality;
 *   `estimatedCostUsd` stays nullable in the source. Null-cost usage is still
 *   counted and surfaced as `unpricedRequests` — it is never silently
 *   converted to free.
 * - Quota semantics mirror the ledger's own `evaluateBudget` (pre-check,
 *   boundary-inclusive denial): consumption that has REACHED a declared cap
 *   is already `quota_exceeded` for enforcement purposes; billing reads the
 *   usage totals as evidence either way.
 */

import {
  aggregateTotals,
  GATEWAY_PURPOSES,
  UNASSIGNED_REF_KEY,
  type GatewayPurpose,
  type UsageRecord,
  type UsageTotals,
} from "./usage-ledger";

/** A usage record extended with its optional transaction time (bi-temporal). */
export type AttributableUsageRecord = UsageRecord & { readonly recordedAt?: string };

/**
 * The declared attribution window. Valid-time bounds apply to `record.at`;
 * optional transaction-time bounds apply to `record.recordedAt`. The window
 * is half-open — `from` inclusive, `to` exclusive — so adjacent periods
 * partition the timeline and can never double-count a record.
 */
export interface AttributionPeriod {
  /** Inclusive valid-time start (ISO-8601). */
  from: string;
  /** Exclusive valid-time end (ISO-8601). */
  to: string;
  /** Optional inclusive transaction-time start (ISO-8601, bi-temporal). */
  recordedFrom?: string;
  /** Optional exclusive transaction-time end (ISO-8601, bi-temporal). */
  recordedTo?: string;
}

export type AttributionDefectReason =
  | "missing_tenant"
  | "missing_mission"
  | "missing_actor"
  | "missing_model"
  | "invalid_purpose"
  | "unparseable_valid_time"
  | "missing_transaction_time"
  | "unparseable_transaction_time";

/**
 * One record that could not be cleanly attributed. The record is either
 * bucketed under the explicit unassigned key (attribution defect) or excluded
 * from period placement (temporal defect) — in both cases it is surfaced
 * here, never absorbed.
 */
export interface AttributionDefect {
  reason: AttributionDefectReason;
  /** Zero-based index of the record in the input sequence. */
  index: number;
  /** The record's declared valid-time string (verbatim, may be malformed). */
  at: string;
  detail: string;
}

/** Bucket totals extended with the unpriced-usage surfacing required by Part 9. */
export interface AttributionTotals extends UsageTotals {
  /** Requests whose `estimatedCostUsd` was null (counted; never billed as free). */
  unpricedRequests: number;
}

export interface RollupIntegrity {
  /**
   * True iff every in-scope record attributed cleanly to every dimension and
   * every dimension reconciles to the grand total (conservation holds).
   */
  ok: boolean;
  /** The conservation property: dimension bucket sums reconcile to grand total. */
  conserves: boolean;
  /** All attribution/temporal defects, in input order. */
  defects: readonly AttributionDefect[];
  /** Human-readable problems (defects + conservation violations). */
  problems: readonly string[];
}

export interface CostRollUp {
  /** The declared period; null when the roll-up covered all records. */
  period: AttributionPeriod | null;
  /** Totals over every record placed in the period (the conservation target). */
  grandTotal: AttributionTotals;
  /** Cost by tenant. Records without tenant attribution sit under UNASSIGNED_REF_KEY. */
  byTenant: Record<string, AttributionTotals>;
  /** Cost by mission. Records without mission attribution sit under UNASSIGNED_REF_KEY. */
  byMission: Record<string, AttributionTotals>;
  /** Cost by actor. Records without actor attribution sit under UNASSIGNED_REF_KEY. */
  byActor: Record<string, AttributionTotals>;
  /** Cost by model. Records without model attribution sit under UNASSIGNED_REF_KEY. */
  byModel: Record<string, AttributionTotals>;
  /** Cost by gateway purpose (the organizational-intelligence vocabulary). */
  byPurpose: Record<string, AttributionTotals>;
  /**
   * Tenant x mission matrix (key `${tenantRef}::${missionRef}`): every record
   * attributes to exactly one (tenant, mission) pair — MISSION-R-70 T1.
   */
  byTenantMission: Record<string, AttributionTotals>;
  integrity: RollupIntegrity;
}

/* ─────────────────────────────────────────────────────────────
 * Totals arithmetic (pure; reuses the ledger's own aggregation)
 * ────────────────────────────────────────────────────────────*/

const COST_PRECISION = 1e6;

function roundCost(value: number): number {
  return Math.round(value * COST_PRECISION) / COST_PRECISION;
}

/** Zero totals for a dimension bucket with no usage (e.g. an unknown tenant). */
export function emptyAttributionTotals(): AttributionTotals {
  return {
    requests: 0,
    tokensIn: 0,
    tokensOut: 0,
    durationMs: 0,
    estimatedCostUsd: 0,
    unpricedRequests: 0,
  };
}

function attributeTotals(records: readonly UsageRecord[]): AttributionTotals {
  const totals = aggregateTotals(records);
  let unpriced = 0;
  for (const record of records) {
    if (record.estimatedCostUsd === null) unpriced += 1;
  }
  return { ...totals, unpricedRequests: unpriced };
}

function isNonBlank(value: string | null | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function reconcile(a: number, b: number): boolean {
  const scale = Math.max(1, Math.abs(a), Math.abs(b));
  return Math.abs(a - b) <= 1e-6 * scale;
}

/* ─────────────────────────────────────────────────────────────
 * Partition helpers (attribution is a partition, never a guess)
 * ────────────────────────────────────────────────────────────*/

type AttributionDimension = "tenant" | "mission" | "actor" | "model" | "purpose";

function dimensionKey(
  record: AttributableUsageRecord,
  dimension: AttributionDimension,
): { key: string; defect: AttributionDefectReason | null } {
  switch (dimension) {
    case "tenant":
      return isNonBlank(record.tenantRef)
        ? { key: record.tenantRef.trim(), defect: null }
        : { key: UNASSIGNED_REF_KEY, defect: "missing_tenant" };
    case "mission":
      return isNonBlank(record.missionRef)
        ? { key: record.missionRef.trim(), defect: null }
        : { key: UNASSIGNED_REF_KEY, defect: "missing_mission" };
    case "actor":
      return isNonBlank(record.actorRef)
        ? { key: record.actorRef.trim(), defect: null }
        : { key: UNASSIGNED_REF_KEY, defect: "missing_actor" };
    case "model":
      return isNonBlank(record.model)
        ? { key: record.model.trim(), defect: null }
        : { key: UNASSIGNED_REF_KEY, defect: "missing_model" };
    case "purpose":
      return GATEWAY_PURPOSES.includes(record.purpose as GatewayPurpose)
        ? { key: record.purpose, defect: null }
        : { key: UNASSIGNED_REF_KEY, defect: "invalid_purpose" };
  }
}

const DEFECT_DETAIL: Readonly<Record<AttributionDefectReason, string>> = {
  missing_tenant: "record has no tenant attribution (tenantRef is null or blank)",
  missing_mission: "record has no mission attribution (missionRef is null or blank)",
  missing_actor: "record has no actor attribution (actorRef is null or blank)",
  missing_model: "record has no model attribution (model is null or blank)",
  invalid_purpose: "record's purpose is outside the organizational-intelligence vocabulary",
  unparseable_valid_time: "record's valid time (at) is not a parseable timestamp",
  missing_transaction_time:
    "record carries no transaction time (recordedAt) while the period declares transaction-time bounds",
  unparseable_transaction_time: "record's transaction time (recordedAt) is not a parseable timestamp",
};

function makeDefect(reason: AttributionDefectReason, index: number, at: string): AttributionDefect {
  return { reason, index, at, detail: `record #${index}: ${DEFECT_DETAIL[reason]}` };
}

interface PartitionResult {
  buckets: Record<string, AttributionTotals>;
  defects: AttributionDefect[];
}

/**
 * Partition placed records into buckets for one dimension. A record with a
 * missing dimension value still lands (under UNASSIGNED_REF_KEY) so the
 * partition always covers every placed record exactly once — the defect is
 * recorded, the record is never dropped and never duplicated.
 */
function partitionDimension(
  placed: readonly { record: AttributableUsageRecord; index: number }[],
  dimension: AttributionDimension,
): PartitionResult {
  const groups = new Map<string, AttributableUsageRecord[]>();
  const defects: AttributionDefect[] = [];
  for (const { record, index } of placed) {
    const { key, defect } = dimensionKey(record, dimension);
    if (defect !== null) defects.push(makeDefect(defect, index, record.at));
    const bucket = groups.get(key) ?? [];
    bucket.push(record);
    groups.set(key, bucket);
  }
  const buckets: Record<string, AttributionTotals> = {};
  for (const [key, bucket] of groups) {
    buckets[key] = attributeTotals(bucket);
  }
  return { buckets, defects };
}

/* ─────────────────────────────────────────────────────────────
 * Bi-temporal period placement
 * ────────────────────────────────────────────────────────────*/

function requireTimestamp(name: string, value: string): number {
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    throw new TypeError(`AttributionPeriod.${name} must be a parseable ISO-8601 timestamp`);
  }
  return parsed;
}

function validatePeriod(period: AttributionPeriod): {
  fromMs: number;
  toMs: number;
  recordedFromMs: number | null;
  recordedToMs: number | null;
} {
  const fromMs = requireTimestamp("from", period.from);
  const toMs = requireTimestamp("to", period.to);
  if (fromMs > toMs) {
    throw new TypeError("AttributionPeriod.from must not be after AttributionPeriod.to");
  }
  const recordedFromMs =
    period.recordedFrom === undefined ? null : requireTimestamp("recordedFrom", period.recordedFrom);
  const recordedToMs =
    period.recordedTo === undefined ? null : requireTimestamp("recordedTo", period.recordedTo);
  return { fromMs, toMs, recordedFromMs, recordedToMs };
}

type TemporalPlacement =
  | { kind: "in" }
  | { kind: "out" }
  | { kind: "defect"; reason: AttributionDefectReason };

/**
 * Bi-temporal placement: valid time (`at`) must fall inside [from, to);
 * when transaction-time bounds are declared, transaction time (`recordedAt`)
 * must fall inside [recordedFrom, recordedTo) too. A record missing the
 * required transaction coordinate is a defect — it is never assumed fresh
 * and never assumed stale.
 */
function placeInPeriod(
  record: AttributableUsageRecord,
  bounds: {
    fromMs: number;
    toMs: number;
    recordedFromMs: number | null;
    recordedToMs: number | null;
  },
): TemporalPlacement {
  const validMs = Date.parse(record.at);
  if (!Number.isFinite(validMs)) return { kind: "defect", reason: "unparseable_valid_time" };
  if (validMs < bounds.fromMs || validMs >= bounds.toMs) return { kind: "out" };
  if (bounds.recordedFromMs !== null || bounds.recordedToMs !== null) {
    if (record.recordedAt === undefined) {
      return { kind: "defect", reason: "missing_transaction_time" };
    }
    const recordedMs = Date.parse(record.recordedAt);
    if (!Number.isFinite(recordedMs)) {
      return { kind: "defect", reason: "unparseable_transaction_time" };
    }
    if (
      (bounds.recordedFromMs !== null && recordedMs < bounds.recordedFromMs) ||
      (bounds.recordedToMs !== null && recordedMs >= bounds.recordedToMs)
    ) {
      return { kind: "out" };
    }
  }
  return { kind: "in" };
}

/* ─────────────────────────────────────────────────────────────
 * The roll-up
 * ────────────────────────────────────────────────────────────*/

/**
 * Roll usage records up to (tenant, mission, actor, model, purpose) cost
 * dimensions over an optional declared period. Every in-scope record is
 * attributed to exactly one bucket per dimension (partition); records with
 * missing attribution are bucketed under UNASSIGNED_REF_KEY, listed as
 * defects and fail `integrity.ok` — they are never silently absorbed and
 * attribution is never guessed.
 */
export function rollUpCosts(
  records: readonly AttributableUsageRecord[],
  period?: AttributionPeriod,
): CostRollUp {
  const bounds = period === undefined ? null : validatePeriod(period);

  const placed: { record: AttributableUsageRecord; index: number }[] = [];
  const temporalDefects: AttributionDefect[] = [];
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (bounds === null) {
      placed.push({ record, index });
      continue;
    }
    const placement = placeInPeriod(record, bounds);
    if (placement.kind === "in") {
      placed.push({ record, index });
    } else if (placement.kind === "defect") {
      temporalDefects.push(makeDefect(placement.reason, index, record.at));
    }
  }

  const tenant = partitionDimension(placed, "tenant");
  const mission = partitionDimension(placed, "mission");
  const actor = partitionDimension(placed, "actor");
  const model = partitionDimension(placed, "model");
  const purpose = partitionDimension(placed, "purpose");

  const tenantMission: Record<string, AttributionTotals> = {};
  const tenantMissionGroups = new Map<string, AttributableUsageRecord[]>();
  for (const { record } of placed) {
    const tenantKey = dimensionKey(record, "tenant").key;
    const missionKey = dimensionKey(record, "mission").key;
    const composite = `${tenantKey}::${missionKey}`;
    const bucket = tenantMissionGroups.get(composite) ?? [];
    bucket.push(record);
    tenantMissionGroups.set(composite, bucket);
  }
  for (const [composite, bucket] of tenantMissionGroups) {
    tenantMission[composite] = attributeTotals(bucket);
  }

  const grandTotal = attributeTotals(placed.map(({ record }) => record));

  const conservationProblems = checkConservation(grandTotal, [
    ["tenant", tenant.buckets],
    ["mission", mission.buckets],
    ["actor", actor.buckets],
    ["model", model.buckets],
    ["purpose", purpose.buckets],
    ["tenantMission", tenantMission],
  ]);

  const defects = [...temporalDefects, ...tenant.defects, ...mission.defects, ...actor.defects, ...model.defects, ...purpose.defects];
  const problems = [
    ...defects.map((defect) => `${defect.reason}: ${defect.detail}`),
    ...conservationProblems,
  ];

  return {
    period: period ?? null,
    grandTotal,
    byTenant: tenant.buckets,
    byMission: mission.buckets,
    byActor: actor.buckets,
    byModel: model.buckets,
    byPurpose: purpose.buckets,
    byTenantMission: tenantMission,
    integrity: {
      ok: defects.length === 0 && conservationProblems.length === 0,
      conserves: conservationProblems.length === 0,
      defects,
      problems,
    },
  };
}

const CONSERVED_FIELDS: readonly { field: keyof AttributionTotals; label: string }[] = [
  { field: "requests", label: "requests" },
  { field: "tokensIn", label: "input tokens" },
  { field: "tokensOut", label: "output tokens" },
  { field: "durationMs", label: "duration" },
  { field: "estimatedCostUsd", label: "estimated cost" },
  { field: "unpricedRequests", label: "unpriced requests" },
];

function checkConservation(
  grandTotal: AttributionTotals,
  dimensions: readonly [string, Record<string, AttributionTotals>][],
): string[] {
  const problems: string[] = [];
  for (const [label, buckets] of dimensions) {
    const sum = emptyAttributionTotals();
    for (const totals of Object.values(buckets)) {
      sum.requests += totals.requests;
      sum.tokensIn += totals.tokensIn;
      sum.tokensOut += totals.tokensOut;
      sum.durationMs += totals.durationMs;
      sum.estimatedCostUsd += totals.estimatedCostUsd;
      sum.unpricedRequests += totals.unpricedRequests;
    }
    sum.estimatedCostUsd = roundCost(sum.estimatedCostUsd);
    for (const { field, label: fieldLabel } of CONSERVED_FIELDS) {
      if (!reconcile(sum[field], grandTotal[field])) {
        problems.push(
          `conservation violated on ${label}.${fieldLabel}: buckets sum to ${String(sum[field])} but grand total is ${String(grandTotal[field])}`,
        );
      }
    }
  }
  return problems;
}

/* ─────────────────────────────────────────────────────────────
 * Quota evaluation (consumed by quotas, billing, per-tenant rate limits)
 * ────────────────────────────────────────────────────────────*/

export interface TenantQuota {
  /** The tenant whose usage the quota caps. */
  tenantRef: string;
  maxRequests?: number;
  maxTokensIn?: number;
  maxTokensOut?: number;
  maxCostUsd?: number;
}

export type QuotaExceededCode = "request_quota" | "token_in_quota" | "token_out_quota" | "cost_quota";

export type QuotaRefusalCode = "non_integral_rollup" | "misconfigured_quota";

export type QuotaEvaluation =
  | {
      decision: "within";
      quota: TenantQuota;
      usage: AttributionTotals;
      /** Remaining headroom per declared limit (null = no limit declared). */
      remaining: { requests: number | null; tokensIn: number | null; tokensOut: number | null; costUsd: number | null };
      integrity: RollupIntegrity;
    }
  | {
      decision: "quota_exceeded";
      code: QuotaExceededCode;
      reason: string;
      limit: number;
      usage: AttributionTotals;
      integrity: RollupIntegrity;
    }
  | {
      decision: "refused";
      code: QuotaRefusalCode;
      reason: string;
      integrity: RollupIntegrity;
    };

interface QuotaCheck {
  limit: number | undefined;
  used: number;
  code: QuotaExceededCode;
  label: string;
}

const ZERO_USAGE = emptyAttributionTotals();

/**
 * Evaluate a declared tenant quota against a tenant cost roll-up. The
 * boundary is inclusive (mirroring the ledger's `evaluateBudget` pre-check):
 * consumption that has REACHED a cap is already `quota_exceeded` for
 * enforcement. A non-integral roll-up (unattributed records or a conservation
 * violation) is refused fail-closed — enforcement never runs on a defective
 * ledger, and a misconfigured quota is refused rather than bypassed.
 */
export function evaluateTenantQuota(rollUp: CostRollUp, quota: TenantQuota): QuotaEvaluation {
  if (!isNonBlank(quota.tenantRef)) {
    return {
      decision: "refused",
      code: "misconfigured_quota",
      reason: "Quota refused: tenantRef is required (fail closed)",
      integrity: rollUp.integrity,
    };
  }
  const checks: readonly QuotaCheck[] = [
    { limit: quota.maxRequests, used: 0, code: "request_quota", label: "request" },
    { limit: quota.maxTokensIn, used: 0, code: "token_in_quota", label: "input-token" },
    { limit: quota.maxTokensOut, used: 0, code: "token_out_quota", label: "output-token" },
    { limit: quota.maxCostUsd, used: 0, code: "cost_quota", label: "cost" },
  ];
  for (const check of checks) {
    if (check.limit === undefined) continue;
    if (!Number.isFinite(check.limit) || check.limit < 0) {
      return {
        decision: "refused",
        code: "misconfigured_quota",
        reason: `Quota refused: ${check.code} limit must be a finite non-negative number (fail closed)`,
        integrity: rollUp.integrity,
      };
    }
  }
  if (!rollUp.integrity.ok) {
    return {
      decision: "refused",
      code: "non_integral_rollup",
      reason:
        "Quota refused: the roll-up is not integral (unattributed records or conservation violation) — repair attribution before enforcing (fail closed)",
      integrity: rollUp.integrity,
    };
  }

  const usage = rollUp.byTenant[quota.tenantRef.trim()] ?? ZERO_USAGE;
  const evaluated: readonly { check: QuotaCheck; used: number }[] = [
    { check: checks[0], used: usage.requests },
    { check: checks[1], used: usage.tokensIn },
    { check: checks[2], used: usage.tokensOut },
    { check: checks[3], used: usage.estimatedCostUsd },
  ];
  for (const { check, used } of evaluated) {
    if (check.limit === undefined) continue;
    if (used >= check.limit) {
      return {
        decision: "quota_exceeded",
        code: check.code,
        reason: `${check.label} quota exceeded: ${String(used)} of ${String(check.limit)} used this period (boundary-inclusive)`,
        limit: check.limit,
        usage,
        integrity: rollUp.integrity,
      };
    }
  }
  return {
    decision: "within",
    quota,
    usage,
    remaining: {
      requests: quota.maxRequests === undefined ? null : quota.maxRequests - usage.requests,
      tokensIn: quota.maxTokensIn === undefined ? null : quota.maxTokensIn - usage.tokensIn,
      tokensOut: quota.maxTokensOut === undefined ? null : quota.maxTokensOut - usage.tokensOut,
      costUsd: quota.maxCostUsd === undefined ? null : roundCost(quota.maxCostUsd - usage.estimatedCostUsd),
    },
    integrity: rollUp.integrity,
  };
}

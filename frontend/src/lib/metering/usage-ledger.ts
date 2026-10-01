/**
 * CoreGrid — AI usage metering ledger (V5.3 MISSION-V1-010, Part 49
 * attribution-minimal).
 *
 * PURE module: no I/O, no provider imports, no environment reads. Every
 * metered AI operation must carry full attribution (tenant, actor, agent,
 * mission, model, provider, purpose, tokens, duration, estimated cost) so the
 * "WHO / WHAT / WHERE / WHY / UNDER WHICH POLICY" questions are answerable
 * from the ledger alone.
 *
 * Design laws honored here:
 * - Part 49: attribution completeness is validated fail-closed — an
 *   unattributable record is rejected, never silently stored.
 * - Part 25/20: cost estimation is config-driven (the model rate table is
 *   passed in by the caller); this module is provider-agnostic.
 * - Part 9 (canonical truth): token counts and durations are observed
 *   reality; `estimatedCostUsd` is derived intelligence and stays nullable —
 *   an unknown model rate yields `null`, never a guessed number.
 * - V5.3 scope: purposes are limited to organizational intelligence only
 *   (summarization/classification/drafting/extraction/support/workflow
 *   assistance). Anything outside that vocabulary is rejected.
 */

/** Grouping key for aggregation when an optional ref is null. */
export const UNASSIGNED_REF_KEY = "(unassigned)";

/**
 * Allowed AI purposes under V5.3: organizational intelligence only.
 * Geophysics/geology/biological/chemical/planetary/simulation work is out of
 * scope by constitution and has no purpose vocabulary here.
 */
export type GatewayPurpose =
  | "summarization"
  | "classification"
  | "drafting"
  | "extraction"
  | "support"
  | "workflow_assistance";

export const GATEWAY_PURPOSES: readonly GatewayPurpose[] = [
  "summarization",
  "classification",
  "drafting",
  "extraction",
  "support",
  "workflow_assistance",
];

export interface UsageRecord {
  tenantRef: string;
  actorRef: string;
  agentRef: string | null;
  missionRef: string | null;
  model: string;
  provider: string;
  purpose: GatewayPurpose;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
  /** Derived intelligence; null when the model has no rate entry. */
  estimatedCostUsd: number | null;
  /** ISO-8601 timestamp of the invocation end. */
  at: string;
}

/** Per-model rate entry; prices are USD per 1,000,000 tokens. */
export interface ModelRate {
  provider: string;
  inputUsdPerMillionTokens: number;
  outputUsdPerMillionTokens: number;
}

/** Caller-supplied rate table — the ledger never hard-codes one provider. */
export type ModelRateTable = Readonly<Record<string, ModelRate>>;

export interface UsageCostInput {
  model: string;
  tokensIn: number;
  tokensOut: number;
}

const COST_PRECISION = 1e6;

function roundCost(value: number): number {
  return Math.round(value * COST_PRECISION) / COST_PRECISION;
}

/**
 * Estimate invocation cost from a caller-supplied rate table. Unknown models
 * return null (never a fabricated price); malformed rate entries also return
 * null so a broken config cannot produce trusted-looking numbers.
 */
export function estimateCostUsd(
  input: UsageCostInput,
  rates: ModelRateTable,
): number | null {
  const rate = rates[input.model];
  if (!rate) return null;
  const inputRate = rate.inputUsdPerMillionTokens;
  const outputRate = rate.outputUsdPerMillionTokens;
  if (
    !Number.isFinite(inputRate) ||
    !Number.isFinite(outputRate) ||
    inputRate < 0 ||
    outputRate < 0
  ) {
    return null;
  }
  const cost =
    (input.tokensIn / 1_000_000) * inputRate +
    (input.tokensOut / 1_000_000) * outputRate;
  if (!Number.isFinite(cost) || cost < 0) return null;
  return roundCost(cost);
}

function isNonEmptyTrimmed(value: string): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Attribution-completeness validation (fail closed). Returns the list of
 * problems; an empty list means the record is attributable and well-formed.
 */
export function validateUsageRecord(record: UsageRecord): string[] {
  const problems: string[] = [];
  if (!isNonEmptyTrimmed(record.tenantRef)) problems.push("tenantRef is required");
  if (!isNonEmptyTrimmed(record.actorRef)) problems.push("actorRef is required");
  if (record.agentRef !== null && !isNonEmptyTrimmed(record.agentRef)) {
    problems.push("agentRef must be null or a non-empty string");
  }
  if (record.missionRef !== null && !isNonEmptyTrimmed(record.missionRef)) {
    problems.push("missionRef must be null or a non-empty string");
  }
  if (!isNonEmptyTrimmed(record.model)) problems.push("model is required");
  if (!isNonEmptyTrimmed(record.provider)) problems.push("provider is required");
  if (!GATEWAY_PURPOSES.includes(record.purpose)) {
    problems.push(
      `purpose "${String(record.purpose)}" is not an organizational-intelligence purpose`,
    );
  }
  if (!Number.isFinite(record.tokensIn) || record.tokensIn < 0) {
    problems.push("tokensIn must be a finite non-negative number");
  }
  if (!Number.isFinite(record.tokensOut) || record.tokensOut < 0) {
    problems.push("tokensOut must be a finite non-negative number");
  }
  if (!Number.isFinite(record.durationMs) || record.durationMs < 0) {
    problems.push("durationMs must be a finite non-negative number");
  }
  if (
    record.estimatedCostUsd !== null &&
    (!Number.isFinite(record.estimatedCostUsd) || record.estimatedCostUsd < 0)
  ) {
    problems.push("estimatedCostUsd must be null or a finite non-negative number");
  }
  if (typeof record.at !== "string" || Number.isNaN(Date.parse(record.at))) {
    problems.push("at must be an ISO-8601 timestamp string");
  }
  return problems;
}

export interface UsageTotals {
  requests: number;
  tokensIn: number;
  tokensOut: number;
  durationMs: number;
  estimatedCostUsd: number;
}

/** Sum a set of usage records into flat totals (null costs contribute 0). */
export function aggregateTotals(records: readonly UsageRecord[]): UsageTotals {
  const totals: UsageTotals = {
    requests: 0,
    tokensIn: 0,
    tokensOut: 0,
    durationMs: 0,
    estimatedCostUsd: 0,
  };
  for (const record of records) {
    totals.requests += 1;
    totals.tokensIn += record.tokensIn;
    totals.tokensOut += record.tokensOut;
    totals.durationMs += record.durationMs;
    if (record.estimatedCostUsd !== null) {
      totals.estimatedCostUsd += record.estimatedCostUsd;
    }
  }
  totals.estimatedCostUsd = roundCost(totals.estimatedCostUsd);
  return totals;
}

export type UsageDimension = "tenant" | "agent" | "mission";

/**
 * Group records by one attribution dimension. Null agent/mission refs group
 * under UNASSIGNED_REF_KEY so every record remains countable somewhere.
 */
export function aggregateBy(
  records: readonly UsageRecord[],
  dimension: UsageDimension,
): Record<string, UsageTotals> {
  const buckets = new Map<string, UsageRecord[]>();
  for (const record of records) {
    const key =
      dimension === "tenant"
        ? record.tenantRef
        : dimension === "agent"
          ? (record.agentRef ?? UNASSIGNED_REF_KEY)
          : (record.missionRef ?? UNASSIGNED_REF_KEY);
    const bucket = buckets.get(key) ?? [];
    bucket.push(record);
    buckets.set(key, bucket);
  }
  const grouped: Record<string, UsageTotals> = {};
  for (const [key, bucket] of buckets) {
    grouped[key] = aggregateTotals(bucket);
  }
  return grouped;
}

export const aggregateByTenant = (
  records: readonly UsageRecord[],
): Record<string, UsageTotals> => aggregateBy(records, "tenant");

export const aggregateByAgent = (
  records: readonly UsageRecord[],
): Record<string, UsageTotals> => aggregateBy(records, "agent");

export const aggregateByMission = (
  records: readonly UsageRecord[],
): Record<string, UsageTotals> => aggregateBy(records, "mission");

export interface BudgetConfig {
  /** Maximum invocations allowed per budget period. */
  maxRequests?: number;
  maxTokensIn?: number;
  maxTokensOut?: number;
  maxCostUsd?: number;
}

export type BudgetDenyCode =
  | "request_limit"
  | "token_in_limit"
  | "token_out_limit"
  | "cost_limit";

export type BudgetDecision =
  | { decision: "allow"; totals: UsageTotals }
  | { decision: "deny"; code: BudgetDenyCode; reason: string; totals: UsageTotals };

/**
 * Evaluate consumed totals against configured limits. This runs BEFORE an
 * invocation, so a limit is denied when consumption has already reached it.
 * Missing limits do not constrain; malformed limits (non-finite, negative)
 * fail closed and deny.
 */
export function evaluateBudget(
  budget: BudgetConfig,
  totals: UsageTotals,
): BudgetDecision {
  const checks: ReadonlyArray<{
    limit: number | undefined;
    used: number;
    code: BudgetDenyCode;
    describe: (limit: number, used: number) => string;
  }> = [
    {
      limit: budget.maxRequests,
      used: totals.requests,
      code: "request_limit",
      describe: (limit, used) =>
        `Request budget exhausted: ${used} of ${limit} requests already used this period`,
    },
    {
      limit: budget.maxTokensIn,
      used: totals.tokensIn,
      code: "token_in_limit",
      describe: (limit, used) =>
        `Input token budget exhausted: ${used} of ${limit} tokens already used this period`,
    },
    {
      limit: budget.maxTokensOut,
      used: totals.tokensOut,
      code: "token_out_limit",
      describe: (limit, used) =>
        `Output token budget exhausted: ${used} of ${limit} tokens already used this period`,
    },
    {
      limit: budget.maxCostUsd,
      used: totals.estimatedCostUsd,
      code: "cost_limit",
      describe: (limit, used) =>
        `Cost budget exhausted: estimated $${used} of $${limit} already used this period`,
    },
  ];

  for (const check of checks) {
    if (check.limit === undefined) continue;
    if (!Number.isFinite(check.limit) || check.limit < 0) {
      return {
        decision: "deny",
        code: check.code,
        reason: `Budget misconfigured: ${check.code} limit must be a finite non-negative number (fail closed)`,
        totals,
      };
    }
    if (check.used >= check.limit) {
      return {
        decision: "deny",
        code: check.code,
        reason: check.describe(check.limit, check.used),
        totals,
      };
    }
  }
  return { decision: "allow", totals };
}

export type UsageRecordInput = Omit<UsageRecord, "estimatedCostUsd" | "at"> & {
  /** Defaults to the current time when omitted. */
  at?: string;
  /** Defaults to a rate-table estimate when omitted; explicit null respected. */
  estimatedCostUsd?: number | null;
};

/**
 * In-process metering ledger. Still pure (no I/O, no environment reads) —
 * persistence is a later-phase concern. Ingestion is fail-closed: records
 * without complete attribution are rejected with an error, never stored.
 */
export class UsageLedger {
  private readonly records: UsageRecord[];

  constructor(private readonly rates: ModelRateTable = {}) {
    this.records = [];
  }

  recordUsage(input: UsageRecordInput): UsageRecord {
    const record: UsageRecord = {
      ...input,
      at: input.at ?? new Date().toISOString(),
      estimatedCostUsd:
        input.estimatedCostUsd !== undefined
          ? input.estimatedCostUsd
          : estimateCostUsd(input, this.rates),
    };
    const problems = validateUsageRecord(record);
    if (problems.length > 0) {
      throw new Error(`Usage record rejected: ${problems.join("; ")}`);
    }
    const frozen = Object.freeze({ ...record });
    this.records.push(frozen);
    return frozen;
  }

  tenantTotals(tenantRef: string): UsageTotals {
    return aggregateTotals(this.records.filter((r) => r.tenantRef === tenantRef));
  }

  agentTotals(agentRef: string): UsageTotals {
    return aggregateTotals(this.records.filter((r) => r.agentRef === agentRef));
  }

  missionTotals(missionRef: string): UsageTotals {
    return aggregateTotals(this.records.filter((r) => r.missionRef === missionRef));
  }

  all(): readonly UsageRecord[] {
    return this.records;
  }
}
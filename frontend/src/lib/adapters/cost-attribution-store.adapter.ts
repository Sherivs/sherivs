/**
 * CoreGrid — DB-backed substrate adapter for the cost-attribution contract
 * (J-043 / V1CAP-078 / MISSION-R-70), persisting metering/cost-attribution.ts
 * usage-ledger roll-ups into the tables authored by
 * database/supabase/migrations/20261002000010_coregrid_v1_cost_attribution.sql.
 *
 * Composition, not rewrite: the pure contract stays untouched — this adapter
 * maps CostRollUp results (header + partition buckets) onto substrate rows
 * and is the ONLY place vendor/DB calls appear (Constitution §24/§25).
 * Service-role access only: the tables are zero-policy deny-by-default (RLS
 * enabled, all anon/authenticated privileges revoked), so no policy-bearing
 * client is accepted — the injected client is a minimal service-role surface.
 *
 * Failure semantics (J-045): all I/O runs through AdapterFailurePolicy.run
 * (bounded timeout, retry caps, breaker, degraded mode events, trust ledger);
 * mapping/validation are local operations and run through containSync —
 * malformed contract data or malformed DB rows become structured errors,
 * never thrown. Writes are append-only, idempotent (ON CONFLICT DO NOTHING)
 * and never transport-retried (maxAttempts: 1); reads may retry (idempotent).
 *
 * Tenant law: a roll-up is persisted under the tenant context it was computed
 * and persisted under; the adapter refuses (fail closed) a roll-up whose
 * tenant dimension names a tenant other than the owning one — cross-tenant
 * cost data never lands in another tenant's substrate. Unassigned
 * attribution stays under the ledger's explicit unassigned key with its
 * defect recorded (J-043), never absorbed. Purity: no wall-clock sampling —
 * every audit instant is a supplied parameter. No credentials, no secret
 * values, no sensitive payload logging (Constitution §29).
 */
import { createAdapterFailurePolicy, type AdapterCallResult, type AdapterFailurePolicy, type AdapterMode } from "./failure-policy";
import type {
  AttributionDefect,
  AttributionPeriod,
  AttributionTotals,
  CostRollUp,
} from "../metering/cost-attribution";
import { UNASSIGNED_REF_KEY } from "../metering/usage-ledger";

/* ─────────────────────────────────────────────────────────────
 * Injected service-role client (minimal surface; no credentials here)
 * ────────────────────────────────────────────────────────────*/

export interface CostAttributionDbClient {
  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: readonly Record<string, unknown>[] }>;
}

export const COST_ATTRIBUTION_ROLLUP_TABLE = "cg_usage_attribution_rollup";
export const COST_ATTRIBUTION_BUCKET_TABLE = "cg_usage_attribution_bucket";

export const ATTRIBUTION_DIMENSIONS = [
  "tenant",
  "mission",
  "actor",
  "model",
  "purpose",
  "tenant_mission",
] as const;

export type AttributionDimension = (typeof ATTRIBUTION_DIMENSIONS)[number];

/**
 * Declared failure-semantics policy for the cost-attribution substrate
 * (J-045). Callers may inject their own instance via
 * CostAttributionStoreConfig.
 */
export const COST_ATTRIBUTION_FAILURE_POLICY: AdapterFailurePolicy = createAdapterFailurePolicy({
  provider: "cg-substrate-cost-attribution",
  timeoutMs: 5_000,
  maxAttempts: 2,
  backoffBaseMs: 100,
  backoffCapMs: 1_000,
  degradedAfterFailures: 3,
  degradedWindowMs: 30_000,
  breakerFailureThreshold: 5,
  breakerResetMs: 15_000,
});

/* ─────────────────────────────────────────────────────────────
 * Mapping helpers (strict, fail-closed, no `any`)
 * ────────────────────────────────────────────────────────────*/

export type CostAttributionStoreErrorCode =
  | "invalid_input"
  | "timeout"
  | "provider_error"
  | "breaker_open";

export type CostAttributionStoreResult<T> =
  | { ok: true; value: T; attempts: number; durationMs: number; mode: AdapterMode }
  | {
      ok: false;
      code: CostAttributionStoreErrorCode;
      reason: string;
      attempts: number;
      durationMs: number;
      mode: AdapterMode;
    };

/** Structured failure with full call observability (AdapterCallError parity). */
function fail<T>(
  code: CostAttributionStoreErrorCode,
  reason: string,
  attempts: number,
  durationMs: number,
  mode: AdapterMode,
): CostAttributionStoreResult<T> {
  return { ok: false, code, reason, attempts, durationMs, mode };
}

class MappingError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(row: Record<string, unknown>, key: string, max: number): string {
  const raw = row[key];
  if (typeof raw !== "string") throw new MappingError(`${key} must be a string`);
  const trimmed = raw.trim();
  if (trimmed.length < 1 || trimmed.length > max) {
    throw new MappingError(`${key} must be 1-${max} characters`);
  }
  return trimmed;
}

function timestampString(value: unknown, key: string): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new MappingError(`${key} is an invalid instant`);
    return value.toISOString();
  }
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new MappingError(`${key} must be a parsable instant`);
  }
  return value;
}

function requireTimestamp(row: Record<string, unknown>, key: string): string {
  const value = timestampString(row[key], key);
  if (value == null) throw new MappingError(`${key} is required`);
  return value;
}

function parseJson(value: unknown, key: string): unknown {
  if (typeof value === "string") {
    try {
      return JSON.parse(value) as unknown;
    } catch {
      throw new MappingError(`${key} is not valid JSON`);
    }
  }
  return value;
}

function jsonValue(value: unknown): string {
  return JSON.stringify(value ?? null);
}

const TOTALS_FIELDS = [
  "requests",
  "tokensIn",
  "tokensOut",
  "durationMs",
  "estimatedCostUsd",
  "unpricedRequests",
] as const;

function totalsToValue(totals: AttributionTotals): string {
  for (const field of TOTALS_FIELDS) {
    const value = totals[field];
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      throw new MappingError(`totals.${field} must be a finite non-negative number`);
    }
  }
  return jsonValue(totals);
}

function readNonNegativeField(value: Record<string, unknown>, field: string, key: string): number {
  const raw = value[field];
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) {
    throw new MappingError(`${key}.${field} must be a finite non-negative number`);
  }
  return raw;
}

function rowToTotals(row: Record<string, unknown>, key: string): AttributionTotals {
  const value = parseJson(row[key], key);
  if (!isRecord(value)) throw new MappingError(`${key} must be a JSON object`);
  return {
    requests: readNonNegativeField(value, "requests", key),
    tokensIn: readNonNegativeField(value, "tokensIn", key),
    tokensOut: readNonNegativeField(value, "tokensOut", key),
    durationMs: readNonNegativeField(value, "durationMs", key),
    estimatedCostUsd: readNonNegativeField(value, "estimatedCostUsd", key),
    unpricedRequests: readNonNegativeField(value, "unpricedRequests", key),
  };
}

/* ─────────────────────────────────────────────────────────────
 * Roll-up -> rows (header + partition buckets)
 * ────────────────────────────────────────────────────────────*/

export interface CostAttributionRollupRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly period_from: string | null;
  readonly period_to: string | null;
  readonly recorded_from: string | null;
  readonly recorded_to: string | null;
  readonly grand_total: string;
  readonly integrity_ok: boolean;
  readonly integrity_conserves: boolean;
  readonly integrity_defects: string;
  readonly integrity_problems: string;
  readonly recorded_at: string;
}

export interface CostAttributionBucketRow {
  readonly rollup_row_id: string;
  readonly tenant_id: string;
  readonly dimension: AttributionDimension;
  readonly bucket_key: string;
  readonly totals: string;
}

export interface SaveRollUpInput {
  readonly rollUp: CostRollUp;
  /** The caller-declared row id (deterministic; e.g. a roll-up batch id). */
  readonly id: string;
  /** The tenant context the roll-up was computed and persisted under. */
  readonly tenantId: string;
  /** Supplied record instant (purity — never wall-clock sampled). */
  readonly recordedAt: string;
}

function requireMetaString(value: string, label: string, max: number): string {
  if (typeof value !== "string" || value.trim().length < 1 || value.trim().length > max) {
    throw new MappingError(`${label} must be 1-${max} characters`);
  }
  return value.trim();
}

/**
 * Map a contract roll-up onto its header row and partition buckets.
 * Tenant law: the tenant-dimension buckets may only name the owning tenant
 * (or the ledger's explicit unassigned key) — a roll-up that would persist
 * another tenant's cost data under this tenant's row is refused (fail
 * closed), mirroring the contract's per-tenant enforcement posture.
 */
export function rollUpToRows(
  input: SaveRollUpInput,
): { rollup: CostAttributionRollupRow; buckets: readonly CostAttributionBucketRow[] } {
  const id = requireMetaString(input.id, "id", 160);
  const tenantId = requireMetaString(input.tenantId, "tenantId", 128);
  const recordedAt = requireMetaString(input.recordedAt, "recordedAt", 64);
  if (Number.isNaN(Date.parse(recordedAt))) {
    throw new MappingError("recordedAt must be a parsable instant");
  }
  if (input.rollUp == null || !isRecord(input.rollUp as unknown)) {
    throw new MappingError("rollUp must be a CostRollUp");
  }
  const rollUp = input.rollUp;

  const tenantKeys = Object.keys(rollUp.byTenant);
  for (const key of tenantKeys) {
    if (key !== tenantId && key !== UNASSIGNED_REF_KEY) {
      throw new MappingError(
        `cross-tenant roll-up denied: byTenant bucket "${key}" is not the owning tenant "${tenantId}" — cost data never persists under another tenant's substrate`,
      );
    }
  }
  for (const key of Object.keys(rollUp.byTenantMission)) {
    const tenantPart = key.split("::")[0] ?? "";
    if (tenantPart !== tenantId && tenantPart !== UNASSIGNED_REF_KEY) {
      throw new MappingError(
        `cross-tenant roll-up denied: byTenantMission bucket "${key}" names tenant "${tenantPart}", not the owning tenant "${tenantId}"`,
      );
    }
  }

  const period = rollUp.period;
  let periodFrom: string | null = null;
  let periodTo: string | null = null;
  let recordedFrom: string | null = null;
  let recordedTo: string | null = null;
  if (period != null) {
    periodFrom = requireMetaString(period.from, "period.from", 64);
    periodTo = requireMetaString(period.to, "period.to", 64);
    if (Number.isNaN(Date.parse(periodFrom)) || Number.isNaN(Date.parse(periodTo))) {
      throw new MappingError("period bounds must be parsable instants");
    }
    if (period.recordedFrom !== undefined) {
      recordedFrom = requireMetaString(period.recordedFrom, "period.recordedFrom", 64);
      if (Number.isNaN(Date.parse(recordedFrom))) {
        throw new MappingError("period.recordedFrom must be a parsable instant");
      }
    }
    if (period.recordedTo !== undefined) {
      recordedTo = requireMetaString(period.recordedTo, "period.recordedTo", 64);
      if (Number.isNaN(Date.parse(recordedTo))) {
        throw new MappingError("period.recordedTo must be a parsable instant");
      }
    }
  }

  const buckets: CostAttributionBucketRow[] = [];
  const pushBuckets = (
    dimension: AttributionDimension,
    source: Record<string, AttributionTotals>,
  ): void => {
    for (const [key, totals] of Object.entries(source)) {
      buckets.push({
        rollup_row_id: id,
        tenant_id: tenantId,
        dimension,
        bucket_key: requireMetaString(key, `bucket key (${dimension})`, 200),
        totals: totalsToValue(totals),
      });
    }
  };
  pushBuckets("tenant", rollUp.byTenant);
  pushBuckets("mission", rollUp.byMission);
  pushBuckets("actor", rollUp.byActor);
  pushBuckets("model", rollUp.byModel);
  pushBuckets("purpose", rollUp.byPurpose);
  pushBuckets("tenant_mission", rollUp.byTenantMission);

  const integrity = rollUp.integrity;
  if (integrity == null || typeof integrity.ok !== "boolean" || typeof integrity.conserves !== "boolean") {
    throw new MappingError("rollUp.integrity is required (ok + conserves verdicts)");
  }
  const defects: readonly AttributionDefect[] = integrity.defects ?? [];
  const problems: readonly string[] = integrity.problems ?? [];

  const rollup: CostAttributionRollupRow = {
    id,
    tenant_id: tenantId,
    period_from: periodFrom,
    period_to: periodTo,
    recorded_from: recordedFrom,
    recorded_to: recordedTo,
    grand_total: totalsToValue(rollUp.grandTotal),
    integrity_ok: integrity.ok,
    integrity_conserves: integrity.conserves,
    integrity_defects: jsonValue(defects),
    integrity_problems: jsonValue(problems),
    recorded_at: recordedAt,
  };
  return { rollup, buckets };
}

/** Rows -> contract roll-up (the reverse mapping; buckets supply the dimensions). */
export function rowsToRollUp(
  rollupRow: Record<string, unknown>,
  bucketRows: readonly Record<string, unknown>[],
): CostRollUp {
  if (!isRecord(rollupRow)) throw new MappingError("roll-up row must be a JSON object");
  const periodFrom = timestampString(rollupRow["period_from"], "period_from");
  const periodTo = timestampString(rollupRow["period_to"], "period_to");
  const recordedFrom = timestampString(rollupRow["recorded_from"], "recorded_from");
  const recordedTo = timestampString(rollupRow["recorded_to"], "recorded_to");
  let period: AttributionPeriod | null = null;
  if (periodFrom !== null && periodTo !== null) {
    period = { from: periodFrom, to: periodTo };
    if (recordedFrom !== null) period.recordedFrom = recordedFrom;
    if (recordedTo !== null) period.recordedTo = recordedTo;
  }

  const byTenant: Record<string, AttributionTotals> = {};
  const byMission: Record<string, AttributionTotals> = {};
  const byActor: Record<string, AttributionTotals> = {};
  const byModel: Record<string, AttributionTotals> = {};
  const byPurpose: Record<string, AttributionTotals> = {};
  const byTenantMission: Record<string, AttributionTotals> = {};
  for (const bucketRow of bucketRows) {
    if (!isRecord(bucketRow)) throw new MappingError("bucket row must be a JSON object");
    const dimension = requireString(bucketRow, "dimension", 32);
    const key = requireString(bucketRow, "bucket_key", 200);
    const totals = rowToTotals(bucketRow, "totals");
    switch (dimension) {
      case "tenant": byTenant[key] = totals; break;
      case "mission": byMission[key] = totals; break;
      case "actor": byActor[key] = totals; break;
      case "model": byModel[key] = totals; break;
      case "purpose": byPurpose[key] = totals; break;
      case "tenant_mission": byTenantMission[key] = totals; break;
      default:
        throw new MappingError(`dimension "${dimension}" is not a registered attribution dimension`);
    }
  }

  const defectsRaw = parseJson(rollupRow["integrity_defects"], "integrity_defects");
  const problemsRaw = parseJson(rollupRow["integrity_problems"], "integrity_problems");
  if (!Array.isArray(defectsRaw) || !Array.isArray(problemsRaw)) {
    throw new MappingError("integrity_defects and integrity_problems must be arrays");
  }

  return {
    period,
    grandTotal: rowToTotals(rollupRow, "grand_total"),
    byTenant,
    byMission,
    byActor,
    byModel,
    byPurpose,
    byTenantMission,
    integrity: {
      ok: rollupRow["integrity_ok"] === true,
      conserves: rollupRow["integrity_conserves"] === true,
      defects: defectsRaw,
      problems: problemsRaw,
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * The adapter
 * ────────────────────────────────────────────────────────────*/

export interface CostAttributionStoreConfig {
  client: CostAttributionDbClient;
  /** J-045: declared adapter failure policy; defaulted when omitted. */
  failurePolicy?: AdapterFailurePolicy;
}

export interface CostAttributionStore {
  /** Append one roll-up (header + buckets). Idempotent, never retried. */
  saveRollUp(input: SaveRollUpInput): Promise<CostAttributionStoreResult<{ id: string; buckets: number }>>;
  /** Load all persisted roll-ups for a tenant (most recent first). */
  loadRollUps(tenantId: string): Promise<CostAttributionStoreResult<readonly CostRollUp[]>>;
  /** The declared failure policy (observability: snapshot, trust ledger). */
  readonly policy: AdapterFailurePolicy;
}

export function createCostAttributionStore(config: CostAttributionStoreConfig): CostAttributionStore {
  const policy = config.failurePolicy ?? COST_ATTRIBUTION_FAILURE_POLICY;
  const client = config.client;

  function containMapping<T>(operation: string, fn: () => T): CostAttributionStoreResult<T> {
    const contained = policy.containSync(operation, fn);
    if (contained.outcome === "ok") {
      return { ok: true, value: contained.value, attempts: contained.attempts, durationMs: contained.durationMs, mode: contained.mode };
    }
    return fail("invalid_input", contained.reason, contained.attempts, contained.durationMs, contained.mode);
  }

  function fromCall<T>(outcome: AdapterCallResult<T>): CostAttributionStoreResult<T> {
    if (outcome.outcome === "ok") {
      return { ok: true, value: outcome.value, attempts: outcome.attempts, durationMs: outcome.durationMs, mode: outcome.mode };
    }
    return fail(outcome.code, outcome.reason, outcome.attempts, outcome.durationMs, outcome.mode);
  }

  return {
    policy,

    async saveRollUp(input: SaveRollUpInput): Promise<CostAttributionStoreResult<{ id: string; buckets: number }>> {
      const mapped = containMapping("cost-attribution.map_rollup", () => rollUpToRows(input));
      if (!mapped.ok) return mapped;
      const { rollup, buckets } = mapped.value;
      const outcome = await policy.run({
        operation: "cost-attribution.save_rollup",
        // Append-only writes are idempotent in the substrate but never
        // transport-retried (J-045 write posture).
        maxAttempts: 1,
        call: async () => {
          await client.query(
            `INSERT INTO public.${COST_ATTRIBUTION_ROLLUP_TABLE}
              (id, tenant_id, period_from, period_to, recorded_from, recorded_to,
               grand_total, integrity_ok, integrity_conserves, integrity_defects,
               integrity_problems, recorded_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
             ON CONFLICT (id, tenant_id) DO NOTHING`,
            [
              rollup.id, rollup.tenant_id, rollup.period_from, rollup.period_to,
              rollup.recorded_from, rollup.recorded_to, rollup.grand_total,
              rollup.integrity_ok, rollup.integrity_conserves, rollup.integrity_defects,
              rollup.integrity_problems, rollup.recorded_at,
            ],
          );
          for (const bucket of buckets) {
            await client.query(
              `INSERT INTO public.${COST_ATTRIBUTION_BUCKET_TABLE}
                (rollup_row_id, tenant_id, dimension, bucket_key, totals)
               VALUES ($1,$2,$3,$4,$5)
               ON CONFLICT (rollup_row_id, dimension, bucket_key) DO NOTHING`,
              [bucket.rollup_row_id, bucket.tenant_id, bucket.dimension, bucket.bucket_key, bucket.totals],
            );
          }
          return { id: rollup.id, buckets: buckets.length };
        },
      });
      return fromCall(outcome);
    },

    async loadRollUps(tenantId: string): Promise<CostAttributionStoreResult<readonly CostRollUp[]>> {
      if (tenantId.trim() === "") {
        return fail("invalid_input", "tenantId is required — roll-ups never cross tenants", 0, 0, policy.snapshot().mode);
      }
      const outcome = await policy.run({
        operation: "cost-attribution.load_rollups",
        call: async () => {
          const headers = await client.query(
            `SELECT * FROM public.${COST_ATTRIBUTION_ROLLUP_TABLE} WHERE tenant_id = $1
             ORDER BY recorded_at DESC, id ASC`,
            [tenantId],
          );
          const buckets = await client.query(
            `SELECT * FROM public.${COST_ATTRIBUTION_BUCKET_TABLE} WHERE tenant_id = $1
             ORDER BY rollup_row_id ASC, dimension ASC, bucket_key ASC`,
            [tenantId],
          );
          return { headers: headers.rows, buckets: buckets.rows };
        },
      });
      if (outcome.outcome === "error") return fromCall(outcome);
      const mapped = containMapping("cost-attribution.map_rollups", () => {
        const byRollup = new Map<string, Record<string, unknown>[]>();
        for (const bucket of outcome.value.buckets) {
          const key = String(bucket["rollup_row_id"] ?? "");
          const group = byRollup.get(key) ?? [];
          group.push(bucket);
          byRollup.set(key, group);
        }
        return outcome.value.headers.map((header) =>
          rowsToRollUp(header, byRollup.get(String(header["id"] ?? "")) ?? []),
        );
      });
      if (!mapped.ok) return mapped;
      return { ok: true, value: mapped.value, attempts: outcome.attempts, durationMs: outcome.durationMs, mode: outcome.mode };
    },
  };
}

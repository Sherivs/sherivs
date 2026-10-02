/**
 * CoreGrid — DB-backed substrate adapter for the tool-runtime contract
 * (J-008 / V1CAP-056 / MISSION-R-62), persisting
 * workforce/tool-runtime.ts governed-tool registrations and invocation
 * records into the tables authored by
 * database/supabase/migrations/20261002000012_coregrid_v1_tool_runtime.sql.
 *
 * Composition, not rewrite: the pure contract stays untouched — this adapter
 * maps GovernedToolDeclaration registration surfaces and ToolInvocationRecord
 * audit records onto substrate rows and is the ONLY place vendor/DB calls
 * appear (Constitution §24/§25). Service-role access only: the tables are
 * zero-policy deny-by-default (RLS enabled, all anon/authenticated privileges
 * revoked), so no policy-bearing client is accepted — the injected client is
 * a minimal service-role surface.
 *
 * Non-observability at rest (J-007): the adapter persists what the runtime
 * already minimized — REDACTED params, lease handle REFERENCES (never
 * handles, never secrets), credential requirements as refs + purposes. The
 * executor function is code, not data, and is deliberately not persisted;
 * a persisted registration round-trips as its data fields only.
 *
 * Failure semantics (J-045): all I/O runs through AdapterFailurePolicy.run
 * (bounded timeout, retry caps, breaker, degraded mode events, trust ledger);
 * mapping/validation are local operations and run through containSync —
 * malformed contract data or malformed DB rows become structured errors,
 * never thrown. Writes are append-only, idempotent (ON CONFLICT DO NOTHING)
 * and never transport-retried (maxAttempts: 1); reads may retry (idempotent).
 *
 * Purity: no wall-clock sampling — every instant is a supplied parameter
 * (registration atMs, record atMs). No credentials, no secret values, no
 * sensitive payload logging (Constitution §29).
 */
import { createAdapterFailurePolicy, type AdapterCallResult, type AdapterFailurePolicy, type AdapterMode } from "./failure-policy";
import type {
  GovernedToolDeclaration,
  ToolExecutionFailureCode,
  ToolInvocationOutcome,
  ToolInvocationRecord,
  ToolInvocationRejectionCode,
  ToolRateGuard,
  ToolBudgetGuard,
  ToolCredentialRequirement,
} from "../workforce/tool-runtime";

/* ─────────────────────────────────────────────────────────────
 * Injected service-role client (minimal surface; no credentials here)
 * ────────────────────────────────────────────────────────────*/

export interface ToolRuntimeDbClient {
  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: readonly Record<string, unknown>[] }>;
}

export const TOOL_RUNTIME_TOOL_TABLE = "cg_tool_runtime_tool";
export const TOOL_RUNTIME_INVOCATION_TABLE = "cg_tool_runtime_invocation";

export const TOOL_RISK_CLASSES = ["low", "medium", "high", "critical"] as const;

export type ToolRiskClass = (typeof TOOL_RISK_CLASSES)[number];

export const TOOL_REASON_CODES = [
  "invalid_invocation_input",
  "tool_not_registered",
  "cross_tenant_invocation_denied",
  "worker_lifecycle_unusable",
  "capability_not_registered",
  "capability_not_declared",
  "capability_risk_escalation_denied",
  "tool_risk_class_bounding_denied",
  "delegation_denied",
  "delegation_action_denied",
  "tool_rate_guard_exceeded",
  "tool_budget_guard_exceeded",
  "param_secret_material_detected",
  "credential_lease_denied",
  "lease_invalidated",
  "tool_execution_failed",
  "result_secret_material_detected",
] as const;

export type ToolReasonCode = ToolInvocationRejectionCode | ToolExecutionFailureCode;

/**
 * Declared failure-semantics policy for the tool-runtime substrate (J-045).
 * Callers may inject their own instance via ToolRuntimeStoreConfig.
 */
export const TOOL_RUNTIME_FAILURE_POLICY: AdapterFailurePolicy = createAdapterFailurePolicy({
  provider: "cg-substrate-tool-runtime",
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

export type ToolRuntimeStoreErrorCode =
  | "invalid_input"
  | "timeout"
  | "provider_error"
  | "breaker_open";

export type ToolRuntimeStoreResult<T> =
  | { ok: true; value: T; attempts: number; durationMs: number; mode: AdapterMode }
  | {
      ok: false;
      code: ToolRuntimeStoreErrorCode;
      reason: string;
      attempts: number;
      durationMs: number;
      mode: AdapterMode;
    };

/** Structured failure with full call observability (AdapterCallError parity). */
function fail<T>(
  code: ToolRuntimeStoreErrorCode,
  reason: string,
  attempts: number,
  durationMs: number,
  mode: AdapterMode,
): ToolRuntimeStoreResult<T> {
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

function optionalString(row: Record<string, unknown>, key: string, max: number): string | null {
  const raw = row[key];
  if (raw == null) return null;
  if (typeof raw !== "string") throw new MappingError(`${key} must be a string or null`);
  const trimmed = raw.trim();
  if (trimmed.length < 1) return null;
  if (trimmed.length > max) throw new MappingError(`${key} must be at most ${max} characters`);
  return trimmed;
}

function stringMeta(value: string, label: string, max: number): string {
  const trimmed = value.trim();
  if (trimmed.length < 1 || trimmed.length > max) {
    throw new MappingError(`${label} must be 1-${max} characters`);
  }
  return trimmed;
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

function requireStringArray(value: unknown, key: string, entryMax: number): readonly string[] {
  if (!Array.isArray(value)) throw new MappingError(`${key} must be a JSON array`);
  return value.map((entry) => {
    if (typeof entry !== "string") throw new MappingError(`${key} entries must be strings`);
    const trimmed = entry.trim();
    if (trimmed.length < 1 || trimmed.length > entryMax) {
      throw new MappingError(`${key} entries must be 1-${entryMax} characters`);
    }
    return trimmed;
  });
}

function requireRiskClass(value: unknown, key: string): ToolRiskClass {
  if (typeof value !== "string" || !(TOOL_RISK_CLASSES as readonly string[]).includes(value)) {
    throw new MappingError(`${key} must be in the agent risk vocabulary`);
  }
  return value as ToolRiskClass;
}

function requireOutcome(value: unknown, key: string): ToolInvocationOutcome {
  if (value !== "executed" && value !== "rejected" && value !== "failed") {
    throw new MappingError(`${key} must be executed, rejected or failed`);
  }
  return value;
}

function requireReasonCode(value: unknown, key: string): ToolReasonCode | null {
  if (value == null) return null;
  if (typeof value !== "string" || !(TOOL_REASON_CODES as readonly string[]).includes(value)) {
    throw new MappingError(`${key} must be in the closed typed reason vocabulary`);
  }
  return value as ToolReasonCode;
}

function instantFromMs(atMs: number, label: string): { atMs: number; at: string } {
  if (!Number.isFinite(atMs)) throw new MappingError(`${label} must be a finite epoch ms value`);
  const at = new Date(atMs).toISOString();
  if (Number.isNaN(Date.parse(at))) throw new MappingError(`${label} is not a representable instant`);
  return { atMs: Math.trunc(atMs), at };
}

function timestampString(value: unknown, key: string): string {
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw new MappingError(`${key} is an invalid instant`);
    return value.toISOString();
  }
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new MappingError(`${key} must be a parsable instant`);
  }
  return value;
}

function parsePositiveIntObject(
  value: unknown,
  keys: readonly string[],
  label: string,
): Record<string, number> | null {
  if (value == null) return null;
  const record = value as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const key of keys) {
    const raw = record[key];
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw <= 0) {
      throw new MappingError(`${label}.${key} must be a positive finite number`);
    }
    out[key] = raw;
  }
  return out;
}

/* ─────────────────────────────────────────────────────────────
 * Registration surface -> row
 * ────────────────────────────────────────────────────────────*/

export interface ToolRuntimeToolRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly tool_id: string;
  readonly contract: string;
  readonly required_capability_ids: string;
  readonly risk_class: ToolRiskClass;
  readonly credential_requirements: string;
  readonly sensitive_param_keys: string;
  readonly rate_guard: string | null;
  readonly budget_guard: string | null;
  readonly registered_at_ms: number;
  readonly registered_at: string;
}

/**
 * Map a governed-tool declaration onto its registration row. The executor is
 * deliberately absent — code is not data; the persisted surface is the
 * declaration's data fields only. Credential requirements persist as refs +
 * purposes + lease bounds, never secret material (J-007).
 */
export function registrationToRow(
  declaration: GovernedToolDeclaration,
  tenantId: string,
  registeredAtMs: number,
): ToolRuntimeToolRow {
  if (!isRecord(declaration as unknown)) throw new MappingError("declaration must be a GovernedToolDeclaration");
  const toolId = stringMeta(declaration.toolId, "toolId", 200);
  const contract = stringMeta(declaration.contract, "contract", 500);
  const riskClass = requireRiskClass(declaration.riskClass, "riskClass");
  if (typeof declaration.executor !== "function") {
    throw new MappingError("executor must be a function (validated, never persisted)");
  }
  const capabilityIds = requireStringArray(
    declaration.requiredCapabilityIds ?? [],
    "requiredCapabilityIds",
    160,
  );
  const credentialRequirements: readonly ToolCredentialRequirement[] =
    declaration.credentialRequirements ?? [];
  for (const requirement of credentialRequirements) {
    if (!isRecord(requirement as unknown)) {
      throw new MappingError("credentialRequirements entries must be objects");
    }
    stringMeta(requirement.credentialRef, "credentialRef", 200);
    stringMeta(requirement.purpose, "credential purpose", 300);
    if (!Number.isFinite(requirement.ttlMs) || requirement.ttlMs <= 0) {
      throw new MappingError("credential ttlMs must be a positive finite number");
    }
    if (!Number.isInteger(requirement.maxUses) || requirement.maxUses <= 0) {
      throw new MappingError("credential maxUses must be a positive integer");
    }
  }
  const sensitiveParamKeys = requireStringArray(
    declaration.sensitiveParamKeys ?? [],
    "sensitiveParamKeys",
    160,
  );

  const rateGuard: ToolRateGuard | null =
    declaration.rateGuard != null
      ? (() => {
          if (
            !Number.isFinite(declaration.rateGuard.windowMs) ||
            declaration.rateGuard.windowMs <= 0 ||
            !Number.isInteger(declaration.rateGuard.maxInvocationsPerWindow) ||
            declaration.rateGuard.maxInvocationsPerWindow <= 0
          ) {
            throw new MappingError("rateGuard requires a positive windowMs and a positive integer maxInvocationsPerWindow");
          }
          return {
            windowMs: declaration.rateGuard.windowMs,
            maxInvocationsPerWindow: declaration.rateGuard.maxInvocationsPerWindow,
          };
        })()
      : null;

  const budgetGuard: ToolBudgetGuard | null =
    declaration.budgetGuard != null
      ? (() => {
          if (
            !Number.isInteger(declaration.budgetGuard.maxTotalInvocations) ||
            declaration.budgetGuard.maxTotalInvocations <= 0
          ) {
            throw new MappingError("budgetGuard requires a positive integer maxTotalInvocations");
          }
          return { maxTotalInvocations: declaration.budgetGuard.maxTotalInvocations };
        })()
      : null;

  const instant = instantFromMs(registeredAtMs, "registeredAtMs");

  return {
    id: toolId,
    tenant_id: stringMeta(tenantId, "tenantId", 128),
    tool_id: toolId,
    contract,
    required_capability_ids: jsonValue(capabilityIds),
    risk_class: riskClass,
    credential_requirements: jsonValue(credentialRequirements),
    sensitive_param_keys: jsonValue(sensitiveParamKeys),
    rate_guard: rateGuard === null ? null : jsonValue(rateGuard),
    budget_guard: budgetGuard === null ? null : jsonValue(budgetGuard),
    registered_at_ms: instant.atMs,
    registered_at: instant.at,
  };
}

/** Row -> registration data surface (executor excluded by design). */
export function rowToRegistration(
  row: Record<string, unknown>,
): Omit<GovernedToolDeclaration, "executor"> {
  if (!isRecord(row)) throw new MappingError("registration row must be a JSON object");
  const toolId = requireString(row, "tool_id", 200);
  const id = requireString(row, "id", 200);
  if (id !== toolId) throw new MappingError("id must equal tool_id (registration identity law)");
  const requiredCapabilityIds = requireStringArray(
    parseJson(row["required_capability_ids"], "required_capability_ids"),
    "required_capability_ids",
    160,
  );
  const credentialRequirementsRaw = parseJson(row["credential_requirements"], "credential_requirements");
  if (!Array.isArray(credentialRequirementsRaw)) {
    throw new MappingError("credential_requirements must be a JSON array");
  }
  const credentialRequirements = credentialRequirementsRaw.map((entry, index) => {
    if (!isRecord(entry)) throw new MappingError(`credential requirement #${index} must be an object`);
    const credentialRef = requireString(entry, "credentialRef", 200);
    const purpose = requireString(entry, "purpose", 300);
    const ttlMs = entry["ttlMs"];
    const maxUses = entry["maxUses"];
    if (typeof ttlMs !== "number" || !Number.isFinite(ttlMs) || ttlMs <= 0) {
      throw new MappingError(`credential requirement #${index} ttlMs must be positive`);
    }
    if (typeof maxUses !== "number" || !Number.isInteger(maxUses) || maxUses <= 0) {
      throw new MappingError(`credential requirement #${index} maxUses must be a positive integer`);
    }
    return { credentialRef, purpose, ttlMs, maxUses } satisfies ToolCredentialRequirement;
  });
  const sensitiveParamKeys = requireStringArray(
    parseJson(row["sensitive_param_keys"], "sensitive_param_keys"),
    "sensitive_param_keys",
    160,
  );

  return {
    toolId,
    contract: requireString(row, "contract", 500),
    requiredCapabilityIds,
    riskClass: requireRiskClass(row["risk_class"], "risk_class"),
    credentialRequirements,
    sensitiveParamKeys,
    rateGuard: parsePositiveIntObject(
      parseJson(row["rate_guard"], "rate_guard"),
      ["windowMs", "maxInvocationsPerWindow"],
      "rate_guard",
    ) as ToolRateGuard | null,
    budgetGuard: parsePositiveIntObject(
      parseJson(row["budget_guard"], "budget_guard"),
      ["maxTotalInvocations"],
      "budget_guard",
    ) as ToolBudgetGuard | null,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Invocation record <-> row
 * ────────────────────────────────────────────────────────────*/

export interface ToolRuntimeInvocationRow {
  readonly record_id: string;
  readonly tenant_id: string;
  readonly at_ms: number;
  readonly at: string;
  readonly worker_id: string | null;
  readonly worker_identity_ref: string | null;
  readonly tool_id: string;
  readonly required_capability_ids: string;
  readonly lease_handle_refs: string;
  readonly delegation_ref: string | null;
  readonly outcome: ToolInvocationOutcome;
  readonly reason_code: ToolReasonCode | null;
  readonly reason_detail: string | null;
  readonly lease_invalidated: boolean;
  readonly redacted_params: string;
  readonly result_summary: string | null;
  readonly evidence_ref: string | null;
}

/**
 * Map a contract invocation record onto its audit row. Worker identity may be
 * absent on a pre-resolution rejection (the contract emits "" there); the
 * substrate stores that as NULL while still auditing the attempt.
 */
export function invocationToRow(record: ToolInvocationRecord): ToolRuntimeInvocationRow {
  if (!isRecord(record as unknown)) throw new MappingError("record must be a ToolInvocationRecord");
  const instant = instantFromMs(record.atMs, "atMs");
  const outcome = requireOutcome(record.outcome, "outcome");
  const reasonCode = requireReasonCode(record.reasonCode, "reasonCode");
  if (outcome === "executed" && reasonCode !== null) {
    throw new MappingError("an executed record names no rejection/failure reason (outcome law)");
  }
  if (outcome !== "executed" && reasonCode === null) {
    throw new MappingError("a rejected/failed record must name its reason code (outcome law)");
  }
  const leaseInvalidated = record.leaseInvalidated === true;
  if (leaseInvalidated && (outcome !== "failed" || reasonCode !== "lease_invalidated")) {
    throw new MappingError("leaseInvalidated is only ever the lease failure path's marker (lease law)");
  }
  if (!isRecord(record.redactedParams as unknown)) {
    throw new MappingError("redactedParams must be a JSON object");
  }

  return {
    record_id: stringMeta(record.recordId, "recordId", 300),
    tenant_id: stringMeta(record.tenantRef, "tenantRef", 128),
    at_ms: instant.atMs,
    at: instant.at,
    worker_id: record.workerId === "" ? null : stringMeta(record.workerId, "workerId", 200),
    worker_identity_ref:
      record.workerIdentityRef === ""
        ? null
        : stringMeta(record.workerIdentityRef, "workerIdentityRef", 200),
    tool_id: stringMeta(record.toolId, "toolId", 200),
    required_capability_ids: jsonValue(requireStringArray(record.requiredCapabilityIds ?? [], "requiredCapabilityIds", 160)),
    lease_handle_refs: jsonValue(requireStringArray(record.leaseHandleRefs ?? [], "leaseHandleRefs", 200)),
    delegation_ref:
      record.delegationRef === null ? null : stringMeta(record.delegationRef, "delegationRef", 200),
    outcome,
    reason_code: reasonCode,
    reason_detail:
      record.reasonDetail === null ? null : stringMeta(record.reasonDetail, "reasonDetail", 2000),
    lease_invalidated: leaseInvalidated,
    redacted_params: jsonValue(record.redactedParams),
    result_summary:
      record.resultSummary === null
        ? null
        : stringMeta(record.resultSummary, "resultSummary", 100_000),
    evidence_ref:
      record.evidenceRef === null ? null : stringMeta(record.evidenceRef, "evidenceRef", 200),
  };
}

/** Row -> contract invocation record (the reverse mapping). */
export function rowToInvocation(row: Record<string, unknown>): ToolInvocationRecord {
  if (!isRecord(row)) throw new MappingError("invocation row must be a JSON object");
  const atRaw = row["at_ms"];
  if (typeof atRaw !== "number" || !Number.isFinite(atRaw)) {
    throw new MappingError("at_ms must be a finite epoch ms value");
  }
  const at = timestampString(row["at"], "at");
  const outcome = requireOutcome(row["outcome"], "outcome");
  const reasonCode = requireReasonCode(row["reason_code"], "reason_code");
  if (outcome === "executed" && reasonCode !== null) {
    throw new MappingError("an executed record names no rejection/failure reason (outcome law)");
  }
  if (outcome !== "executed" && reasonCode === null) {
    throw new MappingError("a rejected/failed record must name its reason code (outcome law)");
  }
  const leaseInvalidated = row["lease_invalidated"] === true;
  if (leaseInvalidated && (outcome !== "failed" || reasonCode !== "lease_invalidated")) {
    throw new MappingError("leaseInvalidated is only ever the lease failure path's marker (lease law)");
  }
  const redactedParams = parseJson(row["redacted_params"], "redacted_params");
  if (!isRecord(redactedParams)) throw new MappingError("redacted_params must be a JSON object");

  return {
    recordId: requireString(row, "record_id", 300),
    atMs: atRaw,
    workerId: optionalString(row, "worker_id", 200) ?? "",
    workerIdentityRef: optionalString(row, "worker_identity_ref", 200) ?? "",
    tenantRef: requireString(row, "tenant_id", 128),
    toolId: requireString(row, "tool_id", 200),
    requiredCapabilityIds: requireStringArray(
      parseJson(row["required_capability_ids"], "required_capability_ids"),
      "required_capability_ids",
      160,
    ),
    leaseHandleRefs: requireStringArray(
      parseJson(row["lease_handle_refs"], "lease_handle_refs"),
      "lease_handle_refs",
      200,
    ),
    delegationRef: optionalString(row, "delegation_ref", 200),
    outcome,
    reasonCode,
    reasonDetail: optionalString(row, "reason_detail", 2000),
    leaseInvalidated,
    redactedParams,
    resultSummary: optionalString(row, "result_summary", 100_000),
    evidenceRef: optionalString(row, "evidence_ref", 200),
  };
}

/* ─────────────────────────────────────────────────────────────
 * The adapter
 * ────────────────────────────────────────────────────────────*/

export interface ToolRuntimeStoreConfig {
  client: ToolRuntimeDbClient;
  /** J-045: declared adapter failure policy; defaulted when omitted. */
  failurePolicy?: AdapterFailurePolicy;
}

export interface ToolRuntimeStore {
  /** Persist one governed-tool registration. Idempotent, never retried. */
  saveRegistration(
    declaration: GovernedToolDeclaration,
    tenantId: string,
    registeredAtMs: number,
  ): Promise<ToolRuntimeStoreResult<{ toolId: string }>>;
  /** Append one invocation record (executed, rejected or failed). Idempotent. */
  saveInvocation(record: ToolInvocationRecord): Promise<ToolRuntimeStoreResult<{ recordId: string }>>;
  /** Load persisted registration surfaces for a tenant (executor excluded). */
  loadRegistrations(tenantId: string): Promise<ToolRuntimeStoreResult<readonly (Omit<GovernedToolDeclaration, "executor"> & { registeredAtMs: number })[]>>;
  /** Load the invocation ledger for a tenant (most recent first). */
  loadInvocations(tenantId: string): Promise<ToolRuntimeStoreResult<readonly ToolInvocationRecord[]>>;
  /** The declared failure policy (observability: snapshot, trust ledger). */
  readonly policy: AdapterFailurePolicy;
}

export function createToolRuntimeStore(config: ToolRuntimeStoreConfig): ToolRuntimeStore {
  const policy = config.failurePolicy ?? TOOL_RUNTIME_FAILURE_POLICY;
  const client = config.client;

  function containMapping<T>(operation: string, fn: () => T): ToolRuntimeStoreResult<T> {
    const contained = policy.containSync(operation, fn);
    if (contained.outcome === "ok") {
      return { ok: true, value: contained.value, attempts: contained.attempts, durationMs: contained.durationMs, mode: contained.mode };
    }
    return fail("invalid_input", contained.reason, contained.attempts, contained.durationMs, contained.mode);
  }

  function fromCall<T>(outcome: AdapterCallResult<T>): ToolRuntimeStoreResult<T> {
    if (outcome.outcome === "ok") {
      return { ok: true, value: outcome.value, attempts: outcome.attempts, durationMs: outcome.durationMs, mode: outcome.mode };
    }
    return fail(outcome.code, outcome.reason, outcome.attempts, outcome.durationMs, outcome.mode);
  }

  return {
    policy,

    async saveRegistration(
      declaration: GovernedToolDeclaration,
      tenantId: string,
      registeredAtMs: number,
    ): Promise<ToolRuntimeStoreResult<{ toolId: string }>> {
      const mapped = containMapping("tool-runtime.map_registration", () =>
        registrationToRow(declaration, tenantId, registeredAtMs),
      );
      if (!mapped.ok) return mapped;
      const row = mapped.value;
      const outcome = await policy.run({
        operation: "tool-runtime.save_registration",
        // Append-only writes are idempotent in the substrate but never
        // transport-retried (J-045 write posture).
        maxAttempts: 1,
        call: async () => {
          await client.query(
            `INSERT INTO public.${TOOL_RUNTIME_TOOL_TABLE}
              (id, tenant_id, tool_id, contract, required_capability_ids, risk_class,
               credential_requirements, sensitive_param_keys, rate_guard, budget_guard,
               registered_at_ms, registered_at)
             VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7::jsonb,$8::jsonb,$9::jsonb,$10::jsonb,$11,$12)
             ON CONFLICT (tenant_id, tool_id) DO NOTHING`,
            [
              row.id, row.tenant_id, row.tool_id, row.contract,
              row.required_capability_ids, row.risk_class,
              row.credential_requirements, row.sensitive_param_keys,
              row.rate_guard, row.budget_guard, row.registered_at_ms, row.registered_at,
            ],
          );
          return { toolId: row.tool_id };
        },
      });
      return fromCall(outcome);
    },

    async saveInvocation(record: ToolInvocationRecord): Promise<ToolRuntimeStoreResult<{ recordId: string }>> {
      const mapped = containMapping("tool-runtime.map_invocation", () => invocationToRow(record));
      if (!mapped.ok) return mapped;
      const row = mapped.value;
      const outcome = await policy.run({
        operation: "tool-runtime.save_invocation",
        maxAttempts: 1,
        call: async () => {
          await client.query(
            `INSERT INTO public.${TOOL_RUNTIME_INVOCATION_TABLE}
              (record_id, tenant_id, at_ms, at, worker_id, worker_identity_ref, tool_id,
               required_capability_ids, lease_handle_refs, delegation_ref, outcome,
               reason_code, reason_detail, lease_invalidated, redacted_params,
               result_summary, evidence_ref)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12,$13,$14,$15::jsonb,$16,$17)
             ON CONFLICT (record_id) DO NOTHING`,
            [
              row.record_id, row.tenant_id, row.at_ms, row.at, row.worker_id,
              row.worker_identity_ref, row.tool_id, row.required_capability_ids,
              row.lease_handle_refs, row.delegation_ref, row.outcome,
              row.reason_code, row.reason_detail, row.lease_invalidated,
              row.redacted_params, row.result_summary, row.evidence_ref,
            ],
          );
          return { recordId: row.record_id };
        },
      });
      return fromCall(outcome);
    },

    async loadRegistrations(
      tenantId: string,
    ): Promise<ToolRuntimeStoreResult<readonly (Omit<GovernedToolDeclaration, "executor"> & { registeredAtMs: number })[]>> {
      if (tenantId.trim() === "") {
        return fail("invalid_input", "tenantId is required — registrations never cross tenants", 0, 0, policy.snapshot().mode);
      }
      const outcome = await policy.run({
        operation: "tool-runtime.load_registrations",
        call: async () =>
          client.query(
            `SELECT * FROM public.${TOOL_RUNTIME_TOOL_TABLE} WHERE tenant_id = $1
             ORDER BY registered_at DESC, tool_id ASC`,
            [tenantId],
          ),
      });
      if (outcome.outcome === "error") return fromCall(outcome);
      const mapped = containMapping("tool-runtime.map_registrations", () =>
        outcome.value.rows.map((row) => {
          const registration = rowToRegistration(row);
          const registeredAtMs = row["registered_at_ms"];
          if (typeof registeredAtMs !== "number" || !Number.isFinite(registeredAtMs)) {
            throw new MappingError("registered_at_ms must be a finite epoch ms value");
          }
          return { ...registration, registeredAtMs };
        }),
      );
      if (!mapped.ok) return mapped;
      return { ok: true, value: mapped.value, attempts: outcome.attempts, durationMs: outcome.durationMs, mode: outcome.mode };
    },

    async loadInvocations(tenantId: string): Promise<ToolRuntimeStoreResult<readonly ToolInvocationRecord[]>> {
      if (tenantId.trim() === "") {
        return fail("invalid_input", "tenantId is required — invocation records never cross tenants", 0, 0, policy.snapshot().mode);
      }
      const outcome = await policy.run({
        operation: "tool-runtime.load_invocations",
        call: async () =>
          client.query(
            `SELECT * FROM public.${TOOL_RUNTIME_INVOCATION_TABLE} WHERE tenant_id = $1
             ORDER BY at DESC, record_id ASC`,
            [tenantId],
          ),
      });
      if (outcome.outcome === "error") return fromCall(outcome);
      const mapped = containMapping("tool-runtime.map_invocations", () =>
        outcome.value.rows.map((row) => rowToInvocation(row)),
      );
      if (!mapped.ok) return mapped;
      return { ok: true, value: mapped.value, attempts: outcome.attempts, durationMs: outcome.durationMs, mode: outcome.mode };
    },
  };
}

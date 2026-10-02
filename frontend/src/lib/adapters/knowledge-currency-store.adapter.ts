/**
 * CoreGrid — DB-backed substrate adapter for the knowledge-currency contract
 * (J-019 / V1CAP-040 / MISSION-R-71, wave 3), persisting
 * memory/knowledge-currency.ts sources, freshness contracts, invalidation
 * acts and reliability downgrades into the tables authored by
 * database/supabase/migrations/20261002000011_coregrid_v1_knowledge_currency.sql.
 *
 * Composition, not rewrite: the pure contract stays untouched — this adapter
 * maps contract declarations/acts onto substrate rows and is the ONLY place
 * vendor/DB calls appear (Constitution §24/§25). Service-role access only:
 * the tables are zero-policy deny-by-default (RLS enabled, all
 * anon/authenticated privileges revoked), so no policy-bearing client is
 * accepted — the injected client is a minimal service-role surface.
 *
 * Failure semantics (J-045): all I/O runs through AdapterFailurePolicy.run
 * (bounded timeout, retry caps, breaker, degraded mode events, trust ledger);
 * mapping/validation are local operations and run through containSync —
 * malformed contract data or malformed DB rows become structured errors,
 * never thrown. Writes are append-only, idempotent (ON CONFLICT DO NOTHING)
 * and never transport-retried (maxAttempts: 1); reads may retry (idempotent).
 *
 * Append-only law (ADR-005): invalidation and downgrade acts are tombstone
 * acts — the underlying memory record is never deleted, and no UPDATE/DELETE
 * path is authored here. The adapter persists REFERENCES to memory records,
 * never their content (currency composes with the phase-36 memory tier, it
 * never invents records). Purity: no wall-clock sampling — every audit
 * instant is a supplied parameter. No credentials, no secret values, no
 * sensitive payload logging (Constitution §29).
 */
import { createAdapterFailurePolicy, type AdapterCallResult, type AdapterFailurePolicy, type AdapterMode } from "./failure-policy";
import type {
  FreshnessContract,
  InvalidationAct,
  ReliabilityDowngradeAct,
  SourceDeclaration,
  SourceReliabilityTier,
} from "../memory/knowledge-currency";

/* ─────────────────────────────────────────────────────────────
 * Injected service-role client (minimal surface; no credentials here)
 * ────────────────────────────────────────────────────────────*/

export interface KnowledgeCurrencyDbClient {
  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: readonly Record<string, unknown>[] }>;
}

export const KNOWLEDGE_SOURCE_TABLE = "cg_knowledge_source";
export const KNOWLEDGE_CONTRACT_TABLE = "cg_knowledge_freshness_contract";
export const KNOWLEDGE_INVALIDATION_TABLE = "cg_knowledge_invalidation";
export const KNOWLEDGE_DOWNGRADE_TABLE = "cg_knowledge_downgrade";

export const KNOWLEDGE_SOURCE_COLUMNS = [
  "id",
  "tenant_id",
  "tier",
  "description",
  "evidence_ref",
  "declared_by",
  "declared_at",
] as const;

export const KNOWLEDGE_CONTRACT_COLUMNS = [
  "record_id",
  "tenant_id",
  "source_id",
  "fresh_until",
  "revalidation",
  "revalidate_after_seconds",
  "registered_at",
  "tier_at_registration",
] as const;

export const KNOWLEDGE_INVALIDATION_COLUMNS = [
  "id",
  "tenant_id",
  "record_id",
  "invalidated_by",
  "reason",
  "evidence_ref",
  "invalidated_at",
] as const;

export const KNOWLEDGE_DOWNGRADE_COLUMNS = [
  "id",
  "tenant_id",
  "source_id",
  "from_tier",
  "to_tier",
  "downgraded_by",
  "reason",
  "evidence_ref",
  "downgraded_at",
] as const;

/**
 * Declared failure-semantics policy for the knowledge-currency substrate
 * (J-045). Callers may inject their own instance via
 * KnowledgeCurrencyStoreConfig.
 */
export const KNOWLEDGE_CURRENCY_FAILURE_POLICY: AdapterFailurePolicy = createAdapterFailurePolicy({
  provider: "cg-substrate-knowledge-currency",
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

export type KnowledgeCurrencyStoreErrorCode =
  | "invalid_input"
  | "timeout"
  | "provider_error"
  | "breaker_open";

export type KnowledgeCurrencyStoreResult<T> =
  | { ok: true; value: T; attempts: number; durationMs: number; mode: AdapterMode }
  | {
      ok: false;
      code: KnowledgeCurrencyStoreErrorCode;
      reason: string;
      attempts: number;
      durationMs: number;
      mode: AdapterMode;
    };

/** Structured failure with full call observability (AdapterCallError parity). */
function fail<T>(
  code: KnowledgeCurrencyStoreErrorCode,
  reason: string,
  attempts: number,
  durationMs: number,
  mode: AdapterMode,
): KnowledgeCurrencyStoreResult<T> {
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
  if (trimmed.length === 0) return null;
  if (trimmed.length > max) throw new MappingError(`${key} must be at most ${max} characters`);
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

function requireVocab(row: Record<string, unknown>, key: string, vocab: readonly string[]): string {
  const value = requireString(row, key, 64);
  if (!vocab.includes(value)) throw new MappingError(`${key} "${value}" is not in the declared vocabulary`);
  return value;
}

const TIERS: readonly string[] = ["authoritative", "verified", "provisional", "unverified"];
const REVALIDATIONS: readonly string[] = ["none", "before_use", "periodic"];

function requireTier(row: Record<string, unknown>, key: string): SourceReliabilityTier {
  return requireVocab(row, key, TIERS) as SourceReliabilityTier;
}

function requirePositiveSeconds(row: Record<string, unknown>, key: string): number | null {
  const raw = row[key];
  if (raw == null) return null;
  if (typeof raw !== "number" || !Number.isInteger(raw) || raw <= 0) {
    throw new MappingError(`${key} must be a positive integer when present`);
  }
  return raw;
}

/* ─────────────────────────────────────────────────────────────
 * Row shapes + mappings (column names pinned to the migration)
 * ────────────────────────────────────────────────────────────*/

export interface KnowledgeSourceRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly tier: string;
  readonly description: string;
  readonly evidence_ref: string | null;
  readonly declared_by: string;
  readonly declared_at: string;
}

export function sourceToRow(source: SourceDeclaration): KnowledgeSourceRow {
  return {
    id: requireField(source, "sourceId", 160),
    tenant_id: requireField(source, "tenantId", 128),
    tier: requireVocabField(source.tier, "tier"),
    description: requireField(source, "description", 500),
    evidence_ref: optionalField(source.evidenceRef, "evidenceRef", 200),
    declared_by: requireField(source, "declaredBy", 160),
    declared_at: requireInstant(source.declaredAt, "declaredAt"),
  };
}

export function rowToSource(row: Record<string, unknown>): SourceDeclaration {
  if (!isRecord(row)) throw new MappingError("source row must be a JSON object");
  return {
    sourceId: requireString(row, "id", 160),
    tenantId: requireString(row, "tenant_id", 128),
    tier: requireTier(row, "tier"),
    description: requireString(row, "description", 500),
    evidenceRef: optionalString(row, "evidence_ref", 200),
    declaredBy: requireString(row, "declared_by", 160),
    declaredAt: requireTimestamp(row, "declared_at"),
  };
}

export interface KnowledgeContractRow {
  readonly record_id: string;
  readonly tenant_id: string;
  readonly source_id: string;
  readonly fresh_until: string;
  readonly revalidation: string;
  readonly revalidate_after_seconds: number | null;
  readonly registered_at: string;
  readonly tier_at_registration: string;
}

export function contractToRow(contract: FreshnessContract): KnowledgeContractRow {
  return {
    record_id: requireField(contract, "recordId", 160),
    tenant_id: requireField(contract, "tenantId", 128),
    source_id: requireField(contract, "sourceId", 160),
    fresh_until: requireInstant(contract.freshUntil, "freshUntil"),
    revalidation: requireVocabField(contract.revalidation, "revalidation"),
    revalidate_after_seconds: contract.revalidateAfterSeconds,
    registered_at: requireInstant(contract.registeredAt, "registeredAt"),
    tier_at_registration: requireVocabField(contract.tierAtRegistration, "tierAtRegistration"),
  };
}

export function rowToContract(row: Record<string, unknown>): FreshnessContract {
  if (!isRecord(row)) throw new MappingError("contract row must be a JSON object");
  return {
    recordId: requireString(row, "record_id", 160),
    tenantId: requireString(row, "tenant_id", 128),
    sourceId: requireString(row, "source_id", 160),
    freshUntil: requireTimestamp(row, "fresh_until"),
    revalidation: requireVocab(row, "revalidation", REVALIDATIONS) as FreshnessContract["revalidation"],
    revalidateAfterSeconds: requirePositiveSeconds(row, "revalidate_after_seconds"),
    registeredAt: requireTimestamp(row, "registered_at"),
    tierAtRegistration: requireTier(row, "tier_at_registration"),
  };
}

export interface KnowledgeInvalidationRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly record_id: string;
  readonly invalidated_by: string;
  readonly reason: string;
  readonly evidence_ref: string;
  readonly invalidated_at: string;
}

export function invalidationToRow(act: InvalidationAct): KnowledgeInvalidationRow {
  return {
    id: requireField(act, "invalidationId", 160),
    tenant_id: requireField(act, "tenantId", 128),
    record_id: requireField(act, "recordId", 160),
    invalidated_by: requireField(act, "invalidatedBy", 160),
    reason: requireField(act, "reason", 500),
    evidence_ref: requireField(act, "evidenceRef", 200),
    invalidated_at: requireInstant(act.invalidatedAt, "invalidatedAt"),
  };
}

export function rowToInvalidation(row: Record<string, unknown>): InvalidationAct {
  if (!isRecord(row)) throw new MappingError("invalidation row must be a JSON object");
  return {
    invalidationId: requireString(row, "id", 160),
    tenantId: requireString(row, "tenant_id", 128),
    recordId: requireString(row, "record_id", 160),
    invalidatedBy: requireString(row, "invalidated_by", 160),
    reason: requireString(row, "reason", 500),
    evidenceRef: requireString(row, "evidence_ref", 200),
    invalidatedAt: requireTimestamp(row, "invalidated_at"),
  };
}

export interface KnowledgeDowngradeRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly source_id: string;
  readonly from_tier: string;
  readonly to_tier: string;
  readonly downgraded_by: string;
  readonly reason: string;
  readonly evidence_ref: string;
  readonly downgraded_at: string;
}

export function downgradeToRow(act: ReliabilityDowngradeAct): KnowledgeDowngradeRow {
  return {
    id: requireField(act, "downgradeId", 160),
    tenant_id: requireField(act, "tenantId", 128),
    source_id: requireField(act, "sourceId", 160),
    from_tier: requireVocabField(act.fromTier, "fromTier"),
    to_tier: requireVocabField(act.toTier, "toTier"),
    downgraded_by: requireField(act, "downgradedBy", 160),
    reason: requireField(act, "reason", 500),
    evidence_ref: requireField(act, "evidenceRef", 200),
    downgraded_at: requireInstant(act.downgradedAt, "downgradedAt"),
  };
}

export function rowToDowngrade(row: Record<string, unknown>): ReliabilityDowngradeAct {
  if (!isRecord(row)) throw new MappingError("downgrade row must be a JSON object");
  return {
    downgradeId: requireString(row, "id", 160),
    sourceId: requireString(row, "source_id", 160),
    tenantId: requireString(row, "tenant_id", 128),
    fromTier: requireTier(row, "from_tier"),
    toTier: requireTier(row, "to_tier"),
    downgradedBy: requireString(row, "downgraded_by", 160),
    reason: requireString(row, "reason", 500),
    evidenceRef: requireString(row, "evidence_ref", 200),
    downgradedAt: requireTimestamp(row, "downgraded_at"),
  };
}

/* ── field validators (fail closed before anything is persisted) ── */

function requireField(
  value: object,
  key: string,
  max: number,
): string {
  const raw = (value as Record<string, unknown>)[key];
  if (typeof raw !== "string" || raw.trim().length < 1 || raw.trim().length > max) {
    throw new MappingError(`${key} must be 1-${max} characters`);
  }
  return raw.trim();
}

function optionalField(value: unknown, key: string, max: number): string | null {
  if (value == null) return null;
  if (typeof value !== "string" || value.trim().length < 1 || value.trim().length > max) {
    throw new MappingError(`${key} must be 1-${max} characters when present`);
  }
  return value.trim();
}

function requireVocabField(value: unknown, label: string): string {
  if (typeof value !== "string") throw new MappingError(`${label} must be a string`);
  const trimmed = value.trim();
  if (!TIERS.includes(trimmed) && !REVALIDATIONS.includes(trimmed)) {
    throw new MappingError(`${label} "${trimmed}" is not in the declared vocabulary`);
  }
  return trimmed;
}

function requireInstant(value: string, label: string): string {
  if (typeof value !== "string" || Number.isNaN(Date.parse(value))) {
    throw new MappingError(`${label} must be a parsable instant`);
  }
  return value.trim();
}

/* ─────────────────────────────────────────────────────────────
 * The adapter
 * ────────────────────────────────────────────────────────────*/

export interface KnowledgeCurrencyStoreConfig {
  client: KnowledgeCurrencyDbClient;
  /** J-045: declared adapter failure policy; defaulted when omitted. */
  failurePolicy?: AdapterFailurePolicy;
}

export interface KnowledgeCurrencyStore {
  /** Append one declared source. Idempotent, never retried. */
  saveSource(source: SourceDeclaration): Promise<KnowledgeCurrencyStoreResult<{ id: string }>>;
  /** Append one evidence-bearing downgrade act. Idempotent, never retried. */
  saveDowngrade(act: ReliabilityDowngradeAct): Promise<KnowledgeCurrencyStoreResult<{ id: string }>>;
  /** Append one freshness contract binding. Idempotent, never retried. */
  saveContract(contract: FreshnessContract): Promise<KnowledgeCurrencyStoreResult<{ recordId: string }>>;
  /** Append one explicit invalidation act. Idempotent, never retried. */
  saveInvalidation(act: InvalidationAct): Promise<KnowledgeCurrencyStoreResult<{ id: string }>>;
  /** Load persisted sources for a tenant (declaration order). */
  loadSources(tenantId: string): Promise<KnowledgeCurrencyStoreResult<readonly SourceDeclaration[]>>;
  /** Load persisted freshness contracts for a tenant. */
  loadContracts(tenantId: string): Promise<KnowledgeCurrencyStoreResult<readonly FreshnessContract[]>>;
  /** Load persisted invalidation acts for a tenant. */
  loadInvalidations(tenantId: string): Promise<KnowledgeCurrencyStoreResult<readonly InvalidationAct[]>>;
  /** Load persisted downgrade acts for a tenant. */
  loadDowngrades(tenantId: string): Promise<KnowledgeCurrencyStoreResult<readonly ReliabilityDowngradeAct[]>>;
  /** The declared failure policy (observability: snapshot, trust ledger). */
  readonly policy: AdapterFailurePolicy;
}

export function createKnowledgeCurrencyDbStore(
  config: KnowledgeCurrencyStoreConfig,
): KnowledgeCurrencyStore {
  const policy = config.failurePolicy ?? KNOWLEDGE_CURRENCY_FAILURE_POLICY;
  const client = config.client;

  function containMapping<T>(operation: string, fn: () => T): KnowledgeCurrencyStoreResult<T> {
    const contained = policy.containSync(operation, fn);
    if (contained.outcome === "ok") {
      return { ok: true, value: contained.value, attempts: contained.attempts, durationMs: contained.durationMs, mode: contained.mode };
    }
    return fail("invalid_input", contained.reason, contained.attempts, contained.durationMs, contained.mode);
  }

  function fromCall<T>(outcome: AdapterCallResult<T>): KnowledgeCurrencyStoreResult<T> {
    if (outcome.outcome === "ok") {
      return { ok: true, value: outcome.value, attempts: outcome.attempts, durationMs: outcome.durationMs, mode: outcome.mode };
    }
    return fail(outcome.code, outcome.reason, outcome.attempts, outcome.durationMs, outcome.mode);
  }

  function requireTenant(tenantId: string): string | null {
    if (tenantId.trim() === "") return null;
    return tenantId;
  }

  async function insert(
    operation: string,
    text: string,
    values: readonly unknown[],
  ): Promise<KnowledgeCurrencyStoreResult<void>> {
    const outcome = await policy.run({
      operation,
      // Append-only writes are idempotent in the substrate but never
      // transport-retried (J-045 write posture).
      maxAttempts: 1,
      call: async () => {
        await client.query(text, values);
        return undefined;
      },
    });
    return fromCall(outcome);
  }

  async function selectAll(
    operation: string,
    text: string,
    tenantId: string,
    mapRow: (row: Record<string, unknown>) => unknown,
  ): Promise<KnowledgeCurrencyStoreResult<readonly unknown[]>> {
    const outcome = await policy.run({
      operation,
      call: async () => client.query(text, [tenantId]),
    });
    if (outcome.outcome === "error") return fromCall(outcome);
    const mapped = containMapping(operation.replace(".load", ".map"), () =>
      outcome.value.rows.map(mapRow),
    );
    if (!mapped.ok) return mapped;
    return { ok: true, value: mapped.value, attempts: outcome.attempts, durationMs: outcome.durationMs, mode: outcome.mode };
  }

  return {
    policy,

    async saveSource(source: SourceDeclaration) {
      const mapped = containMapping("knowledge-currency.map_source", () => sourceToRow(source));
      if (!mapped.ok) return mapped;
      const row = mapped.value;
      const saved = await insert(
        "knowledge-currency.save_source",
        `INSERT INTO public.${KNOWLEDGE_SOURCE_TABLE}
          (id, tenant_id, tier, description, evidence_ref, declared_by, declared_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (id, tenant_id) DO NOTHING`,
        [row.id, row.tenant_id, row.tier, row.description, row.evidence_ref, row.declared_by, row.declared_at],
      );
      if (!saved.ok) return saved;
      return { ok: true, value: { id: row.id }, attempts: saved.attempts, durationMs: saved.durationMs, mode: saved.mode };
    },

    async saveDowngrade(act: ReliabilityDowngradeAct) {
      const mapped = containMapping("knowledge-currency.map_downgrade", () => downgradeToRow(act));
      if (!mapped.ok) return mapped;
      const row = mapped.value;
      const saved = await insert(
        "knowledge-currency.save_downgrade",
        `INSERT INTO public.${KNOWLEDGE_DOWNGRADE_TABLE}
          (id, tenant_id, source_id, from_tier, to_tier, downgraded_by, reason, evidence_ref, downgraded_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (id, tenant_id) DO NOTHING`,
        [row.id, row.tenant_id, row.source_id, row.from_tier, row.to_tier, row.downgraded_by, row.reason, row.evidence_ref, row.downgraded_at],
      );
      if (!saved.ok) return saved;
      return { ok: true, value: { id: row.id }, attempts: saved.attempts, durationMs: saved.durationMs, mode: saved.mode };
    },

    async saveContract(contract: FreshnessContract) {
      const mapped = containMapping("knowledge-currency.map_contract", () => contractToRow(contract));
      if (!mapped.ok) return mapped;
      const row = mapped.value;
      const saved = await insert(
        "knowledge-currency.save_contract",
        `INSERT INTO public.${KNOWLEDGE_CONTRACT_TABLE}
          (record_id, tenant_id, source_id, fresh_until, revalidation, revalidate_after_seconds, registered_at, tier_at_registration)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (record_id, tenant_id) DO NOTHING`,
        [row.record_id, row.tenant_id, row.source_id, row.fresh_until, row.revalidation, row.revalidate_after_seconds, row.registered_at, row.tier_at_registration],
      );
      if (!saved.ok) return saved;
      return { ok: true, value: { recordId: row.record_id }, attempts: saved.attempts, durationMs: saved.durationMs, mode: saved.mode };
    },

    async saveInvalidation(act: InvalidationAct) {
      const mapped = containMapping("knowledge-currency.map_invalidation", () => invalidationToRow(act));
      if (!mapped.ok) return mapped;
      const row = mapped.value;
      const saved = await insert(
        "knowledge-currency.save_invalidation",
        `INSERT INTO public.${KNOWLEDGE_INVALIDATION_TABLE}
          (id, tenant_id, record_id, invalidated_by, reason, evidence_ref, invalidated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (tenant_id, record_id) DO NOTHING`,
        [row.id, row.tenant_id, row.record_id, row.invalidated_by, row.reason, row.evidence_ref, row.invalidated_at],
      );
      if (!saved.ok) return saved;
      return { ok: true, value: { id: row.id }, attempts: saved.attempts, durationMs: saved.durationMs, mode: saved.mode };
    },

    async loadSources(tenantId: string) {
      const tenant = requireTenant(tenantId);
      if (tenant == null) {
        return fail("invalid_input", "tenantId is required — the registry never crosses tenants", 0, 0, policy.snapshot().mode);
      }
      const loaded = await selectAll(
        "knowledge-currency.load_sources",
        `SELECT * FROM public.${KNOWLEDGE_SOURCE_TABLE} WHERE tenant_id = $1 ORDER BY declared_at ASC, id ASC`,
        tenant,
        rowToSource,
      );
      return loaded as KnowledgeCurrencyStoreResult<readonly SourceDeclaration[]>;
    },

    async loadContracts(tenantId: string) {
      const tenant = requireTenant(tenantId);
      if (tenant == null) {
        return fail("invalid_input", "tenantId is required — contracts never cross tenants", 0, 0, policy.snapshot().mode);
      }
      const loaded = await selectAll(
        "knowledge-currency.load_contracts",
        `SELECT * FROM public.${KNOWLEDGE_CONTRACT_TABLE} WHERE tenant_id = $1 ORDER BY registered_at ASC, record_id ASC`,
        tenant,
        rowToContract,
      );
      return loaded as KnowledgeCurrencyStoreResult<readonly FreshnessContract[]>;
    },

    async loadInvalidations(tenantId: string) {
      const tenant = requireTenant(tenantId);
      if (tenant == null) {
        return fail("invalid_input", "tenantId is required — acts never cross tenants", 0, 0, policy.snapshot().mode);
      }
      const loaded = await selectAll(
        "knowledge-currency.load_invalidations",
        `SELECT * FROM public.${KNOWLEDGE_INVALIDATION_TABLE} WHERE tenant_id = $1 ORDER BY invalidated_at ASC, id ASC`,
        tenant,
        rowToInvalidation,
      );
      return loaded as KnowledgeCurrencyStoreResult<readonly InvalidationAct[]>;
    },

    async loadDowngrades(tenantId: string) {
      const tenant = requireTenant(tenantId);
      if (tenant == null) {
        return fail("invalid_input", "tenantId is required — acts never cross tenants", 0, 0, policy.snapshot().mode);
      }
      const loaded = await selectAll(
        "knowledge-currency.load_downgrades",
        `SELECT * FROM public.${KNOWLEDGE_DOWNGRADE_TABLE} WHERE tenant_id = $1 ORDER BY downgraded_at ASC, id ASC`,
        tenant,
        rowToDowngrade,
      );
      return loaded as KnowledgeCurrencyStoreResult<readonly ReliabilityDowngradeAct[]>;
    },
  };
}

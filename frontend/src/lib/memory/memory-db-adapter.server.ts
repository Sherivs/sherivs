/**
 * Sherivs — DB-backed memory tier adapter (MISSION V1-005).
 *
 * Persists the durable practical/organizational memory tier into the
 * cg_memory_* tables initially defined in the repository by
 * `database/supabase/migrations/20261002000004_coregrid_v1_memory_tier.sql`:
 *
 *   declareScope → cg_memory_scope       (with declared_by provenance, §12)
 *   writeRecord  → cg_memory_record      (full envelope + bi-temporal columns)
 *   retrieve     → cg_memory_access_log  (append-only; granted AND denied)
 *
 * Security posture (the migration's own law): RLS on cg_memory_* is
 * deny-by-default (enabled, zero policies, no anon/authenticated grants), so
 * this adapter runs on the SERVICE-ROLE client (`client.server.ts`) and the
 * authorization contract — identity AND tenant AND scope AND policy — is
 * enforced exclusively by the pure `memory-store.ts` functions, which every
 * operation runs BEFORE any row is read into contract state or written back.
 * Application code is never the only security layer, and here it is not even
 * an authorization layer (Constitution §17).
 *
 * Provenance (AGENTS §12): every persisted row carries who/when/source —
 * records persist the canonical CoreObject envelope verbatim (created_by,
 * provenance jsonb, trace/correlation/causation ids) plus recorded_at;
 * scopes persist declared_by (declared_at is database record time); the
 * access log persists identity_ref/scope_id/purpose/recorded_at per
 * retrieval. KNOWN GAP, fail-closed: cg_memory_record authors NO subject
 * column, so a write naming a `subjectRef` is REJECTED by this adapter
 * rather than silently losing the field; persisting subject-scoped writes
 * requires a follow-up migration under explicit authorization.
 *
 * Untrusted reads: rows read back from the database are Zod-validated and
 * re-validated through the contract's own envelope/bi-temporal builders
 * before they re-enter `MemoryTierStore` — malformed rows fail the load,
 * they are never coerced.
 *
 * Tenant scoping: scope, record, and access-log queries are tenant-scoped in
 * SQL. Before insertion, access ids are replaced with random UUIDs so
 * concurrent requests cannot collide on a count-derived primary key.
 *
 * Selection: `createMemoryTierAdapter` reads `MEMORY_TIER_BACKEND`
 * ("memory" | "db"); production defaults to and requires "db", while
 * tests/development retain the in-memory fallback.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { validateKernelObjectEnvelope } from "../kernel/reality";
import {
  declareMemoryScope,
  retrieveMemory,
  writeMemoryRecord,
  type MemoryAccessRecord,
  type MemoryExclusionReason,
  type MemoryRetrievalConfig,
  type MemoryRetrievalRequest,
  type MemoryScopeDeclaration,
  type MemoryTierStore,
  type MemoryWriteRequest,
} from "./memory-store";
import {
  createInMemoryMemoryTierAdapter,
  type MemoryScopeDeclareInput,
  type MemoryTierAdapter,
  type MemoryTierBackend,
  type MemoryTierLoadResult,
} from "./memory-adapter";

/**
 * The db adapter runs on the service-role client. Typed as the bare
 * `SupabaseClient` because the generated `Database` types do not include the
 * cg_memory_* tables yet — the same posture as
 * `kernel-admin-client.ts`. The untyped surface is contained here: every row
 * read from the database is Zod-validated before it reaches contract state.
 */
export type MemoryTierDbClient = SupabaseClient;

/* ─────────────────────────────────────────────────────────────
 * Row schemas — the untrusted read boundary (Zod, fail-closed)
 * ────────────────────────────────────────────────────────────*/

const MEMORY_EXCLUSION_REASONS = [
  "tenant_mismatch",
  "outside_declared_scope",
  "exceeds_declared_sensitivity",
  "permission_denied",
  "stale",
  "validity_expired",
  "superseded",
  "item_budget",
  "outside_binding_namespace",
  "binding_tier_not_readable",
] as const satisfies readonly MemoryExclusionReason[];

const memoryExclusionSchema = z.object({
  recordId: z.string().min(1).max(160),
  tenantId: z.string().min(1).max(128),
  reason: z.enum(MEMORY_EXCLUSION_REASONS),
  detail: z.string(),
  requiredPermission: z.string().max(200).nullable(),
  recordedAt: z.string().min(1),
});

const memoryScopeRowSchema = z.object({
  id: z.string().min(1).max(160),
  tenant_id: z.string().min(1).max(128),
  mission_ref: z.string().max(200).nullable(),
  actor_scope: z.array(z.string().min(1).max(160)),
  domains: z.array(z.string().min(1).max(128)),
  max_sensitivity: z.enum(["public", "internal", "restricted"]),
  declared_by: z.string().min(1).max(160),
  declared_at: z.string().min(1),
});

const memoryProvenanceSchema = z.object({
  source: z.string().min(1).max(200),
  sourceRef: z.string().max(500).nullable().optional(),
  recordedBy: z.string().max(160).nullable().optional(),
  originTenantId: z.string().max(128).nullable().optional(),
  generatedByAi: z.boolean().optional(),
  verified: z.boolean().optional(),
});

const memoryRecordRowSchema = z.object({
  id: z.string().min(1).max(160),
  tenant_id: z.string().min(1).max(128),
  scope_id: z.string().min(1).max(160),
  mission_ref: z.string().max(200).nullable(),
  memory_class: z.enum(["practical", "organizational"]),
  domain: z.string().min(1).max(128),
  content: z.string().min(1).max(100000),
  sensitivity: z.enum(["public", "internal", "restricted"]),
  required_permission: z.string().max(200).nullable(),
  freshness_at: z.string().min(1),
  recorded_at: z.string().min(1),
  // Canonical CoreObject envelope columns (V1CAP-002), authored natively.
  object_type: z.string().min(1).max(128),
  schema_version: z.string().regex(/^\d+\.\d+$/),
  status: z.enum(["draft", "active", "suspended", "archived", "deleted"]),
  created_by: z.string().min(1).max(160),
  updated_by: z.string().min(1).max(160),
  provenance: memoryProvenanceSchema,
  policy_context: z.record(z.string(), z.unknown()),
  trace_id: z.string().min(1).max(200),
  correlation_id: z.string().min(1).max(200),
  causation_id: z.string().max(200).nullable(),
  parent_event_id: z.string().max(200).nullable(),
  declared_origin: z.string().max(200).nullable(),
  // Bi-temporal validity (V1CAP-004).
  valid_from: z.string().nullable(),
  valid_until: z.string().nullable(),
  valid_time_known: z.boolean(),
  supersedes: z.string().max(160).nullable(),
});

const memoryAccessLogRowSchema = z.object({
  id: z.string().min(1).max(160),
  tenant_id: z.string().max(128).nullable(),
  identity_ref: z.string().max(160).nullable(),
  scope_id: z.string().max(160).nullable(),
  purpose: z.string(),
  outcome: z.enum(["granted", "partial", "denied"]),
  returned_record_ids: z.array(z.string().min(1).max(160)),
  exclusions: z.array(memoryExclusionSchema),
  denial_reason: z.string().nullable(),
  recorded_at: z.string().min(1),
});

type MemoryScopeRow = z.infer<typeof memoryScopeRowSchema>;
type MemoryRecordRow = z.infer<typeof memoryRecordRowSchema>;
type MemoryAccessLogRow = z.infer<typeof memoryAccessLogRowSchema>;

/* ─────────────────────────────────────────────────────────────
 * Row ↔ contract mappers
 * ────────────────────────────────────────────────────────────*/

function scopeFromRow(row: MemoryScopeRow): MemoryScopeDeclaration {
  return {
    scopeId: row.id,
    tenantId: row.tenant_id,
    missionRef: row.mission_ref,
    actorScope: row.actor_scope,
    domains: row.domains,
    maxSensitivity: row.max_sensitivity,
  };
}

function recordFromRow(row: MemoryRecordRow) {
  // Re-validate through the contract's own fail-closed envelope builder — a
  // row that cannot satisfy the envelope law never re-enters the store.
  const envelope = validateKernelObjectEnvelope({
    objectType: row.object_type,
    schemaVersion: row.schema_version,
    status: row.status,
    createdBy: row.created_by,
    updatedBy: row.updated_by,
    provenance: row.provenance,
    policyContext: row.policy_context,
    traceId: row.trace_id,
    correlationId: row.correlation_id,
    causationId: row.causation_id,
    parentEventId: row.parent_event_id,
    declaredOrigin: row.declared_origin,
  });
  return {
    id: row.id,
    tenantId: row.tenant_id,
    scopeId: row.scope_id,
    missionRef: row.mission_ref,
    memoryClass: row.memory_class,
    domain: row.domain,
    // No subject column is authored on cg_memory_record (see module header);
    // subject-named writes are rejected on the write path, so null is exact.
    subjectRef: null,
    content: row.content,
    sensitivity: row.sensitivity,
    requiredPermission: row.required_permission,
    freshnessAt: row.freshness_at,
    recordedAt: row.recorded_at,
    biTemporal: {
      valid_from: row.valid_from,
      valid_until: row.valid_until,
      valid_time_known: row.valid_time_known,
      supersedes: row.supersedes,
    },
    envelope,
  };
}

function accessRecordFromRow(row: MemoryAccessLogRow): MemoryAccessRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    identityRef: row.identity_ref,
    scopeId: row.scope_id,
    purpose: row.purpose,
    outcome: row.outcome,
    returnedRecordIds: row.returned_record_ids,
    exclusions: row.exclusions.map((exclusion) => ({ ...exclusion })),
    denialReason: row.denial_reason,
    recordedAt: row.recorded_at,
  };
}

/* ─────────────────────────────────────────────────────────────
 * DB-backed adapter
 * ────────────────────────────────────────────────────────────*/

type MemoryTierTable = "cg_memory_scope" | "cg_memory_record" | "cg_memory_access_log";

function persistenceFailed(table: MemoryTierTable, error: { message: string }): Error {
  return new Error(`memory tier persistence failed for ${table}: ${error.message}`);
}

function loadFailed(table: MemoryTierTable, error: { message: string }): Error {
  return new Error(`memory tier load failed for ${table}: ${error.message}`);
}

function parseRows<Row>(schema: z.ZodType<Row>, rows: unknown[], table: MemoryTierTable): Row[] {
  const parsed = schema.array().safeParse(rows);
  if (!parsed.success) {
    throw new Error(`memory tier row validation failed for ${table}: ${parsed.error.message}`);
  }
  return parsed.data;
}

export function createDbMemoryTierAdapter(client: MemoryTierDbClient): MemoryTierAdapter {
  async function selectRows(table: MemoryTierTable, tenantId: string | null): Promise<unknown[]> {
    const query = client.from(table).select("*");
    const result = tenantId == null ? await query : await query.eq("tenant_id", tenantId);
    if (result.error) throw loadFailed(table, result.error);
    return (result.data ?? []) as unknown[];
  }

  async function insertRow(table: MemoryTierTable, row: Record<string, unknown>): Promise<void> {
    const result = await client.from(table).insert(row);
    if (result.error) throw persistenceFailed(table, result.error);
  }

  async function loadStore(tenantId: string | null): Promise<MemoryTierStore> {
    const scopeRows = parseRows<MemoryScopeRow>(
      memoryScopeRowSchema,
      await selectRows("cg_memory_scope", tenantId),
      "cg_memory_scope",
    );
    const recordRows = parseRows<MemoryRecordRow>(
      memoryRecordRowSchema,
      await selectRows("cg_memory_record", tenantId),
      "cg_memory_record",
    );
    // Keep audit history tenant-scoped just like scopes and records; database
    // primary-key uniqueness is provided by random UUIDs on each new audit.
    const accessLogRows = parseRows<MemoryAccessLogRow>(
      memoryAccessLogRowSchema,
      await selectRows("cg_memory_access_log", tenantId),
      "cg_memory_access_log",
    );
    return {
      scopes: scopeRows.map(scopeFromRow),
      records: recordRows.map(recordFromRow),
      accessLog: accessLogRows.map(accessRecordFromRow),
      // No cg_memory_* substrate is authored for worker memory sessions
      // (J-007/V1CAP-016); session state remains in-contract only.
      workerSessions: [],
      sessionAuditLog: [],
    };
  }

  return {
    backend: "db",
    async load(): Promise<MemoryTierLoadResult> {
      try {
        return { ok: true, store: await loadStore(null) };
      } catch (error) {
        return { ok: false, error: (error as Error).message };
      }
    },

    async declareScope(input: MemoryScopeDeclareInput) {
      if (!isRef(input.declaredBy, 160)) {
        return { ok: false as const, error: "memory scope declaredBy must be 1–160 characters" };
      }
      const store = await loadStore(input.scope.tenantId);
      const result = declareMemoryScope(store, input.scope);
      if (!result.ok) return result;
      await insertRow("cg_memory_scope", {
        id: input.scope.scopeId,
        tenant_id: input.scope.tenantId,
        mission_ref: input.scope.missionRef,
        actor_scope: [...input.scope.actorScope],
        domains: [...input.scope.domains],
        max_sensitivity: input.scope.maxSensitivity,
        // Provenance (§12): who declared the scope. declared_at is database
        // record time (column default) — never backdated by this adapter.
        declared_by: input.declaredBy.trim(),
      });
      return result;
    },

    async writeRecord(request: MemoryWriteRequest) {
      if (request.subjectRef != null) {
        return {
          ok: false as const,
          error: `memory record "${request.recordId}" names a subjectRef, but cg_memory_record authors no subject column — persisting it would silently lose provenance (AGENTS §12). Rejected fail-closed; a follow-up migration must author the column first.`,
        };
      }
      const store = await loadStore(request.tenantId);
      const result = writeMemoryRecord(store, request);
      if (!result.ok) return result;
      const record = result.record;
      await insertRow("cg_memory_record", {
        id: record.id,
        tenant_id: record.tenantId,
        scope_id: record.scopeId,
        mission_ref: record.missionRef,
        memory_class: record.memoryClass,
        domain: record.domain,
        content: record.content,
        sensitivity: record.sensitivity,
        required_permission: record.requiredPermission,
        freshness_at: record.freshnessAt,
        recorded_at: record.recordedAt,
        object_type: record.envelope.object_type,
        schema_version: record.envelope.schema_version,
        status: record.envelope.status,
        created_by: record.envelope.created_by,
        updated_by: record.envelope.updated_by,
        provenance: record.envelope.provenance,
        policy_context: record.envelope.policy_context,
        trace_id: record.envelope.trace_id,
        correlation_id: record.envelope.correlation_id,
        causation_id: record.envelope.causation_id,
        parent_event_id: record.envelope.parent_event_id,
        declared_origin: record.envelope.declared_origin,
        valid_from: record.biTemporal.valid_from,
        valid_until: record.biTemporal.valid_until,
        valid_time_known: record.biTemporal.valid_time_known,
        supersedes: record.biTemporal.supersedes,
      });
      return result;
    },

    async retrieve(request: MemoryRetrievalRequest, config: MemoryRetrievalConfig) {
      const store = await loadStore(request.tenantId);
      const result = retrieveMemory(store, request, config);
      // The access record is mandatory audit (Constitution §12/§29): granted,
      // partial AND denied attempts are persisted before anything is returned.
      // A failed audit persist fails retrieval CLOSED — no record is served
      // without its audit trail.
      const access = { ...result.accessRecord, id: `mem-access-${randomUUID()}` };
      const auditedResult = {
        ...result,
        accessRecord: access,
        store: {
          ...result.store,
          accessLog: [...result.store.accessLog.slice(0, -1), access],
        },
      };
      await insertRow("cg_memory_access_log", {
        id: access.id,
        tenant_id: access.tenantId,
        identity_ref: access.identityRef,
        scope_id: access.scopeId,
        purpose: access.purpose,
        outcome: access.outcome,
        returned_record_ids: [...access.returnedRecordIds],
        exclusions: access.exclusions.map((exclusion) => ({ ...exclusion })),
        denial_reason: access.denialReason,
        recorded_at: access.recordedAt,
      });
      return auditedResult;
    },
  };
}

/** Mirrors the memory contract's ref grammar (1–bound characters, trimmed). */
function isRef(value: unknown, maxLength: number): value is string {
  if (typeof value !== "string") return false;
  const trimmed = value.trim();
  return trimmed.length >= 1 && trimmed.length <= maxLength;
}

/* ─────────────────────────────────────────────────────────────
 * Backend selection (environment-driven; in-memory is the fallback)
 * ────────────────────────────────────────────────────────────*/

const MEMORY_TIER_BACKENDS = ["memory", "db"] as const;
const backendSchema = z.enum(MEMORY_TIER_BACKENDS);

/**
 * Resolve the configured backend. Empty/unset resolves to "db" in production
 * and "memory" elsewhere; an unknown value throws rather than silently
 * degrading durability.
 */
export function resolveMemoryTierBackend(
  raw: string | null | undefined,
  environment = process.env.NODE_ENV,
): MemoryTierBackend {
  const value = (raw ?? "").trim() || (environment === "production" ? "db" : "memory");
  const parsed = backendSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `MEMORY_TIER_BACKEND "${value}" is not a registered memory tier backend (${MEMORY_TIER_BACKENDS.join(" | ")})`,
    );
  }
  if (environment === "production" && parsed.data !== "db") {
    throw new Error('MEMORY_TIER_BACKEND must be "db" in production');
  }
  return parsed.data;
}

/**
 * Build the configured memory tier adapter. "memory" (default) returns the
 * in-process fallback; "db" returns the service-role cg_memory_* adapter.
 */
export async function createMemoryTierAdapter(): Promise<MemoryTierAdapter> {
  const backend = resolveMemoryTierBackend(process.env.MEMORY_TIER_BACKEND);
  if (backend === "db") {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return createDbMemoryTierAdapter(supabaseAdmin);
  }
  return createInMemoryMemoryTierAdapter();
}

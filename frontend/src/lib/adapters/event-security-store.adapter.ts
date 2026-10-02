/**
 * CoreGrid — DB-backed substrate adapter for the per-event security contract
 * (V1CAP-044 / J-022 / MISSION-R-81), persisting kernel/event-security.ts
 * contracts and gate audit records into the tables authored by
 * database/supabase/migrations/20261002000006_coregrid_v1_event_security.sql.
 *
 * Composition, not rewrite: the pure contract stays untouched — this adapter
 * maps SecuredEvent contracts, EventDenialRecords and EventRedactionRecords
 * onto their substrate rows and is the ONLY place vendor/DB calls appear
 * (Constitution §24/§25). Service-role access only: the tables are zero-policy
 * deny-by-default (RLS enabled, all anon/authenticated privileges revoked).
 *
 * Failure semantics (J-045): all I/O runs through AdapterFailurePolicy.run
 * (bounded timeout, retry caps, breaker, degraded mode events, trust ledger);
 * mapping/validation are local operations and run through containSync —
 * malformed contract data or malformed DB rows become structured errors,
 * never thrown. Writes are append-only, idempotent (ON CONFLICT DO NOTHING /
 * deterministic ids) and never transport-retried (maxAttempts: 1); reads may
 * retry (idempotent).
 *
 * Tenant law: a persisted contract is tenant-bound — a tenant-less event is
 * anonymous at the tenancy boundary and undeliverable to everyone, so saving
 * one is refused with a structured error (never defaulted). Denial rows admit
 * a null tenant only when the record itself carried one (pre-resolution
 * denials are still audited). Purity: no wall-clock sampling — audit instants
 * are supplied. No credentials, no secret values, no sensitive payload
 * logging (Constitution §29).
 */
import { createHash } from "node:crypto";
import { createAdapterFailurePolicy, type AdapterCallResult, type AdapterFailurePolicy, type AdapterMode } from "./failure-policy";
import { canonicalJson, eventDedupDigest, type KernelEventRecord } from "../kernel/event-semantics";
import type {
  EventDenialReason,
  EventDenialRecord,
  EventRedactionRecord,
  EventSecurityContract,
  EventSensitivity,
  EventVisibilityScope,
} from "../kernel/event-security";

/* ─────────────────────────────────────────────────────────────
 * Injected service-role client (minimal surface; no credentials here)
 * ────────────────────────────────────────────────────────────*/

export interface EventSecurityDbClient {
  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: readonly Record<string, unknown>[] }>;
}

export const EVENT_SECURITY_TABLE = "cg_event_security";
export const EVENT_SECURITY_DENIAL_TABLE = "cg_event_security_denial";
export const EVENT_SECURITY_REDACTION_TABLE = "cg_event_security_redaction";

/**
 * Declared failure-semantics policy for the event-security substrate (J-045).
 * Callers may inject their own instance via EventSecurityStoreConfig.
 */
export const EVENT_SECURITY_FAILURE_POLICY: AdapterFailurePolicy = createAdapterFailurePolicy({
  provider: "cg-substrate-event-security",
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

export type EventSecurityStoreErrorCode =
  | "invalid_input"
  | "tenant_required"
  | "timeout"
  | "provider_error"
  | "breaker_open";

export type EventSecurityStoreResult<T> =
  | { ok: true; value: T; attempts: number; durationMs: number; mode: AdapterMode }
  | {
      ok: false;
      code: EventSecurityStoreErrorCode;
      reason: string;
      attempts: number;
      durationMs: number;
      mode: AdapterMode;
    };

/** Structured failure with full call observability (AdapterCallError parity). */
function fail<T>(
  code: EventSecurityStoreErrorCode,
  reason: string,
  attempts: number,
  durationMs: number,
  mode: AdapterMode,
): EventSecurityStoreResult<T> {
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

function stringArray(value: unknown, key: string): readonly string[] {
  const parsed = typeof value === "string" ? safeParse(value, key) : value;
  if (!Array.isArray(parsed) || parsed.some((entry) => typeof entry !== "string")) {
    throw new MappingError(`${key} must be an array of strings`);
  }
  return Object.freeze([...(parsed as string[])]);
}

function safeParse(value: string, key: string): unknown {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new MappingError(`${key} is not valid JSON`);
  }
}

/** Mirror of the private `eventIdOf` convention in event-semantics. */
export function eventRefOf(event: KernelEventRecord): string {
  return event.id?.trim() || `digest:${eventDedupDigest(event).slice(0, 16)}`;
}

function denyRef(digestInput: unknown): string {
  return createHash("sha256").update(canonicalJson(digestInput)).digest("hex").slice(0, 32);
}

/* ─────────────────────────────────────────────────────────────
 * Contract <-> DB row mapping
 * ────────────────────────────────────────────────────────────*/

export interface EventSecurityRow {
  readonly id: string;
  readonly tenant_id: string;
  readonly event_ref: string;
  readonly issuer_id: string;
  readonly issuance_at: string;
  readonly issuance_at_ms: number;
  readonly issuance_sequence: number;
  readonly issuance_issuer: string;
  readonly digest: string;
  readonly previous_digest: string | null;
  readonly visibility: string;
  readonly emission_authority: string;
  readonly sensitivity: string;
  readonly subject_refs: string;
  readonly redactable_fields: string;
  readonly evidence_class: string;
  readonly source: string;
  readonly recorded_at: string;
}

export interface SecuredEventLike {
  readonly event: KernelEventRecord;
  readonly security: EventSecurityContract;
}

/**
 * Map a secured event onto the substrate contract row. The event must be
 * tenant-bound: a tenant-less event is anonymous at the tenancy boundary and
 * cannot carry a persisted contract.
 */
export function securityToRow(secured: SecuredEventLike, recordedAt: string): EventSecurityRow {
  const tenantId = secured.event.tenant_id?.trim() ?? "";
  if (tenantId === "") {
    throw new MappingError(
      "event tenant_id is required — a tenant-less event is anonymous at the tenancy boundary and undeliverable to everyone",
    );
  }
  const eventRef = eventRefOf(secured.event);
  const issuance = secured.security.authenticity.issuance;
  const instant = secured.event.occurred_at ?? secured.event.recorded_at;
  if (instant == null || issuance.at !== instant) {
    throw new MappingError(
      "issuance coordinates do not verify against the event's own instant — secure the event through secureEvent first",
    );
  }
  if (Number.isNaN(Date.parse(recordedAt))) {
    throw new MappingError("recordedAt must be a valid ISO-8601 audit instant");
  }
  return {
    id: `esec:${secured.security.authenticity.digest}`,
    tenant_id: tenantId,
    event_ref: eventRef,
    issuer_id: secured.security.authenticity.issuerId,
    issuance_at: issuance.at,
    issuance_at_ms: issuance.atMs,
    issuance_sequence: issuance.sequence,
    issuance_issuer: issuance.issuer,
    digest: secured.security.authenticity.digest,
    previous_digest: secured.security.authenticity.previousDigest,
    visibility: secured.security.authorization.visibility,
    emission_authority: secured.security.authorization.emissionAuthority,
    sensitivity: secured.security.privacy.sensitivity,
    subject_refs: JSON.stringify(secured.security.privacy.subjectRefs),
    redactable_fields: JSON.stringify(secured.security.privacy.redactableFields),
    evidence_class: secured.security.provenance.evidenceClass,
    source: secured.security.provenance.source,
    recorded_at: recordedAt,
  };
}

/** DB row -> the persisted security contract view. */
export interface PersistedEventSecurity {
  readonly tenant_id: string;
  readonly event_ref: string;
  readonly issuer_id: string;
  readonly issuance: { readonly at: string; readonly atMs: number; readonly sequence: number; readonly issuer: string };
  readonly digest: string;
  readonly previous_digest: string | null;
  readonly visibility: EventVisibilityScope;
  readonly emission_authority: string;
  readonly sensitivity: EventSensitivity;
  readonly subject_refs: readonly string[];
  readonly redactable_fields: readonly string[];
  readonly evidence_class: string;
  readonly source: string;
  readonly recorded_at: string;
}

export function rowToEventSecurity(row: Record<string, unknown>): PersistedEventSecurity {
  if (!isRecord(row)) throw new MappingError("security row must be a JSON object");
  const atMsRaw = row["issuance_at_ms"];
  const sequenceRaw = row["issuance_sequence"];
  if (typeof atMsRaw !== "number" || !Number.isFinite(atMsRaw)) throw new MappingError("issuance_at_ms must be a number");
  if (typeof sequenceRaw !== "number" || !Number.isInteger(sequenceRaw)) throw new MappingError("issuance_sequence must be an integer");
  return {
    tenant_id: requireString(row, "tenant_id", 128),
    event_ref: requireString(row, "event_ref", 200),
    issuer_id: requireString(row, "issuer_id", 200),
    issuance: {
      at: requireString(row, "issuance_at", 128),
      atMs: atMsRaw,
      sequence: sequenceRaw,
      issuer: requireString(row, "issuance_issuer", 200),
    },
    digest: requireDigest(row, "digest"),
    previous_digest: optionalDigest(row, "previous_digest"),
    visibility: requireVocab(row, "visibility", ["public", "tenant", "restricted", "direct-observation"]) as EventVisibilityScope,
    emission_authority: requireString(row, "emission_authority", 200),
    sensitivity: requireVocab(row, "sensitivity", ["public", "internal", "restricted"]) as EventSensitivity,
    subject_refs: stringArray(row["subject_refs"], "subject_refs"),
    redactable_fields: stringArray(row["redactable_fields"], "redactable_fields"),
    evidence_class: requireVocab(row, "evidence_class", ["observed", "reported", "inferred", "predicted", "simulated"]),
    source: requireString(row, "source", 200),
    recorded_at: timestampString(row["recorded_at"], "recorded_at") ?? requireString(row, "recorded_at", 64),
  };
}

function requireDigest(row: Record<string, unknown>, key: string): string {
  const value = requireString(row, key, 64);
  if (!/^[0-9a-f]{64}$/.test(value)) throw new MappingError(`${key} must be a SHA-256 hex digest`);
  return value;
}

function optionalDigest(row: Record<string, unknown>, key: string): string | null {
  const raw = row[key];
  if (raw == null) return null;
  const value = requireString(row, key, 64);
  if (!/^[0-9a-f]{64}$/.test(value)) throw new MappingError(`${key} must be a SHA-256 hex digest`);
  return value;
}

function requireVocab(row: Record<string, unknown>, key: string, vocab: readonly string[]): string {
  const value = requireString(row, key, 64);
  if (!vocab.includes(value)) throw new MappingError(`${key} "${value}" is not in the declared vocabulary`);
  return value;
}

/** Contract denial record -> audit row (deterministic id, idempotent). */
export interface EventSecurityDenialRow {
  readonly id: string;
  readonly tenant_id: string | null;
  readonly event_ref: string;
  readonly subscriber_id: string | null;
  readonly reason: EventDenialReason;
  readonly detail: string;
  readonly recorded_at: string;
}

export function denialToRow(denial: EventDenialRecord): EventSecurityDenialRow {
  if (Number.isNaN(Date.parse(denial.recordedAt))) {
    throw new MappingError("denial recordedAt must be a valid ISO-8601 audit instant");
  }
  return {
    id: `eden:${denyRef(denial)}`,
    tenant_id: denial.tenantId?.trim() || null,
    event_ref: denial.eventId.trim(),
    subscriber_id: denial.subscriberId.trim() || null,
    reason: denial.reason,
    detail: denial.detail,
    recorded_at: denial.recordedAt,
  };
}

/** Contract redaction record -> audit row (tenant-bound, deterministic id). */
export function redactionToRow(
  redaction: EventRedactionRecord,
  tenantId: string,
): Record<string, string> {
  if (tenantId.trim() === "") {
    throw new MappingError("tenantId is required — redaction audit is tenant-bound");
  }
  if (Number.isNaN(Date.parse(redaction.recordedAt))) {
    throw new MappingError("redaction recordedAt must be a valid ISO-8601 audit instant");
  }
  return {
    id: `ered:${denyRef(redaction)}`,
    tenant_id: tenantId.trim(),
    event_ref: redaction.eventId.trim(),
    subscriber_id: redaction.subscriberId.trim(),
    reason: redaction.reason,
    withheld_fields: JSON.stringify(redaction.withheldFields),
    withheld_subject_refs: JSON.stringify(redaction.withheldSubjectRefs),
    detail: redaction.detail,
    recorded_at: redaction.recordedAt,
  };
}

/* ─────────────────────────────────────────────────────────────
 * The adapter
 * ────────────────────────────────────────────────────────────*/

export interface EventSecurityStoreConfig {
  client: EventSecurityDbClient;
  /** J-045: declared adapter failure policy; defaulted when omitted. */
  failurePolicy?: AdapterFailurePolicy;
}

export interface EventSecurityStore {
  /** Append one persisted security contract. Idempotent, never retried. */
  saveEventSecurity(input: { readonly secured: SecuredEventLike; readonly recordedAt: string }): Promise<EventSecurityStoreResult<{ id: string; event_ref: string }>>;
  /** Load the persisted contract of one event within a tenant. */
  loadEventSecurity(tenantId: string, eventRef: string): Promise<EventSecurityStoreResult<PersistedEventSecurity | null>>;
  /** Append one gate denial audit row. Idempotent, never retried. */
  saveEventSecurityDenial(denial: EventDenialRecord): Promise<EventSecurityStoreResult<{ id: string }>>;
  /** Append one gate redaction audit row. Idempotent, never retried. */
  saveEventSecurityRedaction(input: { readonly redaction: EventRedactionRecord; readonly tenantId: string }): Promise<EventSecurityStoreResult<{ id: string }>>;
  /** Load denial audit rows for a tenant (or all tenants when omitted). */
  loadDenials(tenantId?: string): Promise<EventSecurityStoreResult<readonly Record<string, unknown>[]>>;
  /** Load redaction audit rows for a tenant. */
  loadRedactions(tenantId: string): Promise<EventSecurityStoreResult<readonly Record<string, unknown>[]>>;
  /** The declared failure policy (observability: snapshot, trust ledger). */
  readonly policy: AdapterFailurePolicy;
}

const DENIAL_COLUMNS =
  "(id, tenant_id, event_ref, subscriber_id, reason, detail, recorded_at)";

const REDACTION_COLUMNS =
  "(id, tenant_id, event_ref, subscriber_id, reason, withheld_fields, withheld_subject_refs, detail, recorded_at)";

export function createEventSecurityStore(config: EventSecurityStoreConfig): EventSecurityStore {
  const policy = config.failurePolicy ?? EVENT_SECURITY_FAILURE_POLICY;
  const client = config.client;

  function containMapping<T>(operation: string, fn: () => T): EventSecurityStoreResult<T> {
    const contained = policy.containSync(operation, fn);
    if (contained.outcome === "ok") {
      return { ok: true, value: contained.value, attempts: contained.attempts, durationMs: contained.durationMs, mode: contained.mode };
    }
    return fail("invalid_input", contained.reason, contained.attempts, contained.durationMs, contained.mode);
  }

  function fromCall<T>(outcome: AdapterCallResult<T>): EventSecurityStoreResult<T> {
    if (outcome.outcome === "ok") {
      return { ok: true, value: outcome.value, attempts: outcome.attempts, durationMs: outcome.durationMs, mode: outcome.mode };
    }
    return fail(outcome.code, outcome.reason, outcome.attempts, outcome.durationMs, outcome.mode);
  }

  return {
    policy,

    async saveEventSecurity(input) {
      if ((input.secured.event.tenant_id?.trim() ?? "") === "") {
        return fail(
          "tenant_required",
          "event tenant_id is required — a tenant-less event is anonymous at the tenancy boundary and undeliverable to everyone",
          0,
          0,
          policy.snapshot().mode,
        );
      }
      const mapped = containMapping("event_security.map_contract", () =>
        securityToRow(input.secured, input.recordedAt),
      );
      if (!mapped.ok) return mapped;
      const row = mapped.value;
      const outcome = await policy.run({
        operation: "event_security.save_contract",
        maxAttempts: 1,
        call: async () => {
          await client.query(
            `INSERT INTO public.${EVENT_SECURITY_TABLE}
              (id, tenant_id, event_ref, issuer_id, issuance_at, issuance_at_ms, issuance_sequence,
               issuance_issuer, digest, previous_digest, visibility, emission_authority, sensitivity,
               subject_refs, redactable_fields, evidence_class, source, recorded_at)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
             ON CONFLICT (tenant_id, event_ref) DO NOTHING`,
            [
              row.id, row.tenant_id, row.event_ref, row.issuer_id, row.issuance_at, row.issuance_at_ms,
              row.issuance_sequence, row.issuance_issuer, row.digest, row.previous_digest,
              row.visibility, row.emission_authority, row.sensitivity, row.subject_refs,
              row.redactable_fields, row.evidence_class, row.source, row.recorded_at,
            ],
          );
          return { id: row.id, event_ref: row.event_ref };
        },
      });
      return fromCall(outcome);
    },

    async loadEventSecurity(tenantId, eventRef) {
      if (tenantId.trim() === "" || eventRef.trim() === "") {
        return fail("invalid_input", "tenantId and eventRef are required", 0, 0, policy.snapshot().mode);
      }
      const outcome = await policy.run({
        operation: "event_security.load_contract",
        call: async () =>
          client.query(
            `SELECT * FROM public.${EVENT_SECURITY_TABLE} WHERE tenant_id = $1 AND event_ref = $2`,
            [tenantId, eventRef],
          ),
      });
      if (outcome.outcome === "error") return fromCall(outcome);
      const mapped = containMapping("event_security.map_contract_row", () => {
        const first = outcome.value.rows[0];
        return first == null ? null : rowToEventSecurity(first);
      });
      if (!mapped.ok) return mapped;
      return { ok: true, value: mapped.value, attempts: outcome.attempts, durationMs: outcome.durationMs, mode: outcome.mode };
    },

    async saveEventSecurityDenial(denial) {
      const mapped = containMapping("event_security.map_denial", () => denialToRow(denial));
      if (!mapped.ok) return mapped;
      const row = mapped.value;
      const outcome = await policy.run({
        operation: "event_security.save_denial",
        maxAttempts: 1,
        call: async () => {
          await client.query(
            `INSERT INTO public.${EVENT_SECURITY_DENIAL_TABLE} ${DENIAL_COLUMNS}
             VALUES ($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT (id) DO NOTHING`,
            [row.id, row.tenant_id, row.event_ref, row.subscriber_id, row.reason, row.detail, row.recorded_at],
          );
          return { id: row.id };
        },
      });
      return fromCall(outcome);
    },

    async saveEventSecurityRedaction(input) {
      const mapped = containMapping("event_security.map_redaction", () =>
        redactionToRow(input.redaction, input.tenantId),
      );
      if (!mapped.ok) return mapped;
      const row = mapped.value;
      const outcome = await policy.run({
        operation: "event_security.save_redaction",
        maxAttempts: 1,
        call: async () => {
          await client.query(
            `INSERT INTO public.${EVENT_SECURITY_REDACTION_TABLE} ${REDACTION_COLUMNS}
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
             ON CONFLICT (id) DO NOTHING`,
            [
              row.id, row.tenant_id, row.event_ref, row.subscriber_id, row.reason,
              row.withheld_fields, row.withheld_subject_refs, row.detail, row.recorded_at,
            ],
          );
          return { id: row.id };
        },
      });
      return fromCall(outcome);
    },

    async loadDenials(tenantId) {
      const scoped = tenantId?.trim() ?? "";
      const outcome = await policy.run({
        operation: "event_security.load_denials",
        call: async () =>
          scoped === ""
            ? client.query(`SELECT * FROM public.${EVENT_SECURITY_DENIAL_TABLE} ORDER BY recorded_at DESC`)
            : client.query(
                `SELECT * FROM public.${EVENT_SECURITY_DENIAL_TABLE} WHERE tenant_id = $1 ORDER BY recorded_at DESC`,
                [scoped],
              ),
      });
      if (outcome.outcome === "error") return fromCall(outcome);
      const rows = outcome.value.rows;
      return { ok: true, value: rows, attempts: outcome.attempts, durationMs: outcome.durationMs, mode: outcome.mode };
    },

    async loadRedactions(tenantId) {
      const scoped = tenantId.trim();
      if (scoped === "") {
        return fail("invalid_input", "tenantId is required", 0, 0, policy.snapshot().mode);
      }
      const outcome = await policy.run({
        operation: "event_security.load_redactions",
        call: async () =>
          client.query(
            `SELECT * FROM public.${EVENT_SECURITY_REDACTION_TABLE} WHERE tenant_id = $1 ORDER BY recorded_at DESC`,
            [scoped],
          ),
      });
      if (outcome.outcome === "error") return fromCall(outcome);
      const rows = outcome.value.rows;
      return { ok: true, value: rows, attempts: outcome.attempts, durationMs: outcome.durationMs, mode: outcome.mode };
    },
  };
}
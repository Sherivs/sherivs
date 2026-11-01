import { randomUUID } from "node:crypto";
import { SystemClock, TimeAuthority } from "../kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

/**
 * Shared server-side write-audit hook (Constitution §27.6 — AUDIT, §12, §29).
 *
 * Every canonical write performed by a Scholar server function that leaves no
 * separate audit record must call this hook after the write succeeds. The
 * record answers the provenance questions of §12/§43:
 *
 *   WHO         — actorId (auth uid, mirrored into the record payload) and/or
 *                 actorEmail (verified identity claim; required when the actor
 *                 has no canonical tenant user row, e.g. control-plane actors)
 *   WHICH       — tenantId (gate-resolved, never client-supplied; null = the
 *                 write is a platform/control-plane scope event)
 *   WHAT        — action + table + recordId
 *   UNDER WHICH — gate (the canonical authorization gate that sanctioned the
 *   GATE          write, e.g. "requireSchoolAdminScope")
 *   WHEN        — recordedAt ISO timestamp (plus the row's created_at default)
 *   OUTCOME     — outcome of the audited operation
 *
 * FAIL-CLOSED: unlike lib/audit.ts (best-effort by contract), this hook
 * THROWS when the audit record cannot be persisted. A canonical write whose
 * audit record fails must surface as a failed operation — it is never
 * silently passed as unwritten. Callers therefore `await` the hook inside
 * the handler so a rejected audit propagates as a server-function error.
 *
 * Domain-neutral (§24): the substrate client is injected by the caller; this
 * module imports no vendor and no runtime domain vocabulary.
 */

/** Outcome of the audited canonical write. */
export type WriteAuditOutcome = "succeeded" | "failed" | "denied";

/** The canonical substrate table that received the audited write. */
export type WriteAuditEntry = {
  /** WHAT — namespaced action code, e.g. "school_settings.update". */
  readonly action: string;
  /** UNDER WHICH GATE — the canonical §27.3 authorization gate that sanctioned the write. */
  readonly gate: string;
  /** WHICH TENANT — gate-resolved tenant id; null declares control-plane scope. */
  readonly tenantId: string | null;
  /** WHO — the authenticated actor's auth uid (written to the user_id column). */
  readonly actorId: string | null;
  /** Actor reference for non-user identities such as governed agents. */
  readonly actorRef?: string | null;
  readonly actorKind?: "human" | "agent" | "system";
  /**
   * WHO — verified identity claim. Required whenever actorId is not backed by
   * a canonical tenant user row (audit_logs.user_id is FK-attributed to
   * public.users; control-plane actors may have none).
   */
  readonly actorEmail?: string | null;
  /** WHAT — the substrate table the canonical write landed on. */
  readonly table: string;
  /** WHAT — the record the canonical write produced or addressed. */
  readonly recordId?: string | null;
  /** OUTCOME of the audited operation. */
  readonly outcome: WriteAuditOutcome;
  /** Reuse a request correlation id when one is available; otherwise one is generated. */
  readonly correlationId?: string;
  /** Allow-listed, non-sensitive state immediately before the action. */
  readonly before?: Record<string, unknown> | null;
  /** Allow-listed, non-sensitive state or proposal immediately after the action. */
  readonly after?: Record<string, unknown> | null;
  /** Non-sensitive context (§29: never secrets, credentials, or tokens). */
  readonly details?: Record<string, unknown>;
};

/**
 * Minimal structural contract of a Supabase-compatible postgrest client.
 * Deliberately loose (`PromiseLike<unknown>`): the resolved postgrest response
 * shape is narrowed inside the hook, so any typed SupabaseClient satisfies
 * this contract without call-site casts.
 */
export interface WriteAuditClient {
  from(table: string): {
    insert(payload: Record<string, unknown>): PromiseLike<unknown>;
  };
}

export type WriteAuditResult = {
  /** The `audit_logs` row id, when the substrate returned one. */
  readonly recordId: string | null;
};

export async function writeAuditRecord(
  client: WriteAuditClient,
  entry: WriteAuditEntry,
): Promise<WriteAuditResult> {
  if (!entry.actorId && !entry.actorEmail && !entry.actorRef) {
    throw new Error(
      `write-audit: refusing to persist an unattributed write ("${entry.action}" under ${entry.gate}) — WHO is mandatory`,
    );
  }
  if (entry.tenantId === undefined) {
    throw new Error(
      `write-audit: tenant scope must be declared explicitly ("${entry.action}") — pass the gate-resolved tenant id or null for control-plane scope`,
    );
  }

  const recordedAt = timeAuthority.now().at;
  const correlationId = entry.correlationId?.trim() || randomUUID();
  if (correlationId.length > 200) {
    throw new Error(`write-audit: correlation id is too long ("${entry.action}")`);
  }
  const actorRef = entry.actorRef?.trim() || null;
  if (entry.actorRef && !actorRef) {
    throw new Error(`write-audit: actor reference cannot be empty ("${entry.action}")`);
  }
  if (actorRef && actorRef.length > 200) {
    throw new Error(`write-audit: actor reference is too long ("${entry.action}")`);
  }
  const payload: Record<string, unknown> = {
    school_id: entry.tenantId,
    user_id: entry.actorId,
    action: entry.action,
    table_name: entry.table,
    record_id: entry.recordId ?? null,
    old_value: entry.before ?? null,
    new_value: {
      gate: entry.gate,
      outcome: entry.outcome,
      correlation_id: correlationId,
      actor_kind: entry.actorKind ?? (actorRef ? "agent" : "human"),
      actor_id: entry.actorId,
      actor_email: entry.actorEmail ?? null,
      actor_ref: actorRef,
      recorded_at: recordedAt,
      tenant_id: entry.tenantId,
      after: entry.after ?? null,
      details: entry.details ?? null,
    },
  };

  const result = (await client.from("audit_logs").insert(payload)) as {
    error?: { message: string } | null;
  } | null;
  const message = result?.error?.message;
  if (result?.error) {
    throw new Error(
      `write-audit: audit record rejected for "${entry.action}" (gate ${entry.gate}, outcome ${entry.outcome}): ${message ?? "unknown substrate error"}`,
    );
  }
  return { recordId: null };
}

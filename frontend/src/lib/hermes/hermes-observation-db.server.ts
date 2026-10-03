/**
 * CoreGrid — DB-backed Hermes observation port (HermesObservationPortDb)
 * (V1 remediation wave, team R4 / HERMES-PORT; follow-up of V1-002).
 *
 * Persists the Hermes observation surface into the substrate authored (NOT
 * applied) by
 * `database/supabase/migrations/20261003000030_coregrid_hermes_observation_substrate.sql`:
 *
 *   recordObservation → cg_hermes_observation  (append-only, §12 provenance)
 *   listObservations  → cg_hermes_observation  (tenant-scoped read)
 *
 * Append-only law (§9/§12): the adapter exposes record + list ONLY — no
 * update, no delete. The substrate itself rejects UPDATE/DELETE by trigger
 * and enforces the §9 intelligence-only marking (generated_by_ai = true,
 * verified = false) with database CHECKs. Idempotent replay (§10): a
 * repeated observation id leaves the original row verbatim (replayed:
 * true); event-sourced observations are additionally deduplicated by the
 * substrate's partial unique (tenant_id, event_ref) index.
 *
 * Security posture (the migration's own law): RLS on cg_hermes_observation
 * is deny-by-default (enabled, zero policies, anon/authenticated revoked,
 * service_role only), so this adapter runs on the SERVICE-ROLE client
 * (`client.server.ts`) and tenant scoping is enforced in SQL on every
 * query. Rows read back are Zod-validated — untrusted reads fail closed.
 *
 * Fail-closed on schema gaps: until the observation substrate migration is
 * applied, every operation returns the typed
 * `observation_substrate_missing` failure (HERMES_OBSERVATION_SUBSTRATE_GAP)
 * and writes NOTHING — the port never fakes durability in application code
 * (same posture as the V1-004 lease-substrate gap).
 *
 * Selection: `createHermesObservationPort` reads `HERMES_OBSERVATION_BACKEND`
 * ("memory" | "db"; default and fallback "memory") following the repo's
 * env-selector convention (`MEMORY_TIER_BACKEND`). The in-memory port
 * (`hermes-observation.ts`) is the DEFAULT backend for tests and
 * unconfigured environments; an unknown backend value throws rather than
 * silently degrading durability.
 *
 * Boundary: infrastructure adapter only. No cycle runtime, no host loop
 * (owned by `hermes-cycle.ts`), no event state transition (the cg_event
 * outbox state machine remains the kernel's).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  createInMemoryHermesObservationPort,
  hermesObservationSchema,
  type HermesObservation,
  type HermesObservationListResult,
  type HermesObservationRecordInput,
  type HermesObservationRecordResult,
  type HermesObservationRecorder,
} from "./hermes-observation";

/**
 * The db adapter runs on the service-role client. Typed as the bare
 * `SupabaseClient` because the generated `Database` types lag the AUTHORED
 * (not applied) cg_hermes_observation migration — the same posture as the
 * memory tier db adapter. The untyped surface is contained here: every row
 * read from the database is Zod-validated before it reaches contract state.
 */
export type HermesObservationDbClient = SupabaseClient;

/** The DB-backed HermesObservationPort surface (the same recorder contract). */
export type HermesObservationPortDb = HermesObservationRecorder;

const HERMES_OBSERVATION_TABLE = "cg_hermes_observation" as const;

/* ─────────────────────────────────────────────────────────────
 * The fail-closed schema gap (typed, observable)
 * ────────────────────────────────────────────────────────────*/

export const HERMES_OBSERVATION_SUBSTRATE_GAP =
  "the cg_hermes_observation substrate is absent: migration " +
  "20261003000030_coregrid_hermes_observation_substrate.sql is AUTHORED, NOT " +
  "APPLIED. Observation persistence requires an explicit apply authorization " +
  "(governance law); until then observation operations fail closed and write " +
  "nothing.";

const SCHEMA_GAP_SIGNATURES = [
  "does not exist",
  "could not find the table",
  "pgrst205",
  "schema cache",
] as const;

/** Distinguishes a missing-substrate error from any other persistence error. */
function isSchemaGap(message: string): boolean {
  const lowered = message.toLowerCase();
  return SCHEMA_GAP_SIGNATURES.some((signature) => lowered.includes(signature));
}

function gapFailure(operation: string, message: string): { ok: false; error: string } {
  return {
    ok: false,
    error: `observation_substrate_missing: ${operation} failed closed — ${HERMES_OBSERVATION_SUBSTRATE_GAP} (substrate error: ${message})`,
  };
}

function operationFailed(operation: string, message: string): { ok: false; error: string } {
  return { ok: false, error: `hermes observation ${operation} failed: ${message}` };
}

/* ─────────────────────────────────────────────────────────────
 * Row schema — the untrusted read boundary (Zod, fail-closed)
 * ────────────────────────────────────────────────────────────*/

const observationRowSchema = z
  .object({
    id: z.string().min(1).max(160),
    tenant_id: z.string().min(1).max(128),
    kind: z.enum([
      "mission_observation",
      "worker_observation",
      "verification_observation",
      "event_observation",
    ]),
    subject_ref: z.string().min(1).max(200),
    statement: z.record(z.string(), z.unknown()),
    observed_at: z.string().min(1),
    recorded_at: z.string().min(1),
    source: z.enum(["direct", "event"]),
    event_ref: z.string().min(1).max(200).nullable(),
    trace_id: z.string().min(1).max(200).nullable(),
    correlation_id: z.string().min(1).max(200).nullable(),
    declared_origin: z.string().min(1).max(200),
    created_by: z.string().min(1).max(160),
    // §9 intelligence-only law mirrored from the substrate CHECKs: a row
    // claiming verified state can never re-enter Hermes state.
    generated_by_ai: z.literal(true),
    verified: z.literal(false),
    // Substrate bookkeeping columns (record-time law: database clock).
    created_at: z.string().min(1).optional(),
    updated_at: z.string().min(1).optional(),
  })
  .strict();

type ObservationRow = z.infer<typeof observationRowSchema>;

function rowFromObservation(observation: HermesObservation): Record<string, unknown> {
  return {
    id: observation.observationId,
    tenant_id: observation.tenantId,
    kind: observation.kind,
    subject_ref: observation.subjectRef,
    statement: observation.statement,
    observed_at: observation.observedAt,
    // recorded_at is the DATABASE clock (column default) — never backdated.
    source: observation.source,
    event_ref: observation.eventRef,
    trace_id: observation.traceId,
    correlation_id: observation.correlationId,
    declared_origin: observation.declaredOrigin,
    created_by: observation.recordedBy,
    generated_by_ai: observation.generatedByAi,
    verified: observation.verified,
  };
}

function observationFromRow(row: ObservationRow): HermesObservation {
  return {
    observationId: row.id,
    tenantId: row.tenant_id,
    kind: row.kind,
    subjectRef: row.subject_ref,
    statement: row.statement,
    observedAt: row.observed_at,
    recordedAt: row.recorded_at,
    source: row.source,
    eventRef: row.event_ref,
    traceId: row.trace_id,
    correlationId: row.correlation_id,
    declaredOrigin: row.declared_origin,
    recordedBy: row.created_by,
    generatedByAi: row.generated_by_ai,
    verified: row.verified,
  };
}

/* ─────────────────────────────────────────────────────────────
 * The DB-backed port
 * ────────────────────────────────────────────────────────────*/

export function createHermesObservationPortDb(
  client: HermesObservationDbClient,
): HermesObservationPortDb {
  async function selectRows(tenantId: string): Promise<unknown[]> {
    const result = await client
      .from(HERMES_OBSERVATION_TABLE)
      .select("*")
      .eq("tenant_id", tenantId)
      .order("recorded_at", { ascending: true });
    if (result.error) throw result.error.message;
    return (result.data ?? []) as unknown[];
  }

  async function existingRow(observationId: string, tenantId: string): Promise<boolean> {
    const result = await client
      .from(HERMES_OBSERVATION_TABLE)
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("id", observationId)
      .maybeSingle();
    if (result.error) throw result.error.message;
    return result.data != null;
  }

  return {
    backend: "db",

    async recordObservation(
      input: HermesObservationRecordInput,
    ): Promise<HermesObservationRecordResult> {
      // Validate through the PURE port contract first (the in-memory port's
      // record path owns the same Zod + §12/§9 stamping law): contract
      // rejections never touch the database.
      const inMemory = createInMemoryHermesObservationPort();
      const staged = await inMemory.recordObservation(input);
      if (!staged.ok) return staged;

      // Idempotent replay against the durable substrate: the recorded row is
      // canonical for this observation id (§10) — never rewritten. A
      // concurrent writer's unique win surfaces as 23505 on insert below.
      try {
        if (await existingRow(staged.observationId, input.observation.tenantId)) {
          return { ok: true, observationId: staged.observationId, recorded: false, replayed: true };
        }
      } catch (error) {
        const message = (error as { message?: string }).message ?? String(error);
        if (isSchemaGap(message)) return gapFailure("recordObservation", message);
        return operationFailed("recordObservation", message);
      }

      const listed = await inMemory.listObservations(input.observation.tenantId);
      if (!listed.ok) {
        return operationFailed("recordObservation", `staging read failed: ${listed.error}`);
      }
      const stagedObservation = listed.observations.find(
        (o) => o.observationId === staged.observationId,
      );
      if (stagedObservation === undefined) {
        return operationFailed("recordObservation", "staged observation vanished — failed closed");
      }
      const parsed = hermesObservationSchema.safeParse(stagedObservation);
      if (!parsed.success) {
        return operationFailed("recordObservation", `staged row rejected: ${parsed.error.message}`);
      }

      const insert = await client
        .from(HERMES_OBSERVATION_TABLE)
        .insert(rowFromObservation(parsed.data));
      if (insert.error) {
        const message = insert.error.message;
        // Concurrent-writer race: the substrate's unique constraints (id or
        // the partial (tenant_id, event_ref) index) won — the recorded row
        // stands; this delivery replays (§10), nothing is rewritten.
        if (insert.error.code === "23505") {
          return { ok: true, observationId: staged.observationId, recorded: false, replayed: true };
        }
        if (isSchemaGap(message)) return gapFailure("recordObservation", message);
        return operationFailed("recordObservation", message);
      }
      return { ok: true, observationId: staged.observationId, recorded: true, replayed: false };
    },

    async listObservations(tenantId: string): Promise<HermesObservationListResult> {
      let rows: unknown[];
      try {
        rows = await selectRows(tenantId);
      } catch (error) {
        const message = (error as { message?: string }).message ?? String(error);
        if (isSchemaGap(message)) return gapFailure("listObservations", message);
        return operationFailed("listObservations", message);
      }
      const parsed = observationRowSchema.array().safeParse(rows);
      if (!parsed.success) {
        return operationFailed(
          "listObservations",
          `row validation rejected — ${parsed.error.message}`,
        );
      }
      return { ok: true, observations: parsed.data.map(observationFromRow) };
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Backend selection (environment-driven; in-memory is the fallback)
 * ────────────────────────────────────────────────────────────*/

export const HERMES_OBSERVATION_BACKENDS = ["memory", "db"] as const;
export type HermesObservationBackend = (typeof HERMES_OBSERVATION_BACKENDS)[number];

const hermesObservationBackendSchema = z.enum(HERMES_OBSERVATION_BACKENDS);

/**
 * Resolve the configured backend. Empty/unset resolves to "memory" (the
 * fallback for tests and unconfigured environments); an unknown value throws
 * rather than silently degrading durability.
 */
export function resolveHermesObservationBackend(
  raw: string | null | undefined,
): HermesObservationBackend {
  const value = (raw ?? "").trim() || "memory";
  const parsed = hermesObservationBackendSchema.safeParse(value);
  if (!parsed.success) {
    throw new Error(
      `HERMES_OBSERVATION_BACKEND "${value}" is not a registered Hermes observation backend (${HERMES_OBSERVATION_BACKENDS.join(" | ")})`,
    );
  }
  return parsed.data;
}

/**
 * Build the configured Hermes observation port. "memory" (default) returns
 * the in-process fallback; "db" returns the service-role
 * cg_hermes_observation adapter (HermesObservationPortDb).
 */
export async function createHermesObservationPort(): Promise<HermesObservationRecorder> {
  const backend = resolveHermesObservationBackend(process.env.HERMES_OBSERVATION_BACKEND);
  if (backend === "db") {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    return createHermesObservationPortDb(supabaseAdmin);
  }
  return createInMemoryHermesObservationPort();
}

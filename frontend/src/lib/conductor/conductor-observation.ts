/**
 * Sherivs — Conductor observation contract + in-memory port
 * (V1 remediation wave, team R4 / CONDUCTOR-PORT; follow-up of V1-002).
 *
 * The DURABLE observation surface of the Conductor orchestrator: every
 * observation that arrives at Conductor — from a direct server-function call
 * (`source: "direct"`) or from the event substrate (`source: "event"`,
 * see `conductor-event-source.ts`) — is recorded through ONE governed port as
 * a provenance-stamped, APPEND-ONLY intelligence record.
 *
 * §12 provenance law: every observation answers where it came from
 * (`source`, `eventRef`, `subjectRef`), who/what created it (`recordedBy` —
 * the governed Conductor identity; the port stamps this, callers cannot claim
 * another author), when (valid time `observedAt` vs record time
 * `recordedAt`), and the AI flag (`generatedByAi` — always true here).
 *
 * §9 canonical-truth law: an observation is DERIVED INTELLIGENCE, never
 * canonical truth. The port hard-stamps `verified: false` on every record —
 * an input that tries to claim verified state is REJECTED, never clamped.
 * The state of record lives exclusively in the DB-backed ports of record
 * the observation's `subjectRef` points at.
 *
 * Append-only: the port exposes record + list ONLY. A replayed observation
 * id leaves the original record verbatim (`replayed: true`, exactly-once
 * intent §10); there is no update, no delete, no supersession. The DB-backed
 * implementation (`conductor-observation-db.server.ts`) enforces the same law
 * at the database (append-only trigger + the substrate's own CHECKs).
 *
 * Backend selection: `createConductorObservationPort` (server module) selects
 * "memory" | "db" via `CONDUCTOR_OBSERVATION_BACKEND`; THIS in-memory adapter
 * is the DEFAULT backend — the fallback for tests and unconfigured
 * environments (same posture as the memory tier adapter).
 *
 * Boundary: pure data + Zod + pure logic. The in-memory port holds state
 * but performs no I/O, reads no clock, imports no vendor.
 */

import { z } from "zod";

/* ─────────────────────────────────────────────────────────────
 * Vocabulary
 * ────────────────────────────────────────────────────────────*/

/** Where an observation came from (§12). */
export type ConductorObservationSource = "direct" | "event";

/** Closed observation-kind vocabulary (what was observed). */
export type ConductorObservationKind =
  "mission_observation" | "worker_observation" | "verification_observation" | "event_observation";

export const CONDUCTOR_OBSERVATION_SOURCES: readonly ConductorObservationSource[] = [
  "direct",
  "event",
] as const;

export const CONDUCTOR_OBSERVATION_KINDS: readonly ConductorObservationKind[] = [
  "mission_observation",
  "worker_observation",
  "verification_observation",
  "event_observation",
] as const;

/* ─────────────────────────────────────────────────────────────
 * Records + Zod schemas (everything crossing the trust boundary)
 * ────────────────────────────────────────────────────────────*/

const timestampSchema = z.string().refine((v) => Number.isFinite(Date.parse(v)), {
  message: "must be a parseable timestamp",
});

/**
 * The caller-supplied observation input. NOTE: provenance is NOT input —
 * the port stamps `recordedBy` / `generatedByAi` / `verified` itself
 * (§12: provenance claimed by the caller is not provenance).
 */
export interface ConductorObservationInput {
  /** Deterministic id — the idempotency anchor of the observation. */
  readonly observationId: string;
  readonly tenantId: string;
  readonly kind: ConductorObservationKind;
  /** Stable ref into the state of record this observation is about (§9). */
  readonly subjectRef: string;
  /** The observed claim (JSON object). */
  readonly statement: Record<string, unknown>;
  /** VALID time — when the observed fact was true in reality. */
  readonly observedAt: string;
  readonly source: ConductorObservationSource;
  /** The cg_event coordinate; REQUIRED when source = "event". */
  readonly eventRef: string | null;
  readonly traceId: string | null;
  readonly correlationId: string | null;
  readonly declaredOrigin: string;
}

export const conductorObservationInputSchema = z
  .object({
    observationId: z.string().trim().min(1).max(160),
    tenantId: z.string().trim().min(1).max(128),
    kind: z.enum([
      "mission_observation",
      "worker_observation",
      "verification_observation",
      "event_observation",
    ]),
    subjectRef: z.string().trim().min(1).max(200),
    statement: z.record(z.string(), z.unknown()),
    observedAt: timestampSchema,
    source: z.enum(["direct", "event"]),
    eventRef: z.string().trim().min(1).max(200).nullable(),
    traceId: z.string().trim().min(1).max(200).nullable(),
    correlationId: z.string().trim().min(1).max(200).nullable(),
    declaredOrigin: z.string().trim().min(1).max(200),
  })
  .strict()
  .refine((input) => input.source !== "event" || input.eventRef !== null, {
    message: "an event-sourced observation must cite its event (§12 provenance)",
  });

/** A recorded observation — append-only intelligence (§9), never truth. */
export interface ConductorObservation extends ConductorObservationInput {
  /** RECORD time — when the substrate recorded it (never backdated). */
  readonly recordedAt: string;
  /** §12 who/what: the governed Conductor identity that observed. */
  readonly recordedBy: string;
  /** §12 AI flag — observations arrive through the Conductor AI worker. */
  readonly generatedByAi: true;
  /** §9 canonical-truth marking — an observation is never verified state. */
  readonly verified: false;
}

/** A recorded observation — append-only intelligence (§9), never truth. */
export const conductorObservationSchema = z
  .object({
    observationId: z.string().trim().min(1).max(160),
    tenantId: z.string().trim().min(1).max(128),
    kind: z.enum([
      "mission_observation",
      "worker_observation",
      "verification_observation",
      "event_observation",
    ]),
    subjectRef: z.string().trim().min(1).max(200),
    statement: z.record(z.string(), z.unknown()),
    observedAt: timestampSchema,
    source: z.enum(["direct", "event"]),
    eventRef: z.string().trim().min(1).max(200).nullable(),
    traceId: z.string().trim().min(1).max(200).nullable(),
    correlationId: z.string().trim().min(1).max(200).nullable(),
    declaredOrigin: z.string().trim().min(1).max(200),
    recordedAt: timestampSchema,
    recordedBy: z.string().trim().min(1).max(160),
    generatedByAi: z.literal(true),
    verified: z.literal(false),
  })
  .strict()
  .refine((input) => input.source !== "event" || input.eventRef !== null, {
    message: "an event-sourced observation must cite its event (§12 provenance)",
  });

/** The record call: observation + the governed identity observing it. */
export interface ConductorObservationRecordInput {
  readonly observation: ConductorObservationInput;
  /** The governed Conductor worker identity (stamped as `recordedBy`, §12). */
  readonly observedBy: string;
  /** The record instant (J-023: caller-supplied, never sampled). */
  readonly now: string;
}

export type ConductorObservationRecordResult =
  | { ok: true; observationId: string; recorded: boolean; replayed: boolean }
  | { ok: false; error: string };

export type ConductorObservationListResult =
  { ok: true; observations: readonly ConductorObservation[] } | { ok: false; error: string };

/**
 * The Conductor observation port surface: record + tenant-scoped list. NOTHING
 * else — no update, no delete (append-only by construction). The DB-backed
 * implementation (`ConductorObservationPortDb`) satisfies the same interface
 * over the `cg_hermes_observation` substrate.
 */
export interface ConductorObservationRecorder {
  readonly backend: "memory" | "db";
  recordObservation(input: ConductorObservationRecordInput): Promise<ConductorObservationRecordResult>;
  listObservations(tenantId: string): Promise<ConductorObservationListResult>;
}

/* ─────────────────────────────────────────────────────────────
 * In-memory port — the DEFAULT backend (tests / unconfigured)
 * ────────────────────────────────────────────────────────────*/

/**
 * Backend adapter over an in-process append-only array. This is the DEFAULT
 * backend: tests and unconfigured environments keep the exact port contract
 * behind the adapter interface. It is NOT durable — state lives and dies
 * with the adapter instance.
 */
export function createInMemoryConductorObservationPort(): ConductorObservationRecorder & {
  /** Test introspection only: the append-only record count. */
  size(): number;
} {
  const records: ConductorObservation[] = [];
  return {
    backend: "memory",
    async recordObservation(
      input: ConductorObservationRecordInput,
    ): Promise<ConductorObservationRecordResult> {
      const parsedInput = conductorObservationInputSchema.safeParse(input.observation);
      if (!parsedInput.success) {
        return { ok: false, error: `conductor observation rejected: ${parsedInput.error.message}` };
      }
      const observedBy = z.string().trim().min(1).max(160).safeParse(input.observedBy);
      if (!observedBy.success) {
        return { ok: false, error: `conductor observation rejected: observedBy required (§12)` };
      }
      const recordedAt = timestampSchema.safeParse(input.now);
      if (!recordedAt.success) {
        return {
          ok: false,
          error: `conductor observation rejected: now must be a parseable timestamp`,
        };
      }
      // Idempotent replay (§10): a repeated observation id leaves the
      // original record verbatim — append-only, never rewritten.
      if (records.some((record) => record.observationId === parsedInput.data.observationId)) {
        return {
          ok: true,
          observationId: parsedInput.data.observationId,
          recorded: false,
          replayed: true,
        };
      }
      // §12/§9 stamping is the PORT's act, never the caller's claim.
      const observation: ConductorObservation = {
        ...parsedInput.data,
        recordedAt: recordedAt.data,
        recordedBy: observedBy.data,
        generatedByAi: true,
        verified: false,
      };
      const parsedRecord = conductorObservationSchema.safeParse(observation);
      if (!parsedRecord.success) {
        return { ok: false, error: `conductor observation rejected: ${parsedRecord.error.message}` };
      }
      records.push(parsedRecord.data);
      return {
        ok: true,
        observationId: parsedRecord.data.observationId,
        recorded: true,
        replayed: false,
      };
    },

    async listObservations(tenantId: string): Promise<ConductorObservationListResult> {
      const tenant = z.string().trim().min(1).max(128).safeParse(tenantId);
      if (!tenant.success) {
        return { ok: false, error: `conductor observation list rejected: tenantId required` };
      }
      // Tenant-scoped read (§13): observations of other tenants are never
      // returned — the tenant boundary is the query itself.
      const observations = records.filter((record) => record.tenantId === tenant.data);
      return { ok: true, observations };
    },

    size(): number {
      return records.length;
    },
  };
}

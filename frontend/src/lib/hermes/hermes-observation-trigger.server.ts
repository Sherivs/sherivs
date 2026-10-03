/**
 * CoreGrid — Hermes event-observation runtime trigger (server wiring)
 * (V1 wave follow-up, team T-E / HERMES-WIRE; completes R4's recorded
 * remaining work: "wire the runtime trigger").
 *
 * The RUNTIME CONSUMPTION POINT of the Hermes event→observation flow. R4
 * shipped the full library seam — the pure adapter (`hermes-event-source.ts`)
 * and the DB source over PENDING `cg_event` rows
 * (`hermes-event-source-db.server.ts`) — but NOTHING in the runtime invoked
 * it. This module is the step a runtime driver (a §27 server function, a
 * cron/queue worker, or the Hermes cycle entry) invokes to make observations
 * actually FLOW:
 *
 *   runHermesEventObservationStep({ tenantId, hermesId, now })
 *     → backend "db":      PENDING cg_event rows (tenant-scoped, read-only)
 *                          → map → order → dedupe → cg_hermes_observation
 *     → backend "memory":  typed no-op (nothing to poll in-process) — the
 *                          default backend keeps existing paths UNCHANGED;
 *                          explicit in-process deliveries may still be
 *                          consumed through the in-memory port.
 *
 * Backend selection follows the established env-selector convention
 * (`HERMES_OBSERVATION_BACKEND`, resolve via
 * `resolveHermesObservationBackend`; default and fallback "memory"; an
 * unknown value is a typed FAILURE here, not a crash — a poll loop must
 * survive a misconfiguration and stay observable).
 *
 * Fail-closed law (§9/§12/§13):
 *   - a missing cg_event substrate → typed `{ ok: false }` carrying
 *     HERMES_EVENT_SUBSTRATE_GAP — NO observation is invented;
 *   - a missing observation substrate → typed `{ ok: false }` carrying
 *     HERMES_OBSERVATION_SUBSTRATE_GAP — NO observation is invented;
 *   - an unknown backend, an unresolvable service-role client, invalid input
 *     or any unexpected throw → typed `{ ok: false }` with the reason —
 *     never a crash, never a fabricated observation;
 *   - memory mode without deliveries → typed no-op-with-reason (nothing is
 *     polled, nothing is faked).
 *
 * Exactly-once (§10): recording stays behind the observation port — replay
 * by deterministic digest identity plus the substrate's partial unique
 * `(tenant_id, event_ref)` index; the default memory recorder is a
 * process-scoped singleton so repeated steps replay instead of
 * double-recording. `cg_event` remains READ-ONLY here — the outbox state
 * machine (`kernel/outbox.ts`) keeps delivery-state ownership.
 *
 * §27 boundary note: this is a SERVER-SIDE library seam, not an HTTP
 * surface. Anything that exposes it over HTTP must wrap it in a §27 server
 * function (authenticate → resolve tenant → authorize → validate → execute
 * → audit → return permitted data); the tenant/identity context must come
 * from the server session, never from client input.
 *
 * Boundary: infrastructure wiring only. No cycle runtime (owned by
 * `hermes-cycle.ts`), no taxonomy registration, no event state mutation,
 * no HTTP surface.
 */

import { z } from "zod";
import type { KernelEventRecord } from "../kernel/event-semantics";
import type { HermesObservationBackend } from "./hermes-observation-db.server";
import { resolveHermesObservationBackend } from "./hermes-observation-db.server";
import {
  createInMemoryHermesObservationPort,
  type HermesObservationRecorder,
} from "./hermes-observation";
import {
  createHermesEventObservationSource,
  type HermesEventSourceDbClient,
} from "./hermes-event-source-db.server";
import { ingestEventsAsObservations, type HermesEventIngestion } from "./hermes-event-source";

/* ─────────────────────────────────────────────────────────────
 * Typed reasons (observable, never silent)
 * ────────────────────────────────────────────────────────────*/

/**
 * The typed no-op reason for the default memory backend: there is no
 * durable event substrate to poll in-process, so the step consumes nothing
 * and changes nothing — existing paths keep their exact behavior.
 */
export const HERMES_EVENT_TRIGGER_MEMORY_SKIP_REASON =
  "the memory backend holds no durable event substrate: there is no pending-event " +
  "queue to poll in-process, so this step is a typed no-op. Explicit in-process " +
  "deliveries may still be consumed through this step; durable event consumption " +
  "requires HERMES_OBSERVATION_BACKEND=db.";

/** Explicit deliveries belong to the memory backend only. */
export const HERMES_EVENT_TRIGGER_DELIVERY_REJECTION =
  "explicit deliveries are a memory-backend input: the db backend consumes the " +
  "cg_event substrate (PENDING rows) as the single authoritative event source.";

/* ─────────────────────────────────────────────────────────────
 * Step contract
 * ────────────────────────────────────────────────────────────*/

export interface HermesEventObservationStepInput {
  readonly tenantId: string;
  readonly hermesId: string;
  /** The record instant (J-023: caller-supplied, never sampled). */
  readonly now: string;
  readonly limit?: number;
  /**
   * Explicit in-process deliveries (memory mode). The db backend rejects
   * them: its event source is the cg_event substrate.
   */
  readonly deliveries?: readonly KernelEventRecord[];
}

/** Dependency injection: pure tests; defaults resolve from the environment. */
export interface HermesEventObservationStepDeps {
  /** Overrides `HERMES_OBSERVATION_BACKEND` (invalid values fail closed). */
  readonly backend?: HermesObservationBackend;
  /** The service-role client (db mode). Defaults to `supabaseAdmin`. */
  readonly client?: HermesEventSourceDbClient;
  /** The recorder (memory mode). Defaults to the process-scoped singleton. */
  readonly recorder?: HermesObservationRecorder;
}

export interface HermesEventObservationStepResult {
  /** The backend the step ran on; "unresolved" when selection failed. */
  readonly backend: HermesObservationBackend | "unresolved";
  /** true = the step completed (including a typed no-op); false = fail-closed. */
  readonly ok: boolean;
  readonly consumed: "ingested" | "skipped" | "failed";
  /** Always present on skip/failure; null on success. Observable, never silent. */
  readonly reason: string | null;
  /** The ingestion report (null when nothing was consumed). */
  readonly ingestion: HermesEventIngestion | null;
}

const stepInputSchema = z
  .object({
    tenantId: z.string().trim().min(1).max(128),
    hermesId: z.string().trim().min(1).max(160),
    now: z.string().refine((v) => Number.isFinite(Date.parse(v)), {
      message: "must be a parseable timestamp",
    }),
    limit: z.number().int().min(1).max(1000).optional(),
  })
  .strict();

const backendSchema = z.enum(["memory", "db"]);

/**
 * The process-scoped default in-memory recorder. The in-memory port is
 * instance-scoped by design; the trigger keeps ONE default instance so
 * repeated steps in the same process REPLAY (§10) instead of
 * double-recording. Not durable — the same posture as every memory-tier
 * fallback. Tests inject their own recorder.
 */
let defaultMemoryRecorder: HermesObservationRecorder | null = null;
function defaultInMemoryRecorder(): HermesObservationRecorder {
  defaultMemoryRecorder ??= createInMemoryHermesObservationPort();
  return defaultMemoryRecorder;
}

function failed(
  backend: HermesObservationBackend | "unresolved",
  reason: string,
  ingestion: HermesEventIngestion | null,
): HermesEventObservationStepResult {
  return { backend, ok: false, consumed: "failed", reason, ingestion };
}

function ingestionFailed(
  backend: HermesObservationBackend,
  result: { ok: false; reason: string; ingestion: HermesEventIngestion },
): HermesEventObservationStepResult {
  return {
    backend,
    ok: false,
    consumed: "failed",
    reason: result.reason,
    ingestion: result.ingestion,
  };
}

/**
 * Run ONE observation-poll step: consume pending event deliveries for the
 * tenant and record them as Hermes observations through the governed port.
 * Fail-closed in every direction; never throws, never fakes.
 */
export async function runHermesEventObservationStep(
  input: HermesEventObservationStepInput,
  deps?: HermesEventObservationStepDeps,
): Promise<HermesEventObservationStepResult> {
  const parsedInput = stepInputSchema.safeParse({
    tenantId: input.tenantId,
    hermesId: input.hermesId,
    now: input.now,
    ...(input.limit !== undefined ? { limit: input.limit } : {}),
  });
  if (!parsedInput.success) {
    return failed(
      "unresolved",
      `event observation step rejected: ${parsedInput.error.message}`,
      null,
    );
  }
  const { tenantId, hermesId, now, limit } = parsedInput.data;

  // Backend selection: injected override first, then the env selector. An
  // unknown value is a typed failure (observable), never a crash and never a
  // silent durability degradation.
  let backend: HermesObservationBackend;
  if (deps?.backend !== undefined) {
    const injected = backendSchema.safeParse(deps.backend);
    if (!injected.success) {
      return failed(
        "unresolved",
        `event observation step rejected: backend "${String(deps.backend)}" is not a registered Hermes observation backend (memory | db)`,
        null,
      );
    }
    backend = injected.data;
  } else {
    try {
      backend = resolveHermesObservationBackend(process.env.HERMES_OBSERVATION_BACKEND);
    } catch (error) {
      const message = (error as { message?: string }).message ?? String(error);
      return failed("unresolved", `event observation step failed closed: ${message}`, null);
    }
  }

  const deliveries = input.deliveries;

  if (backend === "memory") {
    if (deliveries === undefined) {
      // Default runtime posture: NOTHING changes on the memory backend.
      return {
        backend: "memory",
        ok: true,
        consumed: "skipped",
        reason: HERMES_EVENT_TRIGGER_MEMORY_SKIP_REASON,
        ingestion: null,
      };
    }
    // Memory mode with explicit in-process deliveries: consume through the
    // in-memory port (the recorder replays by digest identity, §10).
    try {
      const ingested = await ingestThroughMemory(
        deps?.recorder ?? defaultInMemoryRecorder(),
        deliveries,
        { tenantId, hermesId, now },
      );
      return ingested.ok
        ? {
            backend: "memory",
            ok: true,
            consumed: "ingested",
            reason: null,
            ingestion: ingested.ingestion,
          }
        : ingestionFailed("memory", ingested);
    } catch (error) {
      const message = (error as { message?: string }).message ?? String(error);
      return failed("memory", `event observation step failed closed: ${message}`, null);
    }
  }

  // db backend: the cg_event substrate is the single authoritative source —
  // explicit deliveries would bypass it, so they are rejected fail-closed.
  if (deliveries !== undefined) {
    return failed("db", HERMES_EVENT_TRIGGER_DELIVERY_REJECTION, null);
  }

  let client: HermesEventSourceDbClient;
  if (deps?.client !== undefined) {
    client = deps.client;
  } else {
    try {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      client = supabaseAdmin;
    } catch (error) {
      const message = (error as { message?: string }).message ?? String(error);
      return failed(
        "db",
        `event observation step failed closed: the service-role client is unavailable — ${message}`,
        null,
      );
    }
  }

  try {
    const source = createHermesEventObservationSource(client);
    const result = await source.ingestPendingEvents({ tenantId, hermesId, now, limit });
    return result.ok
      ? { backend: "db", ok: true, consumed: "ingested", reason: null, ingestion: result.ingestion }
      : ingestionFailed("db", result);
  } catch (error) {
    const message = (error as { message?: string }).message ?? String(error);
    return failed("db", `event observation step failed closed: ${message}`, null);
  }
}

async function ingestThroughMemory(
  recorder: HermesObservationRecorder,
  deliveries: readonly KernelEventRecord[],
  ctx: { tenantId: string; hermesId: string; now: string },
): Promise<
  | { ok: true; ingestion: HermesEventIngestion }
  | { ok: false; reason: string; ingestion: HermesEventIngestion }
> {
  return ingestEventsAsObservations(recorder, deliveries, {
    tenantId: ctx.tenantId,
    hermesId: ctx.hermesId,
    now: ctx.now,
  });
}

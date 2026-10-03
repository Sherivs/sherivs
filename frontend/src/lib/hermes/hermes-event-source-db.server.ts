/**
 * CoreGrid — DB-backed Hermes event source (server wiring)
 * (V1 remediation wave, team R4 / HERMES-PORT; follow-up of V1-002).
 *
 * Wires the event→observation adapter (`hermes-event-source.ts`) to the
 * REAL event substrate: pending `cg_event` rows (the kernel outbox's
 * emission table, authored by
 * `20260903000000_coregrid_universal_kernel_substrate.sql`) are read
 * tenant-scoped on the SERVICE-ROLE client and ingested as Hermes
 * observations through the DB-backed observation port
 * (`createHermesObservationPortDb`) — the full event→observation path in
 * one governed seam:
 *
 *   cg_event (pending, tenant-scoped) → map → order → dedupe
 *     → cg_hermes_observation (append-only, §12 provenance)
 *
 * Fail-closed when the substrate is absent:
 *   - a cg_event read failure (substrate absent) fails the ingestion with
 *     `{ ok: false }` — NO observation is invented or faked;
 *   - an observation-substrate failure (cg_hermes_observation absent — the
 *     migration is AUTHORED, NOT APPLIED) aborts the ingestion closed
 *     through the port's typed `observation_substrate_missing` failure.
 *
 * Read-only over cg_event: the outbox delivery state machine
 * (`kernel/outbox.ts`) remains the sole owner of event state transitions —
 * this source never marks events consumed. Consumption idempotence instead
 * comes from the deterministic digest identity (§10): a redelivered event
 * replays onto its already-recorded observation.
 *
 * Boundary: infrastructure wiring only. No cycle runtime (owned by
 * `hermes-cycle.ts`), no taxonomy registration (owned by the event's
 * domain), no event state mutation.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { KernelEventRecord } from "../kernel/event-semantics";
import {
  createHermesObservationPortDb,
  HERMES_OBSERVATION_SUBSTRATE_GAP,
} from "./hermes-observation-db.server";
import {
  ingestEventsAsObservations,
  type HermesEventIngestion,
  type HermesEventIngestResult,
} from "./hermes-event-source";

export type HermesEventSourceDbClient = SupabaseClient;

const EVENT_SUBSTRATE_TABLE = "cg_event" as const;

/** Default maximum pending deliveries consumed per ingestion call. */
export const HERMES_EVENT_SOURCE_BATCH_LIMIT = 100 as const;

/* ─────────────────────────────────────────────────────────────
 * The fail-closed event-substrate gap (typed, observable)
 * ────────────────────────────────────────────────────────────*/

export const HERMES_EVENT_SUBSTRATE_GAP =
  "the cg_event substrate is absent or unreadable: events cannot be consumed " +
  "as Hermes observations. The event substrate belongs to the universal kernel " +
  "migration; until it is readable this source fails closed and records NOTHING.";

/** cg_event read shape — the untrusted read boundary (Zod, fail-closed). */
const eventRowSchema = z.object({
  id: z.string().min(1).max(200),
  event_type: z.string().min(1).max(200),
  aggregate_type: z.string().min(1).max(200),
  aggregate_id: z.string().min(1),
  actor_identity: z.string().nullable(),
  tenant_id: z.string().nullable(),
  occurred_at: z.string().nullable(),
  recorded_at: z.string().nullable(),
  correlation_id: z.string().nullable(),
  payload: z.unknown().nullable(),
});

export interface HermesEventObservationSource {
  readonly backend: "db";
  /**
   * Consume pending event deliveries for the tenant as Hermes observations.
   * Fails closed (writing nothing) when either substrate is absent.
   */
  ingestPendingEvents(input: {
    readonly tenantId: string;
    readonly hermesId: string;
    readonly now: string;
    readonly limit?: number;
  }): Promise<HermesEventIngestResult>;
}

/**
 * Build the event source over the service-role client. Observations are
 * recorded through the DB-backed HermesObservationPortDb on the SAME client.
 */
export function createHermesEventObservationSource(
  client: HermesEventSourceDbClient,
): HermesEventObservationSource {
  const observations = createHermesObservationPortDb(client);

  return {
    backend: "db",

    async ingestPendingEvents(input: {
      readonly tenantId: string;
      readonly hermesId: string;
      readonly now: string;
      readonly limit?: number;
    }): Promise<HermesEventIngestResult> {
      const limit = input.limit ?? HERMES_EVENT_SOURCE_BATCH_LIMIT;
      const parsedLimit = z.number().int().min(1).max(1000).safeParse(limit);
      if (!parsedLimit.success) {
        return {
          ok: false,
          reason: `event ingestion rejected: limit must be 1–1000`,
          ingestion: emptyIngestion(input),
        };
      }
      const tenantId = z.string().trim().min(1).max(128).safeParse(input.tenantId);
      if (!tenantId.success) {
        return {
          ok: false,
          reason: "event ingestion rejected: tenantId required (§13)",
          ingestion: emptyIngestion(input),
        };
      }

      // Tenant-scoped pending deliveries, oldest first (deterministic). The
      // outbox owns the state machine; this read NEVER mutates cg_event.
      const result = await client
        .from(EVENT_SUBSTRATE_TABLE)
        .select("*")
        .eq("tenant_id", tenantId.data)
        .eq("state", "pending")
        .order("occurred_at", { ascending: true })
        .limit(parsedLimit.data);
      if (result.error) {
        return {
          ok: false,
          reason: `event ingestion failed closed: ${HERMES_EVENT_SUBSTRATE_GAP} (substrate error: ${result.error.message})`,
          ingestion: emptyIngestion(input),
        };
      }

      // Untrusted reads are Zod-validated; malformed rows fail the batch
      // closed rather than entering Hermes state.
      const rows = eventRowSchema.array().safeParse(result.data ?? []);
      if (!rows.success) {
        return {
          ok: false,
          reason: `event ingestion failed closed: cg_event row validation rejected — ${rows.error.message}`,
          ingestion: emptyIngestion(input),
        };
      }

      const events: KernelEventRecord[] = rows.data.map((row) => ({
        id: row.id,
        event_type: row.event_type,
        tenant_id: row.tenant_id,
        aggregate_type: row.aggregate_type,
        aggregate_id: row.aggregate_id,
        payload: (row.payload ?? null) as Record<string, unknown> | null,
        occurred_at: row.occurred_at,
        recorded_at: row.recorded_at,
        correlation_id: row.correlation_id,
      }));

      const ingested = await ingestEventsAsObservations(observations, events, {
        tenantId: tenantId.data,
        hermesId: input.hermesId,
        now: input.now,
      });
      if (!ingested.ok) {
        return {
          ok: false,
          reason: `${ingested.reason} — ${HERMES_OBSERVATION_SUBSTRATE_GAP}`,
          ingestion: ingested.ingestion,
        };
      }
      return ingested;
    },
  };
}

function emptyIngestion(input: {
  readonly tenantId: string;
  readonly hermesId: string;
  readonly now: string;
}): HermesEventIngestion {
  return {
    tenantId: input.tenantId,
    hermesId: input.hermesId,
    ingestedAt: input.now,
    considered: 0,
    excludedOtherTenant: 0,
    collapsed: 0,
    rejected: [],
    recorded: [],
    replayed: [],
  };
}

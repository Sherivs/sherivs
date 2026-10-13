/**
 * CoreGrid — Jarvis enterprise-cycle RUNTIME (server-only).
 *
 * The executable side of the wake surface: substrate assembly over the
 * sanctioned service-role audit writer, optional provider-health battery,
 * optional Hermes `cg_event` observation ingestion, and the §27 execute
 * pipeline core. This module matches the server-file pattern (dot server
 * dot ts) and is imported ONLY from inside `enterprise-cycle.functions.ts`
 * handler bodies (never statically by routes/components), so it never
 * enters the client bundle.
 *
 * Split:
 *   - `runEnterpriseCycleLibrary` — observation stamp + one Jarvis library
 *     cycle. The cron/script path calls this (no session).
 *   - `executeEnterpriseCycle` — validate → authorize → library → audit.
 *     The §27 server function path.
 *
 * Hermes and Jarvis remain libraries. This runtime does not start a
 * resident process. Provider health is never invented: Observability owns
 * `stampProviderHealthObservations`. Hermes findings are never invented:
 * Observability owns `stampHermesFindings`. Production wires a read-only
 * list port (`createHermesFindingsListPort`): it OBSERVES/ASSESSES only;
 * it does not ACT. This wake lists already-stamped findings; it does not
 * execute Hermes repair as a side effect of Jarvis. Phase 52 is not
 * authorized. This wake does not close MISSION_LEASE_SUBSTRATE_GAP, does
 * not persist leases, does not query cg_mission_lease, and does not apply
 * the V1-003 unapplied migration.
 *
 * Version-target classification: ACTIVE-V1 (AGENTS.md §45).
 */
import { tokenMsRemaining } from "@/lib/auth-helpers";
import { requirePlatformSuperAdmin } from "@/lib/security-role-gate";
import { SystemClock, TimeAuthority } from "@/lib/kernel/time-authority";
import { writeAuditRecord, type WriteAuditClient } from "@/lib/server/write-audit";
import {
  stampProviderHealthObservations,
  PROVIDER_HEALTH_OBSERVATION_SOURCE,
} from "@/lib/observability/provider-health-observation";
import {
  stampHermesFindings,
  HERMES_FINDING_OBSERVATION_SOURCE,
} from "@/lib/hermes/hermes-finding-observation";
import { assertLeaseSubstrateGapRemainsUnauthorized } from "@/lib/missions/lease-substrate-gap-lock";
import { morningExecutiveReport, runJarvisEnterpriseCycle } from "./enterprise-loop";
import type { JarvisObservation } from "./enterprise-loop";
import {
  cycleAuditEntry,
  enterpriseCycleRequestSchema,
  JARVIS_ENTERPRISE_CYCLE_GRANTED_CAPABILITIES,
  toAuditIntent,
} from "./enterprise-cycle-contract";
import type {
  EnterpriseCycleDeps,
  EnterpriseCycleHealthTrace,
  EnterpriseCycleHermesTrace,
  EnterpriseCycleOutcome,
  EnterpriseCycleRequest,
} from "./enterprise-cycle-contract";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

const DEFAULT_HERMES_ID = "hermes";

const HEALTH_PORT_MISSING = "provider health port not injected";
const HERMES_PORT_MISSING = "hermes observation port not injected";
const HERMES_FINDINGS_PORT_MISSING = "hermes findings port not injected";
const HEALTH_OPTED_OUT = "includeProviderHealth=false";
const HERMES_OPTED_OUT = "includeHermesObservation=false";

assertLeaseSubstrateGapRemainsUnauthorized();

/**
 * Production substrate client: the sanctioned service-role adapter used for
 * the canonical users-row lookup (audit_logs.user_id FKs public.users) and
 * the fail-closed audit writer.
 */
export type EnterpriseCycleAdminClient = WriteAuditClient & {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: string): {
        maybeSingle(): PromiseLike<{
          data: { id: string } | null;
          error: { message: string } | null;
        }>;
      };
    };
    insert(payload: Record<string, unknown>): PromiseLike<unknown>;
  };
};

/**
 * Production deps over the sanctioned substrate. The audit writer resolves
 * WHO exactly like the worker-launch family: the canonical users row when
 * one exists, otherwise the verified email claim with a null actor id — the
 * audit is never unattributed and never silently rewritten (§27.6).
 *
 * Default provider-health, Hermes observation, and Hermes findings-list
 * ports are dynamic-imported HERE (never from the functions module) so the
 * client graph cannot reach them. Production `listHermesFindings` wires
 * `createHermesFindingsListPort` over the sanctioned admin client: it
 * OBSERVES/ASSESSES only and does not ACT. Tests may still inject a stub.
 * Missing/throwing port remains a typed skip in `runEnterpriseCycleLibrary`.
 */
export async function buildEnterpriseCycleDeps(input: {
  admin: EnterpriseCycleAdminClient;
  actorId: string;
  actorEmail: string | null;
}): Promise<EnterpriseCycleDeps> {
  const actorRow = await input.admin.from("users").select("id").eq("id", input.actorId).maybeSingle();
  if (actorRow.error) throw new Error(actorRow.error.message);
  const actorHasCanonicalRow = actorRow.data != null;
  return {
    audit: async (entry) => {
      await writeAuditRecord(input.admin, {
        ...entry,
        actorId: actorHasCanonicalRow ? input.actorId : null,
        actorEmail: actorHasCanonicalRow ? (entry.actorEmail ?? null) : input.actorEmail,
      });
    },
    readEnv: (name) => process.env[name],
    now: () => timeAuthority.now().at,
    runProviderHealth: async (env) => {
      const { runProviderHealthBattery } = await import(
        "@/lib/observability/provider-health.server"
      );
      return runProviderHealthBattery(env);
    },
    runHermesObservation: async (step) => {
      const { runHermesEventObservationStep } = await import(
        "@/lib/hermes/hermes-observation-trigger.server"
      );
      try {
        const result = await runHermesEventObservationStep(step);
        return { ok: result.ok, consumed: result.consumed, reason: result.reason };
      } catch (error) {
        const reason = error instanceof Error ? error.message : "hermes observation failed";
        return { ok: false, consumed: "failed", reason };
      }
    },
    listHermesFindings: async ({ tenantId, now }) => {
      const { createHermesFindingsListPort } = await import(
        "@/lib/hermes/hermes-findings-list.server"
      );
      const port = createHermesFindingsListPort(
        input.admin as Parameters<typeof createHermesFindingsListPort>[0],
      );
      return port.listHermesFindings({ tenantId, now });
    },
  };
}

export interface EnterpriseCycleLibraryResult {
  readonly cycle: ReturnType<typeof runJarvisEnterpriseCycle>;
  readonly health: EnterpriseCycleHealthTrace;
  readonly hermes: EnterpriseCycleHermesTrace;
  readonly observations: readonly JarvisObservation[];
}

/**
 * One library-form cycle: stamp honest provider-health observations (when
 * requested), optionally ingest Hermes `cg_event` rows into the Hermes
 * substrate, optionally stamp already-listed Hermes FINDINGS into
 * JarvisObservation (when `listHermesFindings` is present — production
 * read-only port or test stub), then run `runJarvisEnterpriseCycle` over
 * the merged stamped observations. Hermes event-observations stay in the
 * Hermes substrate for ingest; FINDINGS are mapped only via
 * `stampHermesFindings`. Throws are converted to typed skips; nothing is
 * fabricated. Listing findings OBSERVES/ASSESSES only; it does not ACT
 * and is not repair.
 *
 * The script path calls this function (no session, no §27 audit). The
 * server-function path wraps it in `executeEnterpriseCycle`.
 */
export async function runEnterpriseCycleLibrary(
  request: {
    tenantId: string;
    nightMode?: boolean;
    includeProviderHealth?: boolean;
    includeHermesObservation?: boolean;
  },
  deps: EnterpriseCycleDeps,
): Promise<EnterpriseCycleLibraryResult> {
  let observations: JarvisObservation[] = [];
  let health: EnterpriseCycleHealthTrace = {
    ran: false,
    reportCount: 0,
    skipReason: HEALTH_PORT_MISSING,
  };
  let hermesIngest: Pick<EnterpriseCycleHermesTrace, "ran" | "consumed" | "skipReason"> = {
    ran: false,
    consumed: "skipped",
    skipReason: HERMES_PORT_MISSING,
  };

  if (request.includeProviderHealth === false) {
    health = { ran: false, reportCount: 0, skipReason: HEALTH_OPTED_OUT };
  } else if (deps.runProviderHealth === undefined) {
    health = { ran: false, reportCount: 0, skipReason: HEALTH_PORT_MISSING };
  } else {
    try {
      const reports = await deps.runProviderHealth(process.env);
      const stamped = await Promise.resolve(
        stampProviderHealthObservations({
          tenantRef: request.tenantId,
          reports,
        }),
      );
      observations = [...stamped];
      health = { ran: true, reportCount: reports.length, skipReason: null };
    } catch (error) {
      const reason = error instanceof Error ? error.message : "provider health failed";
      health = { ran: false, reportCount: 0, skipReason: reason };
      observations = [];
    }
  }

  if (request.includeHermesObservation === false) {
    hermesIngest = { ran: false, consumed: "skipped", skipReason: HERMES_OPTED_OUT };
  } else if (deps.runHermesObservation === undefined) {
    hermesIngest = { ran: false, consumed: "skipped", skipReason: HERMES_PORT_MISSING };
  } else {
    const hermesId = (deps.readEnv("HERMES_WORKER_ID") ?? "").trim() || DEFAULT_HERMES_ID;
    try {
      const result = await deps.runHermesObservation({
        tenantId: request.tenantId,
        hermesId,
        now: deps.now(),
      });
      hermesIngest = {
        ran: true,
        consumed: result.consumed,
        skipReason: result.ok ? result.reason : (result.reason ?? "hermes observation failed"),
      };
      if (!result.ok) {
        hermesIngest = {
          ran: false,
          consumed: result.consumed,
          skipReason: result.reason ?? "hermes observation failed",
        };
      }
    } catch (error) {
      const reason = error instanceof Error ? error.message : "hermes observation failed";
      hermesIngest = { ran: false, consumed: "failed", skipReason: reason };
    }
  }

  /* FINDINGS: list already-stamped Hermes findings; listing is not repair. */
  let findingsStamped = 0;
  let findingsSkipReason: string | null = HERMES_FINDINGS_PORT_MISSING;
  if (request.includeHermesObservation === false) {
    findingsSkipReason = HERMES_OPTED_OUT;
  } else if (deps.listHermesFindings === undefined) {
    findingsSkipReason = HERMES_FINDINGS_PORT_MISSING;
  } else {
    try {
      const findings = await deps.listHermesFindings({
        tenantId: request.tenantId,
        now: deps.now(),
      });
      const stamped = await Promise.resolve(
        stampHermesFindings({
          tenantRef: request.tenantId,
          findings,
        }),
      );
      observations = [...observations, ...stamped];
      findingsStamped = stamped.length;
      findingsSkipReason = null;
    } catch (error) {
      const reason = error instanceof Error ? error.message : "hermes findings failed";
      findingsSkipReason = reason;
      findingsStamped = 0;
    }
  }

  const hermes: EnterpriseCycleHermesTrace = {
    ...hermesIngest,
    findingsStamped,
    findingsSkipReason,
  };

  const cycle = runJarvisEnterpriseCycle({
    tenantRef: request.tenantId,
    now: deps.now(),
    observations,
    grantedCapabilities: deps.grantedCapabilities ?? JARVIS_ENTERPRISE_CYCLE_GRANTED_CAPABILITIES,
    nightMode: request.nightMode === true,
  });

  return { cycle, health, hermes, observations };
}

/**
 * Run one enterprise-cycle wake attempt. The server function wraps this
 * core; tests inject the ports and exercise the full §27 chain without a
 * database and without a live provider.
 */
export async function executeEnterpriseCycle(
  input: {
    supabase: Parameters<typeof requirePlatformSuperAdmin>[0];
    userId: string;
    claims?: { exp?: number; email?: string };
    data: unknown;
  },
  deps: EnterpriseCycleDeps,
): Promise<EnterpriseCycleOutcome> {
  const parsed = enterpriseCycleRequestSchema.safeParse(input.data);
  if (!parsed.success) {
    const reason = `cycle request rejected: ${parsed.error.message.slice(0, 300)}`;
    const entry = cycleAuditEntry({
      tenantId: "",
      actorId: input.userId,
      actorEmail: input.claims?.email ?? null,
      outcome: "failed",
      code: "invalid_request",
      reason,
    });
    await deps.audit(entry);
    return { outcome: "denied", code: "invalid_request", reason, audit: toAuditIntent(entry) };
  }
  const data: EnterpriseCycleRequest = parsed.data;
  const identity = {
    actorId: input.userId,
    actorEmail: input.claims?.email ?? null,
  };

  /* 3. AUTHORIZE — canonical platform super-admin gate, fail closed. */
  try {
    await requirePlatformSuperAdmin(input.supabase, {
      // Lifecycle threading: the JWT carries no lifecycle claim, so `null`
      // flags the identity lifecycle unverified (never silent); session
      // validity is attested from the verified token's exp claim.
      lifecycle: null,
      sessionValid:
        typeof input.claims?.exp === "number" && tokenMsRemaining(input.claims.exp) > 0,
    });
  } catch (error) {
    const reason = error instanceof Error ? error.message : "platform super admin gate denied";
    const entry = cycleAuditEntry({
      tenantId: data.tenantId,
      ...identity,
      outcome: "failed",
      code: "gate_denied",
      reason,
    });
    await deps.audit(entry);
    return { outcome: "denied", code: "gate_denied", reason, audit: toAuditIntent(entry) };
  }

  /* 5. EXECUTE — one library cycle over injected ports. No AI credential. */
  const library = await runEnterpriseCycleLibrary(data, deps);
  const briefing = morningExecutiveReport(library.cycle);
  const entry = cycleAuditEntry({
    tenantId: data.tenantId,
    ...identity,
    outcome: "succeeded",
    code: "completed",
    reason: library.cycle.sleep.reason,
    extra: {
      detection_count: library.cycle.detections.length,
      health_ran: library.health.ran,
      health_report_count: library.health.reportCount,
      health_skip_reason: library.health.skipReason,
      hermes_ran: library.hermes.ran,
      hermes_consumed: library.hermes.consumed,
      hermes_skip_reason: library.hermes.skipReason,
      hermes_findings_stamped: library.hermes.findingsStamped,
      hermes_findings_skip_reason: library.hermes.findingsSkipReason,
      night_mode: data.nightMode === true,
      observation_count: library.observations.length,
      health_source: PROVIDER_HEALTH_OBSERVATION_SOURCE,
      hermes_finding_source: HERMES_FINDING_OBSERVATION_SOURCE,
      briefing_header: briefing.header,
    },
  });
  await deps.audit(entry);
  return {
    outcome: "completed",
    attempted: true,
    cycle: library.cycle,
    health: library.health,
    hermes: library.hermes,
    briefingHeader: briefing.header,
    audit: toAuditIntent(entry),
  };
}

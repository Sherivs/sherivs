/**
 * CoreGrid — Jarvis enterprise-cycle CONTRACT (client-safe).
 *
 * Everything the server function module and the server runtime module share:
 * the request schema, the typed outcome vocabulary, the declared Jarvis
 * capability grant, and the audit-intent builders. This file imports NO
 * server-only module at runtime (type-only imports are erased), so it is
 * safe in the client graph.
 *
 * The executable WAKE → library cycle → SLEEP pipeline lives in
 * `enterprise-cycle-runtime.server.ts`; the HTTP surface lives in
 * `enterprise-cycle.functions.ts`. This is a cron/queue/§27 POST trigger,
 * not a resident process. Hermes and Jarvis remain libraries.
 *
 * Version-target classification: ACTIVE-V1 (AGENTS.md §45).
 */
import { z } from "zod";
import type { WriteAuditEntry } from "@/lib/server/write-audit";
import type { ProviderHealthObservationSource } from "@/lib/observability/provider-health-observation";
import type { HermesFindingObservationSource } from "@/lib/hermes/hermes-finding-observation";
import { JarvisCapability } from "./jarvis-contract";
import type { JarvisEnterpriseLoopResult, JarvisObservation } from "./enterprise-loop";

/* ─────────────────────────────────────────────────────────────
 * Request contract (§26: validate everything crossing the boundary)
 * ────────────────────────────────────────────────────────────*/

export const enterpriseCycleRequestSchema = z
  .object({
    /** Tenant the cycle TARGETS (passed through as tenantRef; never an authority assertion). */
    tenantId: z.string().trim().min(1).max(128),
    /** Night mode: MONITOR / MAINTAIN / ANALYZE / PREPARE only. */
    nightMode: z.boolean().optional(),
    /** When false, the provider-health port is not called. Default: run. */
    includeProviderHealth: z.boolean().optional(),
    /** When false, the Hermes observation port is not called. Default: run. */
    includeHermesObservation: z.boolean().optional(),
  })
  .strict();

export type EnterpriseCycleRequest = z.infer<typeof enterpriseCycleRequestSchema>;

/* ─────────────────────────────────────────────────────────────
 * Declared capability grant (Part 15 MAY-list). Tests inject a subset.
 * ────────────────────────────────────────────────────────────*/

/** Default grant: every Part 15 MAY capability. Not a permission expansion. */
export const JARVIS_ENTERPRISE_CYCLE_GRANTED_CAPABILITIES: readonly string[] =
  Object.values(JarvisCapability);

/* ─────────────────────────────────────────────────────────────
 * Typed outcomes (§16 decision vocabulary as data, never fake success)
 * ────────────────────────────────────────────────────────────*/

/** Canonical audit action for every enterprise-cycle wake. */
export const ENTERPRISE_CYCLE_AUDIT_ACTION = "jarvis.enterprise_cycle";

/**
 * The audit row's addressed substrate: the existing `cg_event` queue.
 * Do not create a new queue for this wake.
 */
const AUDIT_TARGET_TABLE = "cg_event";

/**
 * The serializable audit-row INTENT carried in the typed outcome (§27.7
 * permitted data). The full `WriteAuditEntry` is persisted server-side by the
 * fail-closed audit writer; the wire carries its provenance summary only.
 */
export interface EnterpriseCycleAuditIntent {
  readonly action: string;
  readonly gate: string;
  readonly outcome: "succeeded" | "failed";
  readonly table: string;
  readonly recordId: string | null;
  readonly tenantId: string | null;
  readonly cycle_outcome_code: string;
  readonly reason: string;
}

export function toAuditIntent(entry: WriteAuditEntry): EnterpriseCycleAuditIntent {
  const details = (entry.details ?? {}) as { cycle_outcome_code?: string; reason?: string };
  return {
    action: entry.action,
    gate: entry.gate,
    outcome: entry.outcome,
    table: entry.table,
    recordId: entry.recordId ?? null,
    tenantId: entry.tenantId,
    cycle_outcome_code: details.cycle_outcome_code ?? "",
    reason: details.reason ?? "",
  };
}

export interface EnterpriseCycleHealthTrace {
  readonly ran: boolean;
  readonly reportCount: number;
  readonly skipReason: string | null;
}

export interface EnterpriseCycleHermesTrace {
  readonly ran: boolean;
  readonly consumed: string;
  readonly skipReason: string | null;
  /** Count of Jarvis observations produced by `stampHermesFindings` this wake. */
  readonly findingsStamped: number;
  /**
   * Typed skip when the findings port was not used. `null` when the port ran
   * (reportCount-style: `findingsStamped` may still be 0). Callers never see
   * `undefined`.
   */
  readonly findingsSkipReason: string | null;
}

/**
 * The typed cycle outcome. Every terminal state carries the audit row INTENT
 * that was persisted for the attempt (`audit`), so no attempt can pass
 * unaudited on the §27 path.
 *
 * `blocked_no_credential` is the exit-2 battery convention (F-13 T8 / BLK-2).
 * The Jarvis library cycle does NOT require `AI_API_KEY` (no model call);
 * the script uses this outcome when `COREGRID_CYCLE_TENANT_ID` is absent.
 */
export type EnterpriseCycleOutcome =
  | {
      outcome: "denied";
      code: "gate_denied" | "invalid_request";
      reason: string;
      audit: EnterpriseCycleAuditIntent;
    }
  | {
      outcome: "blocked_no_credential";
      /** The exit-2 battery convention (F-13 T8 / BLK-2), kept byte-stable. */
      code: "BLOCKED_NO_CREDENTIAL";
      reason: string;
      missingEnvironment: readonly string[];
      attempted: false;
      audit: EnterpriseCycleAuditIntent;
    }
  | {
      outcome: "completed";
      attempted: true;
      cycle: JarvisEnterpriseLoopResult;
      health: EnterpriseCycleHealthTrace;
      hermes: EnterpriseCycleHermesTrace;
      briefingHeader: string;
      audit: EnterpriseCycleAuditIntent;
    };

/* ─────────────────────────────────────────────────────────────
 * Audit intent builder (§12 provenance, §29: no secrets)
 * ────────────────────────────────────────────────────────────*/

export function cycleAuditEntry(input: {
  tenantId: string;
  actorId: string | null;
  actorEmail: string | null;
  outcome: WriteAuditEntry["outcome"];
  code: string;
  reason: string;
  extra?: Record<string, unknown>;
}): WriteAuditEntry {
  const boundedReason = input.reason.slice(0, 300);
  return {
    action: ENTERPRISE_CYCLE_AUDIT_ACTION,
    gate: "requirePlatformSuperAdmin",
    tenantId: input.tenantId,
    actorId: input.actorId,
    actorEmail: input.actorEmail,
    table: AUDIT_TARGET_TABLE,
    recordId: input.tenantId === "" ? null : input.tenantId,
    outcome: input.outcome,
    details: {
      cycle_outcome_code: input.code,
      reason: boundedReason,
      source: "jarvis.enterprise-cycle",
      trigger: "platform-super-admin wake",
      ...input.extra,
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Injectable substrate (the cycle pipeline's only I/O seams)
 * ────────────────────────────────────────────────────────────*/

export interface EnterpriseCycleHermesStepResult {
  readonly ok: boolean;
  readonly consumed: string;
  readonly reason: string | null;
}

export interface EnterpriseCycleDeps {
  /** Fail-closed audit writer (§27.6): a rejected audit fails the wake. */
  readonly audit: (entry: WriteAuditEntry) => Promise<void>;
  /** J-023 injected clock (ISO instant). */
  readonly now: () => string;
  /** Credential/env reads (§30: names in outcomes, values never leave the check). */
  readonly readEnv: (name: string) => string | undefined;
  /**
   * Test seam: a subset of Part 15 capabilities. Default production grant is
   * `JARVIS_ENTERPRISE_CYCLE_GRANTED_CAPABILITIES`.
   */
  readonly grantedCapabilities?: readonly string[];
  /**
   * Provider-health battery port. Observability owns the translator
   * (`stampProviderHealthObservations`); this port only produces source
   * reports. Missing port → typed skip, never fabricated observations.
   */
  readonly runProviderHealth?: (
    env: Record<string, string | undefined>,
  ) => Promise<readonly ProviderHealthObservationSource[]>;
  /**
   * Hermes event-observation port over the existing `cg_event` queue.
   * Hermes observations stay in the Hermes substrate for ingest; they are
   * never mapped into `JarvisObservation`. Missing/failing port → typed skip.
   */
  readonly runHermesObservation?: (step: {
    tenantId: string;
    hermesId: string;
    now: string;
  }) => Promise<EnterpriseCycleHermesStepResult>;
  /**
   * Hermes FINDING port. Observability owns the translator
   * (`stampHermesFindings`); this port only lists already-stamped findings.
   * FINDINGS are mapped into `JarvisObservation` only when this port returns
   * them. Missing port → typed skip, never fabricated findings. Production
   * leaves this undefined (no invented findings substrate). Tests inject it.
   */
  readonly listHermesFindings?: (input: {
    tenantId: string;
    now: string;
  }) => Promise<readonly HermesFindingObservationSource[]>;
}

export type {
  JarvisEnterpriseLoopResult,
  JarvisObservation,
  ProviderHealthObservationSource,
  HermesFindingObservationSource,
};

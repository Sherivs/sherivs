/**
 * Sherivs — Conductor memory through the CANONICAL memory tier
 * (MISSION V1-002).
 *
 * Conductor keeps NO second memory architecture: every Conductor memory act runs
 * through the canonical durable memory substrate (`lib/memory/` — the
 * `MemoryTierAdapter` seam over `memory-store.ts`), which enforces the
 * declared-scope write bound (J-017), the authorization-gated retrieval and
 * the audited access log by construction.
 *
 * Provenance law (AGENTS §9/§12): Conductor' own memory records are stamped as
 * AI-GENERATED, UNVERIFIED intelligence (`generatedByAi: true`,
 * `verified: false`) — memory is never canonical truth. Conductor decisions
 * about system state are only ever RECORDED here; their truth lives in the
 * DB-backed mission/worker/evidence ports the cycle observes.
 *
 * Scope discipline: Conductor operates through ONE declared scope per tenant
 * (`conductor:scope:<tenantId>`, domain `orchestration`, sensitivity ceiling
 * `internal`, actor scope = the governed Conductor worker id). An undeclared
 * scope grants nothing; out-of-scope writes are REJECTED by the substrate,
 * never clamped.
 *
 * Boundary: thin, pure-logic adapter usage only. No vendor, no I/O of its
 * own (the adapter owns persistence), no wall-clock sampling.
 */

import type { MemoryTierAdapter } from "../memory/memory-adapter";
import type { MemoryRecord } from "../memory/memory-store";
import {
  CONDUCTOR_MEMORY_DOMAIN,
  type ConductorActionClass,
  type ConductorFinding,
} from "./conductor-contract";

/** The declared Conductor memory scope for one tenant. */
export function conductorMemoryScopeId(tenantId: string): string {
  return `conductor:scope:${tenantId}`;
}

/** Declare Conductor' bounded memory scope (idempotent; provenance required §12). */
export async function declareConductorMemoryScope(
  adapter: MemoryTierAdapter,
  input: { tenantId: string; conductorId: string },
): Promise<{ ok: true; scopeId: string; alreadyDeclared: boolean } | { ok: false; error: string }> {
  const scopeId = conductorMemoryScopeId(input.tenantId);
  const loaded = await adapter.load();
  if (!loaded.ok) return { ok: false, error: loaded.error };
  if (loaded.store.scopes.some((scope) => scope.scopeId === scopeId)) {
    return { ok: true, scopeId, alreadyDeclared: true };
  }
  const declared = await adapter.declareScope({
    scope: {
      scopeId,
      tenantId: input.tenantId,
      missionRef: null,
      actorScope: [input.conductorId],
      domains: [CONDUCTOR_MEMORY_DOMAIN],
      maxSensitivity: "internal",
    },
    declaredBy: input.conductorId,
  });
  if (!declared.ok) return { ok: false, error: declared.error };
  return { ok: true, scopeId, alreadyDeclared: false };
}

/** The deterministic memory-record id of a recorded Conductor decision. */
export function conductorDecisionRecordId(findingId: string): string {
  return `conductor:decision:${findingId}`;
}

/**
 * Record ONE Conductor cycle decision as a provenance-stamped memory record.
 * Idempotent: a decision already recorded for the finding is left verbatim
 * (the substrate rejects duplicate ids; Conductor checks first and skips).
 */
export async function writeConductorDecisionMemory(
  adapter: MemoryTierAdapter,
  input: {
    tenantId: string;
    conductorId: string;
    finding: ConductorFinding;
    proposedAction: ConductorActionClass;
    cycleId: string;
    now: string;
  },
): Promise<
  | { ok: true; recordId: string; written: boolean; provenance: string }
  | { ok: false; error: string }
> {
  const scopeId = conductorMemoryScopeId(input.tenantId);
  const recordId = conductorDecisionRecordId(input.finding.findingId);

  const loaded = await adapter.load();
  if (!loaded.ok) return { ok: false, error: loaded.error };
  if (loaded.store.records.some((record) => record.id === recordId)) {
    return { ok: true, recordId, written: false, provenance: "already_recorded" };
  }

  const content = JSON.stringify({
    findingId: input.finding.findingId,
    kind: input.finding.kind,
    subjectRef: input.finding.subjectRef,
    proposedAction: input.proposedAction,
    cycleId: input.cycleId,
    // §9 marking: the recorded DECISION is intelligence; the underlying
    // state claim lives in the DB-backed ports named by the claim source.
    claimSource: input.finding.claim.source,
    claimSourceRef: input.finding.claim.sourceRef,
    claimVerified: input.finding.claim.verified,
  });

  const written = await adapter.writeRecord({
    recordId,
    scopeId,
    identityRef: input.conductorId,
    tenantId: input.tenantId,
    missionRef: null,
    memoryClass: "practical",
    domain: CONDUCTOR_MEMORY_DOMAIN,
    content,
    sensitivity: "internal",
    requiredPermission: null,
    freshnessAt: input.now,
    recordedAt: input.now,
    biTemporal: { validFrom: input.now },
    envelope: {
      objectType: "memory_record",
      schemaVersion: "1.0",
      status: "active",
      createdBy: input.conductorId,
      updatedBy: input.conductorId,
      // §12 provenance: who (Conductor), what source (the cycle), AI-generated,
      // UNVERIFIED — memory is never canonical truth (§9).
      provenance: {
        source: "conductor:orchestrator",
        sourceRef: `cycle:${input.cycleId}`,
        recordedBy: input.conductorId,
        originTenantId: input.tenantId,
        generatedByAi: true,
        verified: false,
      },
      policyContext: { purpose: "conductor-orchestration" },
      traceId: `trace:${input.cycleId}`,
      correlationId: input.finding.findingId,
      declaredOrigin: "conductor.orchestration-cycle",
    },
  });
  if (!written.ok) return { ok: false, error: written.error };

  return {
    ok: true,
    recordId,
    written: true,
    provenance: `conductor:orchestrator|cycle:${input.cycleId}|generatedByAi:true|verified:false`,
  };
}

/**
 * Retrieve Conductor' own prior decision records for the tenant (the LEARN
 * input). Authorization-gated by the substrate; the result may be EMPTY —
 * memory absence never asserts state (§9).
 */
export async function retrieveConductorDecisionMemory(
  adapter: MemoryTierAdapter,
  input: { tenantId: string; conductorId: string; now: string },
): Promise<{ ok: true; records: readonly MemoryRecord[] } | { ok: false; error: string }> {
  const result = await adapter.retrieve(
    {
      identityRef: input.conductorId,
      tenantId: input.tenantId,
      scopeId: conductorMemoryScopeId(input.tenantId),
      permissions: [],
      purpose: "conductor-cycle-learning",
    },
    { now: input.now },
  );
  const records = result.records.filter((record) => record.domain === CONDUCTOR_MEMORY_DOMAIN);
  return { ok: true, records };
}

/**
 * CoreGrid — Hermes memory through the CANONICAL memory tier
 * (MISSION V1-002).
 *
 * Hermes keeps NO second memory architecture: every Hermes memory act runs
 * through the canonical durable memory substrate (`lib/memory/` — the
 * `MemoryTierAdapter` seam over `memory-store.ts`), which enforces the
 * declared-scope write bound (J-017), the authorization-gated retrieval and
 * the audited access log by construction.
 *
 * Provenance law (AGENTS §9/§12): Hermes' own memory records are stamped as
 * AI-GENERATED, UNVERIFIED intelligence (`generatedByAi: true`,
 * `verified: false`) — memory is never canonical truth. Hermes decisions
 * about system state are only ever RECORDED here; their truth lives in the
 * DB-backed mission/worker/evidence ports the cycle observes.
 *
 * Scope discipline: Hermes operates through ONE declared scope per tenant
 * (`hermes:scope:<tenantId>`, domain `orchestration`, sensitivity ceiling
 * `internal`, actor scope = the governed Hermes worker id). An undeclared
 * scope grants nothing; out-of-scope writes are REJECTED by the substrate,
 * never clamped.
 *
 * Boundary: thin, pure-logic adapter usage only. No vendor, no I/O of its
 * own (the adapter owns persistence), no wall-clock sampling.
 */

import type { MemoryTierAdapter } from "../memory/memory-adapter";
import type { MemoryRecord } from "../memory/memory-store";
import {
  HERMES_MEMORY_DOMAIN,
  type HermesActionClass,
  type HermesFinding,
} from "./hermes-contract";

/** The declared Hermes memory scope for one tenant. */
export function hermesMemoryScopeId(tenantId: string): string {
  return `hermes:scope:${tenantId}`;
}

/** Declare Hermes' bounded memory scope (idempotent; provenance required §12). */
export async function declareHermesMemoryScope(
  adapter: MemoryTierAdapter,
  input: { tenantId: string; hermesId: string },
): Promise<{ ok: true; scopeId: string; alreadyDeclared: boolean } | { ok: false; error: string }> {
  const scopeId = hermesMemoryScopeId(input.tenantId);
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
      actorScope: [input.hermesId],
      domains: [HERMES_MEMORY_DOMAIN],
      maxSensitivity: "internal",
    },
    declaredBy: input.hermesId,
  });
  if (!declared.ok) return { ok: false, error: declared.error };
  return { ok: true, scopeId, alreadyDeclared: false };
}

/** The deterministic memory-record id of a recorded Hermes decision. */
export function hermesDecisionRecordId(findingId: string): string {
  return `hermes:decision:${findingId}`;
}

/**
 * Record ONE Hermes cycle decision as a provenance-stamped memory record.
 * Idempotent: a decision already recorded for the finding is left verbatim
 * (the substrate rejects duplicate ids; Hermes checks first and skips).
 */
export async function writeHermesDecisionMemory(
  adapter: MemoryTierAdapter,
  input: {
    tenantId: string;
    hermesId: string;
    finding: HermesFinding;
    proposedAction: HermesActionClass;
    cycleId: string;
    now: string;
  },
): Promise<
  | { ok: true; recordId: string; written: boolean; provenance: string }
  | { ok: false; error: string }
> {
  const scopeId = hermesMemoryScopeId(input.tenantId);
  const recordId = hermesDecisionRecordId(input.finding.findingId);

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
    identityRef: input.hermesId,
    tenantId: input.tenantId,
    missionRef: null,
    memoryClass: "practical",
    domain: HERMES_MEMORY_DOMAIN,
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
      createdBy: input.hermesId,
      updatedBy: input.hermesId,
      // §12 provenance: who (Hermes), what source (the cycle), AI-generated,
      // UNVERIFIED — memory is never canonical truth (§9).
      provenance: {
        source: "hermes:orchestrator",
        sourceRef: `cycle:${input.cycleId}`,
        recordedBy: input.hermesId,
        originTenantId: input.tenantId,
        generatedByAi: true,
        verified: false,
      },
      policyContext: { purpose: "hermes-orchestration" },
      traceId: `trace:${input.cycleId}`,
      correlationId: input.finding.findingId,
      declaredOrigin: "hermes.orchestration-cycle",
    },
  });
  if (!written.ok) return { ok: false, error: written.error };

  return {
    ok: true,
    recordId,
    written: true,
    provenance: `hermes:orchestrator|cycle:${input.cycleId}|generatedByAi:true|verified:false`,
  };
}

/**
 * Retrieve Hermes' own prior decision records for the tenant (the LEARN
 * input). Authorization-gated by the substrate; the result may be EMPTY —
 * memory absence never asserts state (§9).
 */
export async function retrieveHermesDecisionMemory(
  adapter: MemoryTierAdapter,
  input: { tenantId: string; hermesId: string; now: string },
): Promise<{ ok: true; records: readonly MemoryRecord[] } | { ok: false; error: string }> {
  const result = await adapter.retrieve(
    {
      identityRef: input.hermesId,
      tenantId: input.tenantId,
      scopeId: hermesMemoryScopeId(input.tenantId),
      permissions: [],
      purpose: "hermes-cycle-learning",
    },
    { now: input.now },
  );
  const records = result.records.filter((record) => record.domain === HERMES_MEMORY_DOMAIN);
  return { ok: true, records };
}

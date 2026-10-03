/**
 * CoreGrid — governed worker identity registry, DB adapter
 * (MISSION V1-003, team WORKFORCE).
 *
 * Persists the PERSISTENT half of the governed worker lifecycle (§28) into
 * the worker-definition substrate tables
 * (`20261002000002_coregrid_v1_worker_definitions.sql`) and the
 * live-state/quarantine surfaces authored by
 * `20261003000019_coregrid_v1_mission_lease.sql`:
 *
 *   registerWorker         → cg_worker_definition (envelope-stamped,
 *                            V1CAP-002) + cg_worker_capability rows
 *   grantDelegation        → cg_worker_delegation_grant (LIVE state,
 *                            'active') + cg_worker_delegation (append-only
 *                            RULING-3 history ref) + definition
 *                            delegation_history_refs mirror
 *   revokeDelegation       → grant state → 'revoked' (who/when/why); takes
 *                            effect IMMEDIATELY at the next gate check
 *   quarantineWorker       → cg_worker_quarantine ledger row + definition
 *                            lifecycle_state → 'suspended' (persistent,
 *                            immediate freeze)
 *   resolveWorkerAuthority → definition + capabilities + ACTIVE grants +
 *                            quarantine check → neutral-RBAC actor context
 *                            via `buildWorkerMissionActor`
 *                            (worker-registry.ts)
 *   workerLeaseGate        → the read-time `WorkerLeaseGate` the mission
 *                            lease adapter
 *                            (missions/mission-lease-db.server.ts)
 *                            consults at WAKE: quarantined / non-usable /
 *                            fully-revoked workers are NOT leased to.
 *
 * Security posture (the substrates' own law): RLS on every table is
 * deny-by-default (enabled, zero policies, anon/authenticated revoked), so
 * this adapter runs on the SERVICE-ROLE client; authorization decisions for
 * the mission path are made by the neutral RBAC core through the resolved
 * actor context — these tables grant nothing by themselves. Rows read back
 * are Zod-validated (untrusted reads fail closed).
 *
 * Boundary: infrastructure adapter only. No execution runtime, no host loop
 * (owned by `worker-host.ts`).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { AgentRiskClassification } from "../agent-core";
import {
  stampKernelDraft,
  validateKernelRowEnvelope,
  type KernelObjectEnvelopeInput,
} from "../kernel/reality";
import { isIdentityUsable } from "../identity";
import type { WorkerDefinition } from "./worker-definition";
import {
  buildWorkerMissionActor,
  delegationGrantInputSchema,
  validateWorkerRegistration,
  workerDelegationGrantStateSchema,
  workerRegistrationInputSchema,
  type DelegationGrantInput,
  type WorkerDelegationGrantState,
  type WorkerRegistrationInput,
} from "./worker-registry";
import type { WorkerLeaseGate } from "../missions/mission-lease-db.server";
import type { MissionActorContext } from "../missions/mission-authorization";

/** Service-role client posture (same as missions/mission-execution-db.server.ts). */
export type WorkerRegistryDbClient = SupabaseClient;

export const WORKER_REGISTRY_OBJECT_TYPE = "worker_definition";

/* ─────────────────────────────────────────────────────────────
 * Row schemas — the untrusted read boundary (Zod, fail-closed)
 * ────────────────────────────────────────────────────────────*/

const riskClassSchema = z.custom<AgentRiskClassification>(
  (value) => value === "low" || value === "medium" || value === "high" || value === "critical",
);

const definitionRowSchema = z.object({
  id: z.string().min(1).max(160),
  tenant_id: z.string().min(1).max(128),
  identity_id: z.string().uuid(),
  classification: z.enum(["human", "ai"]),
  lifecycle_state: z.enum(["provisioned", "active", "suspended", "archived", "deleted"]),
  max_risk_class: riskClassSchema,
  resource_scopes: z.array(z.string()),
  delegation_history_refs: z.array(z.string()),
});

const capabilityRowSchema = z.object({
  definition_id: z.string().min(1).max(160),
  capability_id: z.string().min(1).max(160),
  description: z.string().min(1).max(500),
});

const grantRowSchema = z.object({
  id: z.string().min(1).max(160),
  tenant_id: z.string().min(1).max(128),
  definition_id: z.string().min(1).max(160),
  delegation_ref: z.string().min(1).max(200),
  delegated_capabilities: z.array(z.string()),
  max_granted_risk_class: riskClassSchema,
  state: z.enum(["active", "revoked"]),
});

const quarantineRowSchema = z.object({
  id: z.string().min(1).max(160),
  tenant_id: z.string().min(1).max(128),
  definition_id: z.string().min(1).max(160),
  state: z.enum(["quarantined", "released"]),
});

type WorkerTable =
  | "cg_worker_definition"
  | "cg_worker_capability"
  | "cg_worker_delegation"
  | "cg_worker_delegation_grant"
  | "cg_worker_quarantine";

function persistenceFailed(table: WorkerTable, error: { message: string }): Error {
  return new Error(`worker registry persistence failed for ${table}: ${error.message}`);
}

function loadFailed(table: WorkerTable, error: { message: string }): Error {
  return new Error(`worker registry load failed for ${table}: ${error.message}`);
}

function invalid(reason: string): { ok: false; reason: string } {
  return { ok: false, reason };
}

export interface WorkerRegistryDb {
  /** Persist a governed worker definition + its capability claims. */
  registerWorker(
    input: WorkerRegistrationInput,
  ): Promise<{ ok: true; definitionId: string; replayed: boolean } | { ok: false; reason: string }>;

  /** Record a LIVE delegation grant + its append-only history reference. */
  grantDelegation(
    input: DelegationGrantInput,
  ): Promise<{ ok: true; grantId: string; replayed: boolean } | { ok: false; reason: string }>;

  /** Revoke a delegation grant — effective at the NEXT gate check. */
  revokeDelegation(input: {
    tenantId: string;
    definitionId: string;
    grantId: string;
    revokedBy: string;
    reason: string;
    now: string;
  }): Promise<{ ok: true; replayed: boolean } | { ok: false; reason: string }>;

  /** Record quarantine + suspend the definition (persistent, immediate). */
  quarantineWorker(input: {
    tenantId: string;
    definitionId: string;
    reason: string;
    failureCount: number;
    threshold: number;
    quarantinedBy: string;
    now: string;
  }): Promise<{ ok: true } | { ok: false; reason: string }>;

  /** Resolve the worker's mission actor context (gate + grants → RBAC). */
  resolveWorkerAuthority(input: {
    tenantId: string;
    definitionId: string;
    missionId: string;
  }): Promise<{ ok: true; actor: MissionActorContext } | { ok: false; reason: string }>;

  /** The read-time lease gate: quarantine ∘ lifecycle ∘ active-grant. */
  workerLeaseGate(): WorkerLeaseGate;
}

export function createWorkerRegistryDb(client: WorkerRegistryDbClient): WorkerRegistryDb {
  async function selectRows(
    table: WorkerTable,
    filters: ReadonlyArray<readonly [string, string]>,
  ): Promise<Record<string, unknown>[]> {
    let query = client.from(table).select("*");
    for (const [column, value] of filters) {
      query = query.eq(column, value);
    }
    const result = await query;
    if (result.error) throw loadFailed(table, result.error);
    return (result.data ?? []) as Record<string, unknown>[];
  }

  async function maybeRow(
    table: WorkerTable,
    filters: ReadonlyArray<readonly [string, string]>,
  ): Promise<Record<string, unknown> | null> {
    let query = client.from(table).select("*");
    for (const [column, value] of filters) {
      query = query.eq(column, value);
    }
    const result = await query.maybeSingle();
    if (result.error) throw loadFailed(table, result.error);
    return (result.data ?? null) as Record<string, unknown> | null;
  }

  async function insertRow(table: WorkerTable, row: Record<string, unknown>): Promise<void> {
    const result = await client.from(table).insert(row);
    if (result.error) throw persistenceFailed(table, result.error);
  }

  async function updateRows(
    table: WorkerTable,
    patch: Record<string, unknown>,
    filters: ReadonlyArray<readonly [string, string]>,
  ): Promise<void> {
    let query = client.from(table).update(patch);
    for (const [column, value] of filters) {
      query = query.eq(column, value);
    }
    const result = await query;
    if (result.error) throw persistenceFailed(table, result.error);
  }

  function parseOrThrow<T extends z.ZodTypeAny>(
    table: WorkerTable,
    schema: T,
    row: Record<string, unknown>,
  ): z.infer<T> {
    const parsed = schema.safeParse(row);
    if (!parsed.success) {
      throw new Error(
        `worker registry load failed for ${table}: row validation rejected — ${parsed.error.message}`,
      );
    }
    return parsed.data as z.infer<T>;
  }

  async function loadDefinition(
    tenantId: string,
    definitionId: string,
  ): Promise<WorkerDefinition | null> {
    const row = await maybeRow("cg_worker_definition", [
      ["tenant_id", tenantId],
      ["id", definitionId],
    ]);
    if (row === null) return null;
    // The anonymous-object gate (J-001): an unstamped/half-stamped
    // definition row never enters authority resolution.
    validateKernelRowEnvelope(row);
    const parsed = parseOrThrow("cg_worker_definition", definitionRowSchema, row);
    const capabilityRows = await selectRows("cg_worker_capability", [
      ["tenant_id", tenantId],
      ["definition_id", definitionId],
    ]);
    const capabilities = capabilityRows.map((cap) =>
      parseOrThrow("cg_worker_capability", capabilityRowSchema, cap),
    );
    return {
      id: parsed.id,
      tenantScope: parsed.tenant_id,
      identityRef: parsed.identity_id,
      classification: parsed.classification,
      capabilities: capabilities.map((cap) => ({
        capabilityId: cap.capability_id,
        description: cap.description,
      })),
      authorityBounds: {
        maxRiskClass: parsed.max_risk_class,
        resourceScopes: parsed.resource_scopes,
      },
      delegationHistoryRefs: parsed.delegation_history_refs,
      lifecycle: parsed.lifecycle_state,
    };
  }

  async function activeGrantCount(tenantId: string, definitionId: string): Promise<number> {
    const grantRows = await selectRows("cg_worker_delegation_grant", [
      ["tenant_id", tenantId],
      ["definition_id", definitionId],
      ["state", "active"],
    ]);
    return grantRows.length;
  }

  return {
    async registerWorker(input) {
      const validated = validateWorkerRegistration(input);
      if (!validated.ok) return invalid(validated.errors.join("; "));
      const definition = validated.definition;

      const existing = await maybeRow("cg_worker_definition", [
        ["tenant_id", definition.tenantScope],
        ["id", definition.id],
      ]);
      if (existing !== null) {
        // Idempotent replay: the registered definition is canonical truth (§10).
        return { ok: true, definitionId: definition.id, replayed: true };
      }

      const registration = workerRegistrationInputSchema.parse(input);
      const envelopeInput: KernelObjectEnvelopeInput = {
        objectType: WORKER_REGISTRY_OBJECT_TYPE,
        schemaVersion: registration.schemaVersion,
        status: "active",
        createdBy: registration.createdBy,
        updatedBy: registration.createdBy,
        provenance: {
          source: "workforce.worker-registry",
          sourceRef: definition.id,
          recordedBy: registration.createdBy,
          originTenantId: definition.tenantScope,
          generatedByAi: false,
          verified: false,
        },
        policyContext: { tenantScope: definition.tenantScope },
        traceId: registration.traceId,
        correlationId: registration.correlationId,
        declaredOrigin: registration.declaredOrigin,
      };
      const stamped = stampKernelDraft(
        { tenant_id: definition.tenantScope, created_by: registration.createdBy },
        envelopeInput,
      );

      await insertRow("cg_worker_definition", {
        ...stamped,
        id: definition.id,
        tenant_id: definition.tenantScope,
        identity_id: definition.identityRef,
        classification: definition.classification,
        lifecycle_state: definition.lifecycle,
        max_risk_class: definition.authorityBounds.maxRiskClass,
        resource_scopes: [...definition.authorityBounds.resourceScopes],
        delegation_history_refs: [...definition.delegationHistoryRefs],
        created_by: registration.createdBy,
      });
      for (const claim of definition.capabilities) {
        await insertRow("cg_worker_capability", {
          definition_id: definition.id,
          tenant_id: definition.tenantScope,
          capability_id: claim.capabilityId,
          description: claim.description,
        });
      }
      return { ok: true, definitionId: definition.id, replayed: false };
    },

    async grantDelegation(input) {
      const parsed = delegationGrantInputSchema.safeParse(input);
      if (!parsed.success) return invalid(`delegation grant rejected: ${parsed.error.message}`);
      const grant = parsed.data;
      const loaded = await loadDefinition(grant.tenantId, grant.definitionId);
      if (loaded === null) {
        return invalid(
          `worker definition ${grant.definitionId} is not registered in tenant ${grant.tenantId}`,
        );
      }

      const existingGrant = await maybeRow("cg_worker_delegation_grant", [
        ["tenant_id", grant.tenantId],
        ["id", grant.grantId],
      ]);
      if (existingGrant !== null) {
        // Idempotent replay (§10): the recorded grant state is canonical truth.
        return { ok: true, grantId: grant.grantId, replayed: true };
      }

      await insertRow("cg_worker_delegation_grant", {
        id: grant.grantId,
        tenant_id: grant.tenantId,
        definition_id: grant.definitionId,
        delegation_ref: grant.delegationRef,
        delegated_capabilities: [...grant.delegatedCapabilities],
        max_granted_risk_class: grant.maxGrantedRiskClass,
        state: "active",
        granted_by: grant.grantedBy,
      });
      // Append-only RULING-3 history reference (the live grant row above is
      // the state surface; this row is the attribution record).
      await insertRow("cg_worker_delegation", {
        id: grant.grantId,
        tenant_id: grant.tenantId,
        definition_id: grant.definitionId,
        delegation_ref: grant.delegationRef,
        delegated_capabilities: [...grant.delegatedCapabilities],
        max_granted_risk_class: grant.maxGrantedRiskClass,
        recorded_by: grant.grantedBy,
      });
      await updateRows(
        "cg_worker_definition",
        {
          delegation_history_refs: [...loaded.delegationHistoryRefs, grant.delegationRef],
        },
        [
          ["tenant_id", grant.tenantId],
          ["id", grant.definitionId],
        ],
      );
      return { ok: true, grantId: grant.grantId, replayed: false };
    },

    async revokeDelegation(input) {
      const existing = await maybeRow("cg_worker_delegation_grant", [
        ["tenant_id", input.tenantId],
        ["id", input.grantId],
      ]);
      if (existing === null) {
        return invalid(`delegation grant ${input.grantId} not found in tenant ${input.tenantId}`);
      }
      const grant = parseOrThrow("cg_worker_delegation_grant", grantRowSchema, existing);
      if (grant.definition_id !== input.definitionId) {
        return invalid(
          `delegation grant ${input.grantId} does not belong to worker ${input.definitionId}`,
        );
      }
      if (grant.state === "revoked") {
        // Replay: revocation is idempotent; the recorded revocation stands.
        return { ok: true, replayed: true };
      }
      const reason = z.string().trim().min(1).max(500).safeParse(input.reason);
      if (!reason.success) {
        return invalid(`revocation requires a reason: ${reason.error.message}`);
      }
      await updateRows(
        "cg_worker_delegation_grant",
        {
          state: "revoked",
          revoked_by: input.revokedBy,
          revoked_at: input.now,
          revoked_reason: reason.data,
        },
        [
          ["tenant_id", input.tenantId],
          ["id", input.grantId],
        ],
      );
      return { ok: true, replayed: false };
    },

    async quarantineWorker(input) {
      const loaded = await loadDefinition(input.tenantId, input.definitionId);
      if (loaded === null) {
        return invalid(
          `worker definition ${input.definitionId} is not registered in tenant ${input.tenantId}`,
        );
      }
      await insertRow("cg_worker_quarantine", {
        id: `${input.definitionId}:quarantine:${input.now}`,
        tenant_id: input.tenantId,
        definition_id: input.definitionId,
        reason: input.reason.slice(0, 500),
        failure_count: input.failureCount,
        failure_threshold: input.threshold,
        state: "quarantined",
        quarantined_by: input.quarantinedBy,
      });
      // Persistent, immediate freeze: a suspended definition can never
      // resolve an actor (worker_lifecycle_unusable at the gate).
      await updateRows("cg_worker_definition", { lifecycle_state: "suspended" }, [
        ["tenant_id", input.tenantId],
        ["id", input.definitionId],
      ]);
      return { ok: true };
    },

    async resolveWorkerAuthority({ tenantId, definitionId, missionId }) {
      const loaded = await loadDefinition(tenantId, definitionId);
      if (loaded === null) {
        return invalid(`worker definition ${definitionId} is not registered in tenant ${tenantId}`);
      }
      // Quarantine gate (read-time): a quarantined worker is not leased to.
      const quarantineRows = await selectRows("cg_worker_quarantine", [
        ["tenant_id", tenantId],
        ["definition_id", definitionId],
        ["state", "quarantined"],
      ]);
      for (const row of quarantineRows) {
        parseOrThrow("cg_worker_quarantine", quarantineRowSchema, row);
      }
      if (quarantineRows.length > 0) {
        return invalid("worker_quarantined:failure bound reached — no longer leased to");
      }

      const grantRows = await selectRows("cg_worker_delegation_grant", [
        ["tenant_id", tenantId],
        ["definition_id", definitionId],
      ]);
      const grants: WorkerDelegationGrantState[] = grantRows.map((row) => {
        const parsed = parseOrThrow("cg_worker_delegation_grant", grantRowSchema, row);
        return workerDelegationGrantStateSchema.parse({
          grantId: parsed.id,
          definitionId: parsed.definition_id,
          delegationRef: parsed.delegation_ref,
          delegatedCapabilities: parsed.delegated_capabilities,
          maxGrantedRiskClass: parsed.max_granted_risk_class,
          state: parsed.state,
        });
      });

      const resolution = buildWorkerMissionActor({
        definition: loaded,
        grants,
        tenantId,
        missionId,
      });
      if (!resolution.ok) return invalid(resolution.reason);
      return { ok: true, actor: resolution.actor };
    },

    workerLeaseGate(): WorkerLeaseGate {
      return async ({ tenantId, workerId }) => {
        // Read-time, never cached: quarantine, lifecycle and live delegation
        // state are evaluated at EVERY gate check (revocation and quarantine
        // take effect at the next check, immediately).
        const loaded = await loadDefinition(tenantId, workerId);
        if (loaded === null) {
          return { ok: false, reason: `worker_not_registered:${workerId}` };
        }
        if (!isIdentityUsable({ lifecycle: loaded.lifecycle })) {
          return { ok: false, reason: `worker_lifecycle_unusable:${loaded.lifecycle}` };
        }
        const quarantineRows = await selectRows("cg_worker_quarantine", [
          ["tenant_id", tenantId],
          ["definition_id", workerId],
          ["state", "quarantined"],
        ]);
        if (quarantineRows.length > 0) {
          return {
            ok: false,
            reason: "worker_quarantined:failure bound reached — no longer leased to",
          };
        }
        const activeGrants = await activeGrantCount(tenantId, workerId);
        if (activeGrants === 0) {
          return {
            ok: false,
            reason: "worker_not_delegated:no active delegation grant (Invariant 12)",
          };
        }
        return { ok: true };
      };
    },
  };
}

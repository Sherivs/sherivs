/**
 * Sherivs — governed worker identity registry, DB adapter
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
 *   resolveWorkerAuthority → definition + capabilities + active, effective,
 *                            unexpired, mission-scoped grant + quarantine
 *                            check → neutral-RBAC actor context
 *                            via `buildWorkerMissionActor`
 *                            (worker-registry.ts)
 *   workerLeaseGate        → the read-time `WorkerLeaseGate` the mission
 *                            lease adapter consults at acquisition,
 *                            heartbeat, and completion: quarantined,
 *                            non-usable, revoked, expired, or mis-scoped
 *                            workers are denied.
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
  granted_at: z.string().datetime({ offset: true }),
  expires_at: z.string().datetime({ offset: true }).nullable(),
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
    correlationId: string;
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
    now: string;
  }): Promise<
    { ok: true; actor: MissionActorContext; grantId: string } | { ok: false; reason: string }
  >;

  /** The read-time gate: quarantine ∘ lifecycle ∘ active, bounded mission grant. */
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

  async function loadGrants(
    tenantId: string,
    definitionId: string,
  ): Promise<WorkerDelegationGrantState[]> {
    const grantRows = await selectRows("cg_worker_delegation_grant", [
      ["tenant_id", tenantId],
      ["definition_id", definitionId],
    ]);
    return grantRows.map((row) => {
      const parsed = parseOrThrow("cg_worker_delegation_grant", grantRowSchema, row);
      return workerDelegationGrantStateSchema.parse({
        grantId: parsed.id,
        definitionId: parsed.definition_id,
        delegationRef: parsed.delegation_ref,
        delegatedCapabilities: parsed.delegated_capabilities,
        maxGrantedRiskClass: parsed.max_granted_risk_class,
        state: parsed.state,
        grantedAt: parsed.granted_at,
        expiresAt: parsed.expires_at,
      });
    });
  }

  function matchingExecutionGrant(
    grants: readonly WorkerDelegationGrantState[],
    definitionId: string,
    missionId: string,
    now: string,
  ): WorkerDelegationGrantState | null {
    const required = `mission:execute:${missionId}`;
    const wildcard = "mission:execute:*";
    return (
      grants.find(
        (grant) =>
          grant.definitionId === definitionId &&
          grant.state === "active" &&
          Date.parse(grant.grantedAt) <= Date.parse(now) &&
          grant.expiresAt !== null &&
          Date.parse(grant.expiresAt) > Date.parse(now) &&
          grant.delegatedCapabilities.includes(required),
      ) ??
      grants.find(
        (grant) =>
          grant.definitionId === definitionId &&
          grant.state === "active" &&
          Date.parse(grant.grantedAt) <= Date.parse(now) &&
          grant.expiresAt !== null &&
          Date.parse(grant.expiresAt) > Date.parse(now) &&
          grant.delegatedCapabilities.includes(wildcard),
      ) ??
      null
    );
  }

  async function resolveWorkerAuthority(input: {
    tenantId: string;
    definitionId: string;
    missionId: string;
    now: string;
  }): Promise<
    { ok: true; actor: MissionActorContext; grantId: string } | { ok: false; reason: string }
  > {
    const { tenantId, definitionId, missionId, now } = input;
    const loaded = await loadDefinition(tenantId, definitionId);
    if (loaded === null) {
      return invalid(`worker definition ${definitionId} is not registered in tenant ${tenantId}`);
    }
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

    const grants = await loadGrants(tenantId, definitionId);
    const grant = matchingExecutionGrant(grants, definitionId, missionId, now);
    if (grant === null) {
      return invalid("worker_not_delegated:no active, unexpired, scope-matching execution grant");
    }
    const resolution = buildWorkerMissionActor({
      definition: loaded,
      grants: [grant],
      tenantId,
      missionId,
      now,
    });
    if (!resolution.ok) return invalid(resolution.reason);
    const executionScope = `${tenantId}:mission:${missionId}`;
    const executionPermission = resolution.actor.extraPermissions?.find(
      (permission) =>
        permission.resource === "mission" &&
        permission.action === "execute" &&
        permission.scope === executionScope,
    );
    if (executionPermission === undefined) {
      return invalid("worker_not_delegated:no mission-scoped execution permission");
    }
    return {
      ok: true,
      actor: { ...resolution.actor, extraPermissions: [executionPermission] },
      grantId: grant.grantId,
    };
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
      if (Date.parse(grant.expiresAt) <= Date.parse(grant.grantedAt)) {
        return invalid("delegation grant expiry must be after its grant instant");
      }
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
        const sameContent =
          existingGrant.definition_id === grant.definitionId &&
          existingGrant.delegation_ref === grant.delegationRef &&
          JSON.stringify(existingGrant.delegated_capabilities) ===
            JSON.stringify(grant.delegatedCapabilities) &&
          existingGrant.max_granted_risk_class === grant.maxGrantedRiskClass &&
          existingGrant.granted_by === grant.grantedBy &&
          typeof existingGrant.granted_at === "string" &&
          Date.parse(existingGrant.granted_at) === Date.parse(grant.grantedAt) &&
          typeof existingGrant.expires_at === "string" &&
          Date.parse(existingGrant.expires_at) === Date.parse(grant.expiresAt);
        if (!sameContent) {
          return invalid(`delegation grant ${grant.grantId} already exists with different content`);
        }
        return { ok: true, grantId: grant.grantId, replayed: true };
      }

      const persisted = await client.rpc("cg_worker_grant_delegation", {
        p_tenant_id: grant.tenantId,
        p_definition_id: grant.definitionId,
        p_grant_id: grant.grantId,
        p_delegation_ref: grant.delegationRef,
        p_delegated_capabilities: grant.delegatedCapabilities,
        p_max_granted_risk_class: grant.maxGrantedRiskClass,
        p_granted_by: grant.grantedBy,
        p_granted_at: grant.grantedAt,
        p_expires_at: grant.expiresAt,
        p_correlation_id: grant.correlationId,
      });
      if (persisted.error) throw persistenceFailed("cg_worker_delegation_grant", persisted.error);
      if (typeof persisted.data !== "boolean") {
        throw new Error("worker delegation grant transaction returned an invalid result");
      }
      return { ok: true, grantId: grant.grantId, replayed: !persisted.data };
    },

    async revokeDelegation(input) {
      const validated = z
        .object({
          tenantId: z.string().trim().min(1).max(128),
          definitionId: z.string().trim().min(1).max(160),
          grantId: z.string().trim().min(1).max(160),
          revokedBy: z.string().trim().min(1).max(160),
          reason: z.string().trim().min(1).max(500),
          now: z.string().datetime(),
          correlationId: z.string().trim().min(1).max(200),
        })
        .strict()
        .safeParse(input);
      if (!validated.success)
        return invalid(`delegation revocation rejected: ${validated.error.message}`);
      input = validated.data;
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
      const reason = z.string().trim().min(1).max(500).safeParse(input.reason);
      if (!reason.success) {
        return invalid(`revocation requires a reason: ${reason.error.message}`);
      }
      const persisted = await client.rpc("cg_worker_revoke_delegation", {
        p_tenant_id: input.tenantId,
        p_definition_id: input.definitionId,
        p_grant_id: input.grantId,
        p_revoked_by: input.revokedBy,
        p_reason: reason.data,
        p_now: input.now,
        p_correlation_id: input.correlationId,
      });
      if (persisted.error) throw persistenceFailed("cg_worker_delegation_grant", persisted.error);
      if (typeof persisted.data !== "boolean") {
        throw new Error("worker delegation revocation transaction returned an invalid result");
      }
      return { ok: true, replayed: !persisted.data };
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

    resolveWorkerAuthority,

    workerLeaseGate(): WorkerLeaseGate {
      return async ({ tenantId, workerId, missionId, now }) => {
        // Reuse the full live authority check so expiry, scope, capability
        // integrity, risk ceiling, lifecycle, and quarantine stay aligned.
        const authority = await resolveWorkerAuthority({
          tenantId,
          definitionId: workerId,
          missionId,
          now,
        });
        return authority.ok ? { ok: true } : { ok: false, reason: authority.reason };
      };
    },
  };
}

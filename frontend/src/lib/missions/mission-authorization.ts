/**
 * CoreGrid — mission execution authorization contribution (MISSION V1-004).
 *
 * The mission domain's contribution to the NEUTRAL RBAC core
 * (`rbac/domain-contribution.ts` + `rbac/neutral-roles.ts`), following the
 * DomainDefinition registration pattern proven by
 * `domain-config/scholar-authorization.ts` (V1-006). Every mission execution
 * operation resolves its decision through the combined authorization engine
 * (`authorization.ts`): neutral lifecycle gate → tenant boundary gate →
 * RBAC role grants → default DENY. Education terms never appear here — the
 * vocabulary is the neutral universal-role and permission vocabulary
 * (RULING-4: domain -> neutral only).
 *
 * Roles contributed (domain -> neutral semantics):
 *   mission_owner    → ADMINISTRATOR + OWNER  (manage intents, recover)
 *   mission_operator → OPERATOR + WORKER      (assign, lease, execute, report)
 *   mission_verifier → REVIEWER               (independent verification)
 *
 * Agent authority (Invariant 12): role membership is never a source of agent
 * authority — an `ai_agent`/worker identity acts only through explicit
 * delegation grants (`extraPermissions`), so a worker can never self-authorize
 * into the execution path.
 *
 * Boundary: configuration + pure decision functions. No persistence, no I/O.
 */

import {
  domainPermissionResource,
  type IdentityId,
  type IdentityKind,
  type IdentityLifecycleState,
  type Permission,
} from "../identity";
import { authorize, makeAuthorizationRequest, type CoreGridRole } from "../authorization";
import {
  registerDomainAuthorization,
  domainRole,
  type DomainRoleContribution,
} from "../rbac/domain-contribution";
import type { UniversalRole } from "../universal-roles";
import { z } from "zod";

/** The mission path's permission resource — contributed, never added to the core union. */
export const MISSION_PERMISSION_RESOURCE = domainPermissionResource("mission");

export const MISSION_AUTHORIZATION_DOMAIN_ID = "mission_execution";

function missionPermission(action: Permission["action"], scope: string | null = null): Permission {
  return { resource: MISSION_PERMISSION_RESOURCE, action, scope };
}

export const MISSION_DOMAIN_ROLES: readonly DomainRoleContribution[] = [
  {
    domainRole: "mission_owner",
    neutralRoles: ["ADMINISTRATOR", "OWNER"] satisfies readonly UniversalRole[],
    permissions: [
      missionPermission("manage"),
      missionPermission("create"),
      missionPermission("read"),
    ],
    description:
      "Accountable owner of the tenant's mission substrate: declares intents, manages the execution path and recovers orphaned work.",
  },
  {
    domainRole: "mission_operator",
    neutralRoles: ["OPERATOR", "WORKER"] satisfies readonly UniversalRole[],
    permissions: [missionPermission("execute"), missionPermission("read")],
    description:
      "Runs assigned mission work: admits executions, acquires leases, heartbeats and reports outcomes with evidence.",
  },
  {
    domainRole: "mission_verifier",
    neutralRoles: ["REVIEWER"] satisfies readonly UniversalRole[],
    permissions: [missionPermission("verify"), missionPermission("read")],
    description:
      "Independent verifier of evidenced mission work; never the executor of the work it verifies.",
  },
];

let registered = false;

/**
 * Register the mission domain's authorization contribution (idempotent).
 * Throws fail-closed when the neutral core rejects the contribution — a
 * mission path without its RBAC contribution must not execute.
 */
export function ensureMissionAuthorizationRegistered(): void {
  if (registered) return;
  const result = registerDomainAuthorization({
    domainId: MISSION_AUTHORIZATION_DOMAIN_ID,
    roles: MISSION_DOMAIN_ROLES,
  });
  if (!result.ok) {
    throw new Error(`mission authorization contribution rejected: ${result.errors.join("; ")}`);
  }
  registered = true;
}

/* ─────────────────────────────────────────────────────────────
 * Actor context + capability decision
 * ────────────────────────────────────────────────────────────*/

export const MISSION_IDENTITY_KINDS = [
  "human",
  "institution",
  "organization",
  "ai_agent",
  "service",
  "device",
  "digital_twin",
  "external",
] as const satisfies readonly IdentityKind[];

/**
 * The acting identity's authorization context. `tenantId` is the
 * SERVER-RESOLVED tenant (never trusted from client payloads, AGENTS §26).
 */
export const missionActorContextSchema = z
  .object({
    actorId: z.string().trim().min(1).max(160),
    tenantId: z.string().trim().min(1).max(128),
    identityKind: z.enum(MISSION_IDENTITY_KINDS),
    lifecycle: z.enum([
      "proposed",
      "review",
      "provisioned",
      "active",
      "suspended",
      "deleted",
      "archived",
    ]),
    role: z.string().trim().min(1).max(160),
    isAgent: z.boolean().optional(),
    extraPermissions: z
      .array(
        z.object({
          resource: z.string().trim().min(1).max(160),
          action: z.string().trim().min(1).max(32),
          scope: z.string().max(200).nullable(),
        }),
      )
      .optional(),
  })
  .strict();

export type MissionActorContext = z.infer<typeof missionActorContextSchema>;

export type MissionCapability = "create" | "execute" | "verify";

/**
 * Resolve one mission operation's authorization through the combined engine.
 * The permission scope embeds the tenant (`<tenantId>:mission:<missionId>`),
 * so the engine's tenant boundary gate denies cross-tenant requests before
 * any grant layer is consulted (AGENTS §13/§26).
 */
export function authorizeMissionOperation(input: {
  actor: MissionActorContext;
  tenantId: string;
  missionId: string;
  capability: MissionCapability;
}): { ok: true } | { ok: false; reason: string } {
  ensureMissionAuthorizationRegistered();
  const { actor, tenantId, missionId, capability } = input;
  const scope = `${tenantId}:mission:${missionId}`;
  const result = authorize(
    makeAuthorizationRequest(
      {
        // The actor id is validated by missionActorContextSchema before it
        // reaches this boundary; the brand conversion is the sanctioned
        // boundary cast (same pattern as domainRole / domainPermissionResource).
        id: actor.actorId as IdentityId,
        kind: actor.identityKind,
        lifecycle: actor.lifecycle,
        tenantId: actor.tenantId,
      },
      MISSION_PERMISSION_RESOURCE,
      capability,
      scope,
    ),
    {
      role: domainRole(actor.role) as CoreGridRole,
      // Delegation grants arrive as schema-validated strings; the brand
      // conversions are the sanctioned boundary casts (same pattern as the
      // actorId cast above). Unknown actions simply never match a grant.
      extraPermissions: actor.extraPermissions?.map((grant) => ({
        resource: domainPermissionResource(grant.resource),
        action: grant.action as Permission["action"],
        scope: grant.scope,
      })),
      isAgent: actor.isAgent,
    },
  );
  return result.decision === "ALLOW" ? { ok: true } : { ok: false, reason: result.reason };
}

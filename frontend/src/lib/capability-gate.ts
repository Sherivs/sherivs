/**
 * CoreGrid — capability-code gate (Phase 08/06 enforcement primitive).
 *
 * A capability code is the atomic authorization unit of workspace chrome and
 * future per-feature server gates ("r001:org_admin.settings"). This module
 * parses codes strictly and evaluates them against a member's coarse
 * membership kind — FAILING CLOSED on malformed codes, unknown features,
 * unknown kinds and unknown roles. It grants nothing by itself: it is the
 * pattern every per-feature server gate an installed runtime adopts (Phases 11–13) so a
 * capability is never granted by accident.
 *
 * Role resolution is UNIVERSAL (V1CAP-014 / J-006, CTO RULING-4): every role
 * the gate accepts is resolved FORWARD into the neutral universal role
 * vocabulary (frontend/src/lib/universal-roles.ts) and checked against each
 * chrome kind's NEUTRAL membership — the gate never decides on a domain role
 * name. Direction is domain -> neutral only; no reverse resolution exists.
 *
 * The legacy identity-store role union (frontend/src/lib/roles.ts) is bridged
 * through the universal mapping engine below. The owning runtime declares the
 * authoritative mapping in its own layer
 * (the domain mapping table in the runtime layer); the bridge is deprecated and
 * proven coherent with that declaration by tests. It is deleted when identity
 * actors carry neutral roles natively (I-010 follow-through).
 *
 * Platform super-admin evaluation bypasses kind checks ONLY for codes the
 * runtime declared (mirrors the existing composite server gates). UI never
 * calls this for hiding: RLS + server functions remain the boundary.
 */
import type { AppRole } from "@/lib/roles";
import {
  defineDomainRoleMappings,
  isUniversalRole,
  resolveDomainRoleToNeutral,
  type DirectionalRoleMappings,
  type UniversalRole,
} from "@/lib/universal-roles";
import {
  isDeclaredRuntimeFeatureCode,
  // The runtime layer names its own nav kinds; the platform gate speaks of them
  // generically, so the runtime's vocabulary never becomes the platform's.
  type ScholarNavKind as RuntimeNavKind,
} from "@/lib/runtime/nav-registry";

const CAPABILITY_CODE = /^([a-z0-9]+):([a-z0-9_]+)\.([a-z0-9_.]+)$/;

export interface ParsedCapabilityCode {
  runtime: string;
  kind: string;
  feature: string;
}

/** Strict parse; null on any malformed code (fail closed). */
export function parseCapabilityCode(code: string): ParsedCapabilityCode | null {
  const match = CAPABILITY_CODE.exec(code);
  if (!match) return null;
  return { runtime: match[1], kind: match[2], feature: match[3] };
}

/* ─────────────────────────────────────────────────────────────
 * Neutral chrome-kind membership (V1CAP-014) — what each installed
 * chrome kind MEANS in the universal role vocabulary. The gate's
 * role checks resolve against THIS table.
 * ────────────────────────────────────────────────────────────*/
export const NEUTRAL_ROLES_FOR_NAV_KIND: Readonly<
  Record<RuntimeNavKind, readonly UniversalRole[]>
> = {
  org_admin: ["ADMINISTRATOR"],
  teacher: ["CONTRIBUTOR"],
  bursar: ["OPERATOR"],
  hq: ["SUPERVISOR"],
  super_admin: ["ADMINISTRATOR", "SYSTEM"],
  parent: ["MEMBER"],
  student: ["MEMBER"],
  driver: ["WORKER"],
};

/**
 * LEGACY BRIDGE (I-010) — deprecated. Maps the legacy identity-store role
 * union FORWARD into the neutral vocabulary through the universal mapping
 * engine, so the r001-era gate API keeps accepting identity-store roles while
 * every decision is made in neutral terms. The authoritative declaration of
 * these semantics is the owning runtime's domain mapping
 * (the domain mapping table in the runtime layer); coherence is test-enforced in
 * both directions. Deleted when identity actors carry neutral roles natively.
 */
const LEGACY_IDENTITY_STORE_ROLE_MAPPINGS: DirectionalRoleMappings = defineDomainRoleMappings({
  super_admin: ["ADMINISTRATOR", "SYSTEM"],
  hq: ["SUPERVISOR"],
  admin: ["ADMINISTRATOR"],
  principal: ["ADMINISTRATOR"],
  teacher: ["CONTRIBUTOR"],
  bursar: ["OPERATOR"],
  parent: ["MEMBER"],
  student: ["MEMBER"],
  driver: ["WORKER"],
});

/** Installed domain role mappings, in installation order (first declared wins). */
export const INSTALLED_DOMAIN_ROLE_MAPPINGS: readonly {
  domainId: string;
  mappings: DirectionalRoleMappings;
}[] = [{ domainId: "legacy-identity-store", mappings: LEGACY_IDENTITY_STORE_ROLE_MAPPINGS }];

/**
 * Resolve any role the gate accepts to its NEUTRAL roles:
 *  - an already-neutral role passes through unchanged;
 *  - a legacy identity-store role resolves forward through the declared
 *    domain mappings (never the reverse);
 *  - anything unknown resolves to nothing (null — the caller must fail closed).
 */
export function neutralRolesForIdentityRole(role: string): readonly UniversalRole[] | null {
  if (isUniversalRole(role)) return [role];
  for (const installed of INSTALLED_DOMAIN_ROLE_MAPPINGS) {
    const resolved = resolveDomainRoleToNeutral(installed.mappings, role);
    if (resolved !== null) return resolved;
  }
  return null;
}

/** Membership kinds that satisfy a runtime chrome kind (P08-equivalent). */
export const MEMBERSHIP_FOR_NAV_KIND: Readonly<Record<RuntimeNavKind, readonly AppRole[]>> = {
  org_admin: ["admin", "principal"],
  teacher: ["teacher"],
  bursar: ["bursar"],
  hq: ["hq"],
  super_admin: ["super_admin"],
  parent: ["parent"],
  student: ["student"],
  driver: ["driver"],
};

const ROUTED_NAV_KINDS = Object.keys(MEMBERSHIP_FOR_NAV_KIND) as RuntimeNavKind[];

export type CapabilityGateDecision =
  | {
      decision: "allow";
      reason: "Capability granted";
      /** Present (true) only on an opted-in allow that left actor liveness unverified. */
      lifecycleUnverified?: boolean;
    }
  | {
      decision: "deny";
      code: "malformed" | "unknown_feature" | "unknown_kind" | "role_required";
      reason: string;
    };

export interface RuntimeCapabilitySignals {
  code: string;
  /** A legacy identity-store role or an already-neutral universal role. */
  role: AppRole | UniversalRole;
  /** Platform super-admin evaluation (bypasses kind membership checks). */
  isPlatformSuper?: boolean;
  /**
   * Actor-context liveness (additive; AGENTS §31 — revoked access fails).
   * When explicitly false the capability is refused regardless of role,
   * including for platform super-admins. When absent the call keeps the
   * historical shape; an opted-in allow that leaves the flag unset carries
   * `lifecycleUnverified: true` so an unchecked gate is never mistaken for a
   * verified one.
   */
  actorActive?: boolean;
}

/**
 * Evaluate a runtime capability code against the membership kind that satisfies it. Every
 * non-allow path is an explicit DENY (AT.9) — malformed, undeclared,
 * unknown-kind and role-mismatch codes all fail closed.
 *
 * Role evaluation (V1CAP-014): the signal's role is resolved into the neutral
 * vocabulary and checked against the kind's neutral membership. A role with no
 * declared neutral resolution falls back to the legacy identity-store
 * membership table — itself a fail-closed path, so unknown roles deny.
 */
export function evaluateRuntimeCapability(
  signals: RuntimeCapabilitySignals,
): CapabilityGateDecision {
  // Actor-context liveness check (additive): a non-active actor context is
  // refused before anything else — role membership never resurrects it. The
  // deny code stays inside the gate's closed vocabulary ("role_required");
  // the reason carries the specificity.
  if (signals.actorActive === false) {
    return {
      decision: "deny",
      code: "role_required",
      reason: "Actor context is not active",
    };
  }
  const actorLivenessUnverified = "actorActive" in signals && signals.actorActive == null;

  const parsed = parseCapabilityCode(signals.code);
  if (!parsed) {
    return { decision: "deny", code: "malformed", reason: "Malformed capability code" };
  }
  const kind = parsed.kind as RuntimeNavKind;
  if (!ROUTED_NAV_KINDS.includes(kind)) {
    return {
      decision: "deny",
      code: "unknown_kind",
      reason: `Unknown chrome kind "${parsed.kind}"`,
    };
  }
  if (parsed.runtime !== "r001" || !isDeclaredRuntimeFeatureCode(signals.code)) {
    return {
      decision: "deny",
      code: "unknown_feature",
      reason: `Capability not declared by the installed runtime: ${signals.code}`,
    };
  }
  if (signals.isPlatformSuper) {
    const allow = { decision: "allow" as const, reason: "Capability granted" as const };
    return actorLivenessUnverified ? { ...allow, lifecycleUnverified: true } : allow;
  }
  const neutralRoles = neutralRolesForIdentityRole(signals.role);
  const allowed =
    neutralRoles !== null
      ? NEUTRAL_ROLES_FOR_NAV_KIND[kind].some((neutral) => neutralRoles.includes(neutral))
      : MEMBERSHIP_FOR_NAV_KIND[kind].includes(signals.role as AppRole);
  if (!allowed) {
    return {
      decision: "deny",
      code: "role_required",
      reason: `Role "${signals.role}" does not grant ${signals.code}`,
    };
  }
  const allow = { decision: "allow" as const, reason: "Capability granted" as const };
  return actorLivenessUnverified ? { ...allow, lifecycleUnverified: true } : allow;
}

/**
 * CoreGrid — universal organization model (V1-minimal, MISSION-V1-006).
 *
 * Pure, domain-neutral organization structure per V5.3 Part 7.2: organizations
 * are dynamically configurable trees of OrgUnits (organization | department |
 * team | branch | location) with memberships binding principals (humans or
 * workforce position refs — never domain-specific vocabulary) to units via
 * declared roles.
 *
 * Nothing here hard-codes "school" or any other domain: the universal model
 * speaks only of tenants, units, principals and roles (Part 46: no domain
 * contamination).
 *
 * Every operation is PURE and FAILS CLOSED: malformed inputs, unknown
 * references, cross-tenant links, undeclared roles and invalid lifecycle
 * transitions are explicit DENY decisions, never silent success.
 *
 * Authority boundary: resolveOrgScope derives a projection of org units a
 * principal is related to. It is a derived view, NEVER a permission grant —
 * authorization remains with the authorization stack (capability gates, RLS,
 * server-function policy), exactly like workspace membership does not grant
 * authority by itself.
 */
import type { TenantId } from "./tenant-core";

/* ─────────────────────────────────────────────────────────────
 * Branded references
 * ────────────────────────────────────────────────────────────*/

export type OrgUnitRef = string & { readonly __brand: "OrgUnitRef" };
export type PrincipalRef = string & { readonly __brand: "PrincipalRef" };
export type RoleRef = string & { readonly __brand: "RoleRef" };
export type OrgMembershipRef = string & { readonly __brand: "OrgMembershipRef" };

export function orgUnitRef(raw: string): OrgUnitRef {
  return raw as OrgUnitRef;
}
export function principalRef(raw: string): PrincipalRef {
  return raw as PrincipalRef;
}
export function roleRef(raw: string): RoleRef {
  return raw as RoleRef;
}
export function orgMembershipRef(raw: string): OrgMembershipRef {
  return raw as OrgMembershipRef;
}

/** Refs are short printable identifiers (mirrors the SQL CHECK lengths). */
const REF_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:@\-/]{0,159}$/;

function isWellFormedRef(value: string): boolean {
  return REF_PATTERN.test(value);
}

/* ─────────────────────────────────────────────────────────────
 * Vocabularies (domain-neutral; mirrors the V1 substrate checks)
 * ────────────────────────────────────────────────────────────*/

export const ORG_UNIT_KINDS = ["organization", "department", "team", "branch", "location"] as const;
export type OrgUnitKind = (typeof ORG_UNIT_KINDS)[number];

export const ORG_UNIT_LIFECYCLE_STATES = [
  "draft",
  "active",
  "suspended",
  "archived",
  "deleted",
] as const;
export type OrgUnitLifecycleState = (typeof ORG_UNIT_LIFECYCLE_STATES)[number];

export const ORG_MEMBERSHIP_STATES = ["invited", "active", "suspended", "removed"] as const;
export type OrgMembershipState = (typeof ORG_MEMBERSHIP_STATES)[number];

/**
 * Typed profile key vocabulary. The model never interprets the values; the
 * vocabulary only bounds what an org unit's profile may carry so unknown
 * keys fail closed instead of silently accumulating unvalidated attributes.
 */
export const ORG_UNIT_PROFILE_KEYS = [
  "name",
  "code",
  "description",
  "timezone",
  "locale",
  "region",
  "external_ref",
] as const;
export type OrgUnitProfileKey = (typeof ORG_UNIT_PROFILE_KEYS)[number];
export type OrgUnitProfile = { readonly [K in OrgUnitProfileKey]?: string };

/* ─────────────────────────────────────────────────────────────
 * Entities
 * ────────────────────────────────────────────────────────────*/

export interface OrgUnit {
  readonly id: OrgUnitRef;
  readonly tenantRef: TenantId;
  readonly kind: OrgUnitKind;
  /** Null only for the tenant's single root (kind "organization"). */
  readonly parentRef: OrgUnitRef | null;
  readonly lifecycleState: OrgUnitLifecycleState;
  readonly profile: OrgUnitProfile;
}

export interface OrgMembership {
  readonly id: OrgMembershipRef;
  /** Derived from the unit at creation — membership rows can never cross tenants. */
  readonly tenantRef: TenantId;
  readonly orgUnitRef: OrgUnitRef;
  /** Human or workforce position ref — deliberately untyped vocabulary. */
  readonly principalRef: PrincipalRef;
  readonly roleRef: RoleRef;
  readonly state: OrgMembershipState;
}

/** Immutable in-memory snapshot the pure operations transform. */
export interface OrgModelState {
  readonly units: ReadonlyMap<OrgUnitRef, OrgUnit>;
  readonly memberships: ReadonlyMap<OrgMembershipRef, OrgMembership>;
  /** Role vocabulary per tenant; memberships may only use declared roles. */
  readonly declaredRoles: ReadonlyMap<TenantId, ReadonlySet<RoleRef>>;
}

/* ─────────────────────────────────────────────────────────────
 * Fail-closed decision envelope (capability-gate style)
 * ────────────────────────────────────────────────────────────*/

export type OrgDenyCode =
  | "malformed_input"
  | "duplicate_unit"
  | "duplicate_membership"
  | "self_parent_cycle"
  | "cycle"
  | "unknown_parent"
  | "unknown_unit"
  | "unknown_membership"
  | "cross_tenant_parent"
  | "root_already_exists"
  | "root_kind_required"
  | "parent_not_available"
  | "unit_not_active"
  | "role_not_declared"
  | "invalid_transition";

export type OrgDecision<T> =
  | { outcome: "ok"; value: T }
  | { outcome: "deny"; code: OrgDenyCode; reason: string };

function deny<T>(code: OrgDenyCode, reason: string): OrgDecision<T> {
  return { outcome: "deny", code, reason };
}

function ok<T>(value: T): OrgDecision<T> {
  return { outcome: "ok", value };
}

/* ─────────────────────────────────────────────────────────────
 * State construction
 * ────────────────────────────────────────────────────────────*/

export function emptyOrgModelState(
  declaredRoles: ReadonlyMap<TenantId, readonly RoleRef[]> = new Map(),
): OrgModelState {
  const roles = new Map<TenantId, ReadonlySet<RoleRef>>();
  for (const [tenant, list] of declaredRoles) {
    roles.set(tenant, new Set(list));
  }
  return { units: new Map(), memberships: new Map(), declaredRoles: roles };
}

/** Expand the per-tenant role vocabulary (pure). */
export function declareTenantRole(
  state: OrgModelState,
  tenantRef: TenantId,
  roleRef: RoleRef,
): OrgDecision<OrgModelState> {
  if (!isWellFormedRef(tenantRef) || !isWellFormedRef(roleRef)) {
    return deny("malformed_input", "Malformed tenant or role reference");
  }
  const existing = state.declaredRoles.get(tenantRef);
  if (existing?.has(roleRef)) {
    return deny("malformed_input", `Role "${roleRef}" already declared for tenant`);
  }
  const declaredRoles = new Map(state.declaredRoles);
  declaredRoles.set(tenantRef, new Set([...(existing ?? []), roleRef]));
  return ok({ ...state, declaredRoles });
}

/* ─────────────────────────────────────────────────────────────
 * Validation helpers (fail closed on every malformed input)
 * ────────────────────────────────────────────────────────────*/

function validateProfile(profile: OrgUnitProfile): OrgDenyCode | null {
  if (profile === null || typeof profile !== "object") {
    return "malformed_input";
  }
  for (const [key, value] of Object.entries(profile)) {
    if (!ORG_UNIT_PROFILE_KEYS.includes(key as OrgUnitProfileKey)) {
      return "malformed_input";
    }
    if (typeof value !== "string" || value.length < 1 || value.length > 200) {
      return "malformed_input";
    }
  }
  if (typeof profile.name !== "string" || profile.name.length < 1) {
    return "malformed_input";
  }
  return null;
}

function isAvailableParent(unit: OrgUnit): boolean {
  return unit.lifecycleState === "draft" || unit.lifecycleState === "active";
}

function rootExists(state: OrgModelState, tenantRef: TenantId, excluding?: OrgUnitRef): boolean {
  for (const unit of state.units.values()) {
    if (unit.tenantRef === tenantRef && unit.parentRef === null && unit.id !== excluding) {
      return true;
    }
  }
  return false;
}

/** Walks ancestors from `from` to detect a cycle back to `target`. */
function introducesCycle(
  state: OrgModelState,
  from: OrgUnitRef,
  target: OrgUnitRef,
): boolean {
  let cursor: OrgUnitRef | null = from;
  const seen = new Set<OrgUnitRef>();
  while (cursor !== null) {
    if (cursor === target) return true;
    if (seen.has(cursor)) return true;
    seen.add(cursor);
    cursor = state.units.get(cursor)?.parentRef ?? null;
  }
  return false;
}

/* ─────────────────────────────────────────────────────────────
 * Operations
 * ────────────────────────────────────────────────────────────*/

export interface CreateOrgUnitInput {
  readonly id: OrgUnitRef;
  readonly tenantRef: TenantId;
  readonly kind: OrgUnitKind;
  readonly parentRef: OrgUnitRef | null;
  readonly profile: OrgUnitProfile;
  readonly lifecycleState?: OrgUnitLifecycleState;
}

/**
 * Create an org unit. Tree rules (fail closed):
 * - ids are globally unique;
 * - the parent must exist, be available, and belong to the SAME tenant;
 * - a unit can never be its own ancestor (self-parent / cycle guard);
 * - each tenant has at most one root, and only the "organization" kind may
 *   be a root.
 */
export function createOrgUnit(
  state: OrgModelState,
  input: CreateOrgUnitInput,
): OrgDecision<OrgModelState> {
  if (
    !isWellFormedRef(input.id) ||
    !isWellFormedRef(input.tenantRef) ||
    !ORG_UNIT_KINDS.includes(input.kind) ||
    (input.parentRef !== null && !isWellFormedRef(input.parentRef)) ||
    (input.lifecycleState !== undefined &&
      !ORG_UNIT_LIFECYCLE_STATES.includes(input.lifecycleState))
  ) {
    return deny("malformed_input", "Malformed org unit input");
  }
  const profileError = validateProfile(input.profile);
  if (profileError !== null) {
    return deny(profileError, "Malformed org unit profile attributes");
  }
  if (state.units.has(input.id)) {
    return deny("duplicate_unit", `Org unit "${input.id}" already exists`);
  }
  if (input.parentRef === input.id) {
    return deny("self_parent_cycle", "An org unit cannot be its own parent");
  }

  let parent: OrgUnit | undefined;
  if (input.parentRef !== null) {
    parent = state.units.get(input.parentRef);
    if (!parent) {
      return deny("unknown_parent", `Parent org unit "${input.parentRef}" does not exist`);
    }
    if (parent.tenantRef !== input.tenantRef) {
      return deny("cross_tenant_parent", "Parent org unit belongs to a different tenant");
    }
    if (!isAvailableParent(parent)) {
      return deny("parent_not_available", `Parent org unit is ${parent.lifecycleState}`);
    }
  } else {
    if (rootExists(state, input.tenantRef)) {
      return deny("root_already_exists", "Tenant already has a root org unit");
    }
    if (input.kind !== "organization") {
      return deny("root_kind_required", 'Only the "organization" kind may be a root org unit');
    }
  }

  const unit: OrgUnit = {
    id: input.id,
    tenantRef: input.tenantRef,
    kind: input.kind,
    parentRef: input.parentRef,
    lifecycleState: input.lifecycleState ?? "active",
    profile: Object.freeze({ ...input.profile }),
  };
  const units = new Map(state.units);
  units.set(unit.id, unit);
  return ok({ ...state, units });
}

export interface ReparentOrgUnitInput {
  readonly id: OrgUnitRef;
  readonly newParentRef: OrgUnitRef | null;
}

/**
 * Move a unit within its tenant's tree. Same tenant, availability and cycle
 * rules as creation; the universal single-root invariant is preserved.
 */
export function reparentOrgUnit(
  state: OrgModelState,
  input: ReparentOrgUnitInput,
): OrgDecision<OrgModelState> {
  if (
    !isWellFormedRef(input.id) ||
    (input.newParentRef !== null && !isWellFormedRef(input.newParentRef))
  ) {
    return deny("malformed_input", "Malformed reparent input");
  }
  const unit = state.units.get(input.id);
  if (!unit) {
    return deny("unknown_unit", `Org unit "${input.id}" does not exist`);
  }
  if (!isAvailableParent(unit)) {
    return deny("unit_not_active", `Org unit is ${unit.lifecycleState}`);
  }
  if (input.newParentRef === unit.id) {
    return deny("self_parent_cycle", "An org unit cannot be its own parent");
  }

  if (input.newParentRef !== null) {
    const parent = state.units.get(input.newParentRef);
    if (!parent) {
      return deny("unknown_parent", `Parent org unit "${input.newParentRef}" does not exist`);
    }
    if (parent.tenantRef !== unit.tenantRef) {
      return deny("cross_tenant_parent", "Parent org unit belongs to a different tenant");
    }
    if (!isAvailableParent(parent)) {
      return deny("parent_not_available", `Parent org unit is ${parent.lifecycleState}`);
    }
    if (introducesCycle(state, input.newParentRef, unit.id)) {
      return deny("cycle", "Reparenting would create a cycle in the org tree");
    }
  } else {
    if (rootExists(state, unit.tenantRef, unit.id)) {
      return deny("root_already_exists", "Tenant already has a root org unit");
    }
    if (unit.kind !== "organization") {
      return deny("root_kind_required", 'Only the "organization" kind may be a root org unit');
    }
  }

  const updated: OrgUnit = { ...unit, parentRef: input.newParentRef };
  const units = new Map(state.units);
  units.set(updated.id, updated);
  return ok({ ...state, units });
}

export interface AddMembershipInput {
  readonly id: OrgMembershipRef;
  readonly orgUnitRef: OrgUnitRef;
  readonly principalRef: PrincipalRef;
  readonly roleRef: RoleRef;
}

/**
 * Bind a principal to an org unit under a DECLARED role. Fail closed on
 * unknown units, non-active units, undeclared roles and duplicate active
 * memberships in the same unit.
 */
export function addMembership(
  state: OrgModelState,
  input: AddMembershipInput,
): OrgDecision<OrgModelState> {
  if (
    !isWellFormedRef(input.id) ||
    !isWellFormedRef(input.orgUnitRef) ||
    !isWellFormedRef(input.principalRef) ||
    !isWellFormedRef(input.roleRef)
  ) {
    return deny("malformed_input", "Malformed membership input");
  }
  if (state.memberships.has(input.id)) {
    return deny("duplicate_membership", `Membership "${input.id}" already exists`);
  }
  const unit = state.units.get(input.orgUnitRef);
  if (!unit) {
    return deny("unknown_unit", `Org unit "${input.orgUnitRef}" does not exist`);
  }
  if (unit.lifecycleState !== "active") {
    return deny("unit_not_active", `Org unit is ${unit.lifecycleState}; membership denied`);
  }
  if (!state.declaredRoles.get(unit.tenantRef)?.has(input.roleRef)) {
    return deny("role_not_declared", `Role "${input.roleRef}" is not declared for the tenant`);
  }
  for (const existing of state.memberships.values()) {
    if (
      existing.orgUnitRef === input.orgUnitRef &&
      existing.principalRef === input.principalRef &&
      (existing.state === "active" || existing.state === "invited")
    ) {
      return deny(
        "duplicate_membership",
        "Principal already holds an active membership in this org unit",
      );
    }
  }

  const membership: OrgMembership = {
    id: input.id,
    tenantRef: unit.tenantRef,
    orgUnitRef: input.orgUnitRef,
    principalRef: input.principalRef,
    roleRef: input.roleRef,
    state: "active",
  };
  const memberships = new Map(state.memberships);
  memberships.set(membership.id, membership);
  return ok({ ...state, memberships });
}

/**
 * Deactivate a membership. Fail-closed transition: only invited/active
 * memberships may be suspended; unknown refs and terminal states deny.
 */
export function deactivateMembership(
  state: OrgModelState,
  membershipId: OrgMembershipRef,
): OrgDecision<OrgModelState> {
  if (!isWellFormedRef(membershipId)) {
    return deny("malformed_input", "Malformed membership reference");
  }
  const membership = state.memberships.get(membershipId);
  if (!membership) {
    return deny("unknown_membership", `Membership "${membershipId}" does not exist`);
  }
  if (membership.state !== "active" && membership.state !== "invited") {
    return deny("invalid_transition", `Membership is ${membership.state}; cannot deactivate`);
  }
  const updated: OrgMembership = { ...membership, state: "suspended" };
  const memberships = new Map(state.memberships);
  memberships.set(updated.id, updated);
  return ok({ ...state, memberships });
}

/**
 * Derived projection: the org units a principal is related to through ACTIVE
 * memberships of ACTIVE units. This is a derived view only — it NEVER grants
 * permissions; the authorization stack (capability gates, RLS, server
 * functions) remains the sole authority. When `tenantRef` is supplied the
 * projection is bounded to that tenant; malformed inputs yield an EMPTY
 * scope (fail closed), never an error surface.
 */
export function resolveOrgScope(
  state: OrgModelState,
  principalRef: PrincipalRef,
  tenantRef?: TenantId,
): readonly OrgUnit[] {
  if (!isWellFormedRef(principalRef)) {
    return [];
  }
  if (tenantRef !== undefined && !isWellFormedRef(tenantRef)) {
    return [];
  }
  const scope: OrgUnit[] = [];
  for (const membership of state.memberships.values()) {
    if (membership.principalRef !== principalRef || membership.state !== "active") {
      continue;
    }
    const unit = state.units.get(membership.orgUnitRef);
    if (!unit || unit.lifecycleState !== "active") {
      continue;
    }
    if (tenantRef !== undefined && unit.tenantRef !== tenantRef) {
      continue;
    }
    scope.push(unit);
  }
  return Object.freeze(scope);
}

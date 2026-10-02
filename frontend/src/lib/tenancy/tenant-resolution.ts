/**
 * CoreGrid — H2-11 multi-tenant actor tenancy resolution (V1 contract).
 *
 * Problem this solves (NEUTRAL_TENANT_PRIMITIVES.md §8 risk 4):
 *   `get_my_tenant_id()` answers "THE actor's tenant". A principal with
 *   active neutral bindings in TWO tenants makes it raise
 *   AMBIGUOUS_TENANCY — fail-closed, but unusable: every policy shaped
 *   `tenant = get_my_tenant_id()` denies a multi-tenant actor outright.
 *
 * V1 contract (this module, pure and offline):
 *   An actor's tenant context is EXPLICIT per request. The actor's session
 *   DECLARes one active tenant and references one membership proof (a
 *   substrate binding). Resolution NEVER picks implicitly — no first-tenant,
 *   no single-element collapse. A declaration alone grants nothing: it is
 *   validated against the server-resolved membership set before any tenant
 *   is considered resolved. Absence of declaration, absence of proof, or a
 *   mismatch denies — fail-closed, observable, typed (AGENTS §15, §16).
 *
 * Security invariants (Constitution §13, §16, §26, §27, §34):
 *   - The declaration is a SCOPE NARROWER, never a credential. A client may
 *     only ever shrink what it sees (to one of its own proven tenants);
 *     the membership set is always server-derived (SQL: from auth.uid()).
 *   - The UI/TS layer is not the security boundary; RLS + the per-tenant
 *     SQL predicates (design doc below) remain the enforcement layer.
 *   - Multi-membership is surfaced, never silently collapsed: distinct
 *     tenants are enumerable, and each resolution names the exact proof.
 *
 * Domain neutrality: this module contains no domain (vertical) vocabulary
 * and no hand-written role list; tenant refs and role refs are opaque
 * neutral tokens owned by the substrate (J-005 / J-006).
 */

/** A neutral tenant reference (opaque; text today, uuid-compatible under COND-003). */
export type TenantRef = string & { readonly __brand: "TenantRef" };

/**
 * Opaque handle to one membership binding in the substrate
 * (a cg_org_membership row or a time-bounded cg_role_assignment row).
 * The handle is resolved server-side; a client can only echo back what
 * the server showed it — it cannot forge a binding.
 */
export type MembershipProofRef = string & { readonly __brand: "MembershipProofRef" };

/** Substrate binding kinds the membership set is derived from (20261002000001 §1). */
export type MembershipBindingKind = "org_membership" | "role_assignment";

/**
 * One server-resolved, ACTIVE membership binding. Consumers never construct
 * these from client input; they arrive from the membership-set provider
 * (SQL design doc below) which re-derives the actor from auth.uid().
 */
export interface MembershipProof {
  readonly proofRef: MembershipProofRef;
  readonly tenantId: TenantRef;
  readonly bindingKind: MembershipBindingKind;
}

/**
 * The actor's complete active membership set, resolved server-side for the
 * current request. `actorId` is the authenticated identity (auth.uid());
 * `actorId === null` means unauthenticated — the set is empty by construction.
 */
export interface ActorMembershipSet {
  readonly actorId: string | null;
  readonly proofs: readonly MembershipProof[];
}

/**
 * The per-request EXPLICIT declaration of active tenancy: one tenant, one
 * proof the actor (or their session) is operating under. Declaring is an
 * assertion to be verified, not an authorization.
 */
export interface ActiveTenantDeclaration {
  readonly tenantId: TenantRef;
  readonly proofRef: MembershipProofRef;
}

/** Why a resolution denied. Every denial is observable and auditable (AGENTS §29). */
export type TenantDenialReason =
  | "NO_ACTIVE_TENANT_DECLARATION"
  | "NO_MEMBERSHIP_PROOF"
  | "PROOF_UNKNOWN"
  | "PROOF_NOT_ACTIVE_FOR_TENANT"
  | "TENANT_MISMATCH"
  | "AMBIGUOUS_MEMBERSHIP_PROOF";

export type TenantResolution =
  | { readonly outcome: "denied"; readonly reason: TenantDenialReason; readonly message: string }
  | { readonly outcome: "resolved"; readonly tenantId: TenantRef; readonly proof: MembershipProof };

/** Construct a per-request declaration. Pure data; authorization happens in resolveActiveTenant. */
export function declareActiveTenant(
  tenantId: TenantRef,
  proofRef: MembershipProofRef,
): ActiveTenantDeclaration {
  return { tenantId, proofRef };
}

/**
 * Resolve the request's single active tenant.
 *
 * Fail-closed ladder (each step denies without leaking the next):
 *   1. no declaration            -> NO_ACTIVE_TENANT_DECLARATION
 *   2. declaration w/o proofRef  -> NO_MEMBERSHIP_PROOF
 *   3. proofRef not in the set   -> PROOF_UNKNOWN (covers "declaration
 *      without membership proof": an unproven tenant is denied, never
 *      defaulted to any tenant the actor happens to belong to)
 *   4. proof tenant ≠ declared   -> TENANT_MISMATCH
 *   5. >1 active binding matches -> AMBIGUOUS_MEMBERSHIP_PROOF
 *      (multi-membership never collapses silently — the actor must
 *      disambiguate by naming one proof)
 *   6. otherwise                 -> resolved, single tenant + exact proof
 */
export function resolveActiveTenant(
  declaration: ActiveTenantDeclaration | null | undefined,
  membershipSet: ActorMembershipSet,
): TenantResolution {
  if (declaration === null || declaration === undefined) {
    return {
      outcome: "denied",
      reason: "NO_ACTIVE_TENANT_DECLARATION",
      message:
        "No active tenant declared for this request; every request must carry explicit tenant context (AGENTS §13).",
    };
  }

  if (declaration.proofRef === null || declaration.proofRef === undefined) {
    return {
      outcome: "denied",
      reason: "NO_MEMBERSHIP_PROOF",
      message: "Active-tenant declaration carries no membership-proof reference.",
    };
  }

  const matches = membershipSet.proofs.filter(
    (p) => p.proofRef === declaration.proofRef,
  );

  if (matches.length === 0) {
    return {
      outcome: "denied",
      reason: "PROOF_UNKNOWN",
      message:
        "Declared proof is not an active membership binding of the authenticated actor; tenancy denied.",
    };
  }

  const provenTenant = matches[0].tenantId;
  if (provenTenant !== declaration.tenantId) {
    return {
      outcome: "denied",
      reason: "TENANT_MISMATCH",
      message: "Declared active tenant does not match the tenant of the referenced proof.",
    };
  }

  if (matches.length > 1) {
    return {
      outcome: "denied",
      reason: "AMBIGUOUS_MEMBERSHIP_PROOF",
      message:
        "Multiple active bindings satisfy the declaration; tenancy must be disambiguated, never collapsed.",
    };
  }

  return { outcome: "resolved", tenantId: provenTenant, proof: matches[0] };
}

/** Server-function convenience: turn a denial into a thrown, observable failure (AGENTS §27). */
export function assertResolvedTenant(resolution: TenantResolution): TenantRef {
  if (resolution.outcome === "denied") {
    throw new Error(`TENANT_RESOLUTION_DENIED[${resolution.reason}]: ${resolution.message}`);
  }
  return resolution.tenantId;
}

/** Distinct tenants in the actor's membership set — the multi-tenant actor is visible, not collapsed. */
export function distinctTenantIds(membershipSet: ActorMembershipSet): TenantRef[] {
  return [...new Set(membershipSet.proofs.map((p) => p.tenantId))].sort();
}

export function isMultiTenantActor(membershipSet: ActorMembershipSet): boolean {
  return distinctTenantIds(membershipSet).length > 1;
}

/**
 * List the proofs an actor holds in ONE declared tenant (scope-narrowing view,
 * e.g. tenant switchers). Empty when the actor holds nothing in that tenant.
 */
export function proofsForTenant(
  membershipSet: ActorMembershipSet,
  tenantId: TenantRef,
): MembershipProof[] {
  return membershipSet.proofs.filter((p) => p.tenantId === tenantId);
}

/* ============================================================================
 * SQL DESIGN DOC — per-tenant membership predicates that stay row-secure
 * ============================================================================
 *
 * Companion design (authored, not applied — same posture as
 * 20261002000001: apply only with explicit human authorization):
 *
 *   -- 1. Membership-set primitive: the set-valued sibling of
 *   --    get_my_tenant_id(). Returns the actor's DISTINCT active neutral
 *   --    tenant bindings; never raises (AMBIGUOUS_TENANCY is a property of
 *   --    forcing ONE tenant, which this primitive deliberately refuses to
 *   --    do). Actor re-derived from auth.uid(); unauthenticated -> '{}'.
 *   CREATE OR REPLACE FUNCTION public.get_actor_tenant_ids()
 *   RETURNS text[]
 *   LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
 *     SELECT coalesce(
 *       array_agg(DISTINCT t.tenant),
 *       '{}'::text[]
 *     )
 *     FROM (
 *       SELECT m.tenant_id AS tenant
 *         FROM public.cg_org_membership m
 *        WHERE m.principal_ref = auth.uid()::text
 *          AND m.state = 'active'
 *       UNION
 *       SELECT r.tenant_ref
 *         FROM public.cg_role_assignment r
 *        WHERE r.identity_ref = auth.uid()::text
 *          AND r.status = 'active'
 *          AND r.started_on <= CURRENT_DATE
 *          AND (r.ended_on IS NULL OR r.ended_on >= CURRENT_DATE)
 *     ) t;
 *   $$;
 *
 *   REVOKE ALL ON FUNCTION public.get_actor_tenant_ids() FROM PUBLIC;
 *   REVOKE ALL ON FUNCTION public.get_actor_tenant_ids() FROM anon;
 *   GRANT EXECUTE ON FUNCTION public.get_actor_tenant_ids()
 *     TO authenticated, service_role;
 *
 *   -- 2. Policy shape — SELECT gate (replaces
 *   --    `tenant_ref = public.get_my_tenant_id()`, which raises
 *   --    AMBIGUOUS_TENANCY for multi-tenant actors):
 *   CREATE POLICY <table>_select_actor_tenants
 *     ON public.<table>
 *     FOR SELECT TO authenticated
 *     USING (tenant_ref = ANY (public.get_actor_tenant_ids()));
 *
 *   Why this stays row-secure:
 *   a. The array is derived server-side inside a SECURITY DEFINER helper
 *      from auth.uid() — no client-supplied tenant can enter the predicate
 *      (Constitution §26); the per-request active-tenant DECLARATION of the
 *      TS contract above NEVER reaches SQL as a parameter.
 *   b. Every row is tested against the actor's binding in the row's OWN
 *      tenant — authorization is per-row and idempotent across actors with
 *      one, two, or N tenants. No "resolve one tenant, then filter" step
 *      exists, so there is nothing to collapse and nothing to make
 *      ambiguous. `= ANY (array)` yields one boolean per row and never
 *      leaks the membership set itself.
 *   c. Fail-closed preserved: unauthenticated -> '{}' -> zero rows;
 *      unbound actor -> '{}' -> zero rows. Exactly the same visible-row
 *      set as `tenant = get_my_tenant_id()` for single-tenant actors;
 *      strictly the same for the multi-tenant actor's per-tenant rows.
 *      Nothing not explicitly allowed is allowed: RLS stays enabled (and
 *      FORCED per 20261002000013), anon keeps zero privileges.
 *
 *   -- 3. Write gates stay PER-ROW admin predicates (unchanged shape):
 *   CREATE POLICY <table>_insert_tenant_admin
 *     ON public.<table>
 *     FOR INSERT TO authenticated
 *     WITH CHECK (public.is_tenant_admin(tenant_ref));
 *   -- UPDATE: USING + WITH CHECK is_tenant_admin(tenant_ref);
 *   -- DELETE: no policy — denied (history preserved, AGENTS §28).
 *   -- Scope-narrowing on writes, when a session wants to operate in one
 *   -- tenant, belongs to the RPC layer's own validation, never to RLS.
 *
 *   4. Anti-patterns (each would weaken fail-closed / row security):
 *   x. Passing the declared active tenant as a policy/RPC predicate
 *      operand — reintroduces client-trusted tenancy (§26).
 *   x. `(public.get_actor_tenant_ids())[1]` or any scalar pick — the
 *      implicit first-tenant collapse this contract exists to remove.
 *   x. Caching the array into a session-stored scalar and reusing it
 *      across statements — bindings can expire mid-session; the predicate
 *      must re-derive per statement (STABLE, not IMMUTABLE).
 *   x. Replacing write gates with membership-set checks — writing
 *      requires the ADMINISTRATOR binding in the row's tenant, per
 *      20261002000013; a mere member stays read-scoped.
 * ========================================================================== */

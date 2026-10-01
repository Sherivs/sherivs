# MISSION-R-22 — Identity lifecycle enforcement defect report

Companion to `tests/unit/identity-lifecycle-enforcement.test.ts` (J-009,
V1CAP-020, AGENTS §31: expired access fails / revoked access fails).

**Status: DEFECT-1/2/3 RESOLVED (fix wave, coordinator-routed). DEFECT-4
DEFERRED to the delegation substrate mission.** Each entry below records the
original finding and the fix. The suite's former `DEFECT-n (exposing)` tests
are now `DEFECT-n (resolved)` correctness assertions pinning the secure
behavior; if a fix regresses, the resolved test fails and this file must be
re-opened.

Enforcement points audited (the server-function gate patterns the codebase
actually uses, enumerated from the `.functions.ts` call sites and the
`requireScope`/`requireSchoolAdminScope`/`authenticate` grep surface):

- `frontend/src/integrations/supabase/auth-middleware.ts` — `requireSupabaseAuth`
  (bearer-token authentication middleware on every `createServerFn`)
- `frontend/src/lib/security-role-gate.ts` — `evaluateRoleGate`,
  `decideStaffRole`, `decideAccountAdministration`, `checkLifecycleSignals`,
  and the adapters `resolveRoleGate` / `assertRoleScope` /
  `requireSchoolAdminScope` / `requirePlatformSuperAdmin` /
  `resolveStaffContext` / `requireStaffContext`
- `frontend/src/lib/security-core.ts` — `evaluateSecurityGateway` (the
  decision authority the role gates embed)
- `frontend/src/lib/identity-actor.ts` — `resolveIdentityActor` (actor
  substrate bridging session → actor context)
- `frontend/src/lib/capability-gate.ts` — `evaluateRuntimeCapability`

Lifecycle states enumerated from the substrate
(`frontend/src/lib/identity.ts`, `IDENTITY_LIFECYCLE_STATES`): `proposed`,
`review`, `provisioned`, `active`, `suspended`, `deleted`, `archived`. The
registry vocabulary (`frontend/src/lib/identity-registry.ts`,
`IDENTITY_STATES`) is a subset: `provisioned`, `active`, `suspended`,
`archived`, `deleted`. "Revoked"/"expired" are not identity lifecycle states;
they are carried by `SessionStatus` (`expired`/`revoked`/`terminated`) and
`CredentialStatus` (`expired`/`revoked`).

---

## DEFECT-1 (Critical) — RESOLVED: runtime server-function gates had no lifecycle input

**Original finding:** `evaluateRoleGate`, `decideStaffRole`,
`decideAccountAdministration` and all adapters accepted only role + scope
signals and hardcoded `identityValid: true, sessionValid: true` into
`evaluateSecurityGateway`; the backing RPCs (`is_school_admin`, `get_my_role`
— migrations `20260620122048_50e590c2…`, `20260620122110_178748dc…`,
`20260620151525_b630392a…`) check only `users.role`. A
SUSPENDED/DELETED/ARCHIVED identity with an unexpired bearer token executed
every gated server function — violating AGENTS §31, G5, and §26.

**Fix (this wave):** `frontend/src/lib/security-role-gate.ts`

- New shared additive contract `LifecycleSignals` (`lifecycle?`,
  `sessionStatus?`, `sessionValid?`) plus the exported fail-closed evaluator
  `checkLifecycleSignals`, consumed FIRST by `evaluateRoleGate`,
  `decideStaffRole` and `decideAccountAdministration` — before any role is
  consulted:
  - a supplied lifecycle outside the usable set (`active`/`provisioned` per
    `isIdentityUsable`) denies with `code: "lifecycle_denied"`;
  - unknown lifecycle values fail closed (never trusted);
  - a supplied `sessionStatus` other than `active`, or an explicit
    `sessionValid: false`, denies with `code: "session_denied"`;
  - contradictory signals fail closed (`sessionValid: false` beats an
    `active` status).
- Deny-outcome unions gained `lifecycle_denied`/`session_denied` codes;
  reasons are canonical and non-leaky ("Forbidden: identity lifecycle does
  not permit execution" / "Forbidden: session is expired or revoked").
- All six RPC adapters (`resolveRoleGate`, `assertRoleScope`,
  `requireSchoolAdminScope`, `requirePlatformSuperAdmin`,
  `resolveStaffContext`, `requireStaffContext`) take an optional trailing
  `LifecycleSignals` parameter and thread it into the decision, so every
  call site that already holds the acting identity's lifecycle/session state
  can attest it without changing existing call signatures.
- Every existing export name, result field and deny/allow reason is preserved
  (additive-compatible); calls that supply none of the new signal keys keep
  the historical outcome shape byte-for-byte (the adjacent
  `security-role-gate.test.ts` suite passes unmodified).

**Attestation semantics (documented deviation):** on an allow, the outcome
carries `lifecycleUnverified: true` whenever the caller opted into the
lifecycle contract (supplied at least one of the three signal keys) but left
the lifecycle or the session validity unverified; a fully-attested allow
carries no flag; a legacy-shaped call (no signal keys) keeps the historical
shape with no attestation. Byte-compatibility with the unmodifiable adjacent
suite (`decideStaffRole`/`decideAccountAdministration` allow outcomes are
`toEqual`-compared there) required the flag to be scoped to opted-in calls;
the fail-closed deny path itself applies whenever signals are supplied, so
the security property (non-active/expired denies) does not depend on the
flag. Legacy callers gain attestation by supplying the signals — the new
contract is the only path that produces an allow.

**Resolved tests** (in `tests/unit/identity-lifecycle-enforcement.test.ts`):
all former `DEFECT-1 (exposing)` tests are now `DEFECT-1 (resolved)` —
per-state deny proofs for both role kinds, all staff kinds × roles, account
administration (school + platform super), the RPC adapters (suspended admin,
expired session, suspended teacher), fail-closed unknown lifecycle values,
contradictory-signal fail-closed, attested-allow/no-flag, opted-in-gap flag,
and legacy-shape preservation.

**Residual risk (recorded, not fixable here):** the DB RPCs still report only
`users.role`; until they also consult the lifecycle/active column (or the
server functions resolve the actor substrate), a caller that does NOT supply
`LifecycleSignals` keeps the historical behavior. The additive adapter
parameters make the correct wiring a one-argument change at every call site;
threading it through all `*.functions.ts` call sites is follow-through work
outside this mission's file scope.

## DEFECT-2 (High) — RESOLVED: the actor substrate could not express identity lifecycle

**Original finding:** `resolveIdentityActor` took only the binary `isActive`
row flag; canonical lifecycle states (suspended/deleted/archived) were
inexpressible and a suspended identity with `isActive: true` resolved to a
fully usable actor.

**Fix (this wave):** `frontend/src/lib/identity-actor.ts`

- `IdentityActorSource` gained additive optional fields `lifecycle?:
  IdentityLifecycleState | null` and `sessionStatus?: SessionStatus | null`.
- `resolveIdentityActor` now fails closed (after the `isActive` check, before
  role resolution) when:
  - `lifecycle` is supplied and not in the usable set
    (`active`/`provisioned`) — reason "Identity lifecycle is not usable";
  - `lifecycle` is supplied with an unknown value (e.g. the string
    `"expired"`, which is not a lifecycle state) — same fail-closed reason;
  - `sessionStatus` is supplied and not `active` — reason "Session is not
    active" (covers expired/revoked/terminated).
- `IdentityActor` now carries `lifecycle: IdentityLifecycleState | null` —
  the resolved state when supplied, `null` when the source did not supply
  one. Consumers must treat `null` as lifecycle-unverified, never as
  verified-active.
- All existing fields, reasons and export names are preserved
  (additive-compatible); sources without the new fields behave exactly as
  before, except the actor now explicitly carries `lifecycle: null`.

**Resolved tests:** all former `DEFECT-2 (exposing)` tests are now
`DEFECT-2 (resolved)` — every non-usable lifecycle state fails resolution,
unknown lifecycle values fail closed, non-active sessions fail resolution,
usable states resolve carrying their lifecycle, and the null-lifecycle
(unverified) contract is pinned.

## DEFECT-3 (Medium) — RESOLVED: capability gate evaluated role only

**Original finding:** `evaluateRuntimeCapability` granted by role alone with
no lifecycle/session input; a suspended admin retained every declared
`r001:*` capability.

**Fix (this wave, minimal enforcement):** `frontend/src/lib/capability-gate.ts`

- `RuntimeCapabilitySignals` gained additive optional `actorActive?: boolean`.
- When `actorActive === false` the capability is refused before any other
  check — role membership and the platform super-admin bypass never resurrect
  a non-active actor context. The deny uses the gate's closed code vocabulary
  (`role_required`) with the specific reason "Actor context is not active",
  because the adjacent `capability-gate.test.ts` pins a closed `DenyCode`
  union this mission may not edit; the security property (deny, fail-closed)
  is unaffected.
- Allow outcomes carry `lifecycleUnverified: true` when the caller opted in
  (`actorActive` key present, value unset) — same attestation semantics as
  the role gates; legacy-shaped calls keep the historical shape.
- Note: this module gained a universal-role resolution layer (V1CAP-014) from
  parallel work between the defect report and this fix; the enforcement was
  applied on top of that current shape.

**Resolved tests:** the former `DEFECT-3 (exposing)` test is now
`DEFECT-3 (resolved)` — non-active actor refused (with and without
`isPlatformSuper`), verified-active allow without flag, opted-in-unverified
allow with flag, legacy-shape preservation.

## DEFECT-4 (Medium) — DEFERRED: DelegationRecord expiry has no enforcement point

**Routing (coordinator ruling):** DEFERRED to the delegation substrate
mission (MISSION-R-42-era work). Do not fix in this wave.

**Original finding:** `DelegationRecord` (`frontend/src/lib/identity.ts`)
mandates `expiresAt` ("delegation must have an expiry") and `revokedAt`, but
the substrate exports no predicate for it (no `isDelegationActive` equivalent
to `isCredentialActive` / `isRelationshipActive` / `evaluateSessionSecurity`)
and no gate consumes delegation expiry. `authorize()` has no delegation input
either (R-80 DEFECT-1 records the adjacent relationship-expiry fail-open).

**Deferred-state pin:** `pins the DelegationRecord contract whose expiry
remains unenforced (DEFERRED)` keeps the gap visible: an expired, unrevoked
delegation is still indistinguishable from an active one anywhere in the
codebase.

**Routing note for the delegation substrate mission:** add a pure
`isDelegationActive(record, now)` predicate to the identity layer (revokedAt
non-null → inactive; expiresAt !== null && expiresAt <= now → inactive),
thread delegation expiry into the authorization engine or the role gates'
`LifecycleSignals` contract (natural extension: a `delegations` signal), and
flip the deferred pin into a deny proof in the same commit.

---

## Informational observations (no change requested)

- **`evaluateSecurityGateway` maps `sessionValid: false` → `challenge`, not
  hard `deny`** (Phase 08 Section H step-up semantics). Proven non-granting
  (`isGrantingDecision("challenge") === false` and `challenge` ∈
  `NON_GRANTING_DECISION_STATES`); recorded as a tested property.
- **`requireSupabaseAuth` (generated auth middleware) validates the bearer
  token only** — authentication, not lifecycle. Consistent with DEFECT-1's
  original root cause; the role gate is the lifecycle-capable enforcement
  point after the middleware and now carries the lifecycle signal when the
  call site supplies it.
- **Agent lifecycle is consumed by no runtime gate.** `AGENT_LIFECYCLE_STATES`
  and the pure `isAgentGoverned` predicate are proven in this suite, but no
  gate helper takes agent lifecycle as input (cross-reference
  authorization-exhaustive DEFECT-3, where `AuthorizeOptions.isAgent` is dead
  code). Wiring agent lifecycle into the gates is follow-through for the
  workforce/agent missions.
- **Credential status is authoritative over the timestamp** — a credential
  transitioned to `expired` can carry a future `expiresAt` (pinned as
  documented behavior); `isCredentialActive` requires `status === "active"`
  AND a non-past `expiresAt`, so both paths fail closed.

## Boundary with MISSION-R-80 (authorization-exhaustive)

Per the boundary recorded in `tests/unit/authorization-exhaustive.DEFECTS.md`,
this suite does NOT re-test the `authorize()` decision-matrix lifecycle gate
(active/provisioned vs everything else) — R-80 covers it. Conversely, this
suite owns: transition legality, the runtime gate helpers' lifecycle behavior
(DEFECT-1/2/3, now RESOLVED), and session/credential/delegation expiry at the
identity layer (DEFECT-4 DEFERRED).
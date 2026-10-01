# MISSION-R-80 — Authorization engine defect report

Companion to `tests/unit/authorization-exhaustive.test.ts` (exhaustive
decision-matrix suite for `frontend/src/lib/authorization.ts`).

**STATUS UPDATE (AUTHORIZATION FIX ENGINEER):** all three defects below are
now **RESOLVED** in `frontend/src/lib/authorization.ts`. The previously
exposing `DEFECT-n` tests were flipped in place to passing correctness
assertions (same `DEFECT-n` identifiers, `(resolved)` phrasing), and the
suite's fuzz oracle now models every resolved invariant. Original defect
analysis is preserved below each resolution note.

---

## DEFECT-1 — RESOLVED: Expired relationships no longer authorize

**Fix (in `frontend/src/lib/authorization.ts`):** a relationship is active
only while `revokedAt === null` AND (`expiresAt === null` or `expiresAt` is
in the future relative to the request time). The single helper
`isRelationshipActive(r, nowMs)` is used by both `authorize()` (ReBAC step)
and `hasRelationship()`, so an expired grant is identical to a revoked one:
it no longer exists, and any decision path it would have enabled falls back
to the deny path. Request time is `opts.abac.now` (RFC 3339) when the caller
supplies it, otherwise `Date.now()` — documented in the engine contract
block. An unparseable `expiresAt` fails closed.

**Resolution tests:**
`DEFECT-1 (resolved): an EXPIRED relationship no longer authorizes (expiry is identical to revocation)`
and the `hasRelationship` companion in
`describe("Revocation and expiry authority classes")`.

## DEFECT-2 — RESOLVED: The combined engine now enforces the tenant boundary

**Fix (in `frontend/src/lib/authorization.ts`):** `authorize()` gained a
tenant-boundary gate at the single enforcement point, as evaluation step 2
(immediately after the identity lifecycle gate, before PBAC/ABAC/RBAC/ReBAC):
when the acting identity carries a non-null `tenantId` and the requested
permission scope carries a tenant (the substring before the first ":" of the
scope string) that differs from the identity's, the decision can never be
ALLOW — the request DENIES with reason
"Tenant boundary violation: requested scope belongs to a different tenant".
Consequences, all covered by the suite: scope-null role grants and scope-null
extra permissions cannot authorize a foreign tenant's objects; relationships
recorded against a foreign tenant's target cannot authorize (the gate runs
before the ReBAC layer); a PBAC policy ALLOW cannot authorize cross-tenant
either (the gate precedes PBAC). Identities without a `tenantId`
(platform-level) and scopes that carry no tenant segment are not constrained
by the gate. The exact rule is documented in the engine's contract comment
block. Tenant context is resolved server-side from the request identity;
callers cannot supply or override it.

**Resolution tests:** the two `DEFECT-2 (resolved)` tests in
`describe("Cross-tenant combinations")`, the tenant-bounded scope-null grant
tests, and the fuzz invariant (cross-tenant scopes are non-ALLOW in the
oracle, with tenant-varied fuzz identities).

## DEFECT-3 — RESOLVED: `AuthorizeOptions.isAgent` is enforced (Invariant 12)

**Fix (in `frontend/src/lib/authorization.ts`):** the option is now read at
the enforcement point. When `isAgent` is true, role membership is never a
source of agent authority: `ROLE_PERMISSIONS` grants are skipped for the
request, so an agent receives ALLOW only through explicit delegation —
`extraPermissions` granted to it or an explicit `owns`/`manages`
relationship. Undelegated agent requests deny with the observable reason
"Agent authority requires explicit delegation (Invariant 12)". This is the
minimal enforcement that makes the option real: agents cannot silently
escalate their own authority by holding a role. Semantics documented in the
engine contract block and on `AuthorizeOptions.isAgent`.

**Resolution test:** `DEFECT-3 (resolved): AuthorizeOptions.isAgent is enforced — agents need explicit delegation (Invariant 12)`
— asserts the human ALLOWs, the undelegated agent denies with the Invariant-12
reason, and both delegation paths (extra grant, relationship) restore ALLOW.

---

## Original defect analysis (pre-fix record)

## DEFECT-1 (High): Expired relationships still authorize (fail-open on `expiresAt`)

**Location:** `frontend/src/lib/authorization.ts`

- `authorize()` ReBAC grant (step 5) checks only
  `r.revokedAt === null && r.targetId === req.permission.scope` — it never
  consults `r.expiresAt`.
- `hasRelationship()` likewise checks only `type`, `targetId`, `revokedAt`.

**Impact:** `IdentityRelationship.expiresAt` is part of the identity model
("delegation must have an expiry" is the same authority-lifecycle family), but
an `owns`/`manages` relationship whose `expiresAt` is far in the past still
grants **ALLOW for any action at that scope**. Revocation is the only
termination path the engine honors. This is a fail-open on expired authority —
directly against the mission's "expired access fails" mandatory test class.

**Exposing tests:**
`DEFECT-1 (exposing): an EXPIRED relationship still authorizes (fail-open on expiresAt)`
and the `hasRelationship` companion in
`describe("Revocation and expiry authority classes")`.

**Suggested fix (for the coordinator to route):** treat a relationship as
inactive when `expiresAt !== null && expiresAt <= now` in both `authorize()`
and `hasRelationship()`; either thread a `now` parameter through
`authorize()` options or compare against `Date.now()` (document the choice).

## DEFECT-2 (High): The combined engine enforces no tenant boundary

**Location:** `frontend/src/lib/authorization.ts`, `authorize()` — the engine
receives `req.identity.tenantId` and `req.permission.scope` but **never
compares them**; there is no tenant input to any layer (RBAC, ABAC, ReBAC,
PBAC).

**Impact:**

- Any scope-null role grant (most of `ROLE_PERMISSIONS`) authorizes the same
  `resource:action` at **any** scope string, including another tenant's
  objects. Example pinned by test: a `parent` of `tenant-1` gets ALLOW reading
  `student` scoped to a `tenant-2` object.
- Relationships are matched purely by `targetId` string equality, so a
  relationship recorded against a foreign tenant's object authorizes if the
  caller presents that scope string.

The combined formula in AGENTS.md §16 includes **Tenant** as an input; in the
implemented engine that term is identically null. Tenant isolation currently
rests entirely on callers and RLS (per §17 that may be acceptable layering,
but then the engine's contract must say so explicitly — today it is silent).
If engine-level tenancy is intended, this needs a scoped-grant/tenant-binding
fix plus an ADR (§38); if caller-bound tenancy is intended, the contract and
this suite's cross-tenant section must document the boundary invariant.

**Exposing tests:** the two `DEFECT-2 (exposing)` tests in
`describe("Cross-tenant combinations")`. Note the suite also proves the
*legitimate* cross-tenant deny class: a **scoped** grant requested against a
foreign scope correctly DENYs.

## DEFECT-3 (Low): `AuthorizeOptions.isAgent` is dead code — Invariant 12 unenforced at this layer

**Location:** `frontend/src/lib/authorization.ts`, `AuthorizeOptions.isAgent`
("When true, the actor is an AI agent (Invariant 12)").

**Impact:** the flag is never read by `authorize()`. An `ai_agent` identity
holding the same role/extra grants receives byte-identical decisions to a
human, and no agent-specific gate, restriction, or escalation exists at the
single enforcement point that V1CAP-016 says every server function consumes.
Agents may be governed upstream (agent-core, capability gates), but the
engine's own documented option silently does nothing — a trap for future
callers who believe setting `isAgent` protects them.

**Exposing test:** `DEFECT-3 (exposing)` in
`describe("Revocation and expiry authority classes")` — asserts the agent and
human results are `toEqual`.

**Suggested fix:** either wire `isAgent` to a real control (e.g. force
ESCALATE/REQUIRE_APPROVAL for critical actions, or deny grants not explicitly
delegated) or remove the option and document that agent governance happens
upstream.

---

## Informational observations (no change requested)

- **ESCALATE precedes RBAC** (documented in the engine docstring): a request
  for an *ungranted* action with `risk > 0.8` returns ESCALATE rather than
  DENY, revealing to a prober that the request was risk-flagged. Ordering is
  intentional per the contract; pinned as a documented-behavior test.
- **ReBAC grant ignores resource and action classes:** an `owns`/`manages`
  relationship on a target authorizes *any* action on *any* resource at that
  scope (pinned as a documented-breadth test). Broad by design; flagging so
  the breadth is a known, tested property rather than an accident.
- **`redact()` uses `in`**, which walks the prototype chain; only relevant if
  callers pass non-plain-object records. Benign for current call sites.

## Boundary with MISSION-R-22 (identity lifecycle suite)

The decision matrix consumes `identity.lifecycle` as an input; the gate
(active/provisioned vs. everything else) is verified here. The following are
lifecycle *semantics* and belong to R-22's suite, not this one — noted to
avoid duplication:

- Lifecycle **transition legality** between states (`canTransitionIdentity`,
  `transitionIdentityLifecycle`).
- **Credential** status expiry/revocation (`CredentialStatus`):
  `authorize()` has no credential input at all — expired/revoked credentials
  cannot even be expressed as an authorization request. Until the engine
  grows such an input, that fail-closed property can only be verified at the
  credential-metadata layer (R-22).
- **Session** expiry/revocation and **DelegationRecord** expiry: likewise not
  inputs to `authorize()`; since DEFECT-1 was resolved, delegation expiry
  reaches the engine through the relationship `expiresAt` check, but
  DelegationRecord objects themselves remain outside this engine's inputs.

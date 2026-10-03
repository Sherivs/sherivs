# V1-006 Report — Neutral Core Authorization Vocabulary (team SECURITY)

Mission: V1-006 of the CoreGrid V1 wave. Branch: `cursor/p08-foundation-loop-classification-fe86`.
Report format: AGENTS.md §42. All evidence produced by commands run in this session (see Tests / Security Validation).

## Implemented

1. **Neutral core RBAC substrate (new, `frontend/src/lib/rbac/`)** — the platform authorization core now
   speaks only domain-neutral vocabulary:
   - `rbac/neutral-roles.ts` — `NEUTRAL_CORE_ROLES`: the 16 historical platform/engineering roles
     (behavioral compatibility) plus the neutral tenant hierarchy **org_owner / org_admin / member**
     (capability-mapped: org_owner = tenant+identity+settings manage, audit_log read; org_admin =
     tenant+settings update, user manage, identity read; member = delegation-only baseline).
     Re-pointed capability resources that were education-coded: `school`→`tenant` (coregrid_owner,
     platform_admin), `fees`→`billing` (finance). Zero education tokens.
   - `rbac/domain-contribution.ts` — the registration half of the DomainDefinition pattern (modeled on
     `domain-config/restaurant.ts`): `registerDomainAuthorization()` is **fail-closed and atomic** —
     rejects duplicate domain ids, malformed role names, shadowing of neutral core roles, RULING-4
     reverse attempts (a domain role can never be a universal-role name), cross-domain bare-name
     collisions (a bare role string has exactly one meaning platform-wide), invalid neutral-role
     mappings, and structurally invalid permission grants; nothing commits unless everything validates.
     Resolvers: `resolveDomainRoleGrants`, `resolveRoleGrants` (combined neutral+domain lookup used by
     the engine), `registeredDomainRoles`, `registeredDomainIds`, `isRegisteredDomainRole`.
   - `rbac/role-gate.ts` — neutral gate core: lifecycle/session signal checks, `RoleGateKindBinding` /
     `StaffRoleSetBinding`, `registerRuntimeRoleGate()` (fail-closed, atomic), registry-first resolvers,
     and `evaluateGateDecision()` delegating to `security-core`'s `evaluateSecurityGateway` with the
     frozen legacy deny reason preserved byte-for-byte.
2. **`lib/identity.ts` neutralized** — `RelationshipType` core is now 8 neutral types
   (`member_of, employed_by, owns, manages, agent_for, linked_to, assigned_to, delegated_to`); education
   types (`enrolled_in, parent_of, teaches, guardian_of`) are gone from the union and are contributed at
   runtime through `registerDomainRelationshipTypes()` (fail-closed: no core shadowing, no duplicates,
   name-pattern enforced). `PermissionResource` core is the neutral resource set (tenant, identity, user,
   session, credential, device, ai_agent, service, payments, billing, analytics, audit_log, settings,
   communication, notification); domain resources exist only as branded `DomainPermissionResource` values
   created at a domain boundary via `domainPermissionResource()`. All education comment tokens removed.
   Exports `RELATIONSHIP_TYPES` remains a live registry so existing consumers see core + contributed types.
3. **`lib/authorization.ts` neutralized** — `CoreGridRole = NeutralCoreRole | DomainRegisteredRole`;
   `COREGRID_ROLES` is the 19-role neutral set; the hardcoded education role/permission table is deleted;
   `authorize()` resolves grants via `resolveRoleGrants(role)` (empty for agents, Invariant 12 unchanged).
   Decision pipeline (lifecycle gate → tenant boundary → PBAC → ABAC → RBAC → ReBAC → default deny),
   all reasons, and `CoreGridRole`-typed API are behavior-identical.
4. **`lib/security-role-gate.ts` rewritten as a neutral facade** — decision mechanics delegated to
   `rbac/role-gate.ts`; resolution is registry-first with the frozen legacy constants as fallback. Every
   exported symbol is preserved (`RoleGateKind`, `evaluateRoleGate`, `resolveRoleGate`, `assertRoleScope`,
   `requireSchoolAdminScope`, `requirePlatformSuperAdmin`, `AccountAdministration*`,
   `decideAccountAdministration`, `SchoolStaffRole`, `SCHOOL_STAFF_ROLES`, `decideStaffRole`,
   `resolveStaffContext`, `requireStaffContext`, `STAFF_*_RPC`, `SupabaseRpcClient`, lifecycle types).
   All behavior strings/RPC names are byte-identical, so ~25 consumer files (runtime/scholar functions)
   keep working unchanged. Its remaining education tokens live only in frozen legacy fallback constants
   (quarantined in the baseline; see Known Risks).
5. **Scholar runtime adapter (new, `frontend/src/lib/domain-config/scholar-authorization.ts`)** — the
   education runtime contributes its vocabulary entirely as configuration: 9 role mappings onto the
   neutral universal-role vocabulary (RULING-4 direction: domain → neutral only), byte-identical legacy
   capability grants (domain resources via `domainPermissionResource`), the 4 relationship types, and the
   runtime gate bindings (gate kinds, RPC primitives, 4 staff role sets). One import performs
   registration; `registerScholarAuthorization()` re-registration fails closed. The platform core imports
   **nothing** from this file and from any education-*/academic-* module (verified by test + grep).
6. **Tests**
   - New `tests/unit/rbac-neutrality.test.ts` (18 tests) proves: (a) zero education tokens (guard-identical
     strict-token scan, quoted-literal scan, structural identifier scan) across `authorization.ts`,
     `identity.ts`, `rbac/**`; closed neutral role/resource/relationship vocabularies; (b) the Scholar
     adapter's 9 roles register and resolve through the engine exactly like core roles — in-tenant ALLOW,
     cross-tenant DENY at the tenant boundary — with gate-binding value parity and full fail-closed
     rejection matrix (duplicate domain, core shadowing, RULING-4, malformed ids, duplicate runtime gate,
     relationship-type shadowing); (c) a hypothetical second domain ("catering", roles `sous_chef`,
     `head_caterer`, relationship `catered_for`) registers and resolves with **zero core changes**, and a
     cross-domain bare-name collision is rejected atomically.
   - Updated `authorization-exhaustive.test.ts` (decision matrix now spans core + registered domain roles,
     fuzz pool includes domain roles under the same deny-by-default oracle), `identity.test.ts`,
     `h3-010-identity-lifecycle.test.ts`, `identity-lifecycle-enforcement.test.ts` (adapter side-effect
     imports + branded domain resources at the domain boundary; no behavioral assertion weakened).
7. **Baseline ratchet (`architecture/coregrid-mvp-architecture/NEUTRALITY_GUARD_BASELINE.json`)** —
   per the guard's own shrink-only policy ("remove entries in the same change that cleared them"):
   removed all 9 `authorization.ts` and all 13 `identity.ts` entries, refreshed the 7 frozen
   `security-role-gate.ts` legacy-fallback entries against the live tree, summary updated
   (434→412 entries; 1576→1499 observed hits), `meta.lastRatchet` annotated. Guard now reports
   **STATUS=PASS with zero RATCHET warnings**.

## Files Changed

Created:
- `frontend/src/lib/rbac/neutral-roles.ts`
- `frontend/src/lib/rbac/domain-contribution.ts`
- `frontend/src/lib/rbac/role-gate.ts`
- `frontend/src/lib/domain-config/scholar-authorization.ts`
- `tests/unit/rbac-neutrality.test.ts`

Modified:
- `frontend/src/lib/authorization.ts`
- `frontend/src/lib/identity.ts`
- `frontend/src/lib/security-role-gate.ts`
- `tests/unit/authorization-exhaustive.test.ts`
- `tests/unit/identity.test.ts`
- `tests/unit/h3-010-identity-lifecycle.test.ts`
- `tests/unit/identity-lifecycle-enforcement.test.ts`
- `architecture/coregrid-mvp-architecture/NEUTRALITY_GUARD_BASELINE.json` (shrink-only ratchet, mandated by the guard's contract; outside the declared file-ownership list — flagged for coordinator awareness)

## Architecture Impact

- **Domain ↓ Application ↓ Policy ↓ Infrastructure respected**: the authorization engine depends only on
  `rbac/*` + `identity.ts` vocabularies; domain logic (Scholar) enters exclusively through registration
  configuration — no vendor, no education import, no education literal in the core (proven by test).
- **RULING-4 enforced directionally**: domains map onto the neutral universal-role vocabulary; the core
  can never learn a domain role name except through the auditable, fail-closed registration event.
- **Canonical truth preserved**: the engine's decision pipeline, tenant boundary, Invariant 02/12
  enforcement and every user-visible reason string are unchanged; only the vocabulary's *definition site*
  moved (hardcoded table → neutral core + domain contribution).
- **Second-domain readiness**: a new domain registers roles/resources/relationship types/gate bindings
  without touching any platform file (proven by the catering fixture in the new suite).

## Tests

- `npx tsc --noEmit` — clean.
- Full unit suite (`npx vitest run`): **395 files passed, 8480 tests passed** (5 skipped = live-PG
  integration), up from the 8,364 pre-mission baseline with the new proof suites and expanded decision
  matrix — **zero regressions**. Full `npm run verify` intentionally NOT run (coordinator-owned).
- Neutrality guard (`node scripts/verify-domain-neutrality.mjs`): **STATUS=PASS**, zero RATCHET warnings,
  zero new violations.
- Registry drift check (`node scripts/verify-registry-drift.mjs`): clean.
- Targeted suites all green: `authorization-exhaustive` (36), `identity` (32), `security-role-gate` (27),
  `rbac-neutrality` (18), `platform-neutrality`, `roles`, `universal-roles`, `lifecycle-threading`,
  `identity-lifecycle-enforcement`, `h3-010-identity-lifecycle`, `h3-021-independence`,
  `domain-runtime-recertification` (17, incl. guard-ratchet assertions), `mh-24-drift-watch`,
  `identity-actor`, `domain-config-restaurant`, `scholar-role-engine`, `scholar-role-catalog`,
  `identity-registry`, `capability-gate` — 615 tests across 19 files.
- ESLint on every touched file: clean (auto-fixed formatting only; no rule suppressions added).

## Security Validation

- **Tenant boundary**: registered domain roles are subject to the same tenant gate — in-tenant ALLOW,
  foreign-tenant DENY with the standard tenant reason (tested for `teacher` and the second domain).
- **Fail-closed everywhere**: duplicate registration, core shadowing, universal-role impersonation
  (RULING-4), malformed ids, unknown roles, unknown resources/actions all rejected or denied (tested).
- **Atomicity**: a rejected registration leaves every registry untouched (tested for roles, grants,
  relationship types, and staff role sets).
- **Invariant 12**: agents still receive no role-derived authority; the fuzz suite (5,000 seeded cases,
  now including domain roles) holds the deny-by-default oracle invariant.
- **No security boundary moved**: RLS untouched; no database writes; no policy, authorization or
  governance rule modified; the gate's enforcement behavior is byte-identical (legacy parity asserted).

## Known Risks

1. **`security-role-gate.ts` retains 20 education-token hits** (7 baseline groups): they exist only in
   frozen legacy fallback constants (`SchoolStaffRole` values, gate-kind RPC names, reasons). Deleting
   them requires repointing ~25 consumer imports (`runtime/scholar/*.functions.ts`) to the runtime's own
   contribution module — outside this mission's file ownership. Quarantined, not deleted (§52/§39).
2. **Two registration side effects per test file**: adapter registration happens at import; vitest's
   per-file module registry isolates this. If a future test runner shares module state across files,
   registration order must be revisited.
3. **Branded `DomainPermissionResource`/`DomainRegisteredRole`** intentionally do not accept bare string
   literals — existing code that previously passed `"student"`-style literals now needs an explicit
   boundary marker. This is the designed friction (unregistered vocabulary cannot flow silently), but it
   is an API-surface change for future core-side callers.
4. **Restaurant `workspace` kinds** (`"org_admin"`, `"teacher"`, `"bursar"` in
   `domain-config/restaurant.ts`) are documented-gated borrows from the first runtime's vocabulary; they
   are a pre-existing inconsistency (configuration data, not the authorization core) and were left
   untouched per ownership — reported here for follow-up.

## Education-contaminated files found but NOT owned (full list)

Discovered during repository discovery; left untouched per mission ownership. Counts = currently
quarantined baseline hits (live, per `NEUTRALITY_GUARD_BASELINE.json` summary after this ratchet).

**Platform-core-adjacent — highest priority for a follow-up SECURITY mission:**
- `frontend/src/lib/roles.ts` (6 hits) — `AppRole` union hardcodes `principal/teacher/bursar/parent/student` (consumer of the neutral core).
- `frontend/src/lib/identity-actor.ts` (17 hits) — hardcodes `SCHOOL_ROLES`/`PLATFORM_ROLES` actor vocabularies.
- `frontend/src/lib/identity-registry.functions.ts` (10), `frontend/src/lib/kernel-reality.functions.ts` (14), `frontend/src/lib/foundation-loop.functions.ts` (2).
- `frontend/src/lib/tenant-core.ts` (3), `frontend/src/lib/tenant.ts` (2), `frontend/src/lib/tenant-topology.ts` (3), `frontend/src/lib/org-model.ts` (5), `frontend/src/lib/institution-core.ts` (7), `frontend/src/lib/workspace-projection.ts` (2), `frontend/src/lib/platform-core.ts` (2).
- `frontend/src/lib/kernel/phase-contracts/` — `phase-01-foundation.ts` (6), `phase-02-identity.ts` (6), `phase-03-multi-tenancy.ts` (1), `index.ts` (2), `define-phase.ts` (1), plus other phase contracts listed below (kernel purity is otherwise owned by `kernel-purity.test.ts`).
- `frontend/src/lib/audit.ts` (5), `frontend/src/lib/messages-unread.ts` (10), `frontend/src/lib/news-reads.ts` (16), `frontend/src/lib/subscription-tiers.ts` (24), `frontend/src/lib/regional-context.ts` (21), `frontend/src/lib/attendance-identity.ts` (33) — lib-root modules importing education vocabulary into shared surfaces.
- `frontend/src/lib/ai-context.ts` (3), `frontend/src/lib/ai-core.ts` (1), `frontend/src/lib/ai-gateway.server.ts` (1), `frontend/src/lib/ai-governance.ts` (1).
- `frontend/src/lib/scheduling-*` (12 + 10 + 5 + 3 + 2 + 2 + 1 + 1), `frontend/src/lib/workforce-*` (10 + 3 + 1), `frontend/src/lib/financial-*` (18 + 16 + 13 + 3 + 2), `frontend/src/lib/communication-*` (13 + 5 + 1 + 1), `frontend/src/lib/analytics-*` (8 + 3 + 3 + 3), `frontend/src/lib/data-*` (4 + 3 + 3), `frontend/src/lib/command-*` (3 + 2 + 1), `frontend/src/lib/dev-*` (8 + 3), `frontend/src/lib/integration-*` (2 + 1), `frontend/src/lib/trust-*` (9 + 2), `frontend/src/lib/marketplace-*` (6 + 3), `frontend/src/lib/government-*` (3 + 1), `frontend/src/lib/enterprise-governance.ts` (1), `frontend/src/lib/hardware-*` (5 + 2), `frontend/src/lib/twin-core.ts` (10), `frontend/src/lib/evolution-core.ts` (3), `frontend/src/lib/phase-catalog.ts` (4), `frontend/src/lib/class-levels.ts` (1), `frontend/src/lib/localization-content.ts` (1), `frontend/src/lib/push.functions.ts` (1), `frontend/src/lib/push.server.ts` (1), `frontend/src/lib/runtime-command-query.ts` (1).

**Domain-owned Phase-04/Phase-11 implementations (may STAY; must never be imported by platform core — verified none are):**
`education-core.ts` (42), `education-curriculum.ts` (42), `education-institution.ts` (47), `education-assessment.ts` (22), `education-governance.ts` (8), `education-facilities.ts` (1), `education-reality-view.ts` (3), `academic-intelligence-report.ts` (52), `academic-curriculum.ts` (30), `academic-core.ts` (16), `academic-risk.ts` (16), `academic-mastery.ts` (7), `academic-assessment.ts` (6), `academic-pathways.ts` (5), plus `kernel/phase-contracts/phase-11-academic-intelligence.ts` (29), `phase-12-scheduling-intelligence.ts` (10), `phase-13-financial-system.ts` (9), and the remaining phase contracts (1–2 hits each).

**Database migrations** (128 baselined hits across 40+ files, e.g. `20260907000100_runtime_scholar_workforce_catalog.sql` 114, `20260620122048_*.sql` 84) — schema history is immutable; neutral primitives already began at `20261002000001_coregrid_v1_neutral_tenant_primitives.sql`.

## Remaining Work

1. Follow-up mission: neutralize `roles.ts` + `identity-actor.ts` (the last lib-root role vocabularies
   that hardcode education roles) by repointing them at `rbac/neutral-roles.ts` + domain contributions.
2. Follow-up mission: migrate `runtime/scholar/*.functions.ts` consumers from
   `security-role-gate.ts` legacy constants to the registered runtime contribution, then clear the 7
   remaining baseline entries.
3. Coordinator: run full `npm run verify` (neutrality guard evidence captured standalone here).
4. Phase-catalog / kernel phase-contracts education strings: decide whether capability ids like
   `academic-intelligence` are legitimate domain capability *names* (config data) vs. kernel vocabulary
   violations, and baseline or migrate accordingly.
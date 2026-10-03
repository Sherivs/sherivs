# V1-008 Report — Platform Onboarding Engine (team ONBOARDING)

Mission: V1-008 of the CoreGrid V1 program, Wave 2. Branch base: `cursor/p08-foundation-loop-classification-fe86`.
Report format: AGENTS.md §42. Version-target classification (§45): **V1 organizational capability envelope** (tenant/identity/onboarding; no V2 device/IoT or V3 Reality-Intelligence surface touched).
All evidence below is from commands run in this session. Per mission law, no git commands, no real database writes (all substrate clients mocked in tests), no migrations authored.

## Implemented

1. **Neutral provisioning contract (`frontend/src/lib/onboarding/provisioning-contract.ts`)** — Zod-validated onboarding request (`organizationProvisioningRequestSchema`): `domainId` (registered domain), `identity` (name/contact), `structure` (slug, subscription tier/fee, domain-owned `domainData`), `people` (fullName, email, domain-local role, `createAuthAccount`), `.strict()`. Plus the vendor-agnostic structural client contracts (`ProvisioningSubstrateClient`, `ProvisioningIdentityAdminClient`) — the engine never imports Supabase; the sanctioned admin client is narrowed onto these at one server-boundary adapter point (same proven pattern as `lib/server/write-audit.ts`).
2. **Domain-provisioning registry (`frontend/src/lib/onboarding/domain-provisioning.ts`)** — the registration half of the DomainDefinition pattern for provisioning (modeled on `rbac/domain-contribution.ts`): a domain declares ONCE its organization record write, workspace writes, membership write, auxiliary writes and its request-role vocabulary (accepts → `platformRole` + `recordValue` + RULING-4 `neutralRoles` + mandatory description) as pure builders over `ProvisioningContext`. `registerDomainProvisioning()` is **fail-closed and atomic**: malformed ids/tables, duplicate domain ids, request-role collisions inside a contribution, **cross-domain claims of another contribution's domain-contributed platform role**, invalid neutral mappings and non-function builders reject the ENTIRE registration. Resolvers: `resolveDomainProvisioning`, `registeredProvisioningDomainIds`.
3. **The engine (`frontend/src/lib/onboarding/provision-organization.ts`)** — `executeOrganizationProvisioning()` provisions, as ONE transactional unit, in order: organization record → workspaces → identities (generated-once passwords) → memberships → domain auxiliary records. Every person role is resolved fail-closed BEFORE any write (`preflightPeople`/`resolvePersonRole`): unresolvable request role, a domain-contributed platform role with no registered grants (`resolveRoleGrants`), duplicate emails, or a `peopleRequireAuthAccounts` violation aborts the unit with **zero** substrate writes. Because PostgREST exposes no multi-statement transaction from the JS client, the unit executes under a **compensation ledger**: every created record/auth account is undoable, any step failure rolls the unit back in reverse order and returns a failure naming the failed step plus the compensation state (a failed provisioning is never reported as provisioned). Returns per-membership evidence: platform role, vocabulary class (neutral-core vs domain-contributed), persisted `recordValue`, neutral semantics, resolved capability grants, created record/auth ids.
4. **Generated-once credentials (`frontend/src/lib/onboarding/generated-credentials.ts`)** — `generateInitialPassword()`: ≥20 chars, all four character classes guaranteed, unbiased Web-Crypto rejection sampling, Fisher–Yates shuffle; isomorphic (no Node built-in leaks into client bundles). Provisioned passwords are created at provisioning time and returned to the caller exactly once — never constant, never logged, never audited (§29/§30).
5. **Server function (`frontend/src/lib/onboarding/provision-organization.functions.ts`)** — `provisionOrganization` (TanStack Start server fn) implements §27 end-to-end: requireSupabaseAuth middleware → control-plane scope (no client tenant trusted) → `requirePlatformSuperAdmin` (fail-closed, lifecycle threading + session attestation, same gate as `createSchoolWithAdmin`) → Zod validator → composition-root load of registered contributions → engine execution over the service-role substrate → `writeAuditRecord` (fail-closed; credentials deliberately absent from audit details) → outcome returned to the caller.
6. **Scholar as a DomainDefinition contribution (`frontend/src/lib/onboarding/contributions/scholar-provisioning.ts`)** — the education runtime now provisions THROUGH the engine: organization → `schools`, membership → `users` (legacy `users.role` values preserved byte-for-byte via `recordValue`: `school_admin`→`admin`, plus `principal`/`teacher`/`bursar`/`parent`/`student`/`driver`), auxiliary → `subscriptions`. Importing it also loads `domain-config/scholar-authorization.ts`, so grant resolution works; `school_super_admin` is deliberately NOT a tenant-membership role (the Scholar super-admin path remains the control-plane `super_admins` bootstrap). Self-registers fail-closed at module load; `registered-contributions.ts` is the composition root (one import per domain).
7. **Step 3 — DEMO_CREDENTIALS eliminated (generated-credentials-once flow)**:
   - `frontend/src/lib/runtime/scholar/demo-provision.functions.ts` (edited solely for this fix): the `DEMO_CREDENTIALS` constant and the fixed password `Demo@2026!` are gone. `DEMO_ACCOUNTS` is now an identifier list (role/label/email — emails remain deterministic fixture identifiers required by the idempotent `ensure*` upsert flow); every initial password is `generateInitialPassword()` per run, returned once in the result. The env gate (`ALLOW_DEMO_PROVISIONING !== "true"` throws, default OFF in every environment) is preserved byte-for-byte, as are the §27 invariant markers (`ensureSchool(`, `.from("super_admins")`).
   - `frontend/src/routes/auth.tsx` (edited solely for this fix): the public /auth page no longer imports `DEMO_CREDENTIALS` or renders any credential; the demo button signs in from the server-returned generated-once result. Previously the page displayed `admin@demo.school / Demo@2026!` to every visitor unconditionally — a production-reachable fixed-credential leak, now closed.
8. **Tests** — `tests/unit/onboarding-provisioning-engine.test.ts` (15 tests) and `tests/unit/onboarding-credential-isolation.test.ts` (8 tests), below.

## Files Changed

New (ownership: `frontend/src/lib/onboarding/**` + own tests):
- `frontend/src/lib/onboarding/provisioning-contract.ts`
- `frontend/src/lib/onboarding/domain-provisioning.ts`
- `frontend/src/lib/onboarding/provision-organization.ts`
- `frontend/src/lib/onboarding/generated-credentials.ts`
- `frontend/src/lib/onboarding/provision-organization.functions.ts`
- `frontend/src/lib/onboarding/registered-contributions.ts`
- `frontend/src/lib/onboarding/contributions/scholar-provisioning.ts`
- `tests/unit/onboarding-provisioning-engine.test.ts`
- `tests/unit/onboarding-credential-isolation.test.ts`

Edited (step-3 demo-credential fix only):
- `frontend/src/lib/runtime/scholar/demo-provision.functions.ts`
- `frontend/src/routes/auth.tsx`

Not touched: `createSchoolWithAdmin` and `frontend/src/lib/runtime/scholar/provisioning.functions.ts` (frozen for this mission beyond the demo fix), `rbac/**`, `domain-config/**` (see Caller-Migration Status for the plan), no migrations.

## Caller-Migration Status (objective 2)

Discovery: `createSchoolWithAdmin` has exactly ONE caller — `frontend/src/components/super-admin/add-school-form.tsx` (verified by grep). The caller surface is small, but the ownership law for this mission restricts edits to `onboarding/**` + own tests + the demo-credential fix, so the caller refactor is **reported, not executed**. Migration plan (mechanical, ~1 file + optional cleanup):

1. `add-school-form.tsx`: swap `useServerFn(createSchoolWithAdmin)` → `useServerFn(provisionOrganization)`; map form state to the request contract (`domainId: "scholar"`, `identity: { name: schoolName, contactEmail: schoolEmail, phone, address }`, `structure: { subscriptionTier: tier, monthlyFee }`, `people: [{ fullName: adminFullName, email: adminEmail, role: "school_admin", createAuthAccount: true }]`). Read `r.organization.id`/`memberships[0].initialPassword` for the existing credentials panel (result shape differs: no `schoolSlug`/`publicUrlSuffix` — the slug lives in the request, so the form can compute/display it locally).
2. Register `school_admin` as the form's fixed role (already in the Scholar vocabulary; alias `admin` also resolves).
3. Deprecate `createSchoolWithAdmin` (delete after one release; it and `resetSchoolAdminPassword`'s `defaultAdminPassword(slug)` — a derived, partially predictable password — should be re-pointed to `generateInitialPassword()`).
4. Keep `checkPlatformBootstrap`/`claimFirstSuperAdmin` unchanged (control-plane bootstrap, not tenant onboarding).

## Architecture Impact

- The platform now has a domain-neutral provisioning engine: WHAT an organization/workspace/membership/auxiliary record physically is, and WHAT roles a person may carry, are per-domain configuration (`DomainProvisioningContribution`), never engine code — the engine contains zero Scholar vocabulary (matches the V1-006 neutrality direction; `lib/onboarding/**` core files carry no domain tokens).
- Layering respected (§24): Domain (`domain-config/`, `onboarding/contributions/`) → Application (`onboarding/provision-organization.ts`) → Policy (rbac registries resolved at runtime) → Infrastructure (structural client contracts, narrowed to Supabase at one boundary) → Provider.
- Role resolution composes the two platform vocabularies exactly: neutral core roles from `rbac/neutral-roles.ts`, domain-contributed roles through `rbac/domain-contribution.ts`'s combined grant table — a provisioning unit can only grant roles its own domain (or the platform core) owns.
- The `/auth` fixed-credential display is gone; demo credentials exist only as generated-once, returned-once values behind an environment gate.

## Tests

`npx vitest run tests/unit/onboarding-provisioning-engine.test.ts tests/unit/onboarding-credential-isolation.test.ts` → **2 files, 23/23 passed**:

- (a) transactional unit: one run creates org + workspace + identities + memberships + auxiliary with exact step ordering and payload evidence; neutral-core grants (`NEUTRAL_ROLE_PERMISSIONS.org_owner`) and domain-contributed grants (`resolveRoleGrants("sous_chef")` / `("school_admin")` / `("teacher")`) resolve; credentials returned once and provably absent from every substrate payload.
- (b) Scholar end-to-end: `schools`/`users`/`subscriptions` mapping reproduced byte-for-byte via configuration; legacy alias `admin` ≡ canonical `school_admin`; `peopleRequireAuthAccounts` enforced (zero writes on violation).
- (c) failure semantics: membership-insert failure mid-run rolls back records AND both provisioned identities in reverse order (`compensated` = 4 entries, substrate clean); auth-creation failure mid-run rolls back everything created; compensation failures are reported (`compensationErrors`), never silently passed.
- (d) isolation: a Scholar unit rejects `sous_chef` (registered by another domain) at preflight with zero writes; a platform role with no rbac registration is rejected; a second domain claiming `school_admin` is rejected at registration; neutral core roles may be shared across domains; duplicate/malformed registrations fail closed and atomically.
- Credential isolation: no password constant anywhere in the demo module; `/auth` renders no credential; **no file under `frontend/src` carries `Demo@2026!`** (recursive scan); env gate preserved with the dynamic substrate import reachable only after the gate; generator entropy/strength/refusal properties.

Regression evidence (targeted, per mission law — no full `npm run verify`):
- `npx vitest run tests/unit/scholar-invariant-environment-gated.test.ts tests/unit/scholar-invariant-staff-platform-gated.test.ts` → **52/52 passed** (the §27 invariant suites pinning `demo-provision.functions.ts` and `provisioning.functions.ts` still pass).
- `npm run typecheck` → the only errors are 4 pre-existing ones in files owned by concurrent work (`frontend/src/lib/missions/**`, `frontend/src/components/planned-capability-state.tsx` — confirmed absent from the clean tree; none in `onboarding/**`, `demo-provision.functions.ts`, or `auth.tsx`).
- `node scripts/verify-domain-neutrality.mjs` → 0 hits attributable to this change set (the 61 reported FAIL hits all belong to concurrent untracked lib-root files, e.g. `portal-overview.functions.ts`, none matching `onboarding|demo-provision|routes/auth`).

## Security Validation

- Authentication/authorization: `provisionOrganization` enters only through a verified bearer token + `requirePlatformSuperAdmin`; no client-supplied tenant/role is trusted (roles resolve exclusively through the domain's registered vocabulary and the rbac registries).
- Fail-closed everywhere: unregistered domain, unresolvable role, grantless platform role, duplicate email, auth-account requirement violation — all abort pre-write with zero substrate mutations.
- No partial state: compensation ledger reverses every write on mid-unit failure; compensation failures surface in the result (never swallowed) and the server fn throws rather than reporting success.
- Cross-domain isolation proven by test: a Scholar unit can never grant catering capabilities; two domains can never claim the same domain-contributed platform role.
- §30/§29: fixed demo credentials removed from all production-reachable paths (recursive source scan green); generated passwords returned once, excluded from audit details; audit record is fail-closed and attributed (actorId required).
- Mandatory invariants (§31) covered at unit level with mocked substrates: cross-tenant access is structurally impossible here (provisioning creates a NEW tenant; no cross-tenant read/write surface exists in the engine).

## Known Risks

1. **Application-level transactionality**: PostgREST cannot execute the multi-table unit atomically; the compensation ledger is application-level enforcement. A failure between compensation steps could leave orphan rows (reported, not silent). Native atomicity requires a Postgres function/RPC — a schema-level change outside this mission's authority.
2. **Demo password rotation on re-run**: `provisionDemoEnterprise` generates a NEW password each run (and updates existing demo accounts to it), so a previously-returned password stops working after a re-provision — correct for the generated-once posture, but `tests/e2e/helpers.ts` and the e2e specs still hard-code `Demo@2026!` and will fail against a freshly re-provisioned environment (test-only files, not production-reachable; update deferred to the e2e owners).
3. **rbac owner lookup gap**: the provisioning registry proves platform-role ownership across domains, but `rbac/domain-contribution.ts` exposes no role→domainId owner lookup, so a provisioning contribution cannot verify at runtime that its platformRole was registered under ITS OWN domainId in the rbac registry (grants-non-empty is checked; exact owner is not). One exported helper (`resolveDomainRoleOwner`) in `rbac/` would close this — left to the SECURITY owner.
4. **Slug uniqueness**: the engine is insert-only; duplicate slugs fail on the substrate unique constraint and roll back cleanly (reported), rather than being pre-resolved by query (the legacy createSchoolWithAdmin probed for free slugs). Callers may pass an explicit `structure.slug`.

## Remaining Work

1. Execute the caller migration plan above (small: one component) and deprecate `createSchoolWithAdmin`.
2. Author the universal substrate gap: there are **no universal `organizations`/`workspaces`/`memberships` tables** — the engine is contribution-table-driven over existing tables (Scholar: `schools`/`users`/`subscriptions`); a neutral workspace record has no physical home, which is why Scholar declares zero workspace rows while the engine's workspace step is proven by a fixture domain. Universal tenant/workspace/membership substrate tables (with RLS) are a reported gap requiring a migration authority.
3. Add `resolveDomainRoleOwner` to `rbac/domain-contribution.ts` (Known Risk 3).
4. Update e2e helpers to consume returned generated credentials (Known Risk 2).
5. Server-function invariant ledger (M-R-121 T2) does not yet classify `onboarding/provision-organization.functions.ts` as a family; add it to the §27 suite partition when the ledger is next ratcheted.
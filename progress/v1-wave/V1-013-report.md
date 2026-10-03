# V1-013 Report — School-Creation Migration to the Onboarding Engine (team ONBOARDING)

Mission: V1-013 of the CoreGrid V1 program, Wave 3. Branch base: `cursor/p08-foundation-loop-classification-fe86`.
Report format: AGENTS.md §42. Version-target classification (§45): **V1 organizational capability envelope** (tenant onboarding path only; no V2 device/IoT or V3 Reality-Intelligence surface touched).
All evidence below is from commands run in this session. Per mission law: no git commands, no real database writes, no full `npm run verify`.

## Implemented

1. **Caller migration (`frontend/src/components/super-admin/add-school-form.tsx`)** — the super-admin Add School form now provisions through the platform onboarding engine: `useServerFn(provisionOrganization)` (from `lib/onboarding/provision-organization.functions.ts`) with `domainId: "scholar"`, `identity` (school name/contact email/phone/address), `structure` (subscription tier + monthly fee), and one person `{ fullName, email, role: "school_admin", createAuthAccount: true }` — the same tenant shape the legacy creator produced (`schools` row, `users` row with role `admin` via the Scholar contribution's byte-for-byte `recordValue`, `subscriptions` row), now under the engine's fail-closed preflight, compensation ledger and shared write-audit hook. The `onCreated` prop type is the engine's ok outcome (`Extract<ProvisionOrganizationResponse, { ok: true }>`); the sole consumer (`routes/_authenticated/super-admin/schools.tsx`) passes a no-arg callback and needed no change.
2. **Response-shape honesty (generated-once credentials, §30)** — the engine returns the admin's initial password exactly once, in `memberships[0].initialPassword`; the form surfaces it only in the single success panel (plus the operator-driven "Copy all" clipboard action, as before), holds it in component state only, and never logs it, never writes it to storage, and never caches it in a query. The form narrows the `ProvisioningOutcome` union (`if (!r.ok) throw … r.failedStep / r.reason`) before treating the result as provisioned — a failed unit is never displayed as created (the server fn itself throws on non-ok; the client guard is the type-honest counterpart). The engine response carries no slug, so the public-URL rows are computed locally by a client-side mirror of the Scholar contribution's slug derivation (`slugify(name) || "school"`), and the panel now also shows the engine's authoritative tenant record id (`organization.id`).
3. **Legacy creator removed (`frontend/src/lib/runtime/scholar/provisioning.functions.ts`)** — `createSchoolWithAdmin`, its `createSchoolSchema`, `CreateSchoolInput`, `CreateSchoolResult`, the module-local `slugify`, and the derived, partially predictable `defaultAdminPassword` (`Admin@<slug><year>!`) are **removed** (after migration there were zero callers; V1-008's plan allowed "delete after one release" — with no remaining caller there is no release to deprecate across). `resetSchoolAdminPassword` is re-pointed to the engine's `generateInitialPassword()` (generated-once, ≥20 chars, four character classes) per the V1-008 plan, closing the predictable-password pattern for password resets too. `checkPlatformBootstrap` and `claimFirstSuperAdmin` are unchanged (control-plane bootstrap, not tenant onboarding — V1-008 plan step 4).
4. **§27 invariant manifest updated (`tests/unit/scholar-invariant-staff-platform-gated.test.ts`)** — the `provisioning.functions.ts` family suite's classified manifest drops the removed `createSchoolWithAdmin` entry; the inventory test (classified count == exported server fns) now matches the module's four remaining functions.
5. **New migration proof (`tests/unit/v1-013-school-form-migration.test.ts`)** — 8 tests proving: (a) the form binds `useServerFn(provisionOrganization)` from the onboarding functions module with no trace of the legacy import, maps the request contract (`domainId: "scholar"`, `role: "school_admin"`, `createAuthAccount: true`, identity/structure blocks) and narrows the outcome union; (b) credentials surface only from `memberships[0].initialPassword`, with no `console.*`, no `localStorage/sessionStorage/indexedDB`, and no credential persistence in the form; (c) the legacy module no longer exports the creator or its types, carries no `defaultAdminPassword` or `Admin@$` derivation, `resetSchoolAdminPassword` uses `generateInitialPassword()` (no `new Date().getFullYear()` salt), and the engine server fn remains the sanctioned entry point (`requirePlatformSuperAdmin` + `executeOrganizationProvisioning`).

## Files Changed

- `frontend/src/components/super-admin/add-school-form.tsx` (migrated to the engine)
- `frontend/src/lib/runtime/scholar/provisioning.functions.ts` (legacy creator + derived password removed; reset re-pointed to `generateInitialPassword()`)
- `tests/unit/scholar-invariant-staff-platform-gated.test.ts` (manifest entry for the removed fn dropped — direct test of the module)
- `tests/unit/v1-013-school-form-migration.test.ts` (new)

Not touched (reported instead, see Remaining Work): `frontend/src/lib/onboarding/**` (engine needed no changes), `architecture/campaigns/V1-PROGRAM/COMMAND-CENTER.md` line 20 (stale Wave-1 status row still describing the pre-V1-008 onboarding surface — owned by the program level), historical doc comments referencing the retired fn in `lib/onboarding/contributions/scholar-provisioning.ts` and `lib/onboarding/provision-organization.functions.ts` (both outside this mission's file ownership; purely historical context, no code reference). No migrations authored.

## Architecture Impact

- Tenant creation is now single-path: the only production surface that provisions an organization routes through the domain-neutral onboarding engine (`provisionOrganization` → `executeOrganizationProvisioning` over the Scholar `DomainProvisioningContribution`), eliminating the parallel Scholar-specific implementation (§24 layering: the form talks to the application layer, never to the substrate).
- Security posture improved: the last production use of the derived `Admin@<slug><year>!` password pattern (predictable from a school's slug — weak against any observer who knows the naming rule and the year) is gone; both provisioning and password reset now issue generated-once passwords returned exactly once (§29/§30).
- Behavior deltas (accepted, per the V1-008 plan): (1) slug collisions no longer get a `-2…-9` suffix probe — the engine is insert-only, so a colliding slug fails on the substrate unique constraint and rolls back cleanly (Known Risk 4 of V1-008); (2) the audit record moves from `super_admin_logs` to the shared fail-closed `audit_logs` hook (`onboarding.provision_organization`, credentials absent from details); (3) the engine additionally enforces fail-closed preflight (role vocabulary, duplicate emails) and rollback of org + identity + membership + subscription on mid-unit failure.

## Tests

`npx vitest run tests/unit/v1-013-school-form-migration.test.ts tests/unit/scholar-invariant-staff-platform-gated.test.ts tests/unit/scholar-invariant-environment-gated.test.ts tests/unit/mh-01-write-audit.test.ts tests/unit/p08-enforcement-surface.test.ts tests/unit/onboarding-provisioning-engine.test.ts tests/unit/onboarding-credential-isolation.test.ts`
→ **7 files, 94/94 passed** (includes the new 8-test migration proof; the §27 invariant suites for `provisioning.functions.ts`, the write-audit adoption suite, the p08 enforcement-surface classification, and the V1-008 engine/credential suites all still green).

Typecheck: `npm run typecheck` → zero errors in any file touched by this mission. The only reported errors are pre-existing ones in `frontend/src/lib/workforce/worker-registry-db.server.ts` (owned by concurrent work, untouched here).

## Security Validation

- Authorization unchanged and still fail-closed: `provisionOrganization` enters only through a verified bearer token + `requirePlatformSuperAdmin` — the same gate the legacy creator enforced (verified by reading both modules); no client-supplied tenant/role is trusted (the `school_admin` role resolves exclusively through the Scholar contribution's registered vocabulary).
- §30/§29: the predictable derived password pattern is fully removed from the codebase (`Admin@$` grep clean); generated passwords are returned once in the response, absent from audit details, and the new form test asserts they are never logged or persisted client-side.
- §31 mandatory invariants at unit level: the migration creates a NEW tenant (no cross-tenant read/write surface is introduced); failure paths roll back via the engine's compensation ledger and are never reported as provisioned (asserted in the migration test's union-narrowing check).
- No destructive refactoring (§39): usage search across the repo showed exactly one production caller before removal; every other hit was a comment, a progress/architecture doc, or the direct test manifest (evidence below).

## Usage-Search Evidence (§52 law)

Pre-migration grep for `createSchoolWithAdmin` (all files): `frontend/src/components/super-admin/add-school-form.tsx` (the ONE caller), `frontend/src/lib/runtime/scholar/provisioning.functions.ts` (definition), `tests/unit/scholar-invariant-staff-platform-gated.test.ts` (direct-test manifest entry), plus comments/docs (`V1-008-report.md`, `COMMAND-CENTER.md`, `onboarding/**` comments, engine test header comment). `defaultAdminPassword`: only inside `provisioning.functions.ts` (`createSchoolWithAdmin` + `resetSchoolAdminPassword`). `CreateSchoolResult`/`CreateSchoolInput`: only the definition and the caller form. → Proceeded with removal; the sole non-caller code reference (the invariant manifest) was updated, the other hits are historical docs/comments reported above. Post-migration grep: zero code references remain outside the new absence-proof test and historical docs.

## Known Risks

1. **Slug collision behavior change**: a school whose derived slug already exists now fails (with a clean rollback) where the legacy path appended `-2…-9`. Operators retrying with a tweaked name see the substrate error surfaced in the form. Fixing it properly means a slug-uniqueness pre-check or a Postgres function — engine-level change outside this mission's ownership.
2. **Client-side slug mirror**: the form duplicates the Scholar contribution's `slugify` for the public-URL display (the engine response carries no slug). If the contribution's derivation ever changes, the display could drift from reality. The honest alternative — exporting the derivation or echoing the slug in the engine outcome — touches `lib/onboarding/**` (outside this mission's ownership) and is reported for the ONBOARDING owner.
3. **Stale program doc**: `architecture/campaigns/V1-PROGRAM/COMMAND-CENTER.md` still describes the pre-engine onboarding surface; not updated (file ownership law).

## Remaining Work

1. (Owner: program level) Refresh `COMMAND-CENTER.md` row 9 and the historical mentions in `lib/onboarding/**` doc comments.
2. (Owner: ONBOARDING) Optionally echo the derived `slug` on the engine's ok outcome (or export the Scholar slug derivation) to remove the client-side mirror (Known Risk 2), and pre-resolve slug uniqueness (Known Risk 1).
3. (Owner: ONBOARDING, from V1-008) Universal workspace substrate, `resolveDomainRoleOwner` in `rbac/`, e2e helper credential refresh, §27 ledger entry for the onboarding family — unchanged from the V1-008 report.

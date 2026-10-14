# SHERIVS-ENVIRONMENT-SEPARATION-AUDIT-001

**Mission ID:** SHERIVS-ENVIRONMENT-SEPARATION-AUDIT-001
**Mission type:** READ-ONLY ENVIRONMENT INVENTORY AND SEPARATION PLANNING
**Version target:** ACTIVE-V1 ONLY
**Timestamp (UTC):** 2026-10-14T18:58:36Z
**Role:** Principal Systems Architect / Production Security Architect / Supabase Database Auditor / Secrets Management Engineer / Independent Verification Engineer

**Final status:** **A. INVENTORY COMPLETE — READY FOR INDEPENDENT REVIEW**

This mission produced a plan. It did **not** clean up production, restore
staging, rotate credentials, apply SQL, or change configuration.

SHERIVS-001, SHERIVS-002, and SHERIVS-003 remain **OPEN**.

---

## 0. Decision summary

Production (`nwrflbpbhyiqdptmlccm`) and staging (`dvxszhracsjwdancijdc`) are
**distinct project refs**. Staging is an empty default Supabase project
(GATE4-CATALOG-BASELINE-001). Application runtime, CI batteries, and most
operator scripts still **default to production names** (`SUPABASE_URL`,
`DATABASE_URL`, hard-coded production ref).

Staging-prefixed credentials exist in this Cloud Agent environment and are
**not equal** to the unprefixed production names (catalog-baseline evidence).
The same environment also holds production `SUPABASE_URL` / `DATABASE_URL`
and unprefixed vendor secrets. That mix is a **cross-environment operator
hazard**, not proof that Vercel or GitHub secret stores are mixed.

**Do not delete production data based on demo-looking emails.** Those
identifiers exist in source as fixture constants. Whether matching rows
exist in production is **UNKNOWN** without a separately approved, scoped
check. This mission did not query any database.

---

## 1. Repository branch and HEAD

| Item | Value |
|------|-------|
| Working tree **before** | clean |
| Branch at inspection | `cursor/sherivs-rls-gate4-catalog-baseline-caab` |
| HEAD | `83ae504ab51c5e0781baf33efee42fdee033bf66` (`docs: Gate 4 staging catalog baseline`) |
| Authoritative security-prep + catalog | **this commit** (includes `GATE4-CATALOG-BASELINE-001.md` and the Gate 4 document chain) |
| Gate 4 provision parent | `41f2c0369ae550664d7f726b97e03ab8fd9dc51f` |
| Canonical production git | `origin/master` @ `d195ba861f80379b79533126653b9cee82a8e872` |
| Default product branch (no rls-prep docs) | `coregrid-scholar-migration` @ `857d4fee1ccc9d11b3c4a34f1142ff6a0da1f7fe` |
| This report branch | `cursor/sherivs-environment-separation-audit-caab` |
| Working tree **after** | this file only |

The default checkout `coregrid-scholar-migration` does **not** contain
`docs/security/rls-prep/` or `scripts/staging/sherivs-rls-prep/`. This
mission used the catalog-baseline branch, which does.

No application, migration, proposed SQL, env, or deployment files were
modified.

---

## 2. Authoritative source commit used

| Artifact | Commit |
|----------|--------|
| Catalog baseline report | `83ae504` (`docs/security/rls-prep/GATE4-CATALOG-BASELINE-001.md`) |
| Staging provision report | `41f2c03` (ancestor) |
| Gate 3 review-003 | `61aa7c1` (ancestor) |
| Safety harness / catalog-verify.sql | Gate 4 tree at `83ae504` |
| Live Scholar migrations | `origin/master` @ `d195ba8` — **71** files, **same names** as this branch |

Git files are **not** proof a migration is applied. Staging catalog
baseline: no `supabase_migrations` schema; zero `public` tables.

---

## 3. Production and staging identities (existing evidence)

| Identity | Evidence | This mission |
|----------|----------|--------------|
| Production Supabase ref `nwrflbpbhyiqdptmlccm` | `.env.example` comment; `database/supabase/config.toml` `project_id`; many scripts’ default argv; catalog-baseline: this VM’s `SUPABASE_URL` hostname | **not contacted** |
| Production hosts | `sherivs.com`, `www.sherivs.com`, `app.sherivs.com`, `console.sherivs.com` (`frontend/src/lib/experience/experience-host.ts`, harness markers) | DNS not changed |
| Staging ref `dvxszhracsjwdancijdc` | GATE4-CATALOG-BASELINE-001: URL host, Auth health `sb-project-ref`, pooler username | **database not opened this mission** |
| Staging API URL | `https://dvxszhracsjwdancijdc.supabase.co` (catalog-baseline) | names only |
| Staging DB host | `db.dvxszhracsjwdancijdc.supabase.co` (catalog-baseline) | names only |
| Staging hostname on sherivs.com | **none in source** (`rg` for `staging.sherivs` empty) | UNKNOWN whether a Vercel preview URL exists |
| Catalog of staging | Empty Scholar schema; Postgres 17.11; no policies; no buckets | prior mission |

Production `DATABASE_URL` in this VM contains the production ref (pooler).
Staging `STAGING_DATABASE_URL` contains the staging ref. Hashes unequal
(catalog-baseline). Values not printed.

---

## 4. Configuration inventory (names only; values omitted)

Presence in **this Cloud Agent process** is operator-env evidence, not
Vercel/GitHub store proof. Live Vercel env **values** were not fetched
(would disclose secrets).

### 4.1 Application / template

| Variable | Location | Present | Classification | Consumed by | Accidental prod connect? | Safe remediation indicated |
|----------|----------|---------|----------------|-------------|--------------------------|----------------------------|
| `SUPABASE_URL` | `.env.example`; `frontend/src/lib/env.ts` REQUIRED; `client.ts` / `client.server.ts`; most scripts | SET here; contains **prod** ref | ENVIRONMENT_SPECIFIC (currently production-pointing here) | App runtime, e2e, verify scripts | **YES** if used for staging work | Keep production-only name; never alias to staging |
| `VITE_SUPABASE_URL` | `.env.example`; REQUIRED_VARS; `client.ts` | UNSET here | ENVIRONMENT_SPECIFIC | Browser bundle | YES if set to prod on a staging build | Staging build must use staging URL |
| `SUPABASE_PUBLISHABLE_KEY` / `SUPABASE_ANON_KEY` | `.env.example`; clients; e2e | SET here; **≠** staging-prefixed twins (prior hash) | ENVIRONMENT_SPECIFIC | PostgREST JWT | YES with matching URL | Pair only with same-project URL |
| `SUPABASE_SERVICE_ROLE_KEY` | `.env.example` [SECRET]; server client | SET here; **≠** staging twin | ENVIRONMENT_SPECIFIC | `client.server.ts`, demo provision, e2e fixtures, staff/org provision | **YES — BYPASSRLS** | Never copy into staging; never log |
| `DATABASE_URL` | `.env.example` [INFRA]; `db-apply.mjs`, `db-run.mjs`, adapter live tests | SET here; contains **prod** ref | PRODUCTION_ONLY (this VM) | Operator SQL apply/run | **YES — default apply path** | Require staging-prefixed URL + harness before any staging apply |
| `SUPABASE_PROJECT_ID` / `VITE_SUPABASE_PROJECT_ID` | `.env.example` | UNSET here | ENVIRONMENT_SPECIFIC | templates | UNKNOWN | Document intended env |
| `SUPABASE_ACCESS_TOKEN` | `.env.example` [INFRA]; mgmt scripts | SET here; Management API was HTTP 401 in catalog-baseline | UNKNOWN (invalid in prior mission) | `db-apply-mgmt.mjs` et al. | YES if token later valid + default ref | Do not default argv to production |
| `COREGRID_DB_CA_CERT` / `SUPABASE_CA_CERT` | `.env.example`; `pg-ssl.mjs` | SET | SHARED_NON_SECRET (Supabase Root 2021 CA) | TLS | No | Keep; do not disable verify |
| `COREGRID_DB_INSECURE_TLS` | `pg-ssl.mjs` escape hatch | UNSET | DEMO_ONLY / operator | TLS | Weakens prod TLS if set to `1` | Remain unset |
| `ALLOW_DEMO_PROVISIONING` | `.env.example` default `false`; demo server fn | UNSET (= disabled) | STAGING_ONLY / local-only if ever true | `provisionDemoEnterprise` | **YES if `true` on production** | Must stay unset/false on production |
| `APP_ENV` | `frontend/src/lib/env.ts` | UNSET (classifies as `development`) | ENVIRONMENT_SPECIFIC | required-var matrix | Mis-classification if unset in prod | Set explicitly on each deploy |
| `STAGING_*` / `SHERIVS_RLS_STAGING_URL` | **not** in `.env.example`; Gate 4 docs; harness | SET here | STAGING_ONLY | Harness / catalog missions | No if exclusive | Add names-only to `.env.example`; keep values gitignored |
| `PAYSTACK_SECRET_KEY` | `.env.example`; fee init/verify; webhook | SET here | UNKNOWN live vs test (prefix not inspected) | Scholar payments + webhook | Side effects if live key used in staging | Staging must use `sk_test_` only; never copy live |
| `PAYSTACK_BASE_URL` | `.env.example`; drill | UNSET; **app init hard-codes `https://api.paystack.co`** | ENVIRONMENT_SPECIFIC (unused by fee path) | `verify-payments-live.drill.mjs` | App ignores this override | Companion needed before staging payments |
| `RESEND_*`, `TWILIO_*`, `VAPI_API_KEY`, `AI_API_KEY`, `VAPID_*`, `POSTHOG_*`, `REDIS_REST_*`, `SENTRY_AUTH_TOKEN`, `NEW_RELIC_*`, `CLOUDFLARE_API_TOKEN`, `VERCEL_API_TOKEN`, `EXPO_TOKEN` | `.env.example`; adapters; `provision-vercel-env.mjs` | several SET here | UNKNOWN which vendor project | various | Cross-env if same key used in prod+staging | Separate staging vendor projects / test keys |
| `E2E_*_EMAIL` / `E2E_*_PASSWORD` | `tests/e2e/helpers.ts` | UNSET | STAGING_ONLY / CI | e2e skip-or-run | YES if pointed at prod | Only staging |
| `PLAYWRIGHT_BASE_URL` | `.env.example` | UNSET | ENVIRONMENT_SPECIFIC | e2e | Hits whatever URL | Staging URL for staging tests |

`.gitignore` already ignores `.env` and `.env.*` except `.env.example`. A
`.env.staging` would not be committed.

### 4.2 CI/CD

| Variable / setting | Location | Classification | Accidental prod? |
|--------------------|----------|----------------|------------------|
| `CANONICAL_PROJECT_REF: nwrflbpbhyiqdptmlccm` | `.github/workflows/security-batteries.yml` | PRODUCTION_ONLY | **YES** — RLS battery and restore drill target canonical DB |
| `secrets.SUPABASE_URL` / `SUPABASE_ACCESS_TOKEN` / `SUPABASE_ANON_KEY` | same workflow | UNKNOWN store contents; workflow **intends** canonical/production | YES by design of that workflow |
| Restore/recovery drill | same; writes drill table; PR-excluded | PRODUCTION_ONLY | YES if dispatched |
| `verify.yml` | typecheck/unit/build; no DB secrets | SHARED_NON_SECRET | No |
| `release.yml` | tag `v*`; Docker; human-gated `production` environment | PRODUCTION_ONLY | Deploy path |
| `infrastructure-plan-apply.yml` | `workflow_dispatch`; choices include `environments/production` and `supabase` | PRODUCTION_ONLY when those inputs chosen | Apply is approval-gated |
| `drift-watch.yml` / `infrastructure-verify.yml` | not fully re-enumerated here | UNKNOWN | Read workflows before any run |

### 4.3 Vercel (source-visible; live store UNKNOWN)

| Item | Evidence | Classification |
|------|----------|----------------|
| No `vercel.json` in repo | glob empty | UNKNOWN live project settings |
| Default project name `coregrid-scholar-migration` | `scripts/provision-vercel-env.mjs` | SHARED_NON_SECRET name |
| Upsert map copies **unprefixed** `SUPABASE_URL`, service role, Paystack, Twilio, etc. into Vercel | same script | ENVIRONMENT_SPECIFIC — running it from this VM would push **production** values |
| Claimed `productionBranch master` | `SHERIVS_PROGRAM_STATUS.md` (historical) | UNKNOWN whether still true |
| Staging Vercel project | **not found in source** | UNKNOWN |

This mission did **not** call the Vercel API (env list includes secret
values).

### 4.4 Supabase config

| Item | Location | Classification |
|------|----------|----------------|
| `project_id = "nwrflbpbhyiqdptmlccm"` | `database/supabase/config.toml` | PRODUCTION_ONLY default for CLI |
| CLI migrations dir | `database/supabase/migrations/` | SHARED_NON_SECRET files; apply target is env-specific |
| `.sql.proposed` | `docs/security/rls-prep/proposed-sql/` | STAGING_ONLY until authorized; **not** in apply path |

---

## 5. Demo / test provisioning inventory

| Item | Path | Classification | Trace |
|------|------|----------------|-------|
| `provisionDemoEnterprise` | `frontend/src/lib/runtime/scholar/demo-provision.functions.ts` | DEMO_ONLY (gated) | `ALLOW_DEMO_PROVISIONING !== "true"` throws; then `supabaseAdmin` writes school `demo-enterprise`, users, classes, bus, subscription, `super_admins` |
| Demo emails | same `DEMO_ACCOUNTS` | DEMO_ONLY identifiers in source | `admin@demo.school` … `super@universalschool.os` — **not proof those rows exist in production** |
| Public `/auth` demo button | `frontend/src/routes/auth.tsx` | SHARED_NON_SECRET (removed) | Unit tests: no `provisionDemoEnterprise` import, no demo credentials rendered |
| `/request-demo` | marketing CTA only | SHARED_NON_SECRET | No account creation |
| Playwright local default | `playwright.config.ts` `ALLOW_DEMO_PROVISIONING: … ?? "true"` | DEMO_ONLY for local e2e | Could enable demo fn if tests hit a server with that env |
| Per-run e2e fixture | `tests/e2e/helpers.ts` `provisionLegacyFixture` | STAGING_ONLY intended | Uses `SUPABASE_URL` + service role — **production if those vars are prod** |
| `zz-e2e-*@probe.sherivs.com` | `verify-critical-flows.mjs`, `authenticated-shell.spec.ts` | DEMO_ONLY / probe | Live path uses unprefixed Supabase env |
| `claimFirstSuperAdmin` | `provisioning.functions.ts` + `/super-admin-bootstrap` | PRODUCTION_ONLY capability (also needed on empty staging) | Public until a `super_admins` row exists |
| `provisionOrganization` | `provision-organization.functions.ts` | SHARED (real onboarding) | service_role; production feature |
| `create_organization_with_founder` RPC | onboarding + live SQL `20261008000060` | SHARED | Not on staging (catalog: function absent) |
| `createStaffAccount` / `inviteTeacher` | staff/teachers functions | SHARED | Privileged; service_role inserts |
| `switchActiveOrganization` | `memberships.functions.ts` | SHARED | Writes `users.school_id`/`role` via service_role |
| Seed SQL / fixture generators in `database/` | glob `*seed*` empty | N/A | No seed directory |
| Test-only HTTP API | no dedicated `/api/test` found | UNKNOWN | e2e uses real Auth admin API |

Do **not** create or remove accounts in this mission (none created).

---

## 6. Payments and external services

| Service | Source | Env distinction | Side-effect risk |
|---------|--------|-----------------|------------------|
| Paystack (Scholar fees) | `paystack.functions.ts` `initFeePayment` / `verifyFeePayment`; webhook `/api/public/webhooks/paystack` | **None in fee path** — hardcoded `https://api.paystack.co`; `PAYSTACK_SECRET_KEY` as-is | Live charges if key is live; webhook updates `fees` by reference (H3/H4 OPEN) |
| Paystack TEST drill | `paystack-testmode.server.ts`; `verify-payments-live.drill.mjs` | Refuses `sk_live_`; requires `sk_test_` | Must not be pointed at production fee rows; drill claims no DB writes |
| School-level Paystack keys | `admin/api-keys.tsx`; `schools.paystack_*` | Per-school; production data | Do not copy production merchant keys to staging (Gate 4) |
| Resend | adapters + env | No staging name | Email send if used |
| Twilio / Vapi | adapters + env | No staging name | SMS/voice if used |
| Redis/Upstash | `REDIS_REST_URL` / `TOKEN`; in-process limiter if absent | UNKNOWN which Upstash DB | Rate-limit plane |
| PostHog / Sentry / New Relic | env + health probes | UNKNOWN project | Analytics/ops |
| Object storage | Supabase Storage; staging catalog: **0 buckets** | Prod has live SQL for `school-media` bucket | Do not list customer objects |
| Auth callbacks | `emailRedirectTo` uses `window.location.origin` in bootstrap | ENVIRONMENT_SPECIFIC by host | Staging needs its own origin allow-list (Supabase dashboard — **not changed**) |
| AI gateway | `AI_API_KEY` / `AI_GATEWAY_URL` | UNKNOWN | Cost/side effects if called |

This mission did **not** call Paystack, Resend, Twilio, or other mutating
APIs. Payment records were not read.

---

## 7. Migration and seed inventory

| Item | Evidence |
|------|----------|
| Authoritative directory | `database/supabase/migrations/` |
| Count this branch | **71** `.sql` files |
| Count `origin/master` @ `d195ba8` | **71** (same names) |
| Default branch `coregrid-scholar-migration` | **69** — missing `20261008000050` memberships and `20261008000060` onboarding |
| Rollbacks | `database/supabase/rollbacks/` **31** files (DROP TABLE/POLICY; compensating) |
| Forward migrations `DROP TABLE` / `TRUNCATE` at line start | **none** in `database/supabase/migrations/` |
| Environment-specific SQL | **not found** — same files for every project |
| History assumption | CLI `supabase_migrations.schema_migrations` — **absent on staging** (catalog) |
| Seeds | **none** |
| Scripts defaulting to production ref | `db-apply-mgmt.mjs`, `db-run-mgmt.mjs`, `apply-foundation-migration.mjs`, `apply-approved-v1-migrations.mjs`, `apply-canonical-mr100.mjs`, `apply-canonical-hardening.mjs`, `apply-foundation-from-env-local.mjs`, `probe-foundation-database.mjs`, `run-rls-isolation-check.mjs`, `assess-foundation-conformance.mjs`, `inspect-supabase-github.mjs`, `exercise-foundation-loop.mjs`, `generate-database-types.mjs`, `verify-recovery-drill.mjs`, `restore-recovery-drill.mjs`, `verify-neutral-tenant-primitives.mjs` — argv default or constant `nwrflbpbhyiqdptmlccm` |
| Scripts using `DATABASE_URL` only | `db-apply.mjs`, `db-apply-one.mjs`, `db-run.mjs` — **this VM’s `DATABASE_URL` is production** |
| Staging safeguard | `scripts/staging/sherivs-rls-prep/assert-not-production.mjs` — **not imported by db-apply** |
| Proposed SQL | `.sql.proposed` outside apply path; `00070` BLOCKED; `00090` ineligible |

Do not treat Git files as applied. Do not apply in this mission.

---

## 8. Potential demo-data candidates (no customer rows accessed)

| Candidate | Why it looks demo | Classification of **data** | Proposed verification (separate approval) |
|-----------|-------------------|----------------------------|-------------------------------------------|
| School slug `demo-enterprise` / name “Demo Enterprise Academy” | `DEMO` constant in demo-provision | UNKNOWN in production | Staging: N/A (no tables). Production: **approved** `SELECT id, slug FROM schools WHERE slug = 'demo-enterprise'` only — no PII columns |
| Emails `@demo.school`, `super@universalschool.os` | `DEMO_ACCOUNTS` | UNKNOWN in production | Approved existence check on `auth.users.email` **count** or boolean, not dumps |
| Probe emails `zz-e2e-*@probe.sherivs.com` | e2e / critical-flows | UNKNOWN | Same: boolean existence, then delete only if proven synthetic |
| E2E fixture slug/emails `r1legacy-…@r1legacy.dev` | helpers.ts | UNKNOWN | Same |
| Production customer/student/staff/payment rows | live product | PRODUCTION_ONLY until proven otherwise | **Do not DELETE.** Do not enumerate |

Name-based inference is forbidden as proof. **No broad DELETE.**

---

## 9. Cross-environment risks

1. **Unprefixed env is production in this operator VM** while staging-prefixed
   twins exist. Any `node scripts/db-apply.mjs` would target production.
2. **Hard-coded production ref** in mgmt/apply/probe scripts and
   `config.toml` / `security-batteries.yml`.
3. **`provision-vercel-env.mjs`** upserts this process’s unprefixed secrets
   to Vercel (not run here).
4. **`ALLOW_DEMO_PROVISIONING=true`** on a production-pointing app writes
   demo school + super_admin via service_role.
5. **E2E fixtures** use `SUPABASE_URL` + service role — production if those
   vars are production.
6. **Paystack fee path** has no test/live split; webhook is on production
   hosts.
7. **CI RLS/restore batteries** serialize on the canonical (production) DB.
8. **No sherivs.com staging hostname** in source — staging app deploy target
   is UNKNOWN.
9. **`postgres` / `service_role` BYPASSRLS** (catalog) — service-role key
   reuse across projects is a full-data risk.
10. **Default ACLs** on empty staging grant ALL to anon/authenticated on
    future public tables (catalog-baseline).

---

## 10. Environment ownership matrix

Columns: CURRENT = where it lives or points **now** (evidence);
INTENDED = where it should live after separation.

| RESOURCE | CURRENT ENVIRONMENT | INTENDED ENVIRONMENT | CLASSIFICATION | EVIDENCE | DEPENDENCIES | SECURITY RISK | PROPOSED ACTION | ROLLBACK METHOD | VERIFICATION METHOD | APPROVAL REQUIRED |
|----------|---------------------|----------------------|----------------|----------|--------------|---------------|-----------------|-----------------|---------------------|-------------------|
| Supabase project `nwrflbpbhyiqdptmlccm` | Production | Production | PRODUCTION_ONLY | config.toml, scripts, catalog-baseline URL | App, CI batteries | Customer data; SHERIVS-001/002/003 OPEN | Leave; never use for RLS apply | N/A | Harness refuse | Human for any SQL |
| Supabase project `dvxszhracsjwdancijdc` | Staging (empty) | Staging | STAGING_ONLY | GATE4-CATALOG-BASELINE-001 | Live migrations restore | Useless for RLS until restored | Restore live schema only | Recreate project | Post-restore catalog | Human |
| `SUPABASE_URL` / `DATABASE_URL` (unprefixed) | Production (this VM) | Production only | ENVIRONMENT_SPECIFIC | hostname contains prod ref | App + db-apply | Accidental prod SQL | Never fallback for staging | Restore env from secret store | Harness + hostname parse | Human to rotate if leaked |
| `STAGING_*` / `SHERIVS_RLS_STAGING_URL` | Staging (this VM) | Staging only | STAGING_ONLY | hostname contains staging ref; ≠ prod hashes | Catalog/JWT tests | Safe if exclusive | Keep prefixed; add names to `.env.example` | Remove staging secrets | Harness exit 0 | Human for new keys |
| GitHub `CANONICAL_PROJECT_REF` + batteries | Production | Production (read batteries) | PRODUCTION_ONLY | security-batteries.yml | Secrets store | Writes/reads canonical DB | Add a **separate** staging workflow later | Revert workflow | Battery logs redacted | Human |
| `ALLOW_DEMO_PROVISIONING` | Unset / false | False in production; true only on isolated staging | DEMO_ONLY when true | `.env.example`; demo-provision.functions.ts | service_role | Privileged demo super_admin | Confirm false on Vercel production | Set false | Env name check, not value dump | Human for Vercel inspect |
| `provisionDemoEnterprise` | Code in all deploys | Code may ship; **execution** staging/dev only | DEMO_ONLY | env gate | Demo emails | Prod pollution if gated on | Keep gate; never enable on prod | Gate off | Attempt on staging only | Human to enable staging |
| Demo emails / slug in source | Source | Source identifiers; data only if rows exist | DEMO_ONLY source / UNKNOWN data | DEMO_ACCOUNTS | Auth users | If present in prod, privileged | Scoped existence check then decide | Restore from backup if deleted in error | Boolean SQL on staging copy first | Human |
| `/super-admin-bootstrap` | Production + any deploy | First-run only per project | ENVIRONMENT_SPECIFIC | super-admin-bootstrap.tsx | `super_admins` empty | First-claimer wins | Use on staging after restore; keep locked in prod | N/A | `checkPlatformBootstrap` | Human |
| Paystack `PAYSTACK_SECRET_KEY` | SET here; class UNKNOWN | Prod live vs staging test | UNKNOWN / ENVIRONMENT_SPECIFIC | env name SET; fee path ignores PAYSTACK_BASE_URL | fees, webhook | Live charges; H3/H4 | Staging test key only; do not copy prod | Rotate merchant keys | Drill refuses sk_live | Human |
| Scholar fee init/webhook | Production app | Production until companion | PRODUCTION_ONLY runtime | paystack.functions.ts; APPLICATION-INVENTORY | `00070` BLOCKED | Settlement freeze incompatibility | Do not apply `00070` without companion | Git revert proposed SQL (unapplied) | Staging JWT after companion | Human |
| Vercel env map | UNKNOWN live | Prod and staging **separate projects or env groups** | UNKNOWN | provision-vercel-env.mjs | VERCEL_API_TOKEN | Pushing this VM env overwrites prod | Do not run provision script from mixed VM | Vercel rollback of env | Dashboard names-only review | Human |
| Hosts `*.sherivs.com` | Production | Production | PRODUCTION_ONLY | experience-host.ts | DNS | Harness treats as prod | No staging hostname yet — create later | DNS TTL | Harness refuse those hosts | Human |
| Live migrations 71 files | Git | Apply to staging; already assumed on prod (not re-proven here) | SHARED_NON_SECRET files | ls migrations; catalog staging absent | db-apply | Applying to prod via DATABASE_URL | Staging apply with harness + STAGING_DATABASE_URL only | Staging project recreate | Catalog vs git versions | Human |
| `.sql.proposed` | Docs only | Staging after restore | STAGING_ONLY | rls-prep/proposed-sql | Gate 3 conditions | Prod apply forbidden | Do not copy into migrations/ | Git revert | catalog-verify.sql | Human per file (`00070`/`00090` skip) |
| `service_role` / `postgres` BYPASSRLS | Both projects (staging catalog; prod assumed Supabase default) | Same vendor default | SHARED_NON_SECRET behavior | GATE4 catalog roles | All RPCs | Key reuse = data reuse | Separate keys per project | Rotate | Key inequality hashes | Human |
| CI `verify.yml` | Shared | Shared | SHARED_NON_SECRET | workflow | none | Low | Keep | Revert workflow | CI green | No extra |
| Customer application rows | Production (assumed; **not queried**) | Production | PRODUCTION_ONLY / UNKNOWN contents | Product is live per program status | RLS OPEN findings | Irreversible delete | **No cleanup of customer data** | Backup | Out of scope | Human — deny by default |

---

## 11. Proposed production cleanup plan (**do not execute**)

Goal: production holds only legitimate production operations.

1. **Do not delete customer/student/staff/payment rows.**
2. Confirm `ALLOW_DEMO_PROVISIONING` is not `true` on Vercel production
   (names-only dashboard review; no value paste into git).
3. If a later approved check proves `schools.slug = 'demo-enterprise'` or
   `@demo.school` / `super@universalschool.os` rows, treat as a **scoped**
   cleanup mission with backup, row-level evidence, and rollback — not a
   `DELETE FROM users`.
4. Stop using this mixed Cloud Agent env to run `db-apply`, mgmt apply, or
   `provision-vercel-env`.
5. Leave SHERIVS-001/002/003 remediations on **staging** until catalog +
   JWT proofs exist. No production SQL.

Rollback: production backups / PITR (operator-owned; not verified here).

---

## 12. Proposed staging setup and schema-restoration plan (**do not execute**)

Aligned with GATE4-CATALOG-BASELINE-001 and GATE4-STAGING-PROVISION-001 §11.
Staging project already exists and is empty.

0. **Safety:** export only `STAGING_*` / `SHERIVS_RLS_STAGING_URL`. Run
   `assert-not-production.mjs` (exit 0). Refuse `DATABASE_URL` /
   `SUPABASE_URL`. Prefer IPv4 session pooler if the VM has no IPv6
   (`aws-0-eu-west-1.pooler.supabase.com` + `postgres.<staging-ref>`), with
   pinned CA and `rejectUnauthorized: true`.
1. **Live schema restore only:** apply `database/supabase/migrations/*.sql`
   in filename order from `origin/master` @ `d195ba8` (71 files) using
   **staging** connection exclusively. Wrap apply so the harness runs first.
   Do **not** use `db-apply-mgmt.mjs` without overriding the default ref.
2. **Post-restore catalog** (new mission): compare versions to Git; expect
   Scholar tables, policies, helpers. Still no proposed SQL.
3. **Synthetic fixtures** only (Gate 4 fixture plan). No production dump.
   Empty Paystack school secrets. No real NIN/bank/face.
4. **Eligible proposed SQL** in a later authorized mission: `00010`–`00060`,
   `00080`; skip `00070` and `00090` per Gate 3.
5. **JWT matrix** from `STAGING-TEST-HARNESS.md`.
6. Optional: separate Vercel preview with staging Supabase vars — **not**
   the production project.

Rollback: drop/recreate the staging project (no customer data today per
catalog of **schema**; row emptiness still unclaimed).

---

## 13. Dependencies and rollback requirements

| Step | Depends on | Rollback |
|------|------------|----------|
| Staging schema restore | Isolated creds, harness, 71 live SQL files, IPv4 pooler or IPv6 | Recreate staging project |
| Post-restore catalog | Restore success | N/A (read-only) |
| Proposed SQL | Catalog + Gate 3 skips | Restore from staging snapshot / recreate |
| JWT tests | Schema + fixtures | Delete synthetic auth users only |
| Production RLS apply | Staging proofs; **not this plan** | Production PITR — out of scope |
| Paystack staging | Test key; companion app; skip `00070` until then | N/A |
| Script default-ref change | Human PR (not this mission) | Git revert |

---

## 14. Items requiring human approval

- Any SQL against production.
- Any production row existence check (even slug/email boolean).
- Any DELETE of demo-looking production rows.
- Staging live-migration apply.
- Enabling `ALLOW_DEMO_PROVISIONING` anywhere.
- Vercel env inspection or split (dashboard).
- GitHub secret-store split / new staging battery workflow.
- Changing script defaults away from `nwrflbpbhyiqdptmlccm`.
- Creating a staging hostname or DNS.
- Paystack test-key issuance and webhook URL.
- Applying any `.sql.proposed` file.
- Rotating mixed operator credentials.

---

## 15. Explicit limitations

- **No database was opened in this mission** (production or staging).
- Staging emptiness is from GATE4-CATALOG-BASELINE-001, not re-queried.
- Production schema/row contents were not inspected.
- Vercel/GitHub secret **values** were not read; live Vercel env grouping
  is UNKNOWN.
- `PAYSTACK_SECRET_KEY` live vs test class is UNKNOWN (prefix not read).
- `SUPABASE_ACCESS_TOKEN` validity is UNKNOWN (401 in prior mission).
- Whether demo emails exist in production is UNKNOWN.
- Whether a Vercel staging/preview deployment exists is UNKNOWN.
- Mobile `EXPO_PUBLIC_*` still documents CoreGrid example URLs — product
  naming drift, not a second Supabase project proof.
- Default branch vs master migration gap (69 vs 71) is a **git** fact;
  production apply state is not re-proven here.

---

## 16. Confirmation: databases and customer records

- Production database: **not opened**.
- Staging database: **not opened** (this mission).
- Customer, student, parent, staff, payment, or other personal records:
  **not queried**.
- Secret values, tokens, connection strings: **not printed**.

---

## 17. Confirmation: no changes executed

- No SQL, migrations, or proposed SQL applied.
- No configuration, env, secret, DNS, or Vercel changes.
- No deploy, merge, or account create/delete.
- Repository change: **this report file only**.

Do not proceed to cleanup or migration application automatically.

---

## 18. Agent report (Constitution §42)

**Implemented:** read-only environment separation inventory and plan.
**Files changed:** `docs/security/rls-prep/SHERIVS-ENVIRONMENT-SEPARATION-AUDIT-001.md`
**Architecture impact:** none (documentation). Version target ACTIVE-V1.
**Tests:** none run (no code change). Evidence = git + prior catalog report +
env **names**.
**Security validation:** no DB access; no secret disclosure; production
refused by policy.
**Known risks:** mixed operator env; scripts default to production; OPEN
SHERIVS-001/002/003; demo identifiers in source.
**Remaining work:** human-approved staging schema restore; post-restore
catalog; then eligible proposed SQL on staging only.

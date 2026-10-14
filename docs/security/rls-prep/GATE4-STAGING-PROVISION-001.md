# SHERIVS-RLS-GATE4-STAGING-PROVISION-001

**Mission:** Isolated staging provisioning and baseline preparation.
**Version target:** ACTIVE-V1 only.
**Authority consumed:** GATE3-INDEPENDENT-REVIEW-003 — PASS FOR STAGING
PREPARATION ONLY. That verdict does **not** authorize applying proposed SQL.

**Decision:** **C. BLOCKED — ISOLATION OR SAFETY REQUIREMENTS NOT PROVEN**

No isolated staging project was created or verified. This Cloud Agent
environment has production-pointing `SUPABASE_URL` / `DATABASE_URL` (ref
`nwrflbpbhyiqdptmlccm`) and **no** staging-specific URL variables. The
Supabase Management API token present in the environment is **invalid**
(`GET /v1/organizations` and `GET /v1/projects` returned HTTP 401). There
is no `supabase` CLI and no Docker. Production credentials were **not**
used to improvise a staging database.

Proposed SQL was **not** applied. No SQL was executed against any database.
Production configuration was not changed.

Gate 3 remains **PASS FOR STAGING PREPARATION ONLY**.
SHERIVS-001, SHERIVS-002, and SHERIVS-003 remain **OPEN**.
GATE 6 remains **BLOCKED**.

This file does **not** overwrite prior Gate 3 reports.

---

## 1. Repository revision and baseline

| Item | Value |
|------|-------|
| This branch | `cursor/sherivs-rls-gate4-staging-provision-49a0` |
| Parent HEAD at start | `61aa7c1cdc644d3ca9733b49427d428a3a223a` (review-003) |
| Required corrections-002 SHA | `08fa49fb65c615faddad354c71374dc7d9b64aba` |
| Ancestry | `08fa49f` is an ancestor of HEAD (fetched `origin/cursor/sherivs-rls-gate3-corrections-002-49a0`; remote matched) |
| Authoritative production git | `origin/master` @ `d195ba8` |
| Proposed SQL | unchanged in this mission |

Read (not modified): `GATE3-INDEPENDENT-REVIEW-003.md`,
`GATE3-CORRECTIONS-002.md`, `CHANGE-SETS.md`, `STAGING-TEST-HARNESS.md`,
`PER-TABLE-RLS-MATRIX.md`, `VERIFICATION-AND-ROLLBACK.md`,
`IDENTITY-PROVISIONING.md`, `RELATED-POLICIES.md`, `PAYMENT-INVARIANTS.md`,
`HR-RPC-CONTRACT.md`.

---

## 2. Actual staging project reference

**None.** No new Supabase project was created. No existing non-production
project reference was verified.

A display name was not accepted as proof of isolation.

---

## 3. Evidence the reference differs from production

Production ref (canonical, refused by harness): `nwrflbpbhyiqdptmlccm`.

This VM’s `SUPABASE_URL` **contains** that production host. Staging env
vars are **unset**, so there is no second ref to compare.

Management API project list could not be used: HTTP 401 Invalid access
token. Token value was not printed.

---

## 4. Staging endpoint identity verification

**Not performed.** There is no staging endpoint.

Connecting with `DATABASE_URL` / `SUPABASE_URL` would have targeted
production and was **refused**.

---

## 5. Staging credential inventory (no values)

Harness names (`scripts/staging/sherivs-rls-prep/assert-not-production.mjs`):

| Variable | Purpose | Classification | Store | Configured in this VM | Verify without printing value |
|----------|---------|----------------|-------|----------------------|-------------------------------|
| `SHERIVS_RLS_STAGING_URL` | Preferred staging target for the refusal harness | non-secret URL | gitignored `.env.staging` / Cursor secret store labelled staging | **UNSET** | `assert-not-production.mjs` must print `STAGING_TARGET_OK`; string must not contain `nwrflbpbhyiqdptmlccm` or the four Sherivs hosts |
| `STAGING_DATABASE_URL` | Direct Postgres URI for catalog snapshots | **SECRET** | same, never git | **UNSET** | length + `contains_prod_ref=false`; harness against this URL |
| `STAGING_SUPABASE_URL` | Staging API URL fallback for the harness | non-secret URL | same | **UNSET** | host equals `https://<staging-ref>.supabase.co` |
| `STAGING_SUPABASE_PUBLISHABLE_KEY` / `STAGING_SUPABASE_ANON_KEY` | PostgREST JWT tests | publishable; still staging-only | same | **UNSET** | prefix/length only; must not be the production anon key |
| `STAGING_SUPABASE_SERVICE_ROLE_KEY` | Synthetic fixture load / privileged tests | **SECRET** | same | **UNSET** | must not equal production service-role key; never log |

Do **not** alias `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
or `PAYSTACK_SECRET_KEY` for staging. Those names in this VM point at
production (URL vars contain the production ref; Paystack secret is SET
and must not be used for staging payment tests).

`.gitignore` already ignores `.env` and `.env.*` (except `.env.example`).
A local `.env.staging` would not be committed.

This mission did **not** write credential files.

---

## 6. Synthetic fixture plan (not executed)

Compatible with live schema in `database/supabase/migrations/` (especially
`20260620122048`, `20260626150625` role check, `20261008000050`
memberships, `20260725065302` payroll, `20260729052237` biometrics).

**Do not copy production rows. Do not load real faces, NINs, or bank
accounts.** Values below are placeholders for a later fixture-load mission.

### Organizations

| Fixture | Table | Notes |
|---------|-------|-------|
| School A | `schools` | slug `rls-stage-a`, `is_active=true`, **empty** `paystack_secret_key` |
| School B | `schools` | slug `rls-stage-b`, `is_active=true`, empty payment secrets |
| School C | `schools` | second org for Admin H switcher (SW-01) |

### Auth users + `public.users`

Create via staging Auth admin API, then `public.users`. `users.id` FK
`auth.users`. Role CHECK after `20260626150625`:
`admin, principal, teacher, parent, student, bursar, hq, alumni, driver`.

**Incompatible with `users.role`:** `librarian` and `nurse` appear in the
HR RPC staff set (`00020`) but **not** in `users_role_check`. Do not insert
those roles as `users.role` until a schema decision exists.

| Actor | School | Role | `is_active` |
|-------|--------|------|-------------|
| Student A | A | student | true |
| Student B | B | student | true |
| Teacher T | A | teacher | true |
| Teacher T-B | B | teacher | true |
| Parent P | A | parent | true |
| Bursar R | A | bursar | true |
| Admin H | A | admin | true; also membership on School C |
| Admin Z | A | admin | **false** after insert |
| Super S | `super_admins` only | n/a | true |
| Unlinked U | **no** `users` row | auth user only | founder FND-01 |

Sync trigger will upsert `organization_memberships` on users INSERT.
Admin H’s School C membership is extra: load via **staging service_role**
after the users row exists (mirror freeze is not applied until proposed
`00030`). On live schema, school-admin JWT can still INSERT memberships —
fixtures should use service_role anyway.

### Domain rows (school A unless noted)

| Table | Fixture | Schema notes |
|-------|---------|--------------|
| `classes` | one class per school | required for students / lesson_plans |
| `students` | S-A linked to Student A; S-B to Student B | medical columns exist (B9); leave null |
| `parent_student_map` | Parent P → S-A only | B1: no authenticated writer in proposed SQL; load with service_role |
| `lesson_plans` | T: `submitted`; T: `approved` | CHECK `draft/submitted/approved/needs_revision` |
| `fees` | unpaid fee for S-A amount `100.00`; distinct `paystack_reference` | unique index `fees_paystack_reference_uniq` |
| `staff_payroll` | one draft row for Teacher T, month/year unique | finance isolation tests PAYR-* |
| `teacher_biometrics` | Teacher T `face_template_hash='sim_stage_hash_t'` only | **never** real biometric data; UI already uses `sim_*` |
| `attendance` / `attendance_logs` | optional one row marked by T | P3 |
| `users.salary` | numeric placeholder on T only | not a real payroll file |
| `users.nin` / bank_* | **omit** (null) | no fake government IDs required |
| hostel/clinic/library/discipline/transport/meals/sports/expenses | **do not invent product fixtures** | RELATED-POLICIES BLOCKED |

Fixture **preparation** (this document) is separate from fixture
**execution**. Execution: **not run**.

---

## 7. Catalog baseline status

**NOT RUN.**

Procedure for a later mission, after a verified staging ref exists:

1. `node scripts/staging/sherivs-rls-prep/assert-not-production.mjs` with
   `SHERIVS_RLS_STAGING_URL` set to the staging API URL → must print
   `STAGING_TARGET_OK` (exit 0).
2. Confirm the URL host is `https://<ref>.supabase.co` and `<ref>` ≠
   `nwrflbpbhyiqdptmlccm`.
3. Open **only** `STAGING_DATABASE_URL` (never `DATABASE_URL`).
4. Run `scripts/staging/sherivs-rls-prep/catalog-verify.sql` as **read-only**
   metadata (pg_proc, pg_policy, pg_trigger, information_schema grants).
   Do not `SELECT` from `public.users`, `students`, `fees`, or other
   application tables except `count(*)` if proving zero customer rows on a
   fresh project.
5. Record PostgreSQL version (`SHOW server_version`),
   `supabase_migrations.schema_migrations` names (not row payloads),
   RLS enabled/forced, policy `polcmd`, function `prosecdef` / `proconfig`.

Do **not** apply proposed SQL as part of that snapshot.

---

## 8. Schema discrepancies

Cannot compare a live staging catalog to proposed SQL. Static repo notes:

- Empty new Supabase projects **lack** all Scholar tables until **live**
  `database/supabase/migrations/*.sql` are applied. That apply is **not**
  this mission and is **not** proposed-SQL apply. A GATE 4 application
  mission must restore the master schema first, then consider eligible
  `.sql.proposed` files.
- `users.role` CHECK has no `librarian` / `nurse`.
- `organization_memberships.role` includes `alumni` and `driver`.
- `teacher_biometrics` was created twice (`20260729052237` and
  `20260729054314`); proposed `00045` drops both isolation policy names.
- Memberships table already has FORCE RLS in live SQL; `users` does not.

---

## 9. Safety-harness results

`node scripts/staging/sherivs-rls-prep/assert-not-production.mjs` (no DB):

| Input | Result | Exit |
|-------|--------|------|
| unset (this VM default staging vars) | `REFUSED` `empty_target` | 2 |
| `https://nwrflbpbhyiqdptmlccm.supabase.co` | `canonical_production_supabase_ref` | 2 |
| `postgresql://x@db.nwrflbpbhyiqdptmlccm.supabase.co/postgres` | `canonical_production_supabase_ref` | 2 |
| `https://app.sherivs.com` | `production_host:app.sherivs.com` | 2 |
| `https://sherivs.com` | `production_host:sherivs.com` | 2 |
| `https://staging-sherivs-rls.example.supabase.co` | `STAGING_TARGET_OK` | 0 |

The last row proves the harness **accepts a non-production string**. It
does **not** prove a real staging project exists.

Unit ratchet `refuses the canonical production Supabase project and Sherivs
hosts`: **passed**.

Note: `main()` never reaches exit code 3 (`MISSING PREREQUISITE`) because
an empty target already fails `assertNotProductionTarget` with
`empty_target` (exit 2). Harmless for safety.

`GET https://api.supabase.com/v1/organizations` with the injected
`SUPABASE_ACCESS_TOKEN`: **401 Invalid access token**. Cannot list or
create projects from this VM.

---

## 10. Remaining blockers

| Blocker | Status |
|---------|--------|
| Isolated project ref ≠ `nwrflbpbhyiqdptmlccm` | **missing** |
| Staging-only credentials | **missing** |
| Valid Management API token or dashboard operator | **required** |
| Zero customer rows | **unproven** (no project) |
| Catalog snapshot | **not run** |
| Live schema on staging | **not present** |
| `00070` Paystack companion | still BLOCKED |
| `00090` FORCE RLS | still not eligible |
| `hr.functions.ts` / live `saveStaff` | still BLOCKED for A/F release |
| B8 manual mark-paid | BLOCKED |
| Hostel/clinic/… product decisions | do not invent |
| SHERIVS-003 | OPEN until 00045+F applied and tested |

---

## 11. Proposed staging application order (do not execute)

After a human-verified staging project exists **and** a separate mission
is authorized:

0. **Not proposed SQL:** apply live `database/supabase/migrations/*.sql` in
   filename order so the catalog matches `origin/master` @ `d195ba8` plus
   memberships/onboarding. Confirm with catalog-verify **before** proposed
   files.
1. `00010` helpers
2. `00020` HR RPCs (catalog/JWT HR-01/02; app `saveStaff` still incompatible)
3. `00030` identity freeze + memberships boundary
4. `00040` sensitive columns
5. `00045` payroll/biometrics
6. `00050` E-A
7. `00060` E-B
8. **Skip `00070`** until Paystack companion exists
9. `00080` grants
10. **Skip `00090`** until FND-01 and DEFINER/BYPASSRLS proofs

Then FND-01, SW-01, MEM-*, INS-01, DEL-01, identity, payroll, biometric,
lesson-plan cases from `STAGING-TEST-HARNESS.md`.

This mission did **not** run that sequence.

---

## 12. Manual provisioning guide (operator)

Use the **Supabase Dashboard** on an org that can create a **new** project.
Do not clone production data. Do not reuse production URI or service-role
key.

1. New project, name e.g. `sherivs-rls-staging`. Region of operator choice.
2. Copy the project **ref** (20-char id). Abort if it equals
   `nwrflbpbhyiqdptmlccm`.
3. Confirm Settings → Database shows **no** restored production dump.
4. Place in gitignored `.env.staging` (values never committed, never pasted
   into git or chat):
   - `SHERIVS_RLS_STAGING_URL=https://<ref>.supabase.co`
   - `STAGING_SUPABASE_URL` same
   - `STAGING_DATABASE_URL` pooler or direct URI
   - `STAGING_SUPABASE_PUBLISHABLE_KEY`
   - `STAGING_SUPABASE_SERVICE_ROLE_KEY`
5. Leave `PAYSTACK_SECRET_KEY` unset in that file (do not copy production
   merchant keys).
6. From the repo: export only those staging names, then
   `node scripts/staging/sherivs-rls-prep/assert-not-production.mjs`
   must print `STAGING_TARGET_OK`.
7. Optional: `SELECT count(*) FROM public.users` on **staging only** after
   live migrations; expect 0 before fixtures.
8. Stop. Do not copy `.sql.proposed` into `database/supabase/migrations/`.
   Do not apply proposed SQL until a GATE 4 **application** mission is
   authorized.

Cursor Cloud: inject staging secrets under **distinct names** (the table
in §5). Do not overwrite production `SUPABASE_URL` / `DATABASE_URL` on
production environments.

---

## 13. Safety gate checklist

| Check | Proven? |
|-------|---------|
| Staging ref is not production | **no** — no staging ref |
| Endpoint maps to staging | **no** |
| No customer records | **no** |
| Credentials staging-specific | **no** |
| Harness rejects production | **yes** (string tests) |
| Harness accepts verified staging project | **no** — only a synthetic example URL |
| Catalog read-only on staging | **no** |
| No proposed SQL applied | **yes** |
| Production config unchanged | **yes** |

Any unproven item ⇒ this gate is **BLOCKED**.

---

## 14. Confirmations

- **No SQL executed** against production or any other database (no `psql`,
  no Management API `database/query`, no migration apply).
- **Production unchanged:** no DNS, Vercel, hostname routing, env writes,
  deployments, or files under `database/supabase/migrations/`.
- Proposed `.sql.proposed` files were **not** modified.

---

## 15. Decision on a separate staging-application mission

**Not ready for authorization.**

Authorize a GATE 4 **application** mission only after:

1. A human creates the isolated project.
2. The project ref is recorded and differs from `nwrflbpbhyiqdptmlccm`.
3. Staging secrets exist under the names in §5 (not production aliases).
4. `assert-not-production.mjs` exits 0 against that real URL.
5. A read-only catalog snapshot is captured on that project (empty or
   live-schema, never proposed SQL).

Until then, GATE 4/5 remain **BLOCKED**.

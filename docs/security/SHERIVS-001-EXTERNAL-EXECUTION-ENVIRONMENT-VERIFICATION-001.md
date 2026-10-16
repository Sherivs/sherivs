# SHERIVS-001-EXTERNAL-EXECUTION-ENVIRONMENT-VERIFICATION-001

**Mission ID:** SHERIVS-001-EXTERNAL-EXECUTION-ENVIRONMENT-VERIFICATION-001  
**Mission title:** External Database Verification Handoff  
**Mission type:** Documentation and repository inspection only  
**Version-target classification:** ACTIVE-V1 identity verification only. No V2/V3 work.  
**Date:** 2026-10-16  
**Handoff verdict:** **PASS WITH CONDITIONS**  
**SHERIVS-001 status:** **OPEN** (this handoff does not close it)

This document prepares a reproducible, safety-checked handoff for real PostgreSQL and PostgREST execution-context tests on an authorized operator-controlled machine.

This mission did **not** bootstrap Docker or Supabase in the current pod. It did **not** apply the proposed identity-freeze SQL. It did **not** access production or staging. Live execute remains disabled.

Contexts A–D were **planned, not executed**. Offline unit tests are not PostgreSQL or PostgREST evidence.

---

## 1. Actual repository identity

| Item | Value |
|---|---|
| Root | `/workspace` |
| Repository | `vibeoraai-bit/coregrid-scholar-migration` |
| Inspection (parent) branch | `cursor/sherivs-001-operator-env-handoff-local-stack-d80b` |
| Inspection (parent) HEAD | `daba88666e07618405c332903403451195f9a3d4` (confirmed) |
| This mission branch | `cursor/sherivs-001-external-exec-env-verify-d80b` |
| Working tree at inspection | clean |
| Uncommitted user work | none |
| Node | v22.14.0 |
| Proposed migration | `database/supabase/migrations/20261015000010_sherivs_identity_privilege_freeze.sql.proposed` |
| Proposed rollback | `database/supabase/rollbacks/20261015000010_sherivs_identity_privilege_freeze.sql.proposed` |
| Recomputed forward SHA-256 | `62aaad757e3b7ff79cf6fc89aaa3d604cd1fb151feadee6ea03f813361715416` |
| Pinned SHA-256 | `62aaad757e3b7ff79cf6fc89aaa3d604cd1fb151feadee6ea03f813361715416` |
| Checksum | **MATCH** (file not modified) |
| Recomputed rollback SHA-256 | `6a9363db98dd3c82036b315e67d38559a0db00583b8ea7de541375a334bfb7e4` |
| Canonical `migrations/*.sql` | 69 |
| Proposed files in migrations/ | 1 (`*.sql.proposed`) |
| `database/supabase/seed.sql` | absent |
| Live execute | `DISPOSABLE_LIVE_EXECUTE_ENABLED = false` |
| Production ref | `nwrflbpbhyiqdptmlccm` |
| Staging ref | `dvxszhracsjwdancijdc` |

This checkout’s HEAD at inspection equals the parent branch HEAD above. Distinguish that parent SHA from this mission’s later report commits on `cursor/sherivs-001-external-exec-env-verify-d80b`.

---

## 2. Current environment limitations (this pod)

Inspected. Docker/Supabase were **not** started.

| Check | Result |
|---|---|
| Docker CLI | **ABSENT** |
| `/var/run/docker.sock` | **ABSENT** |
| Supabase CLI | **ABSENT** |
| `psql` | **ABSENT** |
| TCP `:2375` | not used (forbidden as a Docker CLI substitute) |
| `SHERIVS_DISPOSABLE_DATABASE_URL` | absent |
| Live URL names present | `DATABASE_URL`, `STAGING_DATABASE_URL`, `SHERIVS_RLS_STAGING_URL`, `SUPABASE_URL`, `STAGING_SUPABASE_URL` (values not printed; not used) |
| Qualifier | exit **2**, `qualified=false`, `code=DISPOSABLE_PRODUCTION_REF`, `candidate=DATABASE_URL`, `connects=false` |
| Harness inspect | exit **0**, `qualified=false`, `connected=false`, `executedSql=false`, `liveExecuteEnabled=false`, `gates.shaPinned=true` |

Qualifier candidate order (`scripts/lib/sherivs-disposable-pg.mjs`): `SHERIVS_DISPOSABLE_DATABASE_URL` → `LOCAL_DATABASE_URL` → `DEVELOPMENT_DATABASE_URL` → `DATABASE_URL`. With the first three unset, it classifies unscoped `DATABASE_URL` as hosted production pooler `aws-1-eu-west-1.pooler.supabase.com:5432` (`loopback=false`, `refs.production=true`). The qualifier was **not** weakened.

`database/supabase/config.toml` is a four-line production `project_id` pin. It has no `[api]` / `[db]` bind settings. It is documented as **not** an execution default. It was not overwritten.

---

## 3. Repository-documented local commands

Commands below are copied from repository files. Names **not** found in this repository are marked undocumented.

**From `database/README.md`:**

```sh
supabase start --workdir database/supabase
supabase db push --workdir database/supabase
supabase link --workdir database/supabase
```

| Command | Use for this handoff |
|---|---|
| `supabase start --workdir database/supabase` | Only on an authorized external machine, after a **local-only** config that does not treat production `project_id` as an execution default |
| `supabase link --workdir database/supabase` | **Do not run** (would target a hosted project) |
| `supabase db push --workdir database/supabase` | **Do not run** |

**Not documented in this repository:** `supabase stop`, `supabase status`, `supabase db reset`. This handoff does **not** invent those names as supported. Teardown and health on the operator machine must be recorded from the CLI that is actually installed there, then compared to loopback listeners.

**From this repository (confirmed; inspection-only):**

```sh
node scripts/sherivs-001-qualify-disposable-pg.mjs
node scripts/sherivs-001-disposable-exec.mjs --operation=inspect
```

`scripts/sherivs-001-disposable-exec.mjs` also documents `--operation=apply-proposed-freeze` and `--operation=apply-proposed-rollback`. Those paths remain refused (`DISPOSABLE_LIVE_EXECUTE_NOT_ENABLED`). **Do not run them.**

Ordinary migration selectors in this repository (`scripts/db-apply.mjs`, `scripts/db-apply-one.mjs`, `scripts/staging/sherivs-restore/source.mjs`) use `endsWith(".sql")` and/or exclude `*.sql.proposed`. The proposal filename ends in `.sql.proposed`, so those selectors do **not** load it. This repository does **not** document the Supabase CLI’s migration glob. Do not assume `supabase start` applies the proposal. Do not rename the proposal to `.sql`.

A local `supabase start` using the current working tree would apply the **69** canonical `*.sql` files, not the 71-file staging pin, and not the proposal. `seed.sql` is absent.

---

## 4. External machine prerequisites

Continue only when **all** of the following are true on the operator machine. Do not weaken any gate.

1. Docker CLI is on PATH and talks to the **intended local daemon via the unix socket**. Do not use TCP `:2375` as a substitute.
2. Supabase CLI and `psql` are installed.
3. `database/supabase/config.toml` is **not** used as a production execution default. Use a separately reviewed local-only config (do not `link`).
4. Live URL names are unset **in that test process only** (`DATABASE_URL`, `STAGING_DATABASE_URL`, `PRODUCTION_DATABASE_URL`, `SHERIVS_RLS_STAGING_URL`, live `SUPABASE_URL`). Do not print values. Do not edit shared persistent credentials.
5. Set `SHERIVS_DATABASE_TARGET=development`.
6. Set `SHERIVS_DISPOSABLE_PG_LIFECYCLE=ephemeral-local`.
7. Set `SHERIVS_DISPOSABLE_DATABASE_URL` to a loopback URL with an **explicit port** and **no** `?host=` / `?hostaddr=` / `?port=`.
8. `node scripts/sherivs-001-qualify-disposable-pg.mjs` exits **0**, `qualified=true`, `connects=false`, no production/staging refs.
9. `node scripts/sherivs-001-disposable-exec.mjs --operation=inspect` reports `qualified=true`, `connected=false`, `executedSql=false`, SHA pins match.
10. Recomputed proposal SHA-256 still equals `62aaad757e3b7ff79cf6fc89aaa3d604cd1fb151feadee6ea03f813361715416`.

Qualification is **not** permission to apply SQL. Leave live execute disabled.

---

## 5. Isolation checks (operator machine)

Record evidence; do not print secrets.

- Qualifier host is loopback (`127.0.0.1` preferred over `localhost`); `hostedSupabase=false`; production/staging refs false.
- Candidate name is `SHERIVS_DISPOSABLE_DATABASE_URL` (harness never uses `DATABASE_URL`).
- No `supabase link` to `nwrflbpbhyiqdptmlccm` or `dvxszhracsjwdancijdc`.
- API and DB listeners bound to loopback only (verify the **running** stack; this repo’s `config.toml` does not declare ports).
- Lifecycle attestation `ephemeral-local` with recorded create/teardown. Loopback is necessary and not sufficient against an SSH tunnel.
- Synthetic local users and local-only keys only.

This pod **fails** these checks today.

---

## 6. Execution-context test matrix (planned, not executed)

Run only after §4–§5 pass. Use synthetic local fixtures only. Do **not** apply the identity-freeze proposal in the first measurement pass. Do **not** infer roles from credential names. Do **not** use `SET ROLE` as a substitute for PostgREST (contexts B–D).

This repository has **no** committed observer that returns `current_user` / `session_user` / `auth.uid()` through PostgREST. Context A can use `psql` against the **qualified** local URL. Contexts B–D require a **separately reviewed, local-only, disposable** observer (not the freeze file, not renamed into canonical `*.sql`, not applied to hosted databases). That observer is **not** implemented here.

| ID | Context | How to measure (plan) | Required columns | Status |
|---|---|---|---|---|
| A | Direct administrative PostgreSQL session | `psql` on the qualified local URL: `SELECT current_user, session_user, auth.uid();` | actual three values | **NOT EXECUTED** |
| B | Authenticated local PostgREST | HTTP through local PostgREST with a synthetic user JWT; observer must run inside that request | actual three values; JWT `role` claim class (no token) | **NOT EXECUTED** |
| C | Service-role local PostgREST | HTTP through local PostgREST with the **local** service-role credential | actual three values; JWT `role` claim class (no token) | **NOT EXECUTED** |
| D | Anonymous local PostgREST | HTTP through local PostgREST with no user JWT | actual three values or accurate error | **NOT EXECUTED** |

Question the next mission must answer from **C**, not from the key name: is `current_user` equal to `service_role`?

Privilege-column tests (self-update of `role` / `school_id` / `is_active`) require the freeze to be applied and are **out of scope** for this handoff.

---

## 7. Transaction-contract risks

Inspected in source. **Not executed.**

The proposal contains `BEGIN;` … `COMMIT;`.

`scripts/staging/sherivs-restore/runner.mjs` does:

`BEGIN` → `query(sql)` → ledger `INSERT` → `COMMIT`.

An inner `COMMIT` would close the outer transaction **before** the ledger write. `source.mjs` excludes `*.sql.proposed` (`PROPOSED_SQL_EXCLUDED`). Do **not** feed the proposal to `runner.mjs`.

`scripts/db-apply-one.mjs` / `scripts/db-apply.mjs` select `endsWith(".sql")` and use `DATABASE_URL` after target checks. Do **not** use them for this proposal. Do **not** rename or copy the proposal to satisfy the selector.

**Future disposable-only strategy (not implemented, not authorized here):**

1. Qualifier exit 0; harness inspect `qualified=true`, `connected=false`, `executedSql=false`.
2. Measure contexts A–D **before** any apply.
3. Separately reviewed enablement of harness apply: inject a loopback connector; submit the **whole** proposed file as one `client.query(sql)` with **no** outer `BEGIN`; keep the file’s own `BEGIN`/`COMMIT`; pin SHA-256 `62aaad757e3b7ff79cf6fc89aaa3d604cd1fb151feadee6ea03f813361715416`.
4. Destroy the disposable instance.

---

## 8. Exact handoff instructions

On the authorized operator machine:

1. Confirm Docker CLI ↔ local unix socket, Supabase CLI, `psql`, Node 22.
2. Do **not** run `supabase link` or `supabase db push`.
3. Prepare a local-only config (do not overwrite production `project_id` as an execution default without review).
4. Start the local stack with the **repository-documented** start command only after that local config is in place: `supabase start --workdir database/supabase`.
5. Unset live URL names in **that process**. Set disposable target, lifecycle, and `SHERIVS_DISPOSABLE_DATABASE_URL`.
6. Run the qualifier and harness inspect commands in §3. Continue only on exit 0 / `qualified=true`.
7. Confirm SHA-256 match.
8. Confirm the proposal was **not** applied (`*.sql.proposed` still unapplied).
9. Hand off to a separately scoped mission to execute §6 (contexts A–D).
10. Do not apply `62aaad757e3b7ff79cf6fc89aaa3d604cd1fb151feadee6ea03f813361715416` until that mission and a reviewed apply authorization exist.

This Cloud Agent pod must **not** retry Docker/Supabase bootstrap.

---

## 9. Remaining uncertainties

1. Under real local PostgREST with a local service-role credential, is `current_user` equal to `service_role`?
2. What are `session_user` and `auth.uid()` in A–D?
3. Which files the operator’s Supabase CLI actually loads from `database/supabase/migrations/` (not documented here).
4. Whether file-level `BEGIN`/`COMMIT` rolls back helper+trigger as one unit with no outer wrap.
5. 69 working-tree `*.sql` files ≠ 71-file staging pin.

---

## 10. Offline tests

These ran in this mission. They are **not** local PostgreSQL or PostgREST tests.

```
npx vitest run \
  tests/unit/sherivs-disposable-pg.test.ts \
  tests/unit/sherivs-disposable-exec.test.ts \
  tests/unit/sherivs-sql-comment-strip.test.ts \
  tests/unit/sherivs-001-identity-privilege.test.ts \
  tests/unit/sherivs-db-target.test.ts \
  tests/unit/sherivs-staging-migration-runner.test.ts \
  tests/unit/security-role-gate.test.ts
```

Results are recorded after the command runs.

---

## 11. Exact files changed

- `docs/security/SHERIVS-001-EXTERNAL-EXECUTION-ENVIRONMENT-VERIFICATION-001.md`

Proposed SQL, `config.toml`, qualifier, harness, and runners were **not** modified.

---

## 12. Declarations

**SHERIVS-001 remains OPEN.**  
**The proposed migration remains unapplied.**  
**Production and staging were not accessed.**  
**Live execution remains disabled.**

No Docker or Supabase bootstrap was attempted in this pod. No SQL was executed against any database. Contexts A–D were not measured.

---

## 13. Verdict statement

**PASS WITH CONDITIONS** for this **handoff artifact**.

Conditions: this pod still cannot host Docker CLI, Supabase CLI, or `psql`; qualifier exit 2; live execute off; A–D unmeasured; transaction contract unmeasured. The identity freeze is **not** verified.

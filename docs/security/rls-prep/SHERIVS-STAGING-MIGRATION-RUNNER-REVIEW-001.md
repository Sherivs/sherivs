# SHERIVS-STAGING-MIGRATION-RUNNER-REVIEW-001

**Mission ID:** SHERIVS-STAGING-MIGRATION-RUNNER-REVIEW-001
**Mission class:** INDEPENDENT CODE REVIEW AND OFFLINE VERIFICATION — NO DATABASE CHANGES
**Version target:** ACTIVE-V1 ONLY
**Timestamp (UTC):** 2026-10-14T20:40:00Z
**Role:** Independent Principal Database Security Engineer / PostgreSQL Migration Specialist / Production Change-Control Reviewer

**Final status:** **B. PASS WITH CONDITIONS — NAMED CODE BLOCKERS REMAIN**

This review assesses whether the newly implemented Sherivs staging-only
migration runner is correct in source pinning, environment isolation,
migration history, TLS controls, connection isolation, and execution
gates.

This document **does not authorize execution**. It does **not** restore
staging. It does **not** apply migrations. It does **not** close
SHERIVS-001, SHERIVS-002, or SHERIVS-003. A PASS on any offline finding
is not permission to mutate any database.

---

## 0. Reviewer independence and non-contact

This review was performed on a fresh inspection of Git objects and of the
implementation at PR #22 (`origin/cursor/sherivs-staging-migration-runner-9668`,
commit `5cfb9eba8d7583a45cad972921c6c8f1ba08d189`). It does **not** treat
the implementation report
(`docs/security/rls-prep/SHERIVS-STAGING-MIGRATION-RUNNER-001.md`) or the
prior restore review
(`docs/security/rls-prep/SHERIVS-STAGING-RESTORE-INDEPENDENT-REVIEW-001.md`)
as proof. Those documents were inputs to contradict, not to copy.

Claims are labeled:

| Label | Meaning |
|-------|---------|
| **Repository evidence** | Re-measured in this mission from Git objects, file bytes, or script source |
| **Driver evidence** | Re-measured from the local `pg@8.23.1` constructor **without** opening a socket |
| **Offline-tested** | Exercised by the targeted Vitest file; mock connector only |
| **Prior-report claim** | Taken from the implementation / restore-review artifacts; not re-proven as live fact |
| **Inference** | Reviewer conclusion from repository or driver evidence |
| **Recommendation** | Required later work; not an authorization |

Hard safety rules observed:

- **No database was opened.** No Postgres session, pooler session, or
  Supabase Management API query ran.
- **No SQL was executed against a server.** Mock connectors never set
  `allowNetwork`. `createLiveConnector({ allowNetwork: false })` was
  exercised only to prove it throws `NETWORK_DISABLED`.
- **The runner was not invoked in execute/migration mode** except inside
  the requested unit file, which injects a mock connector or returns
  `LIVE_EXECUTE_NOT_ENABLED` before any client construction.
- Production (`nwrflbpbhyiqdptmlccm`) and staging (`dvxszhracsjwdancijdc`)
  were unchanged.
- Canonical migration files, runner code, tests, and application code
  were not modified.
- Environment variables and secrets were not changed. Credentials were
  not printed.
- No deploy, merge, or restore publish occurred.
- Passing unit tests are **not** treated as proof of live database safety.
- Staging has **not** been restored.
- This review does **not** authorize a later apply.

The only intended working-tree change in this mission is this file.

---

## 1. Inputs inspected

| Item | Independently measured value |
|------|------------------------------|
| Authoritative application commit | `d195ba861f80379b79533126653b9cee82a8e872` |
| Commit subject | `Merge pull request #9 from vibeoraai-bit/cursor/v1-production-host-routing-5cb8` |
| Commit tree (full repo) | `fc3a321eb12dd15c8a70584b79fdde76dea6f532` |
| Pinned **migrations directory** tree | `bbd828951e166662bbe831fd74972e1a15488468` = `d195ba8:database/supabase/migrations` |
| File count at pin | **71** `.sql` files; **0** `*.sql.proposed`; **0** non-`.sql` entries |
| Timestamp-prefix collisions | **none** (71 unique `YYYYMMDDHHMMSS` tokens) |
| Default-branch HEAD used for this review | `coregrid-scholar-migration` @ `857d4fee1ccc9d11b3c4a34f1142ff6a0da1f7fe` |
| Default-branch migration count | **69** (missing `#70` / `#71`) |
| Implementation under review | `5cfb9eba8d7583a45cad972921c6c8f1ba08d189` (PR #22) |
| Production project ref | `nwrflbpbhyiqdptmlccm` |
| Staging project ref | `dvxszhracsjwdancijdc` |
| Local `pg` | `8.23.1` (constructor inspected; **not connected**) |

Implementation files reviewed:

- `scripts/staging/sherivs-restore/constants.mjs`
- `scripts/staging/sherivs-restore/approved-manifest.json`
- `scripts/staging/sherivs-restore/source.mjs`
- `scripts/staging/sherivs-restore/target.mjs`
- `scripts/staging/sherivs-restore/tls.mjs`
- `scripts/staging/sherivs-restore/connect.mjs`
- `scripts/staging/sherivs-restore/ledger.mjs`
- `scripts/staging/sherivs-restore/runner.mjs`
- `scripts/staging/sherivs-restore/preflight.mjs`
- `scripts/staging/sherivs-restore/cli.mjs`
- `scripts/staging/sherivs-restore/redact.mjs`
- `scripts/staging/sherivs-restore/README.md`
- `tests/unit/sherivs-staging-migration-runner.test.ts`

Production-default apply scripts (`scripts/db-apply.mjs`,
`scripts/apply-canonical-hardening.mjs`, `scripts/lib/pg-ssl.mjs`,
canonical migrations) **were not changed** on PR #22. Diff vs
`origin/coregrid-scholar-migration` is additive: the restore directory,
the unit test file, this mission’s input report, and a pointer in
`scripts/README.md`.

---

## 2. A — Repository and source pinning

**Classification:** **PASS WITH CONDITIONS**

The runner pins the correct commit, the correct **migrations-directory**
tree (not the full-repo tree), all 71 files in lexicographic order, and
SHA-256 of the bytes actually loaded from Git. It does not fall back to
the 69-file working tree. Transport files are present in canonical order.
`*.sql.proposed` is refused. Unexpected, missing, modified, or reordered
files fail closed.

### 2.1 Independently re-measured (repository evidence)

`git rev-parse d195ba861f80379b79533126653b9cee82a8e872:database/supabase/migrations`
= `bbd828951e166662bbe831fd74972e1a15488468`.

`constants.mjs` lines 10–15 and `approved-manifest.json` lines 3–6 store
the same commit, tree, directory, and count=71.

All 71 manifest SHA-256 values and `byteLength` fields were recomputed
from `git show d195ba8:database/supabase/migrations/<file>`. **0
mismatches.** Manifest filename order equals `git ls-tree --name-only`
at the pin. **0 `*.sql.proposed`.** Transport pair:

| Seq | Filename | sha256 |
|----:|----------|--------|
| 59 | `20261002000014_coregrid_v2_transport_buses_rls.sql` | `a1e3bcc3b0f1436de6c49d4ccd601cd894fdd10bdae5f25d692b02f37be83517` |
| 69 | `20261003000041_coregrid_transport_bus_reads.sql` | `9a1e0194dcfebde50e031c63fd3701b9b6c7cbed712f9968c646bd83976ab3cf` |

Working tree at review HEAD: 69 files. Missing from HEAD, present at the
pin: `20261008000050_coregrid_organization_memberships.sql`,
`20261008000060_organization_onboarding.sql`.

### 2.2 How bytes are loaded (repository evidence)

`source.mjs` `loadFromGitCommit` (lines 179–208):

1. Refuses any commit other than `manifest.sourceCommit`.
2. Resolves `${commit}:database/supabase/migrations` and refuses a tree
   other than `bbd82895…`.
3. `git show ${commit}:${dir}/${filename}` for each `ls-tree` name.
4. `verifyLoadedFiles` hashes **those buffers** with SHA-256 and compares
   them to the manifest, in manifest order (lines 118–176).

`resolvePinnedSource` (lines 225–252) uses `migrationsDir` only when
explicitly passed (tests). Otherwise it calls `loadFromGitCommit`. If
git is disabled and no directory is given it throws `SOURCE_UNAVAILABLE`
rather than reading the unmatched working tree. **PASS.**

`inspectWorkingTree` documents the 69-file mismatch; it is not the apply
source. Offline test “working tree mismatch is documented and not used as
the pin” confirms this.

### 2.3 Fail-closed cases (repository evidence + offline-tested)

| Case | Code | Test |
|------|------|------|
| Missing file | `MISSING_MIGRATION` | test 2 |
| Extra file | `ADDITIONAL_MIGRATION` | test 3 |
| Tampered bytes | `CHECKSUM_MISMATCH` | test 4 |
| Wrong commit | `WRONG_SOURCE_COMMIT` | test 5 |
| Wrong tree | `WRONG_GIT_TREE` | test 6 |
| Reorder / transport order | `MIGRATION_REORDERED` / `TRANSPORT_PAIR_ORDER` | tests 13, reordered-pair |
| `*.sql.proposed` | `PROPOSED_SQL_EXCLUDED` | test 14 |

`loadFromDirectory` includes `*.sql.proposed` **so that
`verifyLoadedFiles` can refuse them** rather than silently dropping them.
That is fail-closed. **PASS.**

### 2.4 Git subprocess isolation — condition

`defaultGit` (`source.mjs` lines 61–72) runs `spawnSync("git", args, { cwd: ROOT })`
with the inherited environment. It does **not**:

- clear `GIT_DIR` / `GIT_WORK_TREE` / `GIT_COMMON_DIR` /
  `GIT_OBJECT_DIRECTORY` / `GIT_REPLACE_REF`;
- pass `--no-replace-objects`;
- pin `--git-dir` to this repository.

**Exploitability:** a same-hash commit/tree still yields the same bytes,
and per-file SHA-256 still binds content, so a foreign object store
cannot substitute different SQL without failing `CHECKSUM_MISMATCH` or
`WRONG_GIT_TREE`. A missing object fails `GIT_COMMAND_FAILED`. This is
not a silent alternate-revision apply path for the current pin.

**Required correction:** sanitize Git env and pass
`--no-replace-objects` plus an explicit `--git-dir` / `-C` pin before
live execute.

**Database connection needed to verify?** No.

**Condition classification:** **PASS WITH CONDITIONS** (content is
bound; subprocess environment is not).

---

## 3. B — Environment and target isolation

**Classification:** **PASS WITH CONDITIONS** (static target selection);
several live-network claims **NOT VERIFIED**.

### 3.1 Positive staging pin and production refusal (repository evidence + offline-tested)

`constants.mjs` lines 17–18: staging `dvxszhracsjwdancijdc`, production
`nwrflbpbhyiqdptmlccm`.

`target.mjs` `assertStagingTarget` / `classifyHost` (lines 74–156):

- Direct host must be **exactly** `db.dvxszhracsjwdancijdc.supabase.co`.
- Pooler host must end with `.pooler.supabase.com` **and** username must
  be `postgres.dvxszhracsjwdancijdc`.
- Staging project ref must appear in hostname or username.
  Credentials/passwords are not accepted as identity.
- Database name must be empty, `/`, or `/postgres`.
- Production ref and production host markers (`db.nwrflbpbhyiqdptmlccm…`,
  `www/app/console.sherivs.com`) are refused on the raw URL, hostname,
  username, password, and href.

`resolveStagingTarget` (lines 158–192):

- Reads only `STAGING_DATABASE_URL` and `SHERIVS_RLS_STAGING_URL`.
- If `DATABASE_URL`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`,
  `SUPABASE_ACCESS_TOKEN`, or `SUPABASE_PROJECT_ID` is set, throws
  `TARGET_UNPREFIXED_PRESENT`. No fallback. **PASS** (tests 9, 10).
- Missing staging URL → `TARGET_MISSING`. **PASS.**
- Two staging URLs that disagree on host → `TARGET_URLS_DISAGREE`. **PASS.**
- Production URL → `TARGET_PRODUCTION_REF`. **PASS** (test 8).
- Wrong project host → `TARGET_HOST_NOT_ALLOWLISTED`. **PASS** (test 7).
- Pooler with username `postgres` → `TARGET_POOLER_USER_MISMATCH`. **PASS.**

`usedFallback` is hardcoded `false`. **PASS.**

### 3.2 Conditions and claims that cannot be established statically

| Claim | Classification | Why |
|-------|----------------|-----|
| Port is pinned | **PASS WITH CONDITIONS** | Port is not allowlisted. Same hostname on an unexpected port is accepted. |
| Pooler hostname uniqueness | **PASS WITH CONDITIONS** | Any `*.pooler.supabase.com` is accepted; identity is the username. Correct for current Supabase routing; a future extra pooler hostname is not extra-pinned. |
| Cannot contact production via DNS hijack / `hostaddr` / redirects | **NOT VERIFIED** | Depends on TLS actually verifying the staging name (see §4). PostgreSQL does not HTTP-redirect. The JS `pg` client uses URL `host`, not libpq `hostaddr`, for TCP. Live DNS/IPv6 were not probed. |
| Operator env currently holding production `DATABASE_URL` | **NOT VERIFIED** | Secrets were not read. The runner **refuses to start** if that variable is set, which is the correct fail-closed behaviour. |
| IPv6 direct vs IPv4 pooler reachability | **NOT VERIFIED** | No socket opened. |

**Required correction before live execute:** reject unknown query
parameters (`sslmode`, `ssl`, `hostaddr`, `options` except an explicit
allowlist); pin session-mode pooler port 5432 / direct 5432 as a
documented operator contract; keep the unprefixed-env refusal.

**Database connection needed to verify the static pin?** No.
**Database connection needed to verify “cannot contact production”?**
Yes — and this mission did not open one.

### 3.3 Secret redaction (repository evidence + offline-tested)

`redact.mjs` redacts URL passwords, PEM, and token-like strings. The
logger refuses to emit a credentialed URL (`REFUSED: logger attempted to
emit a credentialed URL`). Target errors include hostname/protocol, not
the password. Test 22 passes.

**PASS** for the logger. Completeness of `pg` driver error shapes is
**NOT VERIFIED** (no live connection).

---

## 4. C — TLS and connection isolation

### 4.1 `rejectUnauthorized` / pinned CA — **BLOCKER** on the live constructor

**Finding ID:** **R-TLS-1**
**Classification:** **BLOCKER**
**File:** `scripts/staging/sherivs-restore/connect.mjs` lines 71–81;
`tls.mjs` lines 56–90; `node_modules/pg/lib/connection-parameters.js`
lines 59–85; `node_modules/pg-connection-string/index.js` lines 77–155.

`tls.mjs` `strictTlsConfig` correctly:

- refuses `COREGRID_DB_INSECURE_TLS=1`;
- refuses `sslmode=disable` and `ssl=false` / `ssl=0`;
- requires a CA via `COREGRID_DB_CA_CERT` or `STAGING_DB_CA_CERT`;
- returns `{ rejectUnauthorized: true, ca }`.

It does **not** refuse `sslmode=no-verify`, `sslmode=require`,
`sslmode=prefer`, `sslmode=verify-ca`, or `uselibpqcompat`.

`createLiveConnector` then constructs:

```js
new Client({ connectionString: options.connectionString, ssl: tls.ssl })
```

`pg@8.23.1` does `Object.assign({}, config, parse(connectionString))`,
so a URL `sslmode` **overwrites** the explicit `ssl` object.

Offline constructor proof (no socket):

| URL extra | Resulting `client.connectionParameters.ssl` |
|-----------|-----------------------------------------------|
| (none) | `{ rejectUnauthorized: true, ca }` — pin preserved |
| `?sslmode=require` | `{}` — **CA dropped** |
| `?sslmode=no-verify` | `{ rejectUnauthorized: false }` — **verification disabled** |
| `?sslmode=verify-full` | `{}` — **CA dropped** |
| `?sslmode=disable` | `false` (caught earlier by `strictTlsConfig`) |

`inspectTlsPosture` still reports `ok: true` / `rejectUnauthorized: true`
for `sslmode=no-verify` because it never inspects that token. Preflight
would green-light a URL that the live constructor then uses to disable
verification.

When the ssl object **is** preserved, `pg/lib/connection.js`
`upgradeToSSL` copies `rejectUnauthorized` and `ca` into `tls.connect`
options. That path is statically consistent. It is **not** live-proven.

**Exploitability:** an authorized later process that injects
`createLiveConnector` with a staging URL containing `sslmode=no-verify`
disables certificate verification. Combined with DNS distortion, that is
a production-contact / MITM path. `sslmode=require` drops the pinned CA
and falls back to Node’s default store (fail-closed against the Supabase
private CA, but the pin is gone).

**Required correction:**

1. Refuse any `sslmode` other than absent or `verify-full`.
2. Refuse `ssl=no-verify`, `uselibpqcompat`, and `PGSSLMODE`.
3. Construct `pg.Client` with discrete `host` / `port` / `user` /
   `password` / `database` / `ssl` fields — **never** pass
   `connectionString` alongside `ssl`.
4. Parse the CA as an X.509 certificate; reject `-----BEGIN` that is not
   a CA cert (today `resolveCa` accepts any `-----BEGIN` prefix,
   including a private key).

**Database connection needed to verify the overwrite?** No (constructor
proof is sufficient). Live handshake still **NOT VERIFIED**.

The current CLI does **not** call `createLiveConnector` (§6). R-TLS-1 is
a blocker for **wiring** that constructor, not an active CLI execute
path.

### 4.2 CA loading — **PASS WITH CONDITIONS**

`tls.mjs` `resolveCa` / `loadCaPem` (lines 20–50) load PEM text or a
path. Presence of `-----BEGIN CERTIFICATE-----` is checked only for path
values. There is no fingerprint pin, no parse, no expiry check, no proof
the CA matches the staging endpoint.

**Database connection needed?** Yes, to prove the CA matches the live
server certificate. **NOT VERIFIED.**

### 4.3 Per-migration connections — **PASS** (code); live **NOT VERIFIED**

`runner.mjs` `applySequence` (lines 102–148) opens one
`connector.withConnection('apply:<filename>', …)` per file, `BEGIN` /
SQL / ledger success / `COMMIT` inside that callback.

`createMockConnector` (`connect.mjs` lines 28–56) refuses overlapping
connections and always `close`s in `finally`. Tests 21 and “overlapping
connections are refused” pass.

`createLiveConnector` (`connect.mjs` lines 75–93) constructs a **new**
`pg.Client` per call and `client.end()` in `finally`. Close errors are
swallowed (`.catch(() => {})`) so they do not mask the original
migration error. **PASS WITH CONDITIONS** (a failed `end()` after
success is ignored; possible leaked socket).

Migration `#23`
(`20260707225659_58faa06f-1875-4a2b-8365-88a8473383f2.sql`) contains a
true session GUC `SET statement_timeout = '0';` (re-read from git bytes).
Other `SET` hits in the 71-file set are `SET search_path` (also
session-scoped) or `UPDATE … SET`. Isolation is by new connection, not
by `RESET`. **PASS** for the orchestrator design. Live session GUC
non-leak is **NOT VERIFIED** (would need a database).

No `CREATE INDEX CONCURRENTLY` / `VACUUM` / explicit `COMMIT` exists in
the 71 files (the only `CONCURRENTLY` hit is a **comment** in
`20261002000004_coregrid_v1_memory_tier.sql`). The runner nevertheless
has **no** branch for SQL that cannot be wrapped in a transaction. For
this pin that is acceptable; it is not a general handler.

**Database connection needed to prove `#23` cannot leak?** Yes. Code
review is sufficient to show the intended isolation mechanism.

---

## 5. D — Migration history and atomicity

### 5.1 Ledger identity and states — **PASS** (design, memory-ledger tests)

`sherivs_staging_ledger` records `filename`, `content_checksum`,
`source_commit`, `manifest_id`, `status`, timestamps, `attempt_id`,
redacted error, `transaction_outcome`, `reconciliation_required`
(`ledger.mjs` lines 39–54).

`evaluateLedger` (lines 68–179) distinguishes:

- empty → `fresh_apply`
- `started` without `completed_at` → `LEDGER_INCOMPLETE` (refuse)
- `failed` → `LEDGER_FAILED` (refuse; no silent retry)
- `ambiguous` / `reconciliation_required` → `LEDGER_AMBIGUOUS` (refuse)
- `succeeded` with wrong checksum / commit / manifest id → refuse
- all 71 matching successes → `already_complete`
- partial matching success → `LEDGER_PARTIAL_PREFIX` (refuse; no auto-resume)

Tests 15–18, 20, and “partial success prefix is not auto-resumed” pass
against `evaluateLedger` / `createMemoryLedger`.

Intended atomicity (`ledger.mjs` header lines 15–22; `runner.mjs`
113–139): STARTED commits on its own connection; SQL +
`schema_migrations(version)` insert + `SUCCEEDED` update share one
transaction on a **different** connection; SUCCEEDED is not written
before that `COMMIT`; crash leaves STARTED → continuation refused.

**PASS** as a design. The SQL implementation of that design is **not**
what the unit tests execute (`createSqlLedger` is untested). Live
transaction atomicity is **NOT VERIFIED**.

### 5.2 Concurrency — **BLOCKER**

**Finding ID:** **R-HIST-1**
**Classification:** **BLOCKER**
**File:** `ledger.mjs` lines 56–57 (unique index), 256–343 (`createSqlLedger`);
`runner.mjs` lines 263–276 (`evaluateLedger` then `applySequence`).

The only uniqueness constraint is `(attempt_id, filename)`. Each run
generates a new `attemptId` (`runner.mjs` line 205). Two concurrent
processes can both observe `ledger_empty` / `fresh_apply` and both apply
file 1. `INSERT INTO schema_migrations … ON CONFLICT (version) DO NOTHING`
(`runner.mjs` lines 128–133) **hides** the second version insert while
the migration SQL still runs twice.

There is no `pg_advisory_lock`, no `UNIQUE (filename)`, no exclusion
constraint on `status IN ('started','succeeded')`, and no compare-and-set
on STARTED.

**Exploitability / failure:** duplicate apply of non-idempotent
`CREATE TABLE` / `CREATE POLICY` / data backfills on staging; torn
schema; false confidence from two “success” attempt rows.

**Required correction:** take a session-level advisory lock for the
duration of the run; add `UNIQUE (filename)` (or a unique partial index
on live statuses); make STARTED insert fail closed on conflict; never
`ON CONFLICT DO NOTHING` unless the SQL apply was skipped because the
version was already present **and** checksums match.

**Database connection needed to verify?** No — absence of a lock in
source is sufficient. Live double-apply was not attempted.

### 5.3 Private ledger vs schema / vendor history — **BLOCKER**

**Finding ID:** **R-HIST-2**
**Classification:** **BLOCKER**
**File:** `runner.mjs` lines 268–271.

If `evaluateLedger` returns `already_complete`, execute returns
`ok: true` **without** opening a catalog connection or comparing
expected objects. A complete private ledger with an absent or divergent
schema would be reported as success.

**Finding ID:** **R-HIST-3**
**Classification:** **BLOCKER**
**File:** `runner.mjs` lines 263–276; `ledger.mjs` lines 7–13, 59–61,
128–133.

The inverse is also true: `fresh_apply` looks only at
`sherivs_staging_ledger`. An empty private ledger plus a populated
`supabase_migrations.schema_migrations` (or an already-created public
schema) still proceeds to re-apply all 71 files.

The relationship to Supabase CLI history **is documented** (`ledger.mjs`
lines 4–13): this runner does not use `supabase db push`; on success it
inserts the 14-character timestamp prefix into
`supabase_migrations.schema_migrations` so a later correctly-linked CLI
does not replay files. That is an explicit, honest contract. It is not
a bidirectional reconciliation. `CREATE TABLE IF NOT EXISTS … schema_migrations
(version text PRIMARY KEY)` can also create a **narrower** table than
the vendor’s if the vendor table does not yet exist.

**Required correction:** execute must not return success from ledger
rows alone. Require a fresh read-only catalog (identity + emptiness or
expected objects) before `fresh_apply` and before `already_complete`.
Read vendor `schema_migrations` and refuse unexpected versions.
Do not create a substitute `schema_migrations` shape if the vendor table
is absent without an explicit catalog decision.

**Database connection needed to verify a false `already_complete`?** Yes,
to observe a divergent schema. The missing check is visible in source
without a connection.

### 5.4 Success-before-commit and uncertain outcomes — **PASS WITH CONDITIONS**

SUCCEEDED is updated on the same client, before `COMMIT`, inside the
apply callback. `applied.push` runs only after `withConnection` returns.
A migration is not marked successful in the SQL ledger **before** that
transaction commits, **if** `createSqlLedger.markSucceededInTransaction`
is the ledger in use.

Conditions:

- `markSucceededInTransaction` does not check `rowCount`; a 0-row UPDATE
  still `COMMIT`s SQL. Continuation would then see leftover STARTED →
  refuse. Fail-closed, but dirty.
- On apply error, `recordFailed` is always given `TX_OUTCOME.ROLLED_BACK`
  even if `ROLLBACK` failed or the error was during `COMMIT` (`runner.mjs`
  lines 156–164). Uncertain outcomes can be mislabeled; they still block
  via FAILED or leftover STARTED.
- `createSqlLedger.recordFailed` UPDATE of 0 rows returns `undefined`
  without throwing.
- If migration SQL contains its own `COMMIT` (none in this pin), schema
  could persist while the outer handler records FAILED.

**Database connection needed?** Yes, to prove PostgreSQL commit pairing.
Source review is sufficient to describe the intended window.

---

## 6. E — Execution gates

**Classification:** **PASS** for the current CLI; live connector still
absent from `cli.mjs`.

| Gate | Evidence | Result |
|------|----------|--------|
| `--mode=manifest` does not resolve a target or construct a client | `runner.mjs` 207–217; CLI test “manifest mode verifies source without a database URL” with `env: {}` | **PASS** |
| `--mode=offline` / `preflight` do not open a database | `runOfflinePreflight` only parses env + git; catalog forced `NOT_CHECKED`; CLI `--allow-live-catalog` returns `LIVE_CATALOG_NOT_ENABLED` and `runRestore` is called with `allowLiveCatalog: false` | **PASS** |
| No default / silent execute | Missing `--mode` → `MODE_REQUIRED`, exit 2. `selectMode` has no default | **PASS** |
| Authorization flag required | `assertExecuteAuthorization`; test 23 | **PASS** |
| Staging ref and source commit must match **exactly** | `confirmStagingRef !== STAGING_PROJECT_REF` / `confirmSourceCommit !== PINNED_SOURCE_COMMIT` | **PASS** |
| Missing confirmation fails **before** connector construction | `cli.mjs` 83–97: authorize, then `LIVE_EXECUTE_NOT_ENABLED` if no injected connector. `allowNetwork` is hardcoded `false` even if `--allow-network` is parsed | **PASS** |
| No hidden auto-apply | CLI `isDirect` calls `main()` without a connector. `--allow-network` is a no-op | **PASS** |
| Absence of a live client in the CLI is documented honestly | `cli.mjs` 11–12, 61, 89–96; README lines 39–40; implementation report §2.6 | **PASS** |

`connect.mjs` **does** contain `createLiveConnector`. That is documented
as a later opt-in and is not invoked by the CLI. This review did **not**
add, complete, or exercise it with `allowNetwork: true`.

`--allow-network` existing as a parsed flag that does nothing is an
operator-confusion risk, not an auto-apply path. **PASS WITH CONDITIONS.**

---

## 7. F — Offline tests

Command run (worktree of `5cfb9eb`; no database; no execute-mode CLI
outside the unit file):

```
npx vitest run tests/unit/sherivs-staging-migration-runner.test.ts
```

**Result:** 1 file, **34 passed / 34**, duration 857ms.

The tests **import the actual implementation modules** (`constants`,
`source`, `target`, `tls`, `ledger`, `connect`, `preflight`, `runner`,
`cli`). They are not a parallel helper reimplementation.

`beforeAll` calls real `loadFromGitCommit()` against the pinned commit
(git objects only). Execute-path tests inject `createMockConnector` and
`createMemoryLedger` with `allowNetwork: false`. Test 24 asserts
`createLiveConnector({ allowNetwork: false })` throws
`NETWORK_DISABLED`. Test 23 asserts CLI execute with confirmation flags
returns `LIVE_EXECUTE_NOT_ENABLED`.

### 7.1 What the tests actually cover

Source pinning, production/unprefixed refusal, TLS disable/insecure/missing
CA, transport order, proposed-SQL exclusion, memory-ledger refuse paths,
mock per-file connections, secret redaction, execute flags, working-tree
69 vs git 71, `#23` GUC **detection** (not live leak), catalog
`NOT_CHECKED`.

### 7.2 Meaningful missing cases

- `sslmode=no-verify` / `sslmode=require` vs `pg.Client` option merge
  (**R-TLS-1**).
- `createSqlLedger` INSERT/UPDATE/rowCount/0-row UPDATE (the live ledger
  is untested).
- Concurrent two-runner `fresh_apply` (**R-HIST-1**).
- `already_complete` must not imply schema presence (**R-HIST-2**).
- Vendor `schema_migrations` populated + empty private ledger
  (**R-HIST-3**).
- Git env (`GIT_DIR`, replace refs).
- CA value that starts with `-----BEGIN` but is not a certificate.
- `hostaddr` / unknown URL query parameters.
- Close-error swallowing vs original migration error (live client).
- Multi-statement simple-query behaviour on PostgreSQL 17 (explicitly
  deferred by the implementation report; still **NOT VERIFIED**).

Passing these 34 tests is **not** proof of live database safety.

---

## 8. Findings table

| ID | Topic | Class | File:lines | DB needed? |
|----|-------|-------|------------|------------|
| A1 | Commit + migrations-tree pin, 71 hashes, order | **PASS WITH CONDITIONS** (Git env) | `constants.mjs` 10–15; `source.mjs` 179–208 | No |
| A2 | No 69-file working-tree fallback | **PASS** | `source.mjs` 225–252 | No |
| A3 | Transport pair #59 then #69 | **PASS** | `approved-manifest.json`; `source.mjs` 99–116 | No |
| A4 | `*.sql.proposed` excluded | **PASS** | `source.mjs` 118–125 | No |
| A5 | Missing/extra/modified/reordered fail closed | **PASS** | `source.mjs` 118–176 | No |
| B1 | Staging ref `dvxszhracsjwdancijdc` only | **PASS** | `target.mjs` 74–156 | No |
| B2 | Production ref refused | **PASS** | `target.mjs` 58–71 | No |
| B3 | Unprefixed `DATABASE_URL` / `SUPABASE_URL` refused | **PASS** | `target.mjs` 158–165 | No |
| B4 | Missing / disagreeing staging URLs | **PASS** | `target.mjs` 166–184 | No |
| B5 | Credentials are not identity | **PASS** | `target.mjs` 136–142 | No |
| B6 | Cannot contact production via DNS/redirects | **NOT VERIFIED** | n/a (depends on TLS + live net) | Yes |
| B7 | Logs redact secrets | **PASS** | `redact.mjs` 13–64 | No |
| C1 | `rejectUnauthorized` actually used by `pg` | **BLOCKER** (R-TLS-1 URL overwrite) | `connect.mjs` 78–81 | No for overwrite; Yes for handshake |
| C2 | CA loaded and validated | **PASS WITH CONDITIONS** / live **NOT VERIFIED** | `tls.mjs` 20–50 | Yes for match |
| C3 | Insecure TLS / `sslmode=disable` refused | **PASS** | `tls.mjs` 56–71 | No |
| C4 | No path bypasses verification | **BLOCKER** (R-TLS-1) | `connect.mjs` 78–81 | No |
| C5 | Separate connection per migration | **PASS** (code); live **NOT VERIFIED** | `runner.mjs` 122–148; `connect.mjs` 75–93 | Yes for live |
| C6 | Close after success and failure | **PASS WITH CONDITIONS** | `connect.mjs` 50–56, 88–92 | No |
| C7 | `#23` cannot leak | **PASS** (design); live **NOT VERIFIED** | `runner.mjs` 122–148 | Yes |
| C8 | Cleanup does not mask apply failure | **PASS WITH CONDITIONS** | `connect.mjs` 90–92; `runner.mjs` 156–164 | No |
| D1 | Filename + checksum identity | **PASS** | `ledger.mjs` 39–54, 113–139 | No |
| D2 | Source commit + manifest recorded | **PASS** | `runner.mjs` 113–119 | No |
| D3 | Distinct started/succeeded/failed/uncertain | **PASS** | `ledger.mjs` 68–179 | No |
| D4 | Success not before schema commit | **PASS WITH CONDITIONS** | `runner.mjs` 123–139 | Yes for live |
| D5 | SQL + success atomic where feasible | **PASS WITH CONDITIONS** (untested SQL ledger) | `ledger.mjs` 296–314 | Yes |
| D6 | Non-transactional SQL handler | **PASS WITH CONDITIONS** (none in this pin; no general handler) | `runner.mjs` 125 | No |
| D7 | Interrupted / ambiguous blocks | **PASS** | `ledger.mjs` 88–94 | No |
| D8 | Failed not silently retried | **PASS** | `ledger.mjs` 96–103; test 20 | No |
| D9 | Changed checksum not accepted | **PASS** | `ledger.mjs` 116–124 | No |
| D10 | Concurrent runners cannot both apply | **BLOCKER** (R-HIST-1) | `ledger.mjs` 56–57 | No |
| D11 | Ledger vs Supabase `schema_migrations` | **PASS** as documentation; **BLOCKER** as reconciliation (R-HIST-3) | `ledger.mjs` 4–13, 59–61 | Yes for live shape |
| D12 | Complete private ledger ≠ restored schema | **BLOCKER** (R-HIST-2) | `runner.mjs` 268–271 | Yes to observe divergence |
| E1–E8 | Modes, flags, no hidden apply, honest CLI | **PASS** | `cli.mjs` 70–125; `runner.mjs` 37–60, 207–283 | No |
| F1 | Targeted offline suite | **PASS** (34/34); not live proof | `tests/unit/sherivs-staging-migration-runner.test.ts` | No |

---

## 9. Named blockers (must be closed before any live connector is authorized)

These keep **restore execution** blocked. They do **not** reopen OPTION A
or the 71-file membership. They are **code** defects in the runner that
exists today, plus still-open operational gates from the restore review.

1. **R-TLS-1 — Live `pg.Client` construction lets URL `sslmode` overwrite
   the pinned `{ rejectUnauthorized: true, ca }`.** `sslmode=no-verify`
   disables verification. Fix the constructor and refuse non-verify-full
   modes **before** adding CLI wiring.
2. **R-HIST-1 — No concurrency safety.** Unique key is
   `(attempt_id, filename)`. Two runners can `fresh_apply` the same file.
   The mission treats missing concurrency safety as a blocker.
3. **R-HIST-2 — `already_complete` is claimed from the private ledger
   alone.** The runner can report success while the expected schema is
   absent.
4. **R-HIST-3 — `fresh_apply` ignores vendor `schema_migrations` and the
   live catalog.** An empty private ledger is treated as a green field.
5. **Prior BLOCKER-2 (still open) — Fresh staging preflight has not been
   performed.** GATE4 emptiness is historical. This review did not open
   staging. Catalog remains `NOT_CHECKED` by design.
6. **Prior BLOCKER-5 (still open) — No written human authorization**
   naming staging ref, Git pin, OPTION A, runner, and acceptance of OPEN
   SHERIVS-001 / 002 / 003.

This review **does not** authorize closing any of the above by merging
this document.

---

## 10. Prior restore-review blockers — status after this runner

| Prior ID | After this runner review |
|----------|--------------------------|
| BLOCKER-1 — no staging-only 71-file runner | **Addressed as existence.** Offline gates and source pin are real. Replaced by R-TLS-1 / R-HIST-1 / R-HIST-2 / R-HIST-3 for live use |
| BLOCKER-2 — fresh staging preflight | **Still open.** Offline preflight records `NOT_CHECKED` |
| BLOCKER-3 — history mechanism undesigned | **Partially addressed** (ledger + refuse-on-failure). Concurrency and vendor-history reconciliation remain blockers |
| BLOCKER-4 — session isolation unspecified | **Addressed in code** (new connection per file). Live non-leak **NOT VERIFIED** |
| BLOCKER-5 — written human authorization | **Still open** |
| BLOCKER-6 — production-refusal harness absent from `d195ba8` | **Addressed in this runner** (positive staging pin + unprefixed refusal). Old `db-apply.mjs` / `pg-ssl.mjs` **unchanged** and still unsafe if used |

---

## 11. Version-target classification

**ACTIVE-V1 ONLY.**

This review inspects the V1 Scholar 71-file restore runner. It does **not**
implement V2 device/IoT or V3 Reality Intelligence. Including the
V2-named transport file is authorization-posture restore of a V1 Scholar
table already present on `origin/master` at `d195ba8`. No frozen
capability was implemented.

---

## 12. Explicit confirmation

- Authoritative source pin re-verified: commit `d195ba8`, migrations tree
  `bbd82895`, **71** files, SHA-256 match, lexicographic order, no
  timestamp collisions.
- Transport pair included in the pinned manifest in the correct order
  (#59 then #69).
- Proposed SQL excluded.
- Default branch remains a **69-file** trap (`#70` / `#71` missing); the
  runner loads Git bytes, not that working tree.
- Production-default apply scripts were not changed.
- No database was opened.
- No SQL was executed against any server.
- No migration was applied.
- Production and staging were unchanged.
- Canonical migration files were not modified.
- Application code and the runner were not modified.
- The CLI live PostgreSQL client was not added.
- The runner was not executed in migration mode (CLI execute returns
  `LIVE_EXECUTE_NOT_ENABLED`; unit execute uses a mock connector).
- SHERIVS-001, SHERIVS-002, and SHERIVS-003 remain **OPEN**.
- Staging schema has **not** been restored.
- Passing 34 offline tests is **not** live safety proof.
- This review is **not** permission to execute.
- Only a later explicit authorization may permit database changes, and
  only after the named blockers in §9 are closed **and** a live connector
  is reviewed again.

---

## 13. Agent report

**Implemented:** independent code review of the Sherivs staging-only
migration runner (document only).

**Files changed:** `docs/security/rls-prep/SHERIVS-STAGING-MIGRATION-RUNNER-REVIEW-001.md`

**Architecture impact:** none to running systems. Records that offline
source pinning, target isolation, and CLI gates are largely correct, and
that live connector TLS merging plus ledger concurrency / catalog honesty
are blockers.

**Tests:** independently recomputed 71 SHA-256 values; Git tree/count/order;
statement scan (session GUC / CONCURRENTLY); `pg@8.23.1` constructor
overwrite proof (no socket); `npx vitest run tests/unit/sherivs-staging-migration-runner.test.ts`
→ **34/34 passed**. No database tests. No apply. No mutation scripts
executed.

**Security validation:** production and staging non-contact; proposed SQL
excluded; findings left OPEN; no credentials printed; no automatic
authorization; live connector not constructed.

**Known risks:** R-TLS-1, R-HIST-1, R-HIST-2, R-HIST-3; stale staging
catalog; old `db-apply.mjs` still present; 69-file working-tree trap;
canonical restore still reintroduces OPEN RLS findings.

**Remaining work:** fix named code blockers; independent re-review of
those fixes; fresh staging catalog; written apply authorization; then a
**separate** mutating restore mission; then post-restore catalog; then
(later) eligible proposed SQL.

**Final status:** **B. PASS WITH CONDITIONS — NAMED CODE BLOCKERS REMAIN**

A PASS on offline implementation pieces does **not** authorize live
execution. Status **A** is refused because named code blockers remain.
Status **C** is refused because source pinning, unprefixed-URL refusal,
production-ref refusal, CLI execute gates, and history fail-closed paths
are real and are not fundamental defects of the offline design.

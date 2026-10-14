# SHERIVS-TRANSPORT-MIGRATION-REVIEW-001

**Mission ID:** SHERIVS-TRANSPORT-MIGRATION-REVIEW-001
**Mission class:** READ-ONLY MIGRATION DEPENDENCY INVESTIGATION
**Version target:** ACTIVE-V1 ONLY
**Timestamp (UTC):** 2026-10-14T19:30:00Z
**Role:** Principal PostgreSQL Architect / Migration Forensics Engineer / Independent Database Change Reviewer

**Final status:** **A. DECISION SUPPORTED BY REPOSITORY EVIDENCE**

This report resolves the outstanding restoration decision for canonical
migrations `20261002000014` and `20261003000041`. It does **not** apply
migrations, open a database, execute SQL, edit or reorder migration files,
modify application code, or change the existing restoration plan.

**Recommendation (empty-staging Git-complete restore matching `origin/master`
@ `d195ba8`):** **OPTION A — apply both migrations in canonical filename
order.** Do not skip one of the pair. Do not use
`scripts/apply-canonical-hardening.mjs` as the empty-staging 71-file runner.

---

## 0. Non-contact and non-mutation statements

- **No database was opened.** No Postgres session, pooler session, or
  Supabase Management API query ran in this mission.
- **No SQL or migration was executed.** Static inspection only (file reads,
  `git` history, offline `--manifest`, unit tests that read repository files).
- **Production was not opened.** Production project identifiers that appear
  in repository files are cited as Git strings only.
- **Staging was not opened.** Emptiness of staging is treated as
  **historical Git evidence** from `GATE4-CATALOG-BASELINE-001`, not as a
  live re-catalog.
- **Neither migration was applied after this report.**
- **No secret, token, or connection string is printed.**
- **The existing restoration plan was not modified.**
- **The only working-tree change in this mission is this file.**

---

## 1. Repository identity

| Item | Value |
|------|-------|
| Inspection branch (this report) | `cursor/sherivs-transport-migration-review-1f50` |
| HEAD at inspection (parent of this report) | `857d4fee1ccc9d11b3c4a34f1142ff6a0da1f7fe` (`coregrid-scholar-migration`) |
| Authoritative application source | `origin/master` @ `d195ba861f80379b79533126653b9cee82a8e872` |
| `origin/master` subject | `Merge pull request #9 from vibeoraai-bit/cursor/v1-production-host-routing-5cb8` |
| Canonical migration directory | `database/supabase/migrations/` |
| `origin/master` migration tree | `bbd828951e166662bbe831fd74972e1a15488468` (**71** `.sql` files) |
| Inspection HEAD migration tree | `a104d5e34f0f4020ffe0d6e36b97cc444459c3f2` (**69** files; missing `#70` and `#71` memberships/onboarding) |
| Blob identity of both reviewed files | **identical** on `origin/master` and inspection HEAD |

`d195ba8` **is** `origin/master` at inspection (`git rev-parse origin/master`
equals `d195ba8`). Authoritative source is **verified**. Status is not **C**.

Default branch `coregrid-scholar-migration` is **not** the restore source
(69 files). Restore source remains `origin/master` @ `d195ba8` (71 files),
as established by `SHERIVS-STAGING-SCHEMA-RESTORE-PREP-001`.

### 1.1 Documents inspected (Git artifacts; not modified)

| Document | Git location | Use in this review |
|----------|--------------|--------------------|
| Restore plan | `docs/security/rls-prep/SHERIVS-STAGING-SCHEMA-RESTORE-PREP-001.md` on `origin/cursor/sherivs-staging-schema-restore-prep-caab` (PR #18, commit `615fe53`) | Open question §8.2 / §15 item 1 |
| Catalog baseline | `docs/security/rls-prep/GATE4-CATALOG-BASELINE-001.md` on `origin/cursor/sherivs-rls-gate4-catalog-baseline-caab` (PR #16, commit `83ae504`) | Historical claim that staging had no Scholar objects and no `supabase_migrations` history |

Neither document exists on `origin/master` or on this inspection HEAD. They
are **security-preparation artifacts**, not a second application source.
Migration blobs at `d195ba8` and at `83ae504` share tree
`bbd828951e166662bbe831fd74972e1a15488468` (restore-prep §2.2).

---

## 2. Exact paths of the two migrations

| Token | Canonical path at `d195ba8` | sha256 of file bytes | git blob |
|-------|-----------------------------|----------------------|----------|
| `20261002000014` | `database/supabase/migrations/20261002000014_coregrid_v2_transport_buses_rls.sql` | `a1e3bcc3b0f1436de6c49d4ccd601cd894fdd10bdae5f25d692b02f37be83517` | `74e4a1860f1b78403f57f8e3650109dd0086abd6` |
| `20261003000041` | `database/supabase/migrations/20261003000041_coregrid_transport_bus_reads.sql` | `9a1e0194dcfebde50e031c63fd3701b9b6c7cbed712f9968c646bd83976ab3cf` | `ebf648c583843e3172e8c99f0a94150035f0d599` |

Companion rollbacks (not an apply path):

| Token | Path | sha256 |
|-------|------|--------|
| `20261002000014` rollback | `database/supabase/rollbacks/20261002000014_coregrid_v2_transport_buses_rls.sql` | `cd8ccc673c2f525ae0dfce7100f9b35e68870e7485b9f1544dbfe10721c84f14` |
| `20261003000041` rollback | `database/supabase/rollbacks/20261003000041_coregrid_transport_bus_reads.sql` | `b7264175c38b8df50116f7a41f6574b8a5679d0ba1c8f1c9a03fd4db975c8e26` |

These checksums match `scripts/apply-canonical-hardening.mjs --manifest`
(offline, no database) and the in-repo
`architecture/proofs/CANONICAL_APPLY_RECORD_HARDENING.json` checksum fields.
Checksum match proves **byte identity of Git files**, not that any live
database received them.

Filename positions in the 71-file lexicographic sequence at `d195ba8`:

| # | Filename |
|---|----------|
| 18 | `20260626150625_35a08443-45fd-46ae-807b-3644b44efe26.sql` (creates `transport_buses`) |
| 20 | `20260627090513_8cdbda3b-4bd0-4ac0-a4b5-0adfdc813790.sql` (replica identity + realtime) |
| 32 | `20260904010000_coregrid_rls_transport_and_grants.sql` (four scoped policies) |
| 59 | `20261002000014_coregrid_v2_transport_buses_rls.sql` (**this review**) |
| 60 | `20261002000015_coregrid_v1_substrate_policies.sql` (does **not** touch `transport_buses`) |
| 68 | `20261003000040_coregrid_school_media_bucket.sql` |
| 69 | `20261003000041_coregrid_transport_bus_reads.sql` (**this review**) |
| 70 | `20261008000050_coregrid_organization_memberships.sql` (does **not** reference `transport_buses`) |
| 71 | `20261008000060_organization_onboarding.sql` (does **not** reference `transport_buses`) |

Proposed filename order **does** satisfy the SQL dependencies of this pair:
`#18` creates the table, `#32` authors the policies `#59` drops, `#59`
establishes the zero-policy grant/policy baseline `#69` requires, `#69`
authors the successor SELECT policy. No later canonical file mutates these
objects.

---

## 3. Summaries of both files

### 3.1 `20261002000014` — H2-03 zero-policy normalization

**Header status (Git text):** `AUTHORED, NOT APPLIED.`
**Mission label:** H2-03, driver-family substrate.
**Filename contains `v2`.** SQL body mutates V1 Scholar table
`public.transport_buses` only. It does not create device/IoT objects and
does not un-freeze V2 scope (AGENTS.md §45). Restore-prep §17 already
classified this as a Git naming artifact.

**Objects changed (authorization state only):**

| Kind | Action |
|------|--------|
| Tables / columns | None created or altered. `ALTER TABLE public.transport_buses ENABLE ROW LEVEL SECURITY` (idempotent re-assert). |
| Indexes / constraints | None |
| Functions / triggers | None. Existing `trg_transport_buses_touch` from `#18` is untouched. |
| Policies | `DROP POLICY IF EXISTS` five names: `buses_school_rw`, `buses_school_read`, `buses_driver_or_admin_update`, `buses_school_admin_insert`, `buses_school_admin_delete` |
| Grants | `REVOKE ALL` from `anon`, `authenticated`, `PUBLIC`; `GRANT ALL` to `service_role` |
| Seed / config data | None |
| Extensions | None |
| Comments | `COMMENT ON TABLE public.transport_buses` — declared ZERO-POLICY audit string |
| Guard | `DO` block: `RAISE EXCEPTION` if any `pg_policies` row remains for `public.transport_buses` |

**Does not** `FORCE` RLS (battery INFO convention for zero-policy).
**Does not** drop or recreate the table. **Does not** backfill rows.

**Intended post-file state:** RLS enabled, **zero** policies, **zero**
client table privileges, `service_role` ALL. Every client REST/realtime
read or write on this table **denies**.

### 3.2 `20261003000041` — T-D driver self-assignment SELECT

**Header status (Git text):** `AUTHORED, NOT APPLIED.`
**Mission label:** TEAM T-D, post-R-wave. Explicitly cites
`20261002000014` as “the zero-policy substrate era this migration
supersedes for the driver read surface only.”

**Objects changed (authorization state only):**

| Kind | Action |
|------|--------|
| Tables / columns | None created. `ALTER TABLE public.transport_buses FORCE ROW LEVEL SECURITY`. |
| Indexes / constraints | None |
| Functions / triggers | None |
| Policies | `CREATE POLICY transport_buses_select_driver_assigned ON public.transport_buses FOR SELECT TO authenticated USING (driver_id = auth.uid())` — **no `IF NOT EXISTS`** |
| Grants | `GRANT SELECT ON TABLE public.transport_buses TO authenticated` only. No INSERT/UPDATE/DELETE. No anon/PUBLIC. `service_role` untouched (assumes `#59` already granted ALL). |
| Seed / config data | None. Header: “No backfill is performed.” |
| Extensions | None |
| Comments | Table comment **supersedes** the `#59` comment. Policy comment authored. |
| Guard | `DO` block fails unless **exactly one** policy exists, it is the named SELECT policy, `authenticated` holds **exactly** `SELECT`, anon/PUBLIC hold **zero** privileges, and `relrowsecurity AND relforcerowsecurity` is true |

**Predicate:** `driver_id = auth.uid()` (identity-scoped, not
`get_my_tenant_id()`). Header records that the J-005 tenant-equality shape
is inexpressible: the table has no neutral tenant column, and the authors
claimed the live neutral membership substrate held zero bindings (a
**historical discovery note dated 2026-10-03**, not re-verified here).

**Intended post-file state:** RLS enabled **and forced**; exactly one
policy; authenticated SELECT-only; writes and all other client read
families remain denied.

### 3.3 Relationship in one sentence

`20261003000041` is the **successor posture** of `20261002000014`, not a
duplicate of it, and **not** a substitute that can run without it on a
greenfield apply: `#69`’s guard requires the zero-policy / zero-client-grant
baseline that only `#59` produces after `#32`.

---

## 4. Relevant Git history

First-parent history on `origin/master`:

| File | First appearance on `origin/master` | Commit | Date | Subject |
|------|-------------------------------------|--------|------|---------|
| `20261002000014` | squash merge PR #1 | `976e2dca5e059be8510f5edaf7dd9ffcff711ca0` | 2026-10-03 | CoreGrid V1 Waves 1–3 |
| `20261003000041` | squash merge PR #2 | `857d4fee1ccc9d11b3c4a34f1142ff6a0da1f7fe` | 2026-10-06 | V1 provider orchestration waves 3–5 |

Feature-branch commits exist in the object store and are **not** required
to be first-parent ancestors of `origin/master` (squash):

| Commit | Subject (truncated) | Relevance |
|--------|---------------------|-----------|
| `3191b083b43e0cbed90312b9d7fa6c92b8b97e68` | `feat(h2-wave): transport RLS normalization…` | Authors H2-03 (`00014`) as zero-policy deny-by-default |
| `6a6d3bd84afc724ee274c2277e4a96e94714ec75` | `v1/T-D: transport fleet driver bus-read gate applied + live-proven…` | Authors `00041` and claims a **canonical** apply `STATUS=PASS`. `git merge-base --is-ancestor 6a6d3bd origin/master` is **false**. The *claim* survived squash as file content in the apply-record JSON and posture JSON |

**Why each file was introduced (repository evidence):**

1. **`00014` (H2-03):** queued finding that `transport_buses` policies were
   campus-wide (`buses_school_rw` / school-scoped helpers), recorded in
   `tests/unit/p08-enforcement-surface.test.ts`. H3-040 adjudicated
   zero-policy because the table has no neutral tenant column and J-005/J-006
   ban legacy helpers in new policy SQL. `00014` drops every known
   permissive policy and revokes client grants.
2. **`00041` (T-D):** R1 e2e finding (`progress/v1-wave/R1-report.md`) that
   under zero-policy, `getMyDriverBus` returns zero rows for every client
   session. Operator-directed post-R-wave follow-up authored a
   least-privilege SELECT using `driver_id = auth.uid()`. T-D report
   (`progress/v1-wave/T-D-report.md`) and the migration header both say the
   file was **authored, not applied by that team**; coordinator apply was a
   later claimed step.

**Does either supersede the other?** Yes, **in the applied-state
signature sense**, not in the greenfield-apply sense:

- `scripts/apply-canonical-hardening.mjs` sets
  `declared.supersededBy: "20261003000041_coregrid_transport_bus_reads.sql"`
  on `00014`.
- On a **re-apply** to a project that already ran both, the marshal
  **unconditionally skips** `00014` (would fail its own zero-policy guard
  once `00041`’s policy exists).
- On an **empty** project, skip is **unsafe**: `00014`’s DROP/REVOKE work
  has not happened yet. Filename-order apply of all 71 files (`scripts/db-apply.mjs`)
  executes both. That is the restore runner the restore-prep identified.

**Later migrations depending on this pair:** none in
`database/supabase/migrations/` after `#69` reference `transport_buses`,
the five dropped policy names, or `transport_buses_select_driver_assigned`.
`#70` / `#71` are independent (and absent from inspection HEAD).

**Skipping both:** table, trigger, realtime publication, and `#32` policies
would remain. Schema of the table would exist; Git HEAD authorization
posture would **not**.

**Applying both:** no duplicate table, column, index, or function. The only
duplicate-object risk is re-running `00041` (`CREATE POLICY` without
`IF NOT EXISTS`) or running `00041` while `#32` policies still exist
(`00041` guard fails).

---

## 5. Dependency graph

```
#18 20260626150625
    CREATE TABLE public.transport_buses
    ENABLE RLS
    GRANT SELECT,INSERT,UPDATE,DELETE TO authenticated
    GRANT ALL TO service_role
    CREATE POLICY buses_school_rw FOR ALL (legacy helpers)
    CREATE TRIGGER trg_transport_buses_touch
    ADD TABLE supabase_realtime
        |
        v
#20 20260627090513
    REPLICA IDENTITY FULL
    ADD TABLE supabase_realtime (IF NOT EXISTS)
        |
        v
#32 20260904010000
    DROP POLICY buses_school_rw
    CREATE POLICY buses_school_read
    CREATE POLICY buses_driver_or_admin_update
    CREATE POLICY buses_school_admin_insert
    CREATE POLICY buses_school_admin_delete
    REVOKE TRUNCATE, TRIGGER, REFERENCES FROM anon, authenticated
        |
        v
#59 20261002000014     ◄── this review
    ENABLE RLS (re-assert)
    DROP POLICY IF EXISTS (all five names above)
    REVOKE ALL FROM anon, authenticated, PUBLIC
    GRANT ALL TO service_role
    GUARD: pg_policies count must be 0
        |
        v
#69 20261003000041     ◄── this review
    FORCE RLS
    GRANT SELECT TO authenticated
    CREATE POLICY transport_buses_select_driver_assigned
        FOR SELECT TO authenticated USING (driver_id = auth.uid())
    GUARD: policies=1 AND named SELECT AND auth=SELECT-only
           AND anon/PUBLIC=0 AND FORCE true
        |
        v
#70 / #71  (no edge)
```

**Hard SQL edges:**

| From | To | Why |
|------|----|-----|
| `#18` | `#59` and `#69` | `ALTER TABLE public.transport_buses` fails if the table is absent |
| `#32` | `#59` | `#59` is the file that removes `#32`’s four policies. If `#32` is skipped, `#59` still `DROP IF EXISTS` the original `buses_school_rw` and can reach zero policies |
| `#59` | `#69` | `#69` guard requires **exactly one** policy and **SELECT-only** authenticated grants. After `#32`, authenticated still has DML and four policies. Applying `#69` without `#59` is expected to **fail the `DO` block** |
| `#69` | later files | none |

`auth.uid()` is a vendor function. `#69` does **not** call
`get_my_school_id`, `is_school_admin`, `get_my_tenant_id`, or
`is_tenant_admin`. There is no SQL dependency on `#58`
(`20261002000013`). Placement after `#58` is filename order, not a
functional edge.

---

## 6. Later migration references

Canonical directory grep at `d195ba8` for `transport_buses`, the five
legacy policy names, and `transport_buses_select_driver_assigned`:

| File | Role |
|------|------|
| `20260626150625_…` | definition |
| `20260627090513_…` | realtime |
| `20260904010000_…` | four scoped policies |
| `20261002000014_…` | zero-policy normalization |
| `20261003000041_…` | successor SELECT policy |

No other file in the 71-file tree references these objects. Neighbor `#60`
(`20261002000015`) is unrelated substrate policy SQL.

---

## 7. Related application-code and test references

Inspected without running database operations.

### 7.1 Runtime surfaces (authenticated client unless noted)

| Surface | Path | Statements | After Option A |
|---------|------|------------|----------------|
| Driver assigned-bus read | `frontend/src/lib/runtime/scholar/driver-portal.functions.ts` `getMyDriverBus`; `bus-tracking.functions.ts` `getMyBus` | `select` + `.eq("driver_id", userId)` via `requireSupabaseAuth` | **Intended to work** (the `#69` policy matches this query) |
| Driver location / status writes | same files: `pushDriverLocation`, `setDriverBusStatus`, `updateBusLocation`, `setMyBusStatus` | `update` filtered by `driver_id` | **Denied** (no UPDATE policy or privilege). T-D remaining work |
| Driver notify path | `notifyBusArrival` | `select` then other tables | SELECT of own bus **allowed**; rest unchanged |
| Parent tracking | `frontend/src/routes/_authenticated/parent/bus-tracking.tsx`, `parent/dashboard.tsx` | `from("transport_buses")` + realtime | **Denied** (not the assigned-driver actor) |
| Admin fleet UI | `admin/bus-management.tsx`, `admin/buses.tsx`, `admin/dashboard.tsx`, `admin/operations.tsx` | `select` / `insert` / `update` / `delete` on authenticated client | **Denied** |
| Demo provision | `frontend/src/lib/runtime/scholar/demo-provision.functions.ts` | `supabaseAdmin` (service-role) insert | **Unaffected** |
| Domain helper (no SQL) | `frontend/src/lib/scholar/transport.ts` | in-memory validation only | No dependency |

Driver comments still describe “RLS (`school_id = get_my_school_id()) AND
the driver_id filter”. That comment describes the **`#32` era**, not the
`#69` posture. It is a documentation drift in application code, not a
second SQL contract.

### 7.2 Tests and registries (file-pinning; no DB)

| Artifact | What it encodes |
|----------|-----------------|
| `tests/unit/mh-03-transport-rls.test.ts` | Pins `#59` SQL (drops, revokes, zero-policy guard) **and** current posture JSON as T-D policy-backed |
| `tests/unit/td-041-transport-bus-reads.test.ts` | Pins `#69` SELECT-only policy, exact-inverse rollback restoring `#59` comment **verbatim**, flow from `getMyDriverBus` |
| `tests/unit/mh-06-apply-marshal.test.ts` | Pins `00014.supersededBy = 00041` and `00041` declared policy |
| `tests/unit/h3-040-posture-adjudication.test.ts` | Historical H3-040 doc still adjudicates **zero-policy**; posture JSON is **policy-backed** by T-D |
| `scripts/verification/rls-table-postures-transport.json` | Current expected catalog: policy-backed, FORCE, one named policy, authenticated SELECT-only |
| `tests/e2e/preview-public-site-card.spec.ts` | Driver case typed-skip names `#69` until applied |

Unit tests executed in this mission (file reads only):

```
npx vitest run tests/unit/td-041-transport-bus-reads.test.ts \
  tests/unit/mh-03-transport-rls.test.ts \
  tests/unit/mh-06-apply-marshal.test.ts \
  tests/unit/h3-040-posture-adjudication.test.ts
→ 4 files, 83 tests, all passed. No database contact.
```

### 7.3 Git claims of “applied” versus headers

Three **in-repo** statements disagree. None is live proof:

| Artifact | Claim |
|----------|--------|
| Both migration SQL headers | `AUTHORED, NOT APPLIED` |
| `td-041` tests | Pin those headers as NOT APPLIED |
| `rls-table-postures-transport.json` `status` | `APPLIED (2026-10-03, coordinator)` |
| `CANONICAL_APPLY_RECORD_HARDENING.json` | `00014` state `SUPERSEDED`; `00041` state `APPLIED_AND_VERIFIED` |
| `GATE4-CATALOG-BASELINE-001` (historical) | Staging had **no** Scholar tables and **no** `supabase_migrations` |

This review **does not** treat any of those as staging or production
history. For empty-staging restore, the SQL bodies and their guards are
the operative contract.

---

## 8. Idempotency and destructive-operation analysis

### 8.1 `20261002000014`

| Statement class | Idempotent? | Notes |
|-----------------|-------------|-------|
| `ENABLE ROW LEVEL SECURITY` | Yes | Re-assert |
| `DROP POLICY IF EXISTS` ×5 | Yes | Safe if names absent |
| `REVOKE ALL` client roles | Yes | |
| `GRANT ALL TO service_role` | Yes | |
| `COMMENT ON TABLE` | Yes | Overwrites |
| Zero-policy `DO` guard | **Not re-runnable after `#69`** | Fails if any policy exists, including `transport_buses_select_driver_assigned` |
| `CREATE TABLE` / `DROP TABLE` / `TRUNCATE` / DML | None | |
| `FORCE` / `NO FORCE` | None | Leaves `relforcerowsecurity` as found (false after `#18`/`#32`) |

Destructive relative to `#32`: **yes** (drops policies, revokes client
DML). Not destructive to table data. Not reversible as part of a 71-file
`db-apply` run except via companion rollback SQL (which **re-creates
J-005-banned helper policies** — a security regression requiring separate
authorization).

### 8.2 `20261003000041`

| Statement class | Idempotent? | Notes |
|-----------------|-------------|-------|
| `FORCE ROW LEVEL SECURITY` | Yes | Re-assert |
| `GRANT SELECT TO authenticated` | Yes | Additive; does **not** revoke leftover DML |
| `CREATE POLICY …` (no `IF NOT EXISTS`) | **No** | Second apply errors `already exists` |
| Table/policy `COMMENT` | Yes | |
| Exact-posture `DO` guard | Fails closed on leftover `#32` policies **or** leftover DML grants | This is why `#59` must run first on greenfield |
| DML / backfill | None | |

`GRANT SELECT` does not strip `INSERT/UPDATE/DELETE` if they still exist.
Only `#59`’s `REVOKE ALL` produces the SELECT-only grant set the `#69`
guard requires. That is independent evidence that **skip-`00014` +
apply-`00041` cannot succeed**.

### 8.3 Transaction assumption

`scripts/db-apply.mjs` sends **each file as one `client.query(sql)`**.
A `RAISE EXCEPTION` in the file’s `DO` block should abort that file’s
statements together. A runner that splits statements could leave
`CREATE POLICY` applied and then fail the guard — not the restore-prep
runner.

### 8.4 Operations that cannot be safely reversed in-place

- 71-file apply is not one transaction (restore-prep §7).
- `#59` rollback restores banned helper policies (`get_my_school_id`,
  `is_school_admin`, `is_super_admin`) — outside the dual-posture model.
- `#69` rollback restores `#59` zero-policy (driver surface dead again).
- Failed partial apply: recreate staging project (restore-prep recovery).

---

## 9. Filename order versus proposed baseline

Restore-prep §10: apply all 71 names in lexicographic order **if** the
transport pair is approved; or the other 69 if the pair is held.

**Finding:** for a Git-complete empty-staging restore, filename order is
the **correct** sequence for this pair. `#59` then `#69` is required by
SQL, not merely by convention.

**Runner constraint (new evidence for the open restore question):**

| Runner | Empty-staging behavior for this pair |
|--------|--------------------------------------|
| `scripts/db-apply.mjs` | Applies **every** `*.sql` in filename order, including both files. **Correct** for Option A |
| `scripts/apply-canonical-hardening.mjs` | Unconditionally `SKIP`s `00014` because `supersededBy` is set, then would attempt `00041`. On empty staging after `#32`, `00041` **fails** its guard. This script is a **re-apply marshal** for a previously hardened canonical project, **not** the 71-file restore tool. Default `projectRef` in the script is the production project id string in Git — do not use it for staging |

---

## 10. Comparison of Options A, B, and C

Context: empty staging restore whose **declared Git target** is
`origin/master` @ `d195ba8` (restore-prep recommendation). Staging
emptiness is **not re-verified** here.

### OPTION A — Apply both in canonical order

**Supporting evidence**

- Both files are members of the 71-file canonical tree.
- `#69` header, T-D report, marshal `supersededBy`, posture JSON
  `normalizedBy` / `policyBackedBy`, and `#69` `DO` guard all encode
  “`00014` then `00041`”.
- Unit tests at HEAD pin that sequence (83/83 passed, file-only).
- Filename order already places `#59` before `#69`.
- No later migration conflicts.
- V2 in the `#59` filename is a naming artifact on a V1 Scholar table
  (restore-prep §17; AGENTS.md §45 is not un-frozen).
- Checksums of both files match the in-repo apply-record **file**
  checksums (byte identity only).

**Risks**

- After both, parent tracking, admin fleet DML, and driver GPS/status
  **writes** deny at the data plane. That is T-D’s stated remaining work,
  not an accidental restore defect. Staging Scholar UI for those surfaces
  will not match the `#32` “working bus console” era.
- `#69` is not idempotent. Apply once.
- Using the hardening marshal instead of `db-apply` will skip `#59` and
  fail `#69`.
- Identity-scoped policy is a recorded deviation from J-005 tenant
  equality. Cross-campus visibility is gated by assignment data integrity.
- H3-040 markdown still says “zero-policy CONFIRMED for V1”; tests and
  posture JSON supersede that for `transport_buses`. Stale adjudication
  doc is a hygiene issue, not a SQL blocker.

**Missing dependencies:** none in Git for a filename-order 71-file apply
that already includes `#18` and `#32`.

**Expected staging schema impact (empty project, after `#18`–`#69`):**
table exists; RLS on and forced; exactly one policy
`transport_buses_select_driver_assigned`; authenticated SELECT-only;
service_role ALL; trigger and realtime publication from `#18`/`#20`
unchanged.

**Runtime compatibility:** driver **read** restored; driver **write**,
parent read, admin DML remain denied; service-role provision works.

**Reversibility:** `#69` rollback → `#59` posture; `#59` rollback → `#32`
banned-helper policies (separate security approval). Practical recovery
for a bad staging apply remains recreate-project.

**Additional approval required:** the restore-prep’s written
authorization to **mutate staging** (restore-prep §15 item 6) still
applies to the whole 71-file apply. This pair does **not** need a further
architecture un-freeze: it is V1 Scholar RLS already on `origin/master`.

### OPTION B — Skip both

**Supporting evidence**

- Leaves `#32` policies: parent SELECT, driver UPDATE, admin INSERT/DELETE
  remain expressible. Closer to a “working Scholar transport console.”
- Avoids the V2 filename optics and the identity-scoped J-005 deviation.

**Risks**

- Staging **does not match** `d195ba8` Git HEAD authorization for this
  table.
- Re-introduces J-005/J-006-banned helpers (`get_my_school_id`,
  `is_school_admin`, `is_super_admin`) as the live policy layer — the
  finding H2-03 removed.
- Current posture JSON, battery expectations, marshal, and T-D tests
  expect `#69`, not `#32`.
- Campus-wide SELECT (`buses_school_read`) is broader than assigned-driver
  SELECT.

**Missing dependencies:** none for the table to exist. Missing relative to
Git HEAD: both files’ authorization state.

**Expected staging schema impact:** `#32` four-policy posture, authenticated
DML grants from `#18` minus TRUNCATE/TRIGGER/REFERENCES.

**Runtime compatibility:** admin/parent/driver write paths can function as
in the 2026-09-04 era; Git HEAD tests/e2e skip text naming `#69` would be
wrong for that database.

**Reversibility:** later applying the pair is still possible (same as A).
Skipping is easy to reverse; applying banned-helper policies into a
security-oracle staging is the harder cleanup.

**Additional approval required:** explicit acceptance that staging will
**not** match the 71-file Git tree, plus acceptance of banned-helper
policies on a table the battery now declares policy-backed.

### OPTION C — Hold both pending more evidence or an ADR

**Supporting evidence**

- Restore-prep status was **B** specifically because this pair was
  unresolved.
- Live staging catalog was not rechecked (restore-prep item 2).
- Production catalog is forbidden and unknown.
- SQL headers vs apply-record “APPLIED” claims are contradictory Git
  text.
- H3-040 doc vs T-D posture JSON is an architecture-doc inconsistency.

**Risks**

- Holding the pair **is operationally identical to Option B** for
  `transport_buses` on a 69-file apply. The `#32` posture lands.
- Delays Git-complete restore without adding SQL information this
  repository can still provide.

**Missing dependencies:** a live staging re-catalog (out of this mission’s
safety rules); a production catalog (forbidden); an ADR only if the
operator rejects matching `d195ba8`.

**Expected staging schema impact:** same as B until a later decision.

**Runtime compatibility:** same as B.

**Reversibility:** highest. Cost is schedule, not schema.

**Additional approval required:** an ADR if the hold is because of V2
filename or J-005 deviation rather than missing Git evidence. This review
finds those issues **already recorded** in-tree and **not** blocking a
Git-complete apply.

---

## 11. Evidence-backed recommendation

**OPTION A** for the restore target the existing plan already recommended
(“match Git HEAD of the 71-file tree” / `origin/master` @ `d195ba8`).

The repository does **not** support skipping only one file:

- Skip `#59`, apply `#69` → `#69` `DO` block fails (policy count and
  grant set wrong).
- Apply `#59`, skip `#69` → zero-policy; driver read dead (R1); posture
  JSON and T-D tests expect the opposite.

The repository **does** support applying both in filename order on an
empty database that will also receive `#18` and `#32`.

Option B remains a **conscious product/security choice** (preserve 2026-09-04
client bus console; diverge from Git HEAD). It is not required by SQL
dependency evidence.

Option C is correct **only** if the restore target is changed from
“match `d195ba8`” to “match an unknown live catalog.” That target change
is outside this mission and still needs a human restore authorization.

**Version-target classification:** ACTIVE-V1 ONLY. No V2 device/IoT or V3
Reality Intelligence implementation. Inclusion of the V2-**named** file is
authorization-posture restore of a V1 Scholar table already present on
`origin/master`.

---

## 12. Remaining uncertainties

These do **not** reopen the pair’s SQL order. They remain restore-execution
hazards owned by later authorized missions:

1. **Live staging catalog** may have changed since Gate 4
   (`2026-10-14T18:34:55Z`). Recheck is restore-prep §15 item 2. Not done
   here.
2. **Production applied-subset** is unknown. Headers, apply-record JSON,
   and posture `status` contradict each other in Git. Matching production
   exactly is **not** this recommendation and **must not** be inferred
   from file existence.
3. **H3-040 markdown** still adjudicates zero-policy; tests treat that doc
   as historical and the posture JSON as current. No ADR was found that
   formally retires H3-040 for this table.
4. **Neutral membership row counts** cited in `#69` (zero live bindings on
   2026-10-03) were not re-measured. They affect whether a future J-005
   tenant-equality policy would work; they do not affect `#69`’s
   `auth.uid()` predicate.
5. **Application comments** in driver-portal still describe `#32` helper
   RLS. Runtime code filters `driver_id` in both eras.

---

## 13. Explicit confirmation

- No database was opened.
- No SQL was executed against any server.
- No migration was applied.
- Production and staging were unchanged.
- Neither reviewed file was edited, renamed, or reordered.
- The restoration plan file was not modified.
- Do not apply either migration as a consequence of this report.

---

## 14. Agent report

**Implemented:** independent, read-only dependency review of
`20261002000014` and `20261003000041` with an evidence-backed restore
recommendation (document only).

**Files changed:** `docs/security/rls-prep/SHERIVS-TRANSPORT-MIGRATION-REVIEW-001.md`

**Architecture impact:** none to running systems. Documents that the two
files are a **greenfield pair** and a **re-apply successor pair**, and that
those two facts must not be confused.

**Tests:** 83 file-pinning unit tests passed; offline
`apply-canonical-hardening.mjs --manifest` checksums matched. No database
tests. No apply.

**Security validation:** production and staging non-contact; no secrets
printed; recommendation refuses skip-one and refuses the hardening marshal
as empty-staging runner.

**Known risks:** post-pair client write/parent/admin denial is intentional
T-D remainder; `#69` non-idempotent; Git “applied” claims unverified live.

**Remaining work:** human written authorization to mutate staging; staging
catalog recheck; then a **separate** restore mission using filename-order
apply of the 71 files including this pair.

**Final status:** **A. DECISION SUPPORTED BY REPOSITORY EVIDENCE**

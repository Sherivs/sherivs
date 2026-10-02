# RUNBOOK — Canonical apply (serialized apply procedure: plan → execute → catalog verify → record)

Status: **OPERATIONAL** — documents the verified apply path used for the Stage-3
hardening wave (executed against the canonical project 2026-10-02), plus the
H2-06 rehearsal modes (`--manifest`, `--verify-only`) added to make the path
CI-portable.
Script: `scripts/apply-canonical-hardening.mjs`
Pattern exemplar: `scripts/apply-canonical-mr100.mjs` (checksummed-apply, cited in the
apply script header, lines 19–22)
Authority: AGENTS.md §28 (database law), §29 (observability), §38 (change management —
rollback plan mandatory), roadmap Stage 3 "Migration apply to canonical DB"
(`architecture/coregrid-mvp-architecture/COREGRID_V1_BUILD_ROADMAP.md`).

---

## 0. Who, what, where, why, under which policy (golden questions)

- WHO: the operator holding the campaign canonical lock (TEAM 3 held it for the
  hardening wave — declared-vs-applied record field `exclusiveAccess`,
  `scripts/apply-canonical-hardening.mjs:690`).
- WHAT: apply the Team-1 hardening migration wave to the canonical environment and
  record declared-vs-applied state truth (`scripts/apply-canonical-hardening.mjs:3–5`).
- WHERE: the canonical project (default ref in the script, `:76`), reached ONLY through
  the authorized Supabase Management API query channel (`:92`); no direct Postgres
  connection is opened, so no CA cert is needed and the TLS posture is untouched
  (`:24–27`).
- WHY: migrations are AUTHORED NOT APPLIED without authorization (roadmap "Rules of the
  road" rule 4); application without catalog verification is never claimed.
- POLICY: exclusive canonical access (apply mode only), idempotent-by-detection,
  "applied" only when declared objects verify in-catalog (`:39–45`).

## 1. Exclusive-access law (hard precondition for apply mode)

The canonical environment accepts ONE canonical operation at a time. The apply prints
the law at start (`scripts/apply-canonical-hardening.mjs:542`) and records it in the
posture record (`:690`); the header scopes it to apply mode (`:40–41`). The `--manifest`
and `--verify-only` modes never contact the database in a mutating way — manifest mode
contacts NO database at all (`:429–430`, `:440`), verify-only uses read-only catalog
probes (`:15–17`, `:463–465`) — so they are exempt, but an apply MUST be serialized.

Before running an apply, the operator MUST:

1. Confirm no other canonical operation is in flight (another apply, the restore drill
   `scripts/restore-recovery-drill.mjs`, the RLS battery's privileged seed path
   `scripts/verify-rls-isolation-battery.mjs:873–875`, or a foundation-loop exercise
   `scripts/exercise-foundation-loop.mjs`). Serialize on the campaign canonical lock.
2. Confirm the rollback directory is populated for every migration in the wave — a
   missing rollback file is a plan FINDING that BLOCKS the apply before any canonical
   contact (`:312–318`, `:549–553`; Constitution §38). Rollback files live in
   `database/supabase/rollbacks/<same filename as the migration>` (`:60`).

Never run the apply concurrently with any other script that writes to the project.

## 2. Modes, inputs, and usage (env var names only — values are never printed)

Three modes (`scripts/apply-canonical-hardening.mjs:7–17`, `:65–75`):

| Mode | Invocation | What it does | Needs token? |
| --- | --- | --- | --- |
| `apply` (default) | `node scripts/apply-canonical-hardening.mjs [project-ref]` | plan → probe → apply → verify → record | yes (`:87–90`) |
| `--manifest` | `node scripts/apply-canonical-hardening.mjs --manifest [project-ref]` | print the full apply plan (order, sha256 per file, rollback checksums, declared signature objects) WITHOUT touching any database | no (`:87`, `:428–461`) |
| `--verify-only` | `node scripts/apply-canonical-hardening.mjs --verify-only [project-ref]` | re-check the declared-vs-applied record against the live catalog (read-only probes, idempotent, nothing applied) | yes (`:87`, `:463–465`) |

The coordinator's serialized canonical apply runs **plan-then-execute**: `--manifest`
is the plan half (`:10–14`). Unknown flags or a second positional are rejected with
`BLOCKED_USAGE` and exit 2 (`:78–84`).

| Env var | Required | Role (cite) |
| --- | --- | --- |
| `SUPABASE_ACCESS_TOKEN` | yes for apply/verify-only | Management API bearer; read at `:86`; absence exits with code 2 before anything runs (`:87–90`) |
| `COREGRID_ARTIFACTS_DIR` | optional | artifacts directory override (defaults to `/opt/cursor/artifacts`) so CI runners can redirect evidence without touching the script (`:29–32`, `:62–63`) |
| argv[1] `project-ref` | optional | Overrides the default project ref (`:76`) |

The token is transported in the `Authorization` header only and is never printed
(`:24–25`, `:94–103`). No secret values belong in this runbook or in any commit.

## 3. Procedure — plan → execute → catalog verify → record

### 3.1 PLAN

Run the manifest mode first — it is the runbook's plan gate:

```
node scripts/apply-canonical-hardening.mjs --manifest
```

The plan builder binds every declared migration to its on-disk bytes (sha256), its
rollback bytes, and its declared signature objects, and never contacts the database; a
missing migration or rollback file is a plan FINDING — "the plan must be complete
before any apply may run" (`:292–297`). Manifest mode exits 0 `STATUS=MANIFEST_OK` or
1 `STATUS=MANIFEST_FINDINGS` ("the plan is incomplete; do not execute it") and writes
`<artifactsDir>/canonical-apply-hardening.manifest.json` (`:454–460`).

The migration list in dependency order is the array `MIGRATIONS`
(`scripts/apply-canonical-hardening.mjs:114–278`) — the single source of order. The
Stage-3 hardening wave is nine entries: eight Team-1 substrate migrations
`20261002000005`–`20261002000012` (declared tables + indexes, RLS enabled, REVOKE from
anon/authenticated — `:107–113`) plus the Stage-2 neutral-membership policy migration
`20261002000013` (nine declared policies across `cg_role_assignment`, `cg_role_grant`,
`cg_org_membership` — `:256–277`).

### 3.2 EXECUTE

```
SUPABASE_ACCESS_TOKEN=... node scripts/apply-canonical-hardening.mjs [project-ref]
```

The apply refuses to start when the plan is incomplete: "BLOCKED plan incomplete … fix
the plan before any canonical contact", exit 1 (`:549–553`). Per-migration behavior
during the run loop (`:561–601`):

| Catalog pre-flight state | Script action | Cite |
| --- | --- | --- |
| all declared objects present | `ALREADY_APPLIED` — skipped, never re-executed | `:572–575` |
| none present | apply, record checksum + elapsed time | `:576–583` |
| apply SQL errors | `APPLY_FAILED`, **stop at first failure** — dependency order, never skip ahead | `:584–591` |
| some present, some missing | `MIXED_PARTIALLY_APPLIED` — FINDING, **stop**; partial state needs a human decision, never a silent re-run | `:592–600` |

### 3.3 CATALOG VERIFY

The script re-probes the catalog post-apply (`:603–626`) and upgrades each entry to
`APPLIED_AND_VERIFIED` only when every declared object is found (`:619–621`); any
missing object is a FINDING (`:622–626`). It then proves the security posture
(`:629–682`):

- Stage-1 substrate tables: `relrowsecurity = true` AND **zero** policies
  (deny-by-default carried into canonical; `:34–37`, `:664`).
- Stage-2 policy-backed tables (`cg_role_assignment`, `cg_role_grant` on `tenant_ref`;
  `cg_org_membership` on `tenant_id` — `:632–636`): RLS enabled AND RLS **forced** AND
  exactly the three declared neutral-primitive policies per table (`:657–664`).

Every posture row prints `PASS` or `FINDING` (`:666–669`); a bad posture increments
findings (`:665`).

The verify-only mode repeats this catalog re-verification independently of an apply:
it checks the declared-vs-applied record exists and is readable (`:471–483`), re-probes
the catalog read-only (`:485–491`), and detects checksum drift between the on-disk
migration bytes and the recorded checksums (`:496–504`) — exit 0
`STATUS=VERIFY_PASS` or 1 `STATUS=VERIFY_FINDINGS` (`:534–540`). Use it after any
suspected drift (repo moves, rebase, incident) before trusting the record.

### 3.4 RECORD

The run writes the declared-vs-applied posture record to BOTH
`architecture/proofs/CANONICAL_APPLY_RECORD_HARDENING.json` (in-repo evidence —
always at this path, `:31–32`, `:711`) and `<artifactsDir>/canonical-apply-hardening.json`
+ `.log` (`:712–713`; default `/opt/cursor/artifacts` per `:62–63`). The record
contains project ref, transport, exclusive-access declaration, per-migration
state/checksums/rollback checksums, RLS posture, verification, and the finding count
(`:684–707`). Artifact writes degrade to a WARN, never silently lose the in-repo
record or crash the run (`:357–372`). Keep the in-repo record — it is the evidence
artifact; per AGENTS §29 the log must never contain secret values, and the script
writes none.

## 4. Exit codes and operator interpretation

| Code | Meaning | Operator action | Cite |
| --- | --- | --- | --- |
| `0` | applied (or already applied) and catalog-verified / manifest clean / verify-only pass | record + evidence archived; proceed to the RLS battery runbook | `:51`, `:459–460`, `:539–540`, `:720` |
| `1` | FINDING (incomplete plan, missing rollback file, MIXED state, apply failure, failed post-apply verification, bad RLS posture, failed catalog probe, unreadable/missing record, checksum drift) | do NOT re-run blindly; diagnose from the record/log; MIXED and APPLY_FAILED need human decisions | `:316–318`, `:476–483`, `:550–552`, `:584–591`, `:622–626`, `:717–719` |
| `2` | `BLOCKED_NO_CREDENTIAL` (token unset) or `BLOCKED_USAGE` (unknown flag / extra positional); nothing applied | provision the credential via the approved secrets channel, or fix the invocation, then re-run | `:78–90` |

## 5. Rollback pointers

- Every migration entry carries a `rollbackChecksum` — the sha256 of
  `database/supabase/rollbacks/<migration file>` (`:312–314`, `:697`). A missing
  rollback file is a plan FINDING that blocks the apply (`:315–318`, `:550–552`).
- Rollback execution is MANUAL and serialized: run the rollback SQL through the same
  Management API query channel, then re-run the apply script — an `ALREADY_APPLIED`
  entry whose objects were dropped will present as "none present" and be re-applied
  (`:576`), and the post-apply probe re-verifies (`:603–626`).
- Never roll back the Stage-2 policy tables (`cg_role_assignment`, `cg_role_grant`,
  `cg_org_membership`) without re-running the RLS battery afterwards — dropping their
  policies reopens the tenant boundary (see `docs/runbooks/rls-battery.md`).
- For a partially applied wave, prefer the recorded rollback of the failed migration
  over forward-fixing; MIXED state is resolved by human decision per the honesty rule
  (`:592–597`).
- If migration files may have changed since the last apply (rebase, incident, repo
  move), run `--verify-only` first: it reports on-disk-vs-recorded checksum drift as a
  FINDING (`:496–504`) instead of letting the apply silently use different bytes.

## 6. Post-apply obligations

1. Run the RLS isolation battery against the same project
   (`docs/runbooks/rls-battery.md`) — the apply only proves posture statically
   (`:34–37`: "the battery re-proves it live in Stage 3").
2. Update the posture record's mission line in
   `architecture/proofs/CANONICAL_APPLY_RECORD_HARDENING.json` only by re-running the
   script — never hand-edit evidence.
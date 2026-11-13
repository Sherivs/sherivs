# Sherivs Project Audit and Recommendation Register (2026-11-13)

Status: draft for owner review. Nothing in this document was applied to production, merged, deployed, or activated.

## 1. Scope and evidence limits

- Repo `Sherivs/sherivs`, canonical branch `master` at `1b4df35f`.
- Production Supabase project `nwrflbpbhyiqdptmlccm` (PG 17.6), read-only: advisor output and SELECT queries only.
- CI is blocked by an organisation billing hold, so every verification claim below is from local runs (scratch PG16 harnesses, unit tests, `npm run verify`). It has not been confirmed by CI.
- Production Vercel and runtime behaviour were not reviewed.
- No credentials, tokens or environment values were read or recorded.

## 2. Correction to an earlier claim

An earlier regex-based scan suggested about 190 tables lacked row level security. That was wrong. A direct production query shows 379 of 379 public tables have RLS enabled and forced. Disregard the earlier figure.

## 3. Work delivered as draft PRs in this audit

| PR | Mission | What it does | Evidence |
|----|---------|--------------|----------|
| #354 | UI-UX | Shell and internal console upgrade: environment bar, auth landmark and touch targets, small-text sizes | 7 static tests, before/after screenshots in `docs/screenshots/ui-upgrade/` |
| #355 | SEC-02 | Revokes write and anon access on 3 views, pins `search_path` on 11 trigger functions, revokes execute on one audit trigger function | Local SQL harness proves the defect before and the fix after, with mutation tests; 6 unit tests; rollback included |
| #356 | DEP-01 | `@sentry/tanstackstart-react` ^11.8.0 to ^11.12.0 | Production dependency audit findings 5 to 0 locally |

All three are drafts. #355 contains a migration that has not been applied anywhere except a local scratch cluster.

## 3a. Production advisor snapshot (read-only, 2026-11-13)

Security advisors:

- 1 ERROR: `security_definer_view` (addressed by SEC-02 where it concerns the fee and credential views).
- 11 WARN `function_search_path_mutable` (addressed by SEC-02).
- 15 WARN anon-executable SECURITY DEFINER functions and 356 WARN authenticated-executable ones (needs per-function review, see R-05).
- 1 WARN `auth_leaked_password_protection` disabled (dashboard setting, R-04).
- 87 INFO `rls_enabled_no_policy` (likely intentional deny-all service tables, to be confirmed, R-08).

Performance advisors:

- 345 INFO unindexed foreign keys. The largest groups are the `cg_*` ledger and fee tables (82 findings), `student_*` (29) and `platform_*` (21).
- 87 WARN `auth_rls_initplan` across 76 tables (policies call `auth.*` per row instead of `(select auth.*)`).
- 111 WARN `multiple_permissive_policies` across 31 tables, worst on `platform_complaints`, `school_ad_campaigns`, `schools` and `users`.
- 226 INFO unused indexes. These need a longer observation window before any drop, because the platform is young.
- 1 WARN duplicate index on `teacher_biometrics` (`idx_biometrics_user` and `idx_teacher_biometrics_user`).
- 1 INFO table without a primary key: `feature_flags`.

## 4. Prioritised recommendation register

Priority: P0 do before onboarding real tenants, P1 next, P2 planned. "Owner" means a decision or dashboard action only the owner can take.

| ID | Priority | Finding | Recommendation | Type |
|----|----------|---------|----------------|------|
| R-01 | P0 | The `master` ruleset requires 0 approvals and no status checks. | Require the verify workflow and at least one review; add CODEOWNERS for `database/`, `.github/`, `architecture/`. | Owner (GitHub settings) |
| R-02 | P0 | CI cannot run (billing hold). | Fix billing, then "Re-run all checks" on every open draft. No PR should be merged on local evidence alone. | Owner |
| R-03 | P0 | Migrations in drafts (#355 and earlier) are unapplied. | Apply only after review, in a staging branch first, forward-only with the matching rollback on hand. | Owner decision |
| R-04 | P0 | Leaked-password protection is disabled. | Enable it in Auth settings. No code change needed. | Owner (dashboard) |
| R-05 | P1 | 15 anon and 356 authenticated SECURITY DEFINER functions are executable. Many are likely intended RPCs. | Classify each as intended RPC, internal helper, or trigger. Revoke execute from anon on all but a short allow-list. Ship as one SEC-03 migration with a harness that checks the allow-list. | Build (PR) |
| R-06 | P1 | Default privileges on schema `public` grant anon and authenticated all rights on every new object. This is the root cause of the SEC-02 defects. | Decide whether to change `pg_default_acl` so new objects are private by default, with explicit grants per migration. | Owner decision, then build |
| R-07 | P1 | Production has 172 applied migrations; the repo has 168 files. `schools_audit_commercial_change()` exists in production but not in the repo. | Reconcile: export the missing definitions into a forward-only migration, then add a CI drift check. | Build (PR) |
| R-08 | P1 | 87 tables have RLS enabled with no policy. | Confirm each is an intentional deny-all service table and record that in an ADR; add explicit deny-all policies so the advisor goes quiet by design. | Build (PR) |
| R-09 | P1 | 87 `auth_rls_initplan` warnings. | Rewrite policies to `(select auth.uid())` form in a batched migration with a policy-equivalence test per table. Behaviour must not change. | Build (PR) |
| R-10 | P1 | 345 unindexed foreign keys, concentrated in the `cg_*` ledger tables. | Add covering indexes for the hot ledger and attendance tables first, using `CREATE INDEX CONCURRENTLY` outside a transaction. | Build (PR, staged) |
| R-11 | P1 | 111 multiple permissive policies. | Merge overlapping permissive policies per table and role, after R-09. | Build (PR) |
| R-12 | P2 | `teacher_biometrics` duplicate index; `feature_flags` has no primary key. | Drop one duplicate index; add a primary key after checking for duplicate rows. | Build (PR) |
| R-13 | P2 | 226 unused indexes. | Re-check after 30 days of real traffic. Do not drop now. | Observe |
| R-14 | P1 | 100 branches, many stalled. | Run the M0.1 per-branch disposition (#348), then close or archive. | Build (docs) and Owner |
| R-15 | P1 | 13 moderate dev-dependency advisories remain. | Handle in a separate dev-dependency bump after CI works; they do not ship to users. | Build (PR) |
| R-16 | P1 | Sentry bump (#356) not yet proven at runtime. | Confirm in a preview deployment that error capture still works once billing is restored. | Owner and Verify |
| R-17 | P1 | Neutrality guard baselines for M10, M11, M14, COMMS-03 and others are pending. | Decide baseline additions per mission; prefer rephrasing over extending the baseline. | Owner decision |
| R-18 | P2 | No production Vercel or runtime review was done. | Review deployment protection, environment separation, runtime logs and error rates. | Verify |
| R-19 | P2 | Remaining missions have no PRs: B-2 to B-5, JARVIS-02 to 06, TWIN-02 to 06, REALITY R3 and R9. | Build as stacked draft PRs once their prerequisite drafts (#310, #321, #320, #336) are reviewed; reading each issue first for reserved migration range and ADR number. | Build |

## 5. What this audit did not do

- It did not apply any migration or change any production setting.
- It did not review Vercel production deployments or runtime logs.
- It did not complete the M0.1 deliverables: per-branch disposition, workflow security review, architecture-versus-implementation report, M0.2 proposal and executive report.
- It did not change financial policy or activate SMS or voice.

## 6. Owner decisions needed

1. Fix the billing hold and re-run checks.
2. Approve (or not) applying SEC-02 and earlier migrations, staging first.
3. Decide the default-privileges policy (R-06).
4. Decide the M11 migration number (013xxx range versus 014500).
5. Decide neutrality baseline additions (R-17).
6. Decide the fate of #6 and #5 (Cursor, older base).
7. Enable leaked-password protection (R-04).

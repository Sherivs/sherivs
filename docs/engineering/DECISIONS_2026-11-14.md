# Owner decisions: recommended options and what was built (2026-11-14)

Status: proposal. Nothing here is merged, applied or changed in production. CI is blocked by the organization billing hold, so every check below ran locally.

This closes the loop on the decision items in `MERGE_PLAN_2026-11-14.md` section 3. For each one it gives my recommended option, why, what it costs, the alternative, and, where it could be built safely as a draft, the PR.

## 1. Built as draft PRs

| Finding    | PR   | What it is                                                                                                                                                                                                               | Applied? |
| ---------- | ---- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | -------- |
| R-12       | #374 | Surrogate primary key on `feature_flags` (keeps the `(key, org)` uniqueness index) and drop of one provably identical `teacher_biometrics` index. Migration `20261105000200` with rollback, local harness, ADR-073.      | No       |
| R-20, R-21 | #375 | `reality.*` profile keys can only be written by a service-role function that re-checks the administrator and does an atomic compare-and-set. Migration `20261105000300`, server change, harness, ADR-074. Stacked on R9. | No       |
| R-23       | #376 | Seven-question early-childhood pack for creche, no migration, ADR-075. Stacked on #375.                                                                                                                                  | n/a      |
| R-06       | #377 | Proposal (outside the migrations directory) making new public tables and sequences private by default, with rollback, harness, ADR-076.                                                                                  | No       |

## 2. Checked: does M14 (#353) depend on M06 (#313)?

No functional dependency. M14 references only `attendance`, `students`, `schools`, `scholar_can`, `can_manage_roles` and `get_my_school_id`; none is created by M06. The M14 harness passes on a database built from `master` plus M14 alone (`M14 ALL PASS`). M14's text mentions the results workflow only as a future producer of metrics.

There is a textual conflict, not a dependency: both PRs edit `NEUTRALITY_GUARD_BASELINE.json` and `architecture/adr/INDEX.md`, and a trial merge conflicts in both files. See section 4.

## 3. Decisions, with a recommendation each

### R-06 default privileges (decide before #319 and #355)

- **Recommend:** adopt private-by-default for new tables, views and sequences, applied **last** (after every pending migration), staging first. See #377.
- **Why:** a miss today ships an open object; after the change a miss fails loudly.
- **Cost:** every future migration must grant explicitly. Functions are not covered (PUBLIC keeps execute); `supabase_admin`-created objects are not covered.
- **Alternative:** keep the default and rely on per-migration revokes plus a CI check that every new table has an explicit grant or revoke.
- **Companion not built:** that CI check.

### R-17 neutrality baseline

- **Finding:** 11 open PRs edit the baseline file (#353, #352, #351, #350, #349, #320, #318, #315, #313, #310, #308), so they will conflict with each other on merge day.
- **Recommend:** keep the rule that the baseline is shrink-only in spirit. Approve additions per PR at review, not in bulk. Prefer rephrasing when the hit is a comment. Accept an addition only when it is structural vocabulary in a migration over existing school-keyed tables (the COMMS-02 and COMMS-03 precedent).
- **Merge mechanics:** resolve a baseline conflict by taking the union of `baselineEntries`, then run `node scripts/verify-domain-neutrality.mjs`; the guard is the check. Merge baseline-touching PRs one after another and rebase the next each time.
- **Not done:** I did not rephrase those PRs or edit the baseline.

### R-22 website catalog extension (design only; not built)

Grounded in `frontend/src/lib/website/generator.ts`: the campuses block renders from real campus records (`data.campuses`), and bands come from `onboarding.institution.bands`.

- **Recommend 1:** keep `campus_count` unpublished. The campus records are the source of truth and a typed number could contradict them.
- **Recommend 2:** add one text-only "facts list" block to the catalog (label and value pairs, sanitized by the existing validator) for senior streams, external examinations and early-childhood groups. Code only, no migration.
- **Recommend 3:** for updating an existing site, mark generated sections with a source hash and update only sections the administrator has not edited. Until then R9 stays create-only.
- **Cost:** a catalog and validator change in #135's area, which needs a design review. I did not verify every generator and validator constraint; this is a recommendation, not a spec.

### Unapplied migrations

- **Recommend:** staging first, in the merge-plan order, one group at a time, with each group's harness run on staging. Apply SEC-02 and the other P0/P1 security items before feature migrations. Apply the R-06 proposal last.
- **Before anything runs against production:** reconcile migration history. Production recorded FIN-01 and ENT-01 as `20261113082810` and `20261113082843` while the repo files are `20261104050000` and `20261104051000`, and production has more applied migrations than the repo has files (R-07). Do not re-apply those two.
- **New since the plan:** `20261105000200` (#374) and `20261105000300` (#375). Neither shares a version with another PR.

### PRs #5 and #6 (Cursor drafts)

- **#5** (open, base `coregrid-scholar-migration`): its head branch is already fully contained in `master` (0 commits ahead, 405 behind). **Recommend closing it** as superseded, after you confirm. I have not closed it.
- **#6** (draft, same base): 2 commits are not in `master` (Sherivs Experience Architecture, brand cleanup), 423 commits behind, 138 files. **Recommend not merging it**. If the brand refoundation is still wanted, port it as small slices from current `master`. Closing is your call.

### Dependabot

- Five open PRs: #182 actions, #255 dev-tooling, #256 expo, #338 mobile supabase-js, #342 runtime-minor (48 updates).
- **Recommend:** merge none until CI runs. Then, in order: #182, #255, #338, #342 (split it if anything fails), then #256 together with `npx expo install --fix` as the Dependabot config itself says.
- Dependabot alerts are disabled for the repository (the API says so). **Recommend enabling alerts and security updates** (owner setting). The 13 moderate dev-dependency advisories (R-15) belong in the first bump after CI works.

### R-04 leaked-password protection

- Owner action in the Auth settings dashboard. I did not change it.

## 4. Merge-day hazards found while checking

1. `NEUTRALITY_GUARD_BASELINE.json` is edited by 11 PRs (section 3).
2. `architecture/adr/INDEX.md` is edited by almost every ADR PR and prettier re-pads the whole table, so expect a conflict each time. Resolve by keeping all rows, then run prettier on the file.
3. M14 (#353) and M06 (#313) conflict textually on those two files (section 2).
4. The stack R1, R3, R9, R20, R23 must merge in that order and each next PR be retargeted to `master` after its parent merges.

## 5. What this document does not claim

- No PR here passes CI; none was run.
- The two new migrations were replayed on PostgreSQL 16, not the PostgreSQL 17 job that is the authority.
- #375 was not tested with two genuinely concurrent sessions.
- The R-22 and Dependabot ordering are recommendations, not verified plans.

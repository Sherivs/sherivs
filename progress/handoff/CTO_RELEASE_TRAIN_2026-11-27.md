# CTO release train — 14 drafts proven together (2026-11-27/28); 5 more added 28 Nov (section 8)

Status: NOTHING here is applied to any hosted database. Every claim below was produced on a disposable local PG16 chain DB built from the merged tree. Evidence line = the command and its result.

## 1. What was proven (one merged tree, one chain DB) - updated 2026-11-28

- Trial-merged all 14 draft branches in order onto origin/master (1cf981ef). Only registry files conflicted (verify.yml, adr/INDEX.md, the neutrality baseline). Registry conflicts keep both sides; baseline conflicts are resolved by `tools/merge-neutrality-baseline.py <merge-base> <branch>` (adds only that branch's new entries and counter deltas, keeps formatting). Merged tree: verify.yml parses, baseline JSON parses, neutrality guard reports 0 new violations.
- 235/235 migrations apply in order (...000100 CS-01 to ...000900 cash path).
- ALL 46 harnesses registered in verify.yml pass on the merged tree. Guarded ones were run on the database names their own guards require: sim_chain (comms-03, ent-01, fin-01, whatsapp-fix), engine_chain with coregrid.test_disposable_database=on (engine01-03), coregrid_twin_test (sv1-twin-personal). New harnesses: cs01, sup01 48, grp01 44, m2b 14, m9b 20, m4 7, wf07 103, wf12 quotas 219, cash path 20.
- Rollbacks: the eight rollback files (000800 to 000100) round-trip cleanly on the chain DB; the cash-path rollback is proven separately (harness fails without the migration, passes after re-apply).
- Unit: ain06a (8), ain07 (5), model-router (8) pass on the merged tree.

## 2. Defects found only by combining (and fixed)

1. GRP-01 `wf_group_event_scan` is executable by service_role but was not on the WF-12 allowlist → wf12-default-privileges failed. Fixed on claude/grp01 (6018ef1d).
2. GRP-01 registers 3 event sources (schedule.weekly, schedule.month_end, group.kpi_below_threshold); WF-05 asserted exactly 7 sources. Fixed in the same commit.
3. PR #523 (CS-01) was conflicting with master in NEUTRALITY_GUARD_BASELINE.json. Rebased onto current master; its 2 baseline entries (5 hits) re-added textually. Force-pushed to claude/class-scope-approvals (only my own branch).
   Individually these PRs were green; together they were not. That is the argument for always running the combined chain before any merge.

## 3. Gate: neutrality guard (resolved with founder approval, 2026-11-28)

The ratchet is shrink-only, so each mission's unavoidable hits were baselined on its own branch, tagged with its mission id and a removal condition, after the 3 comment-only hits were reworded: M9B 1 hit, WF-07 3 (school_id on the legacy notifications table), M4 9 (role-name literals carried from the function it replaces), cash path 21 (legacy table vocabulary it still writes). Merged tree: 0 new violations.

## 4. Merge order (when you approve)

1. #525 docs. 2. #523 CS-01 (rebased) + baseline. 3. #526 A3 then #527 A4. 4. #528 SUP-01. 5. #529 GRP-01 (fixed). 6. #532 M2b resolver. 7. #533 M9B refund. 8. #539 M9B cash path. 9. #534 AIN-01 deferral. 10. #535 WF-07. 11. #537 M4. 12. #530 AIN-06/07, #531 router, #536 design note, #538 this memo (no DB).
   Rule: merge one, let CI go green on master, then the next. Never merge two migrations in one push. After each merge the next PR's baseline/INDEX/verify.yml may conflict: update that branch with master and run tools/merge-neutrality-baseline.py rather than editing the JSON by hand.

## 5. Hosted-DB apply plan (not executed — needs your yes per step)

Before step 1: point-in-time backup + restore proof on a throwaway project; record the migration ledger order. Apply 000100…000800 in timestamp order, one at a time, running the matching harness against a restored copy first. Rollback files exist for all eight and are proven.
Cron needed (Tumi): wf_approval_notify_scan (WF-07), wf_group_event_scan (GRP-01). Both are service_role only.

## 6. Risk register

| Risk                                             | Why                                                | Mitigation                                                                                                     |
| ------------------------------------------------ | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Who-can-do-what changes (#523, #528, #532, #537) | They alter permission resolution                   | Preview deploy + full scenario run before launch; Vercel Hobby commit-author setting currently blocks previews |
| #533 cash path                                   | Legacy record_cash_payment bypasses the M07 ledger | Founder decision: redirect it (recommended yes)                                                                |
| M2b override kinds                               | Only some kinds applied; no TS cache               | Marked in the mission note; do not announce as complete                                                        |
| No browser verification of A3/A4                 | No working preview                                 | Fix Vercel setting, then browser-agent run                                                                     |
| Messaging                                        | Held until Tumi resets                             | Nothing in this train sends messages                                                                           |

## 7. What still needs a person

Tumi: review each migration; backup and restore proof; cron entries; confirm ng.cashier is assigned at campus scope wherever cash is taken (the ledger checks campus authority separately); per-provider data-class clearance; which BulkSMS company.
Founder: Vercel Hobby commit-author setting; decisions on #508-#511 and #495; Track B/C blueprint (or leave to Tumi on Monday).
Decided 2026-11-28: baseline extended; cash path redirected into the ledger (#539).

## 8. Added on 28 Nov after that proof (NOT covered by section 1)

Five more drafts exist. Each was proven on its own chain, not yet together with the 14 above. Do not read section 1 as covering them. (#539, the cash path, is already inside the 14.)

| PR                                                                                                                                                                                                                                      | What                                                               | Base   | Own evidence                                              | Needs                                                                                                              |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ | ------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| #540                                                                                                                                                                                                                                    | M9B relief reversal (ADR-157)                                      | master | harness in its branch                                     | Founder decision on existing data with revoked-and-posted relief                                                   |
| #541                                                                                                                                                                                                                                    | WF-07b approval resume (ADR-158)                                   | master | WF07R 18 checks, 3 unit tests                             | #535 in place; decision on hosted approved approval steps                                                          |
| #542                                                                                                                                                                                                                                    | M2b override kinds (ADR-159)                                       | #532   | M2K 46 checks; all 12 guarded harnesses pass on its chain | #532 first; Tumi review; decision on hosted approved overrides of the six kinds and on level/section scope ranking |
| #543                                                                                                                                                                                                                                    | WF-15b3 group workflows (ADR-160)                                  | master | 9 new unit tests, 54 WF-15 tests                          | #529 applied before the templates can be installed                                                                 |
| #544                                                                                                                                                                                                                                    | M2c override screens, client functions, permission cache (ADR-161) | #542   | M2C 19 checks, 27 unit tests; rollback proven             | #542 first; Tumi review (changes who can change access)                                                            |
| Merge order additions: #542 right after #532, then #544; #540 after #539; #541 after #535; #543 after #529. Still one migration per push.                                                                                               |
| Found while building: the m009-a1 harness used a role that no longer exists (fixed in #542); the guarded harnesses (b1, b5, engine, comms, fin, ent) also run through tools/run-guarded-harnesses.sh (in #542).                         |
| New decisions: relief already revoked-and-posted (#540); hosted approved approval steps (#541); hosted approved overrides (#542); which counts a group may see, so `org_metric` can hold rows (#543); who may propose overrides (#544). |
| Combined proof, 28 Nov: all 19 branches merged (registry conflicts only, baselines merged), chain built 239/239 on local PG16. 45 plain harnesses, 12/12 guarded, WF-08 (131), WF-12 (219), WF-12 privileges (53), AIN-01..05 privilege steps, WhatsApp fix (11), SV1 R3 and R20, rollback round-trip of the 13 new migrations, and 21 unit tests pass. One defect found and fixed: the CI privileges step re-applied WF-12 after the AIN-01 budget deferral and restored the older function, so WF-12 failed with ain01:budget_daily_actions. Fixed in #534 (commit 2bb11175). Nothing applied to a hosted DB. |

## 9. Small items built after the combined proof (28 Nov)

Each proven alone on the 239-migration chain, not yet merged into the combined chain. One migration per push still applies.

| PR   | What                                                                 | Evidence                                              |
| ---- | -------------------------------------------------------------------- | ----------------------------------------------------- |
| #545 | M1c: unit-tree cycle guard (cycles of any length, depth over 32)     | M1C ALL PASS: 13 checks; rollback round-trip          |
| #546 | M9B: read-only open invoices for a student, for the cash picker      | M9D ALL PASS: 15 checks; rollback round-trip          |

- Migration order: 20261128000500 (#545), 20261128000600 (#546), after 20261128000400 (#544).
- #545 does not check loops already in production data; run a read-only ancestry check before applying.
- #546: the cash function still cannot take the picked invoice. That needs a signature change on top of #539 (decision needed).
- M4 live shell: no frontend change is needed. The shell already reads `workspace_manifest`; custom role widgets arrive through the migration in #537. What is unproven is a browser check against a hosted database.
- AIN agent evidence per organisation: NOT built. Evidence is stored per agent, not per organisation (`wf_autonomy_evidence` has no `org_id`), and promotion applies it per organisation. Changing that rewrites the ratified AIN-02 evidence rule (decision 3 of AIN-02, "one piece of evidence promotes once, per agent, within 30 days"). Decision needed: keep per agent, or make evidence organisation-scoped.

## 10. Money builds after section 9 (28 Nov)

Both proven alone on the 239-migration chain; not yet in the combined chain. Re-run the combined proof with #545 to #548 merged in.

| PR   | What                                                                                   | Evidence                                   |
| ---- | -------------------------------------------------------------------------------------- | ------------------------------------------ |
| #547 | PSA-01: accrue Sherivs's per-student term share, settle by split, cash wallet or agreed auto-debit; operator reports (ADR-162, migration 20261128000700) | PSA01 ALL PASS: 46 checks; rollback round-trip |
| #548 | M9B: post settled online payments into the M07 ledger via an online clearing account, parking queue, configured system actor (ADR-163, migration 20261128000800) | M9E ALL PASS: 22 checks; rollback round-trip |

- #539 (cash path) was changed after review of the levy relation: a levy cash payment is no longer applied to the tuition invoice (M9C now 22 checks).
- Merge order: #547 and #548 after #546. One migration per push.
- Decisions: cash path negative wallet bound; default grace days and debt limit; who may waive; cron cadence (PSA-01). Which user is the online-posting system actor; whether levies become M07 schedules and invoices; who clears the parked queue (#548).
- #548 is not wired to the webhook: call `cg_fee_post_online_payment` after `settlePaystackCharge` succeeds, best effort, only after apply and actor setup.

## 11. Combined proof with #545-#548 and the #539 fix (28 Nov)

Local disposable PG16 only; nothing applied to a hosted database. All branches merged in merge order into one tree (243 migrations).

| Check | Result |
|---|---|
| Plain harnesses | 49 pass (45 before + M1C, M9D, PSA01, M9E). The same 6 errors as in the earlier 19-branch proof remain (m13, sherivs-001/-002/-003/-006/-033); they are scratch-environment issues, not caused by this work. |
| Guarded harnesses | 12 of 12 pass |
| WF-08 / WF-12 / default privileges | 131 / 219 / 53 pass |
| Rollback round-trip (0800 > 0500, then re-apply 0500 > 0800) | 0 errors |
| Neutrality + provenance guards | PASS |

Two defects found by the combined run and fixed:
1. #539: a comment in the migration tripped the neutrality guard (reworded).
2. #547: FIN-01 R11b rejected `platform_share_settle_overdue` and `platform_share_collections` as wallet-touching functions open to `authenticated`. Both refuse non-operators in-function (proved by the PSA-01 harness), so the FIN-01 allowlist now names them. Reviewer: confirm that is the intended contract.

## 12. Builds after the combined proof (28 Nov, evening)

All draft, local proof only, nothing applied. Each is stacked, so it contains its parents until they merge.

| PR | What | Stacked on | Evidence |
|---|---|---|---|
| #549 PSA-01b | Read-only Sherivs operator screen over the PSA-01 reports (no migration) | #547 | view core 12 tests, dispatch 8, coverage 9; tsc only the pre-existing error; guards pass |
| #550 PSA-01c (W-028) | Bounds the school wallet on the cash path: cash is always recorded, the share is taken only within `debt_limit`, otherwise parked pending | #547 + #539 | WBND 12; M9C 22, PSA01 46, FIN-01 pass=37 still pass; rollback clean |
| #551 LEVY-M07 (W-029) | Bursar issues M07 invoices for a levy; levy cash posts to the levy invoice | #550 | LEVY 18; same regressions pass; rollback clean |

Review order for these: #539, #547, #548, #549, #550, #551.

New decisions for Tumi: (j) #550 never blocks cash and parks the share instead; confirm. (k) #551: students have no campus, so the bursar picks campus and scope per levy; invoice principal falls back to `student:<id>` without a parent id; the guardian model is not wired. (l) #548 does not yet use the levy link, so online levy payments still park as `levy_not_in_ledger`.

Not built yet: school-facing statement of what a school owes, cash-picker invoice argument and screen, inert webhook wiring, scan function for cron. The combined 243-migration proof in section 11 does not include #550 and #551; run it again with them before approving the stack.

## 13. Website reality alignment (#552)

Answer to the founder question: the builder followed only two interview answers and put generic rules, policies, privacy and safeguarding texts live without review. #552 fixes this: generated texts are pending until the school accepts or removes them, the database refuses to publish while any are pending, streams and examinations reach the site, and the preview reports where the site and the interview agree or disagree. Draft, not applied; WEBR 11 checks pass locally.

Needs a decision (Tumi or founder):
- (m) Registry disclosure: flipping boarding, faith, languages, leadership, facilities and registration questions to public-safe is a disclosure choice for the registry owner and needs a registry version bump.
- (n) New sites now go live without rules and policies until the school adds and accepts them. Confirm this is the wanted default.
- (o) The `policies` block can mix school-given and boilerplate text; the whole block is marked pending.
- (p) The admin builder host route is not mounted in the current tree, so the `website-review` screen is the only review path.
- (q) #552 is not in the combined 243-migration proof. Next ADR 165, next W-031.

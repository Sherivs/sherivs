# CTO release train — 13 open drafts, proven together (2026-11-27)

Status: NOTHING here is applied to any hosted database. Every claim below was produced on a disposable local PG16 chain DB built from the merged tree. Evidence line = the command and its result.

## 1. What was proven (one merged tree, one chain DB)
- Trial-merged all 13 draft branches in order onto origin/master (1cf981ef). Only registry files conflicted (verify.yml, adr/INDEX.md): resolved by keeping both sides; verify.yml parses.
- 234/234 migrations apply in order (…000100 CS-01 → …000800 M4).
- Every harness registered in verify.yml was run on that one DB. All eight new/changed harnesses pass: cs01, sup01 (48), grp01 (44), m2b (14), m9b (20), m4 (7), wf07 (103), wf12 quotas (219). Others that ran also pass (a2, a3, a5, ain01–05, wf01–08, wf12-priv, wf15a/a2, m06, m10–m14, db12, scheduling, sec02).
- Not run (they refuse any DB not named for them or not marked disposable; pre-existing guard, not a failure): comms-03, ent-01, fin-01, engine01–03, sv1-twin, whatsapp-fix. They need their own named scratch DBs.
- Rollbacks: all 8 rollback files run cleanly in reverse order (…000800 → …000100) on the same DB, then all 8 migrations re-apply cleanly forward (round trip proven).
- Unit: ain06a (8), ain07 (5), model-router (8) pass on the merged tree.

## 2. Defects found only by combining (and fixed)
1. GRP-01 `wf_group_event_scan` is executable by service_role but was not on the WF-12 allowlist → wf12-default-privileges failed. Fixed on claude/grp01 (6018ef1d).
2. GRP-01 registers 3 event sources (schedule.weekly, schedule.month_end, group.kpi_below_threshold); WF-05 asserted exactly 7 sources. Fixed in the same commit.
3. PR #523 (CS-01) was conflicting with master in NEUTRALITY_GUARD_BASELINE.json. Rebased onto current master; its 2 baseline entries (5 hits) re-added textually. Force-pushed to claude/class-scope-approvals (only my own branch).
Individually these PRs were green; together they were not. That is the argument for always running the combined chain before any merge.

## 3. Gate that blocks the release: neutrality guard
Merged tree reports 16 NEW hits (shrink-only ratchet, so CI will fail without a founder decision):
- M9B (#533): 1 — literal `'bursar'` in the cg_fee_authorize call.
- WF-07 (#535): 5 — `school_id` column on notifications (unavoidable, the table is legacy-shaped) + 2 comment words (student, guardian; rewordable).
- M4 (#537): 10 — role-name literals copied from the function it replaces (the same literals are baselined against the OLD file; new file = new hits) + 1 comment word.
Decision needed: extend the baseline for the 12 unavoidable hits (my recommendation: yes, with each hit tagged to its stream and a removal condition), and I reword the 3 comment-only hits first. CS-01's 5 hits are already in the rebased baseline.

## 4. Merge order (when you approve)
1. #525 docs.  2. #523 CS-01 (rebased) + baseline.  3. #526 A3 → #527 A4.  4. #528 SUP-01.  5. #529 GRP-01 (now fixed).  6. #532 M2b resolver.  7. #533 M9B.  8. #534 AIN-01 deferral.  9. #535 WF-07.  10. #537 M4.  11. #530 AIN-06/07, #531 router, #536 design note (no DB).
Rule: merge one, let CI go green on master, then the next. Never merge two migrations in one push.

## 5. Hosted-DB apply plan (not executed — needs your yes per step)
Before step 1: point-in-time backup + restore proof on a throwaway project; record the migration ledger order. Apply 000100…000800 in timestamp order, one at a time, running the matching harness against a restored copy first. Rollback files exist for all eight and are proven.
Cron needed (Tumi): wf_approval_notify_scan (WF-07), wf_group_event_scan (GRP-01). Both are service_role only.

## 6. Risk register
| Risk | Why | Mitigation |
|---|---|---|
| Who-can-do-what changes (#523, #528, #532, #537) | They alter permission resolution | Preview deploy + full scenario run before launch; Vercel Hobby commit-author setting currently blocks previews |
| #533 cash path | Legacy record_cash_payment bypasses the M07 ledger | Founder decision: redirect it (recommended yes) |
| M2b override kinds | Only some kinds applied; no TS cache | Marked in the mission note; do not announce as complete |
| No browser verification of A3/A4 | No working preview | Fix Vercel setting, then browser-agent run |
| Messaging | Held until Tumi resets | Nothing in this train sends messages |

## 7. What I still need from you (and nothing else)
1. Baseline decision for the 12 unavoidable hits (section 3).  2. Cash-path decision.  3. Vercel Hobby commit-author setting.  4. Per-provider data-class clearance and which BulkSMS company.  5. Decisions on #508–#511 and #495.

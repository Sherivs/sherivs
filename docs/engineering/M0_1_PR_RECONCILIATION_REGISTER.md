# M0.1 — Open PR reconciliation register and governance snapshot (partial deliverable)

Status: **DRAFT, partial.** Snapshot taken 2026-11-13 against `master` @ `1b4df35`. This covers M0.1 deliverable 3 (open PR reconciliation) and the evidence-backed part of deliverable 5 (GitHub governance). It does **not** complete M0.1: no per-branch disposition register, no workflow-by-workflow CI/CD review, no architecture-vs-implementation discrepancy report, no M0.2 proposal. Nothing was merged, closed, deleted or applied.

Method: GitHub REST (`pulls`, `rulesets`, `branches`, `contents`), plus a local merge of `master` into each branch and `npm run verify` per branch. GraphQL and the Actions API are not reachable from this environment.

## 1. Governance snapshot (evidence)

| Item | Observation |
| --- | --- |
| Default branch | `master`, public repository, not archived |
| Ruleset | One active ruleset, "Sherivs Master Branch Protection" (id 27044869, created 2026-11-11), target `~DEFAULT_BRANCH`, no bypass actors |
| Ruleset rules | `deletion`, `non_fast_forward`, `pull_request` (0 required approvals, stale reviews dismissed on push, thread resolution required, merge/squash/rebase all allowed) |
| Required status checks | **None in the ruleset.** CI is not a merge gate. |
| Classic branch protection | None (404). The ruleset is the only protection. |
| CODEOWNERS | **Absent** (`.github/CODEOWNERS`, `CODEOWNERS`) |
| Workflows | 12 in `.github/workflows` (verify, release, security-batteries, infrastructure-verify, infrastructure-plan-apply, prod-migrate-one, nightly-db-backup, drift-watch, prod-tls-chain-probe, three sv1-* root-tenant/WhatsApp workflows). Not reviewed in depth. |
| Branches | 100 (67 `copilot/`, 26 `cursor/`, 4 `chore/`, 3 others). No per-branch disposition done. |
| CI status | All checks currently fail in 2–4 s because of an org billing hold, not code. Recheck after billing is fixed. |

Recommended (not applied; changing settings is out of scope): add `verify` and `migrations-sim` as required status checks; require at least 1 approval for changes under `database/supabase/migrations/`; add CODEOWNERS for migrations, workflows and `architecture/`.

## 2. Open PR register (27 open)

Classification vocabulary from issue #347. "Verified" means: master merged in, `npm run verify` exit 0 and, where a migration exists, a SQL harness run on a disposable PG16 scratch DB (see the per-PR evidence comment). All Copilot/Cursor branches below were brought to date with `master` by a fast-forward push of a merge commit (no force-push).

| PR | Branch owner | Scope | Classification | Evidence / notes |
| --- | --- | --- | --- | --- |
| #351 COMMS-03 | Claude/owner | SMS dispatch financial integrity, plan gate, refund policy (33 files) | Ready for independent review; needs additional testing in CI | Migration not applied. SMS provider stays off. |
| #350 ENT-01 | Claude/owner | Platform-only subscription changes | Ready for independent review | Migration applied to prod earlier at owner's approval. |
| #349 FIN-01 | Claude/owner | Wallet metering restricted to server | Ready for independent review | Migration applied to prod earlier at owner's approval. |
| #346 INFRA-01 | Cursor | Gate Sentry/PostHog to staging; workflow and Dockerfile changes (37 files) | Needs additional testing; ready for review | Home bundle now 241.37 KiB of 250 KiB. Non-draft. Workflows not exercised. |
| #337 audit | Copilot | Engineering audit docs, webhook signature change | Ready for independent review | verify exit 0. |
| #336 REALITY R1 | Cursor/Copilot | Taxonomy and question registry, code only | Ready for independent review | Gates R3/R9 follow-ups. |
| #333 COMMS-04 | Owner | Resend email via communication fabric | Ready for independent review | 12 new tests pass. No credentials set. |
| #327 WA n8n | Copilot | n8n workflow `$env` fix | Ready for independent review | 3 files. |
| #324 SCHED S0/S1 | Copilot | Scheduling data model and solver, migration | Ready for review; migration needs owner decision | `SV1-SCHED RLS ALL PASS`. |
| #321 JARVIS-01 | Copilot | Governed agent registry and risk policy | Ready for independent review | Blocks JARVIS-02..06. |
| #320 TWIN-01 | Copilot | Identity-bound personal twins, migration | Ready for review; migration needs owner decision | `ALL PASS` on scratch DB. |
| #319 M07 views | Copilot | Revoke anon on fee views, migration | Ready for review | PG17-only `MAINTAIN` assertion not run locally. |
| #318 M12 | Copilot | Retention/deletion, migration | Ready for review | Dependency of M11 (#190). |
| #315 M10 | Copilot | ROPA/DPIA registers, migration, UI | Ready for review | Three conflicts resolved. |
| #313 M06 | Copilot | Assessment/results workflow | Ready for review | |
| #310 M009 | Copilot | Executive workspaces | Ready for review | |
| #308 CORE-19 | Copilot | Notification delivery, migration | Ready for review | Round-trip sim passed. |
| #348 M0.1 | Copilot | This mission | WIP, this document is the first deliverable | Branch was empty ("Initial plan"). |
| #342, #338, #256, #255, #182 | Dependabot | Dependency/action bumps | Not reviewed (intentionally untouched) | #342 spans 48 packages; review separately. |
| #171, #159 | Cursor | Security audit report doc; Cloud Agent dev notes | Not reviewed in this pass | Small doc PRs; no conflicts with master (#171 clean, #159 unstable only because CI is failing). |
| #6, #5 | Cursor | CoreGrid → Sherivs refoundation, base `coregrid-scholar-migration` | Possibly superseded; needs owner decision | Base is not `master`; #5 is 115 files, +14,924/−6,422. Do not close without owner review. |

### Overlaps and dependencies noticed
- `architecture/adr/INDEX.md` is a shared hot spot: at least six branches (#308, #315, #320, #321, #324, #336) conflicted on its intro paragraph and table rows when `master` was merged in. Recommendation: a single integration owner for ADR numbers, or generate the index.
- `NEUTRALITY_GUARD_BASELINE.json` is the second hot spot (conflicted in #308, #315, #320); merging requires recomputing `entryCount`, `totalObservedHits`, `hitsByFile`.
- ADR numbers in use across open PRs: 022 (#308), 029 (#320), 035 (#321), 046 (#315), 050 (#324), 051 (#336), plus master's 023/045/067/068. No collisions found at this snapshot.
- Stacking: M11 (#190) needs M12 (#318); M14 (#193) needs M05–M08; B-2..B-5 (#281–284) need B-1; JARVIS-02..06 need #321; TWIN-02..06 need #320; REALITY R3/R9 need #336. These issues have no PRs yet.

## 3. Not done in this pass

Per-branch disposition register (100 branches); workflow-by-workflow security review (including `prod-migrate-one.yml`, `infrastructure-plan-apply.yml` permissions); architecture-vs-implementation discrepancy report; issue dependency map beyond the list above; M0.2 proposal; executive report. M0.1 is therefore **not complete**.

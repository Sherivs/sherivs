# WF-15a: Private School Pack v1, First Three Templates

Authority: workflow hand-off roadmap (17 Nov 2026), item 11; standing written approval for the build cycle.
Origin: Claude Code agent, mission WF-15a
Creator: Claude Code agent
Created: 2026-11-26

Status: Draft implementation (PR stacked on AIN-05); NOT INSTALLED anywhere, nothing enabled. `WORKFLOWS_ENABLED` untouched. Nothing was sent.

| Field     | Value                                                                  |
| --------- | ---------------------------------------------------------------------- |
| Decision  | [ADR-130](../../architecture/adr/ADR-130_WF15A_PRIVATE_SCHOOL_PACK.md) |
| Migration | none                                                                   |
| Rollback  | delete the three `ps_*` version-1 rows from `wf_template` (in the ADR) |

## Step 1: could it be built now?

Yes, as proposed. Decision 1 (first three templates) is PROPOSED in the hand-off, not ratified; built as proposed. Decision 7
(minors) is not answered, so the absence alert is built but blocked from going live. Decision 2 (SMS/WhatsApp) is respected:
neither is used.

## Implemented

- `private-school-pack.ts`: three templates (fee ladder, payment receipt, absence alert) with trigger, steps, actors, autonomy
  per step, lawful basis, evaluation suite reference, version, changelog, shadow-by-default and `blockedUntil`.
- `validatePrivateSchoolPack()` and `validatePackTemplate()`: trigger is a WF-05 source, only that event's payload keys are
  bound, only email/in_app/task/wait, customer-visible steps are draft with a data class, minors need `decision-7`, shadow
  required, at least three eval cases, changelog entry present.
- `packTemplateToCatalogRow()` and `packInsertSql()` for install into `wf_template`.

## Evidence (26 Nov 2026; local PostgreSQL 16, CI-faithful build of every migration)

- Unit: `wf15a-private-school-pack.test.ts` (7 tests) and `wf15a-private-school-pack-sql.test.ts` (1 test, drift guard): pass.
- Harness `wf15a-pack-install.local.sql`: `WF15A ALL PASS: 16 checks`.
- Sim e2e `wf15a-pack-e2e.mjs`: `WF15A-E2E RESULT: templates=3 events=3 dispatched=3 runs=3 replay_events=0 replay_runs=0 executor_calls_positive=1 sent_live=0 dup=0`.
- verify.yml: two additions (harness step, e2e lines), disclosed here as the master prompt asks for CI wiring.

## Not verified (UNVERIFIED)

- The real action executor was not driven: the e2e uses a counting stub for `executeAction`. Drafts, the approval inbox and the
  sandbox outbox are covered by the WF-06 and WF-07 e2es, not re-proved for these three graphs.
- `sent_live=0` here means no messaging kind appears in the pack and no adapter is wired in this script; it is weaker than the
  WF-06 `sent_live` figure, which counts adapter calls.
- The absence alert's condition (`payload.status equals absent`) was not shown to end a run for a non-absent status.
- Evaluation suites are declared, not run. They need the AIN-04 runner on an installed template.
- The abstract approver role `workflow_approver` is not mapped to a real role in any tenant (decision 4).
- Message template bodies (`ps.fee.*`, `ps.payment.*`, `ps.absence.*`) are referenced but not written or approved; a school
  must author and approve them before anything can be drafted.
- Production install of the three rows is a separate founder-approved action; not done.

# ADR-130: Private School Pack v1, First Three Templates (WF-15a)

- Creator: Claude Code agent, mission WF-15a (provenance id W-015); AI-generated

| Field          | Value                                                                                                                             |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Status         | PROPOSED in the WF-15a PR; nothing applied to any hosted database, nothing enabled                                                |
| Date           | 2026-11-26                                                                                                                        |
| Creator        | Claude Code agent, mission WF-15a (issue spec in the PR); AI-generated                                                            |
| Version target | V1 organizational workflows, Phase 3 (first packs)                                                                                |
| Depends on     | ADR-104 (template catalogue), ADR-111 (event sources), ADR-147 (actions), ADR-122 (approval inbox), ADR-126 (autonomy)            |
| Migration      | None. The pack is data in the scholar runtime namespace; install is a separate, founder-approved service-role action.             |
| Rollback       | `DELETE FROM public.wf_template WHERE template_key IN ('ps_fee_ladder','ps_payment_receipt','ps_absence_alert') AND version = 1;` |

## Provenance

| Item                   | Source                                                                                                                                         |
| ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Requirement            | Workflow hand-off, roadmap item 11: "WF-15a Private School Pack templates and seeds (first 3 proposed: fee ladder, receipt, absence alert)"    |
| Open founder decisions | 1 (first three templates; PROPOSED, built as proposed), 2 (SMS and WhatsApp rates; not used), 4 (approvers; abstract role), 7 (minors; blocks) |

## Context

WF-02 seeded three generic catalogue rows. A pilot school needs real templates with a trigger, steps, who acts, autonomy,
lawful basis, an evaluation suite, a version and a changelog, all starting in shadow mode (hand-off section 6).

## Decision

1. The pack is TypeScript data plus a validator in `frontend/src/lib/runtime/scholar/workflow-packs/`. School vocabulary
   stays in the scholar namespace, so the domain-neutrality guard over universal files and migrations is untouched.
2. New template keys `ps_fee_ladder`, `ps_payment_receipt`, `ps_absence_alert`, version 1. The three WF-02 generic rows are
   left as they are. No migration, so nothing to apply or reverse beyond deleting rows.
3. Triggers are WF-05 sources (`fees.invoice_issued`, `payment.succeeded`, `attendance.marked_absent`). A template may bind
   only payload keys the event carries; the validator and the database harness both check this against `wf_event_source`.
4. Actions are `email`, `in_app`, `task` and `wait` only. No WhatsApp, SMS or webhook (decision 2 is open).
5. Every customer-visible step is declared `draft`. The engine already routes every draft to the approval inbox (WF-07); the
   pack declares it so an installer cannot widen it, and the validator rejects a template that does.
6. The absence alert touches a minor's data. Its lawful basis is `pending_decision_7` and it is `blockedUntil` decision 7:
   it can be installed in shadow but must not be turned live until counsel answers decision 7.
7. Approver is the abstract role `workflow_approver`, to be mapped to holders of `workflows.approve` (decision 4). Roles that
   hold `workflows.manage` cannot also approve (ADR-104), so a named role such as the head of institution is not used.
8. Every template carries an evaluation suite reference with at least three cases. The cases are declarations; running them
   needs the AIN-04 runner against an installed template and is not done here.

## Consequences

- Good: three installable, validated templates; nothing can leave without a person approving it; no domain words leak into
  universal files.
- Cost: the fee ladder cannot skip a paid invoice by itself, because the event payload has no payment status. The approver
  sees live status and skips a rung. A paid-check needs a richer event, which is a WF-05 follow-up.
- Cost: the recipient of a message is resolved by the broker from the event subject, which this pack does not exercise.

## Golden questions

- WHO acts: the engine drafts; a person approves; a bursar or class teacher takes the task.
- WHAT: three templates, shadow mode, draft autonomy.
- WHERE: scholar runtime namespace; catalogue rows only after a founder-approved install.
- WHY: a pilot school needs real templates before enablement.
- UNDER WHICH POLICY: ADR-104, ADR-147, ADR-122, ADR-126; NDPA minors question left open (decision 7).

## Unknowns

- Whether `payload.status` is the field name the engine's condition step reads for the absence check (the pack uses it; the
  e2e shows the run dispatches, not that a non-absent status ends the run).
- Whether the abstract approver role maps cleanly to existing roles in a real tenant.

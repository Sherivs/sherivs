# ADR-122: Tenant Approval Inbox with Passkey Step-Up and Two-Person Approvals (WF-07)

| Field          | Value                                                                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Status         | PROPOSED in the WF-07 PR; nothing applied to any hosted database                                                                                                         |
| Date           | 2026-11-19                                                                                                                                                               |
| Creator        | Claude Code agent, mission WF-07 (provenance id W-007, issue #466); AI-generated                                                                                         |
| Version target | V1 organizational workflows                                                                                                                                              |
| Depends on     | [ADR-104](ADR-104_WF02_WORKFLOW_PERMISSIONS_AND_TEMPLATES.md), [ADR-105](ADR-105_WF03_WORKFLOW_RUNTIME_CORE.md), [ADR-147](ADR-147_WF06_ACTIONS_V1.md) (stacked on #455) |
| Migration      | `database/supabase/migrations/20261117000900_sherivs_wf07_approval_inbox.sql`                                                                                            |
| Rollback       | `database/supabase/rollbacks/20261117000900_sherivs_wf07_approval_inbox.sql`                                                                                             |

## Provenance

| Item                       | Source                                                                                                                                                                                          |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Requirement                | Issue #466 "WF-07: tenant approval inbox with passkey step-up for high-risk approvals"; WF-06 hand-off in ADR-147 ("WF-07 owns the approval inbox")                                             |
| Approval and SoD tables    | WF-01 to WF-03: `wf_approval`, `wf_approval_not_self`, `workflows.approve`, the `workflows.manage` / `workflows.approve` separation-of-duties rule (ADR-104)                                    |
| Passkey step-up pattern    | JARVIS-CONSOLE-01 owner console: `frontend/src/lib/jarvis-bridge/step-up.ts` and `frontend/src/lib/auth/webauthn.server.ts` (`assertionOptions`, `verifyAssertion`); reused, not re-implemented |
| WF-06 constraint replaced  | `wf_action_draft_cap_check`, and the `wf_action_sandbox_outbox` cap, mass and data-class checks (migration `20261117000800`)                                                                    |
| WF-06 independent review   | Notes N1 (draft immutability), N2 (webhook target on the outbox row), N8 (revoke the outbox guard from `service_role`)                                                                          |
| Open decision (unresolved) | Decision 4: who may author and who may approve. Not decided by the owner; see "Assumption" below                                                                                                |

## Context

WF-06 stops every capped action (money movement, safeguarding, credential change, public publish,
mass or confidential communication, sharing with an outside authority) at a draft and says a human
must review it, but nothing lets a human do so. A review that is only a button is not enough: the
people who can approve must be the right people, a second person must be required where the harm is
highest, a high-risk approval must show a fresh passkey, and what the person approved must be exactly
what later runs.

## Decision

1. **Per-approver decisions.** `wf_approval_decision` holds one row per approver (unique per
   approval and person, append-only). `wf_approval` becomes `approved` only when enough different
   people have approved the content as it stands now; one rejection ends it. The requester never
   appears as an approver.
2. **Two-person rule, configurable.** `wf_approval_policy` sets the required count per organization
   and risk. Defaults when no row exists: 1 for normal risk, 1 for high risk, and 2 for
   `money_movement`, `safeguarding` and `mass_message`. A category on the capped list forces the
   approval's risk to `high` (`wf_approval_risk_floor`), so it cannot be approved with a normal-risk
   label. An organization may raise counts and add categories to the two-person list. Money movement
   and safeguarding can never be removed from it, the two-person count can never drop below 2, only
   the service role writes the policy, and every change is audited.
3. **Step-up evidence.** A high-risk approving vote needs its own `wf_approval_step_up` row: single
   use, at most five minutes, bound to the approval id, the person and the content digest. It is
   created only by `wf_record_step_up` after the server verified a WebAuthn assertion (the existing
   `verifyAssertion`) whose challenge is the SHA-256 of context, person, approval, content digest and
   a server nonce (`approval-step-up.ts`). An assertion for another approval, another person or
   changed content has a different challenge and fails. A failed check is audited by reason code.
   Rejecting needs no passkey because it moves toward the safe state.
4. **One decision path.** `wf_decide_approval(p_actor, p_approval, p_decision, p_note, p_digest,
p_step_up)` is `SECURITY DEFINER` with `search_path = ''`, executable only by `service_role`. The
   server passes the verified session user as `p_actor`; the function binds that user for the
   transaction (`wf_act_as`) so `has_permission`, `auth.uid()` and `wf_audit_append` see the human.
   It refuses unless `workflows.approve` is held (the admin pass-through that grants view does not
   grant this), the approver is not the requester, did not author or last edit the workflow version
   or template, has not voted, the approval is pending and unexpired, and the digest is current.
   `wf_approval_decision_gate` stops a direct service-role approval of a high-risk item that lacks
   step-up votes.
5. **Content digest.** `wf_approval_content_digest` is a SHA-256 over the organization, approval,
   run, step, risk, permission, target version, category, and the draft's kind, category, recipients,
   audience, data class, template reference and parameters, plus the approved in-app template body
   hash. The inbox shows it; the decision and the passkey bind to it; any later change to the draft
   changes it and invalidates earlier approvals and step-ups.
6. **Replacement of the WF-06 cap check.** `wf_action_draft` gains `approval_id` with a composite
   foreign key `(org_id, approval_id)`. `wf_action_draft_cap_check` now reads: a draft can be
   `approved` only if it has an approval and is not an unregistered webhook. The cross-table rules
   (the linked approval is approved, high risk where the category is capped, console-decided, with the
   required number of current-digest approving votes, each with its own step-up) are enforced by a
   guard trigger using `wf_draft_approval_gap`, which also guards the outbox. An unregistered webhook
   draft can never be approved.
7. **WF-06 review notes folded in.** N1: a `BEFORE UPDATE` trigger on `wf_action_draft`, `SECURITY
INVOKER` with an empty search path, freezes every column except `status`, `approval_id` (set once)
   and `updated_at`, so a drafted safeguarding message cannot be relabelled and then approved. N2:
   a webhook outbox row must carry `webhook_target_id`. N8: `EXECUTE` on
   `wf_action_sandbox_outbox_guard` is revoked from `service_role`.
8. **After approval.** An approved draft is dispatched by the same ports and guards as a first
   dispatch (`workflow-approved-draft.server.ts`): sandbox only, the kill switch, tool registry,
   binding, hourly budget, recipients, template and webhook target re-checked now, and the broker
   still records its decision first under the key `wf-approved:<draft id>`. Approval stands in for
   the "propose" and "act with approval" rungs for that one draft; `shadow` is not raised. The outbox
   row must equal the approved draft field for field (database-enforced) and carries `draft_id`.
   Live delivery of an approved draft is refused in v1. A run whose approval is rejected or expires is
   cancelled, and its open approvals, drafts and steps close (`wf_run_close_approvals`).
9. **Inbox.** Server functions (`workflow-approvals.functions.ts`) list pending and recently decided
   items, show one with its digest, begin a passkey request and decide. The screen lives in the
   workspace shell at `/home/s/approvals`, lazy-loaded so `/home` does not grow. It shows the filled
   template with contact details masked, the digest, the votes so far, a waiting-for-second-approver
   state, the reason a person cannot decide, and a passkey prompt for high-risk approvals.
10. **Audit.** Every vote, step-up verification, failed step-up and view of a high-risk item is written
    through `wf_audit_append` as the acting human, and policy changes through the existing runtime
    settings audit. The chain is append-only.

## Assumption (open decision 4)

The owner has not yet decided who may author and who may approve. WF-07 gates only on what exists:
the `workflows.approve` permission, `wf_approval_not_self`, the author and last-editor exclusion, and
the SoD rule from ADR-104. Nothing here widens who can approve. When decision 4 lands it changes who
is granted `workflows.approve`, not this mechanism. The admin pass-through is deliberately excluded
from deciding.

## Consequences

- Every WF-06 draft, not only capped ones, now gets an approval in the inbox. A draft with no
  approval cannot be approved; a sweep requests the approval if the first request failed.
- A reject or an expiry cancels the whole run, not just the step. Operators who want a softer
  behaviour need a later decision.
- The inbox is pull-based. No notification is sent in v1, so an item waits until someone opens the
  inbox or the seven-day window ends. Notification belongs to a later mission and needs the comms
  rules, not a side channel here.
- Email, SMS and WhatsApp template bodies are not read in SQL because the neutrality guard forbids
  the comms store's `school_id` column in new migrations. The digest binds their reference and
  parameters, and WF-06's approved-template check re-runs at dispatch. The screen says so.
- The shell link is visible to every active member; a person without access sees a plain refusal.
  The client has no permission list to hide it by, and adding role logic to the shell is outside
  ADR-102.
- Plain approval-kind workflow steps (not drafts) are decided and recorded here, but WF-07 does not
  resume a step that waits on one. That continuation is not built and is marked UNVERIFIED in the
  mission file.

## Validation boundary

Migration replay, the SQL harness `tests/integration/wf07-approval-inbox.local.sql`, unit tests and
the simulation `tools/sim-lab/load/wf07-approval-e2e.mjs` use only a disposable local Postgres and CI.
This ADR does not authorize applying the migration to any hosted database, enabling workflows for any
organization, or enabling live delivery. `WORKFLOWS_ENABLED` stays off.

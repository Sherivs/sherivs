# ADR-158: Resume Workflow Runs After an Approval Step Is Approved (WF-07b)

- Creator: Claude Code agent, mission WF-07b (approval-step resume) (provenance id W-022); AI-generated
- Origin: Mission: W-022; Authority: WF-07 approval inbox (wf_decide_approval) and the WF-03 runtime claim and persist functions

- Status: PROPOSED. Migration not applied anywhere. Needs a backup and Tumi's review.
- Date: 2026-11-28

## Context

An approval step parks its run in `waiting`. `wf_decide_approval` records who approved, with the permission, separation-of-duties and passkey checks, but nothing moved the run afterwards. An approved approval step therefore never completed and its run stayed `waiting` until it timed out.

## Decision

1. New `wf_claim_approved_steps(worker, limit, lease)` (service role only). It leases approval-kind steps whose approval is `approved`, whose run is `waiting`, inside its deadline and step limit, in an organization with workflows enabled. Approvals tied to an action draft are excluded: those belong to the draft executor. An expired lease is claimed again; a lease that expires on the last allowed attempt ends the step as `dead` and fails the run.
2. New `wf_approver_holds_role(org, user, role)` (service role only): true while the user has a current role assignment with that role code in that organization. The runtime uses it to check the role a definition names for the step, which the database cannot know.
3. The runtime tick gains a phase after the normal claim: `resumeApprovedStep` feeds the engine an `approval` event for the human who decided (an AI can never be the approver), then settles the step the same way every other step settles (evidence recorded, run completed or next step queued) through the existing `wf_persist_step_transition`. The step and run limits, loop guard and evidence rules apply unchanged.
4. Fail closed: if the role does not match or the engine refuses, the run ends `failed` with `approval.<engine code>`. Persisting `waiting` is never used here, because it would raise a second pending approval for the same step.
5. Ports that cannot resume (`claimApprovedSteps` absent) leave approval steps waiting, as before.

## Consequences

- Nothing here approves anything or widens who may approve; it only acts on a decision the database already accepted.
- Additive: rollback drops the two functions. Runs already resumed stay resumed; approvals still waiting go back to waiting.
- A definition whose approval step names a role nobody holds now fails its run after approval instead of waiting forever. This is intended and visible.
- Existing data: approved approval steps already waiting when this is applied will be resumed on the first tick. Tumi to check hosted runs before applying anywhere that has data.
- Out of scope: the cron or scheduler that calls the tick (unchanged); resuming draft-linked approvals (draft executor); group workflows (WF-15b).

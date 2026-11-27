# ADR-131: A Human Approval Can Never Lift a Draft Above Its Autonomy Ceiling (CD-01)

| Field      | Value                                                                                       |
| ---------- | ------------------------------------------------------------------------------------------- |
| Status     | PROPOSED in the CD-01 PR; nothing applied to any hosted database                            |
| Date       | 2026-11-26                                                                                  |
| Creator    | Claude Code agent, mission CD-01; AI-generated                                              |
| Decision   | Founder, Decision Pack consent agenda, 26 Nov 2026 ("decide as a cautious CTO would")       |
| Depends on | [ADR-147](ADR-147_WF06_ACTIONS_V1.md), [ADR-122](ADR-122_WF07_APPROVAL_INBOX_AND_STEP_UP.md) |
| Migration  | `database/supabase/migrations/20261117000901_sherivs_cd01_approval_ceiling_guard.sql`        |
| Rollback   | `database/supabase/rollbacks/20261117000901_sherivs_cd01_approval_ceiling_guard.sql`         |

## Context

A step's effective autonomy is the lowest of the template ceiling, the tenant ceiling and the
agent's earned level (WF-06 `wf_autonomy_guard`), with the capped classes held at `draft`. WF-07
lets a person approve a draft but never checked that level. A step at `suggest` produces advice, so
an approval could turn advice into an approved, sendable draft: a person's click would have raised
autonomy above what the template, the tenant or the agent's evidence allowed.

## Decision

A draft whose step runs at `suggest` can never move to `approved`, by any path. A trigger on
`wf_action_draft` enforces it, so it holds for `wf_decide_approval`, the outbox link and any future
caller. At `draft` or above, approval works as before: approval is permission to act within the
ceiling, never an extension of it. Rejecting and expiry are unaffected.

## Consequences

- The ceiling is changed only by the template, the tenant setting or the agent's earned level (a
  founder action with evidence, AIN-02). Nobody can raise it by approving.
- The refusal is `wf07:ceiling_suggest` (SQLSTATE 42501); the approval stays pending and expires.
  A friendlier early refusal at request time is a follow-up (UNVERIFIED need).
- A run with no template has no template ceiling and resolves to `suggest`. The WF-07 harness
  fixtures ran template-less and approved drafts, which pinned the old behaviour; they now run under
  a fixture template that allows approval-gated action.

## Alternatives rejected

Refusing at `draft` as well (would make every pilot template unsendable even with a person's
approval, and capped classes are held at `draft` by design); a check only inside `wf_decide_approval`
(a second path would bypass it).

# ADR-160: Installable Group Workflows That Need No Campus Feature (WF-15b3)

| Field                      | Value                                                                                                                                      |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Status                     | PROPOSED (nothing installed, enabled or applied; depends on GRP-01, PR #529, for the events)                                               |
| Date                       | 2026-11-28                                                                                                                                 |
| Author                     | Claude Code agent (mission 4, WF-15b3)                                                                                                     |
| Creator                    | Claude Code agent, mission WF-15b3 (group workflows)                                                                                       |
| Origin                     | Founder instruction 28 Nov 2026 (execute missions one at a time); Group Pack v1 of ADR-143 and GRP-01 events of ADR-154                    |
| Mission                    | WF-15b3, gap W-024                                                                                                                         |
| Capabilities               | Three installable group templates; a pluggable message registry in the pack validator; the three GRP-01 events known to the pack validator |
| Cites                      | ADR-143, ADR-154, ADR-138, ADR-122                                                                                                         |
| Minimal ownership artifact | `frontend/src/lib/runtime/scholar/workflow-packs/group-workflow-pack.ts`                                                                   |

## Context

ADR-143 listed six group workflows that still lacked an event source. GRP-01 (ADR-154, PR #529) added three of the events they need: `schedule.weekly`, `schedule.month_end` and `group.kpi_below_threshold`. Three of the six (`group.weekly_rollup`, `group.kpi_breach_alert`, `group.finance_close`) need nothing else from the campuses. The other three (`group.fee_policy_rollout`, `group.student_transfer`, `group.staff_transfer`) need a fee-edit event and transfer features that do not exist.

The group view must never leak a small count. GRP-01 suppresses counts of 1 to 4 inside `org_group_aggregate`. A workflow that read the aggregate itself would need a new read action kind and a policy on which metrics a group may see. `org_metric` is empty on purpose.

## Options

- **A. Add a read-only action kind that calls `org_group_aggregate` and puts counts in a message.** Rejected for now: it needs a metric policy decision, a new action kind in the engine, and it would copy counts into message bodies, where the small-number rule no longer protects them.
- **B. Build templates that point the director at the group view.** Chosen. The message says a summary is ready; the director reads the numbers where `org_group_aggregate` applies the rule.
- **C. Leave the three templates as catalogue entries only.** Rejected: the events now exist and the templates can be installed safely.

## Decision

1. Three installable templates in `group-workflow-pack.ts`: `group_weekly_rollup`, `group_kpi_breach_alert`, `group_finance_close`. The catalogue entries are flipped to `built` and name their template through `sourceTemplateKey`.
2. Every step is an in-app draft to the group director, with data class `internal`. No message holds a digit, a name or a campus identifier. The KPI alert binds `campus_org` to the run for a deep link but never into the text.
3. `group_finance_close` begins with a human approval step held by `group_director`. The catalogue entry declares the passkey step-up (ADR-138); a rejection needs none.
4. The pack validator takes an optional message registry (default is the fee registry), so the group pack has its own reviewed wording. The three group events are added to the known event payload keys.
5. The three transfer and fee-edit workflows stay `needs_event_source`.
6. Concrete metrics (`org_metric` rows) are not created here. Which counts a group may see is a policy decision, and any rows would be a PROPOSED migration reviewed by Tumi.

## Consequences

- The templates need GRP-01 merged and applied before they can be installed, because the events come from `wf_group_event_scan`.
- Nothing in these templates reads campus data, so `campus-isolation` holds by construction.
- A director who wants numbers in the message must wait for decision 6 and a read action kind.
- The same validator now serves any future pack with its own registry.

## Verification

- 9 new unit tests (`tests/unit/wf15b3-group-workflow-pack.test.ts`), plus the updated Group Pack v1 test and the unchanged WF-15a tests.

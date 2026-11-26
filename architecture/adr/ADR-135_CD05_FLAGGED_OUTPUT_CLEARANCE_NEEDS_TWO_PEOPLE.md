# ADR-135: Flagged Output Is Cleared Only by a Second Person; One-Person Organisations Stay Blocked (CD-05)

| Field      | Value                                                                                          |
| ---------- | ---------------------------------------------------------------------------------------------- |
| Status     | PROPOSED in the CD-05 PR; nothing applied to any hosted database                               |
| Date       | 2026-11-26                                                                                     |
| Creator    | Claude Code agent, mission CD-05; AI-generated                                                 |
| Decision   | Founder, Decision Pack consent agenda, 26 Nov 2026 ("decide as a cautious CTO would")          |
| Depends on | AIN-04 (evaluation and guardrail layer), WF-07 (approval inbox)                                |
| Migration  | `database/supabase/migrations/20261117000997_sherivs_cd05_flag_clearance_needs_two_people.sql` |
| Rollback   | `database/supabase/rollbacks/20261117000997_sherivs_cd05_flag_clearance_needs_two_people.sql`  |

## Context

AIN-04 already refuses a review by the person who started the run. A run with no starter (scheduled or event-driven)
could still be cleared by a lone approver, so a one-person organisation could clear its own agent's flagged output.

## Decision

`wf_safety_review_check` first requires that at least one OTHER active person in the organisation holds
`workflows.approve` (helper `wf_review_second_person_exists`, no API grants). Otherwise it raises
`ain04:second_reviewer_required` (42501) and writes nothing; this applies to both clear and reject. The starter rule is
unchanged. One-person organisations stay blocked until the proprietor-approval class (D-04 option C) exists.

## Consequences

- Candidates are active role assignments plus active member rows, each tested with the same acting-as pattern WF-07 uses.
- A solo school cannot use flagged output at all until option C; blocked output stays blocked (fail closed).
- Cost: one bounded scan (200 candidates) per review, which is a rare, human-paced action.

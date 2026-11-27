# A2: Tenant isolation for a person in several organisations (decision D-07)

| Field   | Value                                                                               |
| ------- | ----------------------------------------------------------------------------------- |
| Status  | Draft PR stacked on WF-15a3 (#513); tests only, no migration, no application change |
| Harness | `tests/integration/a2-multi-org-student-isolation.local.sql` (`A2ISO ALL PASS`)     |

## What is proved (local PostgreSQL 16, CI-faithful chain; 26 Nov 2026)

- 21 checks pass. Structure: every `wf_*` table with an `org_id` has row security on; none opens reads to everyone; anon has no grant; the only tables readable by all signed-in people are the three platform catalogs and they hold no `org_id`.
- A student in two schools holds no workflow permission anywhere and sees no workflow row of any organisation.
- A school admin who is also a student in another school gets authority only in the school they administer; the student role in the other school grants nothing there.
- An admin sees their own organisation's rows and none of any other, in every workflow table; cross-organisation insert and update are refused.
- The fee-reminder scan for the same student reference in two schools makes separate events with separate keys and invoice ids; a school with workflows off gets none; a signed-in student cannot run the scan.
- Control: with row security switched off on `wf_event` the leak check finds other schools' rows; restored, it is clean. The checks can fail.

## UNVERIFIED

- Only `wf_*` tables were swept. Non-workflow tables (fees, results, welfare) were not, and are the subject of later missions.
- A person with a role in two schools is modelled by one home school plus role assignments; no real multi-membership data was read.
- Not run in CI yet (the verify.yml step is added, unexecuted here).

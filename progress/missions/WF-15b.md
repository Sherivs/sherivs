# WF-15b: Group Pack

| Field  | Value                                                                                         |
| ------ | --------------------------------------------------------------------------------------------- |
| Status | Draft PR stacked on the reporting-lines ADR; no database change; nothing installed or enabled |
| Source | Sherivs Automation Vision (template schema, Group Pack row); ADR-142                          |

## Built

- `workflow-catalog.ts`: the blueprint's template schema as a type plus `validateCatalogEntry` (autonomy caps, build state checked against the real WF-05 event sources, min_plan null until PLAN-01). Later packs reuse it.
- `group-pack.ts`: the eight Private School Pack templates reused per campus, and the six group workflows the blueprint names, each declared `needs_event_source`, reporting to the group director, aggregate-only where it is a roll-up.
- 8 unit tests.

## Evidence (27 Nov 2026)

- vitest: 8 tests pass (with the WF-15a tests, all pass); eslint and prettier clean; domain-neutrality check run.

## UNVERIFIED and open

- The blueprint says the Group Pack has 14 V1, 6 later and 3 needs-integration templates but lists no per-template mapping. Only the 14 above (8 reused + 6 named) are in the file; the pack is NOT at the blueprint's 23. I need the catalogue's workflow-to-pack mapping (a column per institution type) to complete this and every later pack.
- None of the six group workflows can run: `schedule.weekly`, `schedule.month_end`, `group.kpi_below_threshold`, `fees.schedule_edited`, `students.transfer_opened` and `staff.transfer_proposed` are not WF-05 event sources. Each needs an event migration (and, for roll-ups, an aggregate source), which is the next step.
- Org type codes other than `pri`, `grp`, `isl`, `tvet`, `prep` are proposed by me. `release` is null for the six because the blueprint does not say which are V1.
- How a group director sees several campuses given strict tenant isolation (D-07) is undecided: a group-level organisation that owns aggregates is the likely shape, and needs a decision before the roll-up is built.

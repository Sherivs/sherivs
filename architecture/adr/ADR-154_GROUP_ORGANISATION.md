# ADR-154: Group Organisation and Campus Links (GRP-01)

- Creator: Claude Code agent, mission GRP-01 (group organisation) (provenance id W-018); AI-generated
- Origin: Mission: W-018; Authority: ADR-143 Decision B (accepted by the founder in chat, 27 Nov 2026)

- Status: PROPOSED. Migration not applied anywhere. Needs the founder's approval, a backup, and Tumi's review.
- Date: 2026-11-27

## Decision

Build ADR-143 Decision B as database objects. A group is its own organisation and holds no campus records.

1. `org_group_root` marks an existing organisation as a group. Only a platform admin marks it.
2. `org_link` joins a group to a campus. The group's administrator proposes. **Only the campus's own administrator accepts; a platform admin cannot.** Either side ends a link, and sharing stops at once. A link is never edited or deleted; a campus has one live link at a time.
3. `org_metric` is a registry of count metrics (`public.org_metric_*(uuid)` returning `bigint`). A group sees a campus only through these.
4. `org_group_aggregate` returns per-campus counts for accepted, live links only. **Counts of 1 to 4 are suppressed. No total is returned when any campus is suppressed or the total itself is 1 to 4**, so a suppressed count cannot be recovered by subtraction.
5. `org_group_threshold` lets a group ask to be told when a campus falls below a number. The number must be at least 5, so an event can never reveal a suppressed count. The event carries no count.
6. `wf_group_event_scan(now)` (service role) emits `schedule.weekly` (Monday, 08:00 Lagos), `schedule.month_end` (last day of month) and `group.kpi_below_threshold`, once per day or period through dedupe keys, into the group's own organisation.
7. Tables are closed to every client role; only the functions act.

## Not built (open)

- Events `fees.schedule_edited`, `students.transfer_opened`, `staff.transfer_proposed` need features that do not exist yet (fee-schedule edit, student and staff transfer). Their group workflows stay blocked.
- No concrete metrics are registered (needs a decision on which counts a group may see). No screens. The scan is not scheduled; it needs a cron entry when applied.
- Department or faculty hierarchy inside a campus is not part of this.

## Verification

`tests/integration/grp01-group-organisation.local.sql`: 44 checks (closed tables, platform-only marking, proposal and acceptance rules, no sharing before acceptance, suppression and no-differencing, cross-group isolation, either-side ending, immutability, threshold floor, scheduled events with dedupe and no count in the payload).

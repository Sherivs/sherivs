# ADR-118: Academic Core Screens and Own-Class Enforcement

| Field                      | Value                                                                                                                                                                                                                                                           |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status                     | PROPOSED (migration NOT APPLIED; needs the founder's written approval and merge of PRs #433, #449 and #313 first)                                                                                                                                               |
| Date                       | 2026-11-18                                                                                                                                                                                                                                                      |
| Author                     | Claude Code agent (mission M7 implementation)                                                                                                                                                                                                                   |
| Creator                    | Claude Code agent, mission E-017 (M7 academic core)                                                                                                                                                                                                             |
| Mission                    | M7 (academic core)                                                                                                                                                                                                                                              |
| Capabilities               | Today's classes, attendance (offline, audited correction of past days), gradebook / CA entry (offline), lesson notes submit and review; teachers see only their own classes, enforced in the database                                                           |
| Cites                      | [ADR-106](./ADR-106_M3_EVERY_CARD_IS_A_CONTRACT.md) (card registry, PR #433); [ADR-109](./ADR-109_SV1_LITE_OUTBOX_CONTEXT_TAGGING_AND_WIPE.md) (outbox, PR #449); ADR-044 (M06 results, PR #313); WF-05 event sources (PR #451); M05 and SHERIVS-024 migrations |
| Minimal ownership artifact | `database/supabase/migrations/20261117003200_sherivs_m7_academic_core.sql`                                                                                                                                                                                      |

## Context

Most of the academic core already existed as tables and database functions, with no screens on them:

- Timetables: `timetables`, `timetable_slots`.
- Attendance: M05 `class_attendance_marks`, `offline_attendance_capture_sync_m05` and its client queue.
- Scores: PR #313's `m06_*` weighted-result functions.
- Lesson notes: SHERIVS-024 `lesson_plans`, `lesson_note_reviews`, `lesson_note_submit` and `lesson_note_review`.

No assignments table exists.

Read-only queries on the production catalogue (2026-11-17) found three gaps that matter for these screens:

1. Only `class_attendance_marks` limits teachers to their own classes. `grades_teacher_read` lets any teacher read every grade in the organization, unpublished ones included.
2. `lesson_plans` has a tenant-wide `ALL` policy. Any member could set `status = 'approved'` directly and bypass the reviewer, even though the review function enforces separation of duties.
3. A past attendance mark could only be changed without a recorded reason.

## Options

- **A. Build new tables and engines for the teaching screens.** Rejected: it would duplicate M05, M06 and SHERIVS-024 (founder rule: extend, never duplicate).
- **B. Screens only, no database change.** Rejected: own-classes would stay a UI convention, and the lesson-note approval bypass would remain.
- **C. Screens over the existing functions, plus one small migration that closes the gaps.** Chosen.

## Decision

- Screens are lazy chunks registered live in the card registry: today's classes, attendance, gradebook and lesson notes. `assignments` is registered as a planned section, because there is no table and no permission. `w.my_timetable` (the learner's view) stays planned.
- Own classes are enforced in the database:
  - SECURITY DEFINER read functions (`m7_my_classes`, `m7_my_periods`, `m7_class_roster`, `m7_class_gradebook`) built on M05's `m05_teacher_assigned_to_class`.
  - RESTRICTIVE SELECT policies on `grades` and `m06_result_component_scores` for callers whose role is `teacher`. These narrow access and never widen it.
- Attendance stays on the existing M05 queue. It was not moved to the generic outbox, because nothing was gained and the existing tests pin its behaviour.
- A past mark changes only through `m7_correct_attendance`. It needs a reason of 8 characters or more and uses the same 7-day window as M05 (older dates need `attendance.edit_past`). A client key makes a repeat a replay. Corrections are kept in the append-only, audited table `m7_attendance_corrections`.
- CA entry writes only through `enterResultScores` / `m06_enter_result_scores`, always via the generic outbox:
  - The idempotency key is per save and per learner.
  - A server refusal is final (server wins). Network loss keeps the row queued.
- Lesson notes use the existing submit and review functions. A new `m7_lesson_plan_guard` trigger allows a note to reach `approved` only when its latest review was approved by someone other than its author. It also blocks edits to submitted or approved notes.
- No events are emitted here. WF-05's trigger on `class_attendance_marks` covers attendance.

## Consequences

- Teachers lose school-wide reads of grades. An HOD whose legacy `users.role` is `teacher` also loses the department-wide grade view, until department scope exists in the role engine. Founder decision.
- `students`, `classes` and `timetable_slots` stay readable school-wide for teachers through the existing policies. The M7 screens never read them directly, but a teacher can still query the `students` table. Whether to restrict it is a founder decision, because other screens (mobility, messaging) read it.
- Lesson notes are online-only in M7.
- Proof: `tests/sql/m7-academic-core.sql` (62 checks, local Postgres 16), plus unit, offline and screen tests. No browser E2E (Playwright offline mode, Slow-3G) was run.

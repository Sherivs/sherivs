# ADR-016: M05 tenant-scoped offline attendance

## Status

Proposed for V1 organizational attendance capture.

## Context

The existing daily attendance table is unique per student and date, so it cannot
represent separate class, shift, or period marks. M04 makes campuses and shifts
tenant-bound, and the M009 role engine supports effective class-scoped teacher
assignments. Offline captures also need stable item identities, durable replay
handling, and a visible conflict outcome.

## Decision

- Keep the legacy attendance table and sync functions unchanged.
- Store M05 daily or period marks in a new tenant-bound table keyed by school,
  class, student, date, optional M04 shift, and period key.
- Accept teacher writes only for an assigned class. Assignment may be evidenced
  by the class teacher, an active timetable slot, or an active class-scoped
  teacher role assignment. Tenant and student/class consistency are enforced by
  composite foreign keys.
- Persist item idempotency, batch replay results, and cross-writer conflicts.
- Require authenticated RPC writes; enable and force RLS on all new tables,
  expose only scoped reads, and audit mutations.
- Keep client outbox and cache tenant/user/role scoped; failed sync remains
  pending and conflicts remain visible until explicitly reviewed.

## Consequences

Existing attendance reads remain compatible, while M05 class/period records use
the new table and are visible only through its scoped read policy. Applying or
rolling back the migration is an approved deployment operation; this mission
only authors migration files and local disposable-database tests.

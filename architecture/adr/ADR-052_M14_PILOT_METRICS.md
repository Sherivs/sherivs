# ADR-052: M14 Pilot Metrics Are Aggregate Counters With Small-Cohort Suppression

| Field | Value |
|---|---|
| Status | PROPOSED |
| Date | 2026-11-13 |
| Author | Claude (continuation of issue #193) |
| Creator | Claude Code agent, mission M-014 (issue #193) |
| Mission | M14 — pilot metrics |
| Cites | AGENTS.md tenant-isolation, RLS and audit rules; `database/supabase/migrations/20261104017000_sherivs_m14_pilot_metrics.sql`; `docs/pilot/baseline-capture-method.md` |
| Minimal ownership artifact | This ADR and the M14 migration with its rollback |

## Context

Issue #193 asks for baseline and outcome metrics for the pilot (attendance capture rate, result turnaround, fee reconciliation time, ASC export completeness) as aggregate counters, with no personal identifiers in the metrics and a dashboard or report built from synthetic fixtures.

## Options

1. **Per-event metrics rows** (rejected): one row per attendance mark, result or payment. Even without names, per-event rows carry timestamps and tenant context that can be joined back to individuals.
2. **Period aggregates with suppression** (ruled): one row per tenant, metric and period holding a numerator and denominator. Values from fewer than 5 observations are suppressed in the report.
3. **Compute everything from source tables in SQL** (rejected for this change): the results, fees and ASC workflows are separate missions in different merge states; deriving from their tables here would couple M14 to unmerged schemas.

## Decision

Option 2. Attendance capture is derived in the database from counts. Result turnaround, fee reconciliation time and ASC completeness are recorded as counters by their workflows via `pilot_metric_record`. Tables reference only `schools`; there is no actor column. RLS is enabled and forced; `authenticated` has SELECT only; writes go through SECURITY DEFINER functions that require tenant management authority (or the scheduler role). History is append-only.

## Explicit residual risks

- **The three recorded metrics have no producers yet.** Until the results, fees and ASC workflows call `pilot_metric_record`, they show "Not enough data". Owner: the missions that own those workflows.
- **Suppression threshold of 5 is a default**, not a legal ruling.
- **Attendance denominator** counts all tenant students, including any no longer enrolled.

## Golden Questions

- **WHO?** Tenant managers and `audit.view` holders read; tenant managers or the scheduler write.
- **WHAT?** Counters per tenant, metric and period.
- **WHERE?** One tenant per row; cross-tenant access is rejected.
- **WHY?** Baseline and outcome evidence for the pilot without personal data.
- **UNDER WHICH POLICY?** AGENTS tenant isolation, RLS and audit rules.

## UNKNOWNs

- Producers for the three recorded metrics.
- Enrolment-status refinement of the attendance denominator.
- No migration or database operation in this change applies to a production or hosted database.

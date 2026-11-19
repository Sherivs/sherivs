# Pilot metrics: baseline capture method (M14)

Status: PROPOSED. Aggregate counters only. No metric row names, identifies or can be joined back to a student, staff member or guardian. Metrics tables reference only the tenant (`schools`).

## The four metrics

| metric_key | Kind | How it is captured |
| --- | --- | --- |
| `attendance_capture_rate` | rate | **Derived in the database** by `pilot_metric_capture_attendance(org, from, to)`: attendance rows recorded in the period divided by (students in the tenant x days in the period on which any attendance was captured). |
| `result_turnaround` | duration | **Recorded** by the results workflow through `pilot_metric_record`: total seconds from assessment close to result publication, and the number of results published. |
| `fee_reconciliation_time` | duration | **Recorded** by the fees workflow: total seconds from payment recording to ledger posting, and the number of payments reconciled. |
| `asc_export_completeness` | rate | **Recorded** by the ASC export: required fields present across exported records, and the number of required fields expected. |

Rate metrics store `numerator <= denominator`. Duration metrics store total seconds as the numerator and the observation count as the denominator; the report shows the mean.

## Capturing a baseline

1. Before the pilot starts, run the capture for the three weeks before go-live, one call per period (for example one per week). Periods are stored; a re-run of the same period replaces the sample and the previous value stays in the append-only log.
2. Capture the same metrics for the pilot period with the same period length.
3. Compare with `compareToBaseline` (relative change, only when both sides are visible).

## Privacy controls

- Values built from fewer than 5 observations are suppressed (`suppressed: true`, `value: null`); the report never shows a number for them.
- The schema has no actor column; who captured a value is not stored in these tables.
- Only tenant managers (`roles.configure`) and holders of `audit.view` can read a tenant's samples; `anon` has no access.

## Known limits

- The attendance denominator counts every student in the tenant, including any who are no longer enrolled; refine once an enrolment-status column is ruled.
- Recorded metrics depend on the results, fees and ASC workflows calling `pilot_metric_record`; those call sites are not part of this change.
- This method was authored with synthetic fixtures only. No real pilot data was used or available.

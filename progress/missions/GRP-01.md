# GRP-01: group organisation

Status: built (database), draft PR, NOT APPLIED. ADR-154 (from ADR-143 B).

- Migration `20261127000300_sherivs_grp01_group_organisation.sql`, rollback alongside. Tables `org_group_root`, `org_link`, `org_metric`, `org_group_threshold`; ten functions including `wf_group_event_scan`.
- Harness `tests/integration/grp01-group-organisation.local.sql`: 44 checks pass on a scratch PostgreSQL 16.
- Emits three group events (weekly, month-end, KPI below threshold). The other three group events wait on transfer and fee-edit features.
- Not built: concrete metrics, screens, the cron entry for the scan.
- Needs: founder approval and backup before any apply; Tumi's review.

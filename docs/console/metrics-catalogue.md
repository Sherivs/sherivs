# Internal Console metrics catalogue

**Version target:** V1 organizational capability envelope.  
**Status:** Contract documentation for existing console sources; no production database or telemetry was changed.

Values and contract metadata are returned only when the viewer has a listed
capability. The server filters measured values; the metrics screen separately
filters defined-but-not-collected contracts. A workspace label or membership is
not authorization.

| Metric                           | Definition                                                                                                                                 | Source                                                                                       | Calculation                                              | Range                                | Unit          | Freshness         | Authorization                                                                                                  |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------ | ------------- | ----------------- | -------------------------------------------------------------------------------------------------------------- |
| Control-plane organizations      | Organization lifecycle cases recorded for Sherivs staff onboarding.                                                                        | `platform_organization`                                                                      | `count(*)`                                               | Current                              | Organizations | Read at page load | `platform.tenants.read`                                                                                        |
| Active organizations             | Lifecycle cases in state `active`; this is not a loaded Scholar homepage.                                                                  | `platform_organization.lifecycle_state`                                                      | Count where state is `active`                            | Current                              | Organizations | Read at page load | `platform.tenants.read`                                                                                        |
| Organizations onboarding         | Cases that started but are not active, suspended, or deactivated.                                                                          | `platform_organization.lifecycle_state`                                                      | Count of pipeline states                                 | Current                              | Organizations | Read at page load | `platform.tenants.read`                                                                                        |
| Suspended organizations          | Lifecycle cases in state `suspended`; records are retained.                                                                                | `platform_organization.lifecycle_state`                                                      | Count where state is `suspended`                         | Current                              | Organizations | Read at page load | `platform.tenants.read`                                                                                        |
| Onboarding completion rate       | Active cases divided by cases that have left draft.                                                                                        | `platform_organization`                                                                      | `active / (total - draft) * 100`                         | All recorded cases                   | Percent       | Read at page load | `platform.tenants.read`                                                                                        |
| Median onboarding duration       | Median time from submission to activation for activated cases with both timestamps.                                                        | `platform_organization.submitted_at`, `activated_at`                                         | Median of `activated_at - submitted_at`                  | Activated cases with both timestamps | Hours         | Read at page load | `platform.tenants.read`                                                                                        |
| Failed provisioning operations   | Cases currently in `provisioning_failed`; retries are allowed and audited.                                                                 | `platform_organization.lifecycle_state`                                                      | Count where state is `provisioning_failed`               | Current                              | Cases         | Read at page load | `platform.tenants.read`                                                                                        |
| Scholar tenant records           | Rows in the canonical Scholar tenant store, including tenants not created through the console questionnaire.                               | `public.schools` via `platform_control_plane_metrics()`                                      | `count(*)`                                               | Current                              | Tenants       | Read at page load | `platform.tenants.read`                                                                                        |
| Registered users                 | Identity-store rows in `public.users`; platform staff without a school membership are excluded.                                            | `public.users` via `platform_control_plane_metrics()`                                        | `count(*)`                                               | Current                              | People        | Read at page load | `platform.tenants.read`                                                                                        |
| Active users (30 days)           | Scholar users with an Auth `last_sign_in_at` within 30 days. Account creation is not activity.                                             | `auth.users.last_sign_in_at` joined to `public.users` via `platform_control_plane_metrics()` | Count where `last_sign_in_at >= now() - 30 days`         | Trailing 30 days                     | People        | Read at page load | `platform.tenants.read`                                                                                        |
| Staff invitation acceptance rate | Active staff rows divided by staff rows with an invitation timestamp; this is a current-directory ratio, not a delivery or cohort measure. | `platform_staff`                                                                             | `count(status = active) / count(invited_at is not null)` | Current staff directory              | Ratio         | Read at page load | `platform.staff.read`                                                                                          |
| Active internal staff            | Sherivs staff rows currently in status `active`; customer-school users are excluded.                                                       | `platform_staff.status`                                                                      | Count where status is `active`                           | Current active memberships           | People        | Read at page load | `platform.staff.read`                                                                                          |
| Pending staff invitations        | Staff rows in status `invited`; delivery is not implied.                                                                                   | `platform_staff.status`                                                                      | Count where status is `invited`                          | Current                              | Invitations   | Read at page load | `platform.staff.read`                                                                                          |
| API error rate                   | Eligible failed API requests divided by eligible API requests. Not collected in V1.                                                        | Not configured                                                                               | Not collected                                            | Not measured                         | Percent       | Not configured    | `platform.engineering.read`                                                                                    |
| API latency                      | Response-time percentiles for eligible API requests. Not collected in V1.                                                                  | Not configured                                                                               | Not collected                                            | Not measured                         | Milliseconds  | Not configured    | `platform.engineering.read`                                                                                    |
| Active incidents                 | Incidents in open, acknowledged, or mitigating states; closed records are excluded.                                                        | `platform_incident`                                                                          | Count in active incident states                          | Current                              | Incidents     | Read at page load | Any of `platform.operations.read`, `platform.engineering.read`, `platform.tenants.read`, `platform.audit.read` |
| Application process uptime       | Operating-system uptime for this application process; not service-wide availability.                                                       | `buildHealthReport` process snapshot                                                         | `uptime_s`                                               | Since process start                  | Seconds       | Read at page load | `platform.engineering.read`                                                                                    |
| Commercial subscriptions         | Count of payment-history rows; not recognized revenue, MRR, plan entitlement, or authorization.                                            | `public.subscriptions`                                                                       | Count of subscription payment-history rows               | Current ledger                       | Subscriptions | Read at page load | `platform.finance.read` or `platform.tenants.manage`                                                           |

## Health states

The console displays only **Healthy**, **Degraded**, **Unavailable**,
**Unknown**, or **Not configured**. Healthy requires a successful check of the
named source and does not imply every workflow is healthy. Unknown means a
configured check lacks sufficient evidence or could not complete; Not
configured means no check is configured. Health describes operations, not user
authorization.

The process status is sourced from `/health.json` via `buildHealthReport()`.
Database health is a successful query against the platform role catalogue.
Storage and provider integrations are explicitly Not configured on the
homepage. API error rate and latency remain unavailable, not zero.

## Safeguards and limitations

- Signup or registration counts must never be labelled active users. The only
  active-user definition here uses authenticated `last_sign_in_at`.
- A missing relation, failed query, or absent telemetry is unavailable or
  unknown; it is never replaced with a fabricated zero.
- Tenant, staff, finance, engineering, and incident metrics follow their
  separate existing platform capabilities. The existing `has_platform_capability`
  model remains authoritative; this catalogue creates no role engine.
- No production database, production telemetry source, or live user data was
  queried while preparing this catalogue.

## Visual evidence

These screenshots use the localhost-only synthetic Engineer persona and are
not production verification:

- [1440px desktop metrics screen](../../progress/internal-console/phase-f/metrics-1440.png)
- [390px mobile metrics screen](../../progress/internal-console/phase-f/metrics-390.png)

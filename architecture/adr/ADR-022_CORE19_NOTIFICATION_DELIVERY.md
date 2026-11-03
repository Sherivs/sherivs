# ADR-022: V1 Notification Delivery Is Tenant-Bound, Idempotent, and In-App

|| Field | Value |
||---|---|
|| Status | PROPOSED (awaits operator approval) |
|| Date | 2026-11-03 |
|| Author | copilot-swe-agent[bot] / CORE-19 |
|| Mission | CORE-19 (V1 notification delivery) |
|| Capabilities | V1 Phase 10 notification service |
|| Supersedes-in-part | None |
|| Cites | `AGENTS.md:290-310,406-416,638-652,669-695,709-729,923-924`; `architecture/phase-10-communication-platform.md:604-629,644-651`; `docs/v1/V1-GAP-REPORT.md:94`; `frontend/src/lib/runtime/scholar/notifications-fanout.functions.ts:28-108`; `frontend/src/lib/runtime/scholar/notification-digest.functions.ts:27-145`; `frontend/src/components/app-shell/notification-centre.tsx:33-53`; `frontend/src/lib/server/write-audit.ts:7-30,90-148`; `database/supabase/migrations/20260620122048_50e590c2-5911-4c98-8931-fb46a4b509f3.sql:421-430`; `database/supabase/migrations/20260622044140_557cda0e-ae5c-4abc-b1ef-51ea89d09ff5.sql:10-17`; `database/supabase/migrations/20260623054451_c6c2ad41-5c74-4c10-9920-f6ef5546d4e6.sql:21-56`; `architecture/coregrid-mvp-architecture/NEUTRALITY_GUARD_BASELINE.json:13826-13849`; `tests/unit/notifications-contract.test.ts:164-290`; `tests/unit/notifications-dispatch-planner.test.ts:27-103` |
|| Minimal ownership artifact | This ADR only — a decision artifact |

## Context

CORE-19 closes the V1 notification delivery gap recorded in `docs/v1/V1-GAP-REPORT.md`. The existing Scholar runtime writes in-app rows to `public.notifications`, and the merged #207 notification centre reads those rows with both the current school and user filters. The fan-out functions previously inserted duplicates on replay and then called web push directly. Digest delivery queried `notification_preferences` and `notifications` through the caller's authenticated client, although the existing SELECT policies expose only the current user's preference and notification rows. Both existing tables have three policies but did not have FORCE RLS in the checked-in migrations.

The existing preferences table stores in-app opt-outs, quiet-hour bounds, and daily/weekly digest frequency. Security notices are currently represented by type `security` in the Scholar migration history. Phase 10 permits restricted controls for mandatory institutional/emergency messages and requires critical messages not be hidden in ordinary digests. CORE-19 is review-only: no production database access, application, or live external delivery is authorized.

## Options

### Option 1 — Keep best-effort writes and external push in fan-out (rejected)

Retain the current insert-and-push behavior and rely on the notification centre's latest-row presentation.

- **Consequences:** Avoids schema work, but replay creates duplicate rows, web push can contact real endpoints, preferences are not reliably visible under existing RLS, and delivery is not explicitly audited. This violates CORE-19's idempotency and test-mode constraints.

### Option 2 — Add a second delivery or idempotency table (rejected)

Create a separate delivery ledger and route the existing notification centre through it.

- **Consequences:** Could model richer provider receipts, but duplicates existing notification storage and requires a second authorization/read path. CORE-19 explicitly reserves the existing `notifications` and `notification_preferences` tables for this capability.

### Option 3 — Extend existing rows and keep this path in-app only (ruled)

Add a nullable event idempotency key and a composite recipient/school foreign key to `notifications`, enforce FORCE RLS on both existing tables, and use conflict-ignore inserts after the server resolves and authorizes the school. Read other users' preferences and digest inputs, and perform notification upserts, through the server-only service client only after the school-admin gate and with explicit school and recipient filters. Keep mandatory `security` and `emergency` types outside preference suppression and digest summaries. Do not send email, SMS, or web push from these functions.

- **Consequences:** Provides database-enforced deduplication and tenant integrity without a new table or policy. It preserves the existing three-policy sets and user-scoped RLS behavior. The privileged server path bypasses RLS, so its school-admin gate, explicit scope predicates, recipient/school foreign key, unique key, and audit are mandatory compensating controls; service-client use remains a review-sensitive boundary. External delivery and provider receipts remain unverified and out of scope.

## Recommendation (decision)

**Use Option 3 for the V1 implementation: notification rows are upserted only after server-side school resolution, same-school recipient validation, and preference evaluation; a unique `(school_id, user_id, idempotency_key)` index makes replays no-ops, while the composite recipient/school foreign key rejects cross-school recipients. FORCE RLS remains enabled with the existing three policies per table for non-service-role access. Record successful fan-out and digest attempts through the existing fail-closed write-audit hook. External channels remain disabled in this path; no live delivery is claimed.**

### Explicit residual risk

- **The residual risk:** This review has no deployment or database connection, so migration behavior and delivery in a deployed non-production database are not asserted.
- **The sharpest instance:** Existing notification rows that violate the new composite recipient/school foreign key could cause the forward migration to fail closed.
- **The accepted rationale:** No production database may be inspected or changed for this issue; the migration and tests are reviewed locally with synthetic fixtures only.
- **Owner of the residual risk:** CORE-19's human reviewer must authorize a non-production migration and record its result before claiming database verification. External provider verification remains deferred.

## Consequences (summary)

- **Positive:** Replays do not create duplicate in-app notifications; DB-level recipient/school integrity backs the server's scoped recipient resolution; preferences and quiet hours are honored; mandatory security/emergency messages are explicitly exempt; notification rows remain visible through the existing #207 centre.
- **Negative / obligations:** Each new delivery row needs a stable source key. Generic announcements without `event_id` use a deterministic content/audience key, so identical content is treated as a replay; intentional identical announcements must supply distinct event IDs. Service-client reads and writes remain server-only, follow the role gate, and include explicit same-school recipient predicates.
- **For the wave/program specifically:** This is V1 organizational notification behavior. It does not authorize or implement V2, V3, production migration application, or live email/SMS/push delivery.

## Golden Questions

- **WHO?** Scholar's existing school-admin-gated notification functions own fan-out and digest creation; human review owns deployment and residual migration risk.
- **WHAT?** Persist preference-respecting, idempotent, same-school in-app notification rows and audit the operation.
- **WHERE?** Existing `notifications` and `notification_preferences` tables, the runtime functions, `writeAuditRecord`, and the existing #207 notification centre; this ADR records the decision.
- **WHY?** CORE-19 requires replay safety, tenant-bound recipients, preference respect, audit, and no live external sends.
- **UNDER WHICH POLICY?** V1 scope and database/API/audit invariants in `AGENTS.md`; Phase 10 notification/digest requirements; existing notification RLS policies; CORE-19's no-production/no-live-send constraints.

## UNKNOWNs

- **Non-production database verification:** A human must authorize and record applying the forward migration and exercising RLS in an isolated non-production database; no live database is used by this change.
- **External channel delivery:** Provider test-mode integration and receipt evidence are not implemented here. A separately authorized V1 follow-up must define the provider test harness before any external sends.
- **Digest scheduling:** The function remains admin-triggered; automated schedule/worker ownership is not established by CORE-19.

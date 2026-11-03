# ADR-016: M05 Tenant-Scoped Offline Attendance (Issue #184)

|| Field | Value |
||---|---|
|| Status | PROPOSED (implementation authored; operator ratification required; no production database apply authorized) |
|| Date | 2026-11-03 |
|| Author | M05 offline attendance implementation |
|| Creator | `copilot-swe-agent[bot]` |
|| Mission | M05 / issue #184 (V1 organizational capability) |
|| Capabilities | V1 organizational class/shift/period attendance capture; issue #184 assigns no V1CAP identifier |
|| Supersedes-in-part | None |
|| Cites | Issues #175 and #184; AGENTS.md §§17, 26, 28, 31, 38, 45; `database/supabase/migrations/20261103100000_sherivs_m05_offline_attendance.sql`; `database/supabase/rollbacks/20261103100000_sherivs_m05_offline_attendance.sql`; `database/supabase/migrations/20261101000010_sherivs_m009_a1_role_responsibility_engine.sql`; `frontend/src/lib/offline/attendance-queue.ts`; `frontend/src/lib/runtime/scholar/attendance.functions.ts` |
|| Minimal ownership artifact | This ADR only — a decision artifact |

## Context

Issue #184 requires offline-capable daily or period attendance capture for a
class/shift, stable idempotency keys, explicit conflict handling, tenant-limited
cache, and no silent loss. The existing `attendance` table is unique per student
and date, so it cannot represent separate class, shift, or period marks. M04
provides tenant-bound campus and shift data, and M009 provides class-scoped
teacher role assignments. The existing outbox can persist offline records, but
the previous attendance flow did not connect those records to a class/period
sync contract.

The migration and rollback are new forward-only files in the M05 allocation
range. They do not alter the legacy attendance schema, existing migrations, or
production data. This mission's authority is limited to the V1 organizational
capability envelope under AGENTS.md §45.

## Options

### Option 1 — Reuse the legacy daily attendance table (rejected)

Store offline records in `attendance` and rely on its existing key and sync
behavior.

- **Consequences:** This avoids a second storage surface, but the student/date
  uniqueness cannot preserve multiple class, shift, or period marks and does not
  provide M05 batch/item conflict outcomes. Reusing it would lose distinctions
  required by issue #184 and violate the no-silent-loss requirement.

### Option 2 — Rewrite the existing attendance contract (rejected)

Change the legacy schema and its readers to represent class, shift, and period
capture.

- **Consequences:** This could unify the records, but would change existing
  behavior and migration history relied upon by current readers. The task
  requires forward-only migrations and preserving existing security contracts;
  a broad conversion exceeds the M05 scope and creates a larger rollback
  surface.

### Option 3 — Add a tenant-bound class/period capture contract (ruled)

Add separate M05 capture and item-outcome tables, a transactional sync RPC, and
an offline client queue integrated with authenticated server code.

- **Consequences:** Stable batch and item identifiers make replay safe, and
  forced RLS plus database-side teacher assignment checks preserve tenant and
  class boundaries. The additional tables and scoped read surface require
  explicit future integration with legacy attendance reports; class/period
  records are not silently mirrored into a schema that cannot represent them.

## Recommendation (decision)

**Use Option 3 for M05, subject to operator ratification.** Preserve legacy
attendance storage and readers; persist class/shift/period captures through the
new authenticated sync RPC with batch/item idempotency, deterministic conflict
outcomes, tenant-consistent references, assigned-teacher enforcement, forced
RLS, and mutation auditing. The client must retain any unacknowledged item and
must scope and clear its cache with the existing sign-out lifecycle. Only local
disposable-database tests may apply these migrations; no production apply is
authorized by this ADR or issue.

### Explicit residual risk (stated, bounded, owned — not hidden)

- **The residual risk:** Existing legacy attendance reports continue to read
  their existing store and do not automatically include M05 class/period marks.
- **The sharpest instance:** A school using both capture models may see separate
  records in the legacy report and the M05 scoped read surface.
- **The accepted rationale:** M05's required class/shift/period distinctions
  cannot be represented losslessly by the legacy per-student/date key; silently
  collapsing or mirroring them would be incorrect.
- **Owner of the residual risk:** The V1 attendance capability owner must
  authorize and validate any future report integration without weakening tenant
  isolation or altering the legacy contract.

## Consequences (summary)

- **Positive:** Replaying a queued batch is idempotent, item outcomes are
  explicit, and only assigned teachers can capture for their classes.
- **Negative / obligations:** M05 data has a separate scoped read surface,
  conflicts remain visible until explicitly reviewed, and every future report
  integration must preserve class/shift/period distinctions and tenant
  authorization.
- **For the wave/program specifically:** M05 consumes the M04 tenant model and
  M009 role-assignment evidence; it does not change role policy, onboarding, or
  the legacy attendance contract.

## Verification

`npm run verify` passed: typecheck; 548 test files and 10,241 tests passed (4
files and 18 tests skipped); registry, drift, neutrality, and secret guards; and
the production build. The local disposable PostgreSQL migration/RLS/idempotency
harness and desktop/mobile offline-sync browser tests also passed. No production
database was accessed or changed.

## Golden Questions

- **WHO?** M05 implements issue #184 within the V1 organizational envelope; the
  operator ratifies this proposed decision and the V1 attendance owner owns
  report-integration risk.
- **WHAT?** Add a tenant-scoped, idempotent offline capture contract for
  class/shift/period marks without rewriting legacy attendance.
- **WHERE?** This ADR records the decision; the new migration and rollback,
  offline queue, authenticated server function, and focused tests implement and
  verify it.
- **WHY?** The legacy student/date key cannot losslessly represent the capture
  contexts required by issue #184.
- **UNDER WHICH POLICY?** AGENTS.md §§17, 26, 28, 31, 38, 45; the M04 tenant
  model; the M009 role engine; and issues #175 and #184.

## UNKNOWNs

- Operator ratification of this proposed decision and deployment of the new
  migrations remain outside this coding mission.
- The V1 attendance owner must decide whether legacy report integration is
  required and, if so, define a lossless authorized contract before implementing
  it.
- The issue assigns no V1CAP identifier; the capability owner must reconcile
  that classification in the mission registry without claiming frozen V2/V3
  scope.

# ADR-048: M12 Tenant-Scoped Retention Runs Use Audited Tombstones (V1CAP-066)

| Field | Value |
|---|---|
| Status | APPROVED (owner decision on PR #318, 2026-11-04) |
| Date | 2026-11-04 |
| Author | CoreGrid retention implementation (M12) |
| Creator | copilot-swe-agent[bot] |
| Mission | M12 — retention and deletion (V1 organizational capability) |
| Capabilities | V1CAP-066 |
| Supersedes-in-part | None — implements, and does not amend, ADR-005, ADR-008, or ADR-009 |
| Cites | `architecture/coregrid-mvp-architecture/adr/ADR-005_RETENTION_VS_IMMUTABLE_AUDIT.md`; `architecture/coregrid-mvp-architecture/adr/ADR-008_CROSS_TENANT_ERASURE_AND_BACKUP_EXPIRY.md`; `architecture/coregrid-mvp-architecture/adr/ADR-009_CRYPTO_SHRED_DESIGNATION.md`; `architecture/coregrid-mvp-architecture/RETENTION_POLICY_SCHEDULE.json`; `AGENTS.md` §§12, 13, 16, 17, 19, 27, 28, 31 |
| Minimal ownership artifact | This ADR and `database/supabase/migrations/20261104014000_sherivs_m12_retention_tombstones.sql` |

## Context

M12 requires a retention report, an explicit approval before execution, legal holds, and an audit record for each deletion. The governing retention schedule marks durations as provisional and describes Option 2 redaction-with-tombstone; ADR-005 says immutable records are never mutated or deleted. ADR-008 requires per-tenant execution and forbids cross-tenant data operations. ADR-009 rules V1 tombstone-only and designates no crypto-shred class. The owner decision on PR #318 confirms physical deletion is out of V1 scope and interprets M12 “deletion” as an audited tombstone/redaction.

The existing Scholar tables have tenant ownership and several have immutable/audit constraints. The schedule's current table mappings cover attendance, messages, fees, the student platform fee ledger, and staff payroll. Existing audit rows remain outside execution: audit integrity is preserved and the schedule's audit family is tombstone-only.

## Options

### Option 1 — Physically delete expired source rows (rejected)

Delete the source row after a scheduler's retention window has elapsed.

- **Consequences:** removes recoverable canonical data but contradicts the V1 tombstone-only owner ruling, ADR-005's immutable-record boundary, and ADR-009's no-crypto-shred V1 rule. Rejected for V1.

### Option 2 — Silent or immediate tombstone without approval (rejected)

Create a tombstone whenever a retention window matches.

- **Consequences:** is operationally simple but does not satisfy M12's explicit approval gate or separation of duties and makes a scheduled run destructive without review. Rejected.

### Option 3 — Dry-run report, independent approval, tenant-scoped tombstone (ruled)

Every invocation begins in dry-run mode and records candidate IDs and policy/category counts. A distinct authorized tenant actor must approve that report; execution rechecks holds, policy state and source eligibility, then writes append-only tombstone audit rows only for the approved candidates.

- **Consequences:** preserves source and immutable audit rows and yields policy-linked, actor-attributed evidence. It requires application readers/projections to honor tombstone markers to render redacted values; this migration does not rewrite existing readers or delete data.

## Recommendation (decision)

**Option 3 is approved for V1.** Execution is tenant-scoped and tombstone-only. Dry-run is the only default run mode; it cannot tombstone. Approval and execution require an authorized tenant actor and an approver distinct from the requester. Execution re-evaluates active legal holds and candidate eligibility and appends one immutable audit marker per tombstoned target, including tenant, policy reference, run, approver, executor and time. No source row, audit row, or immutable record is updated or deleted. The durations remain provisional defaults and do not constitute legal advice or legal approval of a retention period.

### Explicit residual risk

- **The residual risk:** this migration records redaction/tombstone state but does not wire every existing reader to a redaction projection.
- **The sharpest instance:** a reader that bypasses the tombstone-aware projection can still display source values after their tombstone is recorded.
- **The accepted rationale:** V1 can safely record approved, tenant-scoped retention actions without destroying canonical rows; broad reader integration must be separately verified rather than implied.
- **Owner of the residual risk:** V1CAP-066 / phase 14 owns projection coverage and must verify readers before claiming complete erasure.

## Consequences (summary)

- **Positive:** dry-run, explicit SoD approval, legal holds, tenant scoping, candidate snapshots, and one policy-referenced append-only audit row per successful tombstone are enforced by database contracts and local PostgreSQL tests.
- **Negative / obligations:** retention durations remain provisional; hold release is itself audited; tombstones must be consumed by redaction projections; policy changes invalidate stale candidate snapshots; backups continue to follow ADR-008/ADR-011.
- **For the wave/program specifically:** M12 consumes the V1 M04 tenant and M13 role/audit foundations. The scheduler may invoke only the dry-run RPC; a tenant-authorized human must approve and execute.

## Golden Questions

- **WHO?** An authorized member of one tenant requests/configures; another authorized member approves; an authorized tenant member executes. Phase 14 owns retention policy and projection completeness.
- **WHAT?** V1 retention execution appends an audited tombstone and never physically deletes source or immutable audit records.
- **WHERE?** This ADR rules semantics; the retention schedule supplies provisional durations; the M12 migration stores tenant policies, reports, holds, approvals and tombstone audit; the Verify local PostgreSQL harness exercises the invariants.
- **WHY?** M12 requires dry-run, approval, holds and deletion audit while ADR-005/008/009 and the owner decision require tombstone-only, tenant-scoped V1 execution.
- **UNDER WHICH POLICY?** ADR-005, ADR-008, ADR-009, the schedule's `RP-ATTND-EDU`, `RP-COMMS-EDU` and `RP-FINAN-EDU`, and AGENTS §§12, 13, 16, 17, 19, 27, 28 and 31.

## UNKNOWNs

- Complete redaction projection coverage remains unverified; phase 14 closes this by inventorying and testing every reader of mapped source tables.
- Concrete retention durations remain provisional; the responsible legal/operator review must rule each duration before production execution.
- Mapped target coverage is intentionally limited to the five legacy Scholar tables listed in the migration. New source families require a reviewed additive policy mapping and tests.
- No migration or database operation in this change applies to a production or hosted database.

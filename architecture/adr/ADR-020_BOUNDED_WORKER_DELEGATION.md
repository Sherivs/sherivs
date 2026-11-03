# ADR-020: Bounded Worker Delegation and Audited Activation (CORE-05)

| Field | Value |
|---|---|
|| Status | PROPOSED (operator ratification required before deployment) |
|| Date | 2026-11-03 |
|| Author | copilot-swe-agent[bot] / WORKFORCE |
|| Mission | CORE-05 (V1 organizational capability envelope; WORKFORCE) |
|| Capabilities | Existing worker activation, delegation, quarantine, and lifecycle evidence |
|| Supersedes-in-part | None |
|| Cites | [AGENTS.md](../../AGENTS.md#45-v1-execution-boundary); [worker definitions migration](../../database/supabase/migrations/20261002000002_coregrid_v1_worker_definitions.sql); [mission lease migration](../../database/supabase/migrations/20261003000019_coregrid_v1_mission_lease.sql); [worker host](../../frontend/src/lib/workforce/worker-host.ts); [worker registry](../../frontend/src/lib/workforce/worker-registry-db.server.ts); [delegation contract](../../frontend/src/lib/mission/delegation-contract.ts); [CORE-05 gap](../../docs/v1/V1-GAP-REPORT.md) |
|| Minimal ownership artifact | This ADR, additive grant-expiry ALTER, and service-role-only atomic grant/revoke RPCs |

## Context

The worker-definition substrate and live grant/quarantine surfaces already exist in repository migrations `20261002000002` and `20261003000019`; these are reused rather than duplicated. The live worker grant schema had no expiry, and grant, heartbeat, action, and completion gates did not consistently re-check worker authority. The canonical mission delegation contract already expresses revocation, time bounds, and mission scope; the worker registry must enforce equivalent bounded behavior at activation and execution.

The CORE-05 issue reports, from read-only production evidence, that the first migration is recorded in `schema_migrations`, the five `cg_worker_*` objects exist, and their RLS/FORCE RLS posture has zero policies. This ADR does not claim a fresh production inspection or any production write. The repository migration itself has an “AUTHORED, NOT APPLIED” header; that describes its authored-file status, not the separate production inventory reported by the issue.

## Options

### Option 1 — Recreate the worker tables (rejected)

Create a new schema for the bounded runtime.

- **Consequences:** duplicates existing authority records and contradicts the production inventory and migration history. Rejected under AGENTS §39 and CORE-05's no-duplicate-table constraint.

### Option 2 — Broaden RLS or add client policies (rejected)

Grant authenticated clients access to worker definitions and delegation state.

- **Consequences:** would weaken the existing zero-policy deny-by-default posture without a proven tenant- and capability-scoped policy. Rejected under AGENTS §17 and CORE-05's no-broader-access requirement.

### Option 3 — Extend the existing grants and enforce at each boundary (ruled)

Add nullable expiry metadata to the existing append-only delegation history and live grant table; have runtime code reject legacy NULL, not-yet-effective, revoked, expired, quarantined, capability-escalated, or mission-mismatched grants at wake, lease, heartbeat, action, and completion admission. Use service-role-only transactional RPCs so a grant/revocation state change and its existing append-only `audit_logs`/`audit_chain` evidence commit atomically. Since the existing audit bridge keys `audit_chain` by `audit_logs.school_id`, grant/revoke RPCs and worker lifecycle evidence fail closed unless the tenant is a canonical UUID; no tenant-to-school mapping is guessed.

- **Consequences:** preserves the existing tables and RLS boundary and makes grant expiry enforceable without rewriting migration history. Legacy rows remain readable but lose effective authority until renewed. The RPCs add no policies and are executable only by `service_role`; the service-role adapter remains security-critical and must continue to apply explicit tenant, worker, grant, capability, and mission checks.

## Recommendation (decision)

**Use Option 3. No new `cg_worker_*` table or policy is authorized. A worker can wake or execute only under a grant that has taken effect, remains active and unexpired at the decision instant, and explicitly covers `mission:execute:<missionId>` (or the existing explicit tenant-wide capability). Re-resolve the grant before each action, heartbeat, and completion; atomically audit grant and revoke, and audit wake, run, and sleep with actor, worker, grant, and correlation ID through the existing append-only audit path. Quarantine remains an immediate denial.**

### Explicit residual risk

- **The residual risk:** a grant may be revoked after a provider action has begun.
- **The sharpest instance:** a remote AI request already in flight cannot be recalled by a subsequent authorization check.
- **The accepted rationale:** the host revalidates immediately before the action and on every heartbeat; a post-action check prevents success/evidence acceptance if authority was revoked while it ran.
- **Owner of the residual risk:** WORKFORCE; report any executor path that can perform multiple actions without calling the host's authorization handle.

## Consequences (summary)

- **Positive:** renewal-bound active grants, exact mission capability checks, immediate next-action revocation, quarantine denial, and correlated lifecycle audit become mechanically testable.
- **Negative / obligations:** existing active rows with NULL expiry are deliberately ineffective until renewed; operational migration/renewal planning is required before deployment. Non-UUID tenant IDs cannot use this audit-bound worker path until an authorized canonical mapping exists. The migration must preserve RLS, FORCE RLS, and grants exactly except for `EXECUTE` on the two atomic RPCs, which is granted only to `service_role`.
- **For the wave/program specifically:** CORE-05 provides the bounded activation substrate consumed by CORE-06 and the authorized Twin/JARVIS contracts; it does not implement a general AI workforce control plane.

## Golden Questions

- **WHO?** WORKFORCE owns enforcement; the operator ratifies this proposed ADR.
- **WHAT?** Existing worker grants must be active, unexpired, capability- and mission-scoped, and rechecked before action.
- **WHERE?** This ADR; `cg_worker_delegation[_grant]`; `worker-registry-db.server.ts`; `worker-host.ts`; `writeAuditRecord`.
- **WHY?** CORE-05 found that the existing runtime grant had no expiry and was not rechecked during execution.
- **UNDER WHICH POLICY?** AGENTS §4, §17, §18, §28, §29, §30, §31, §39, §42, §45; CORE-05 hard constraints; existing RLS-deny-by-default worker migrations.

## UNKNOWNs

- Production deployment, live schema verification, and any grant renewal remain explicitly outside this change and require human authorization.
- Existing production grants' expiry values are not established by this repository; after the additive migration, NULL remains non-authorizing until an authorized renewal path supplies an expiry.
- A future multi-action executor must call `authorizeExecution()` before each action; CORE-05 verifies the current single gateway action path.

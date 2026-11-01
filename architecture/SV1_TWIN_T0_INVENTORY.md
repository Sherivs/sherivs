# SV1-TWIN T0 inventory and scope decision

**Status:** T0 inventory complete; implementation is not authorized by this artifact.

**Capability version target:** FUTURE-UNASSIGNED pending the Phase 16 boundary review.

**Scope of this document:** Analysis and proposal only. No schema, runtime, API, or UI change is authorized here.

## Executive decision

The repository has reusable twin, role/workspace, memory, and observation foundations, but does not establish a personal twin per identity or the issue's role-contextual sleep/wake service. More importantly, the governing V1 scope records the Phase 16 organizational-graph versus device/physical-twin boundary as unresolved (D4 open), and the V1 capability catalog classifies the existing twin implementation as `FUTURE-V3/V2` and says not to extend it. The SV1-TWIN proposal cannot be assumed to be the unresolved V1-shaped exception.

Accordingly, this PR completes the issue's documentation-only T0 inventory. T1–T6 implementation, migrations, runtime wiring, UI, and claims that any SV1-TWIN capability is implemented are blocked until a human records the Phase 16 boundary decision and an explicit version-target authorization. Existing, independently authorized V1 identity, workspace, memory, and worker work may continue under its existing owner and scope; it must not be relabeled as Twin implementation.

## Existing repository evidence

| Area | Existing substrate | Gap against SV1-TWIN |
| --- | --- | --- |
| Twin domain | `frontend/src/lib/twin-core.ts` defines generic tenant-scoped twin identities, kinds, lifecycle, provenance, and ownership references. `frontend/src/lib/twin-state.ts` defines observation, state-history, and synchronization contracts. Unit tests cover these domain behaviors. The legacy `database/supabase/migrations/20260626133221_e95464b7-e864-413c-a934-7428cb26da47.sql` defines `digital_twin_config` (one configuration per school) and `digital_twin_calls`; `frontend/src/lib/runtime/scholar/digital-twin.functions.ts` exposes school-admin configuration and outbound-call functions, including a guardian-consent check for student-related calls. | Neither the generic models nor the school-level legacy configuration establish one personal twin per authenticated identity or an identity-to-twin uniqueness constraint. The legacy call table stores recipient phone numbers, transcripts, and recording URLs under school-admin RLS; it is not the personal memory substrate and must not be reused without a separate privacy, retention, authorization, and audit review. |
| V1 boundary | `architecture/coregrid-mvp-architecture/foundation/COREGRID_V1_CAPABILITY_CATALOG.json` identifies the twin area as `FUTURE-V3/V2`, with a freeze disposition. `architecture/coregrid-mvp-architecture/foundation/COREGRID_V1_SCOPE_LOCK.json` lists the Phase 16 split as unresolved and requires a recorded human decision before unfreezing. | No evidence currently authorizes extending twin code for the personal assistant proposal. The classification is a blocker, not an implementation detail. |
| Role and workspace | `frontend/src/lib/scholar/roles/role-template-catalog.ts` defines role categories, data-access scopes, role responsibilities, and validation that responsibilities fit both category and role scope. The workspace engine and role-assignment substrate are existing V1 systems. | The inspected role catalog does not define Twin persona names, lens memory, or Twin-specific tools/playbooks, nor show a Twin context-switch integration. Workspace authorization must remain authoritative; a lens cannot grant access beyond it. |
| Practical/organizational memory | `database/supabase/migrations/20261002000004_coregrid_v1_memory_tier.sql` authors scoped practical/organizational records and an append-only access log. The migration explicitly has no embeddings/vector column; it enables RLS with zero policies and revokes `anon`/`authenticated`. `frontend/src/lib/memory/memory-store.ts` specifies identity-, tenant-, and declared-scope-gated access with audit outcomes. | The migration is marked authored, not applied. It is not a personal-twin schema and has no `(twin_id, role_assignment_id)` lens. Its RLS posture is deny-by-default service-role access, not user-readable forced RLS policies for a Twin. No vector/semantic profile is justified by this substrate. |
| Hermes observations | `database/supabase/migrations/20261003000030_coregrid_hermes_observation_substrate.sql` authors append-only, tenant-scoped, AI-generated observations and is marked authored, not applied. Its RLS policy count is intentionally zero. The server trigger is an invocation seam, not a standalone queue/worker runtime. | Hermes records what was observed; it does not provide Twin identity or user-owned memory. No evidence connects these observations to a per-person, role-scoped Twin or supports unrestricted transfer into model context. |
| Wake/runtime and budgets | The V1 capability catalog records the ephemeral trigger/queue/worker runtime as a gap. It also records the intelligence gateway as thin, with routing, cost/rate controls, fallback, and logging missing; metering is a separate gap. | No Twin job queue, scale-to-zero worker, per-user budget, Twin/org kill switch, or tested idle-cost result is established. Event observations alone do not prove jobs are being enqueued or processed. |
| Audit and approval | Existing V1 memory and mission contracts provide audit/approval-related primitives; `frontend/src/lib/trust-ledger/hash-chain.server.ts` is an audit-related implementation. The capability catalog still marks universal audit as partial, and no `audit_chain` table was identified in the inspected migration files. | The proposal is not wired to a verified canonical audit contract, an approval path for Twin actions, or a tested audit-completeness invariant. No sensitive action may be executed by a proposed Twin. |
| UI and offline delivery | Existing role workspaces and notification/communication components are available for their own authorized purposes. | No Twin panel, away brief, growth ledger, offline cache, or authorized WhatsApp/SMS delivery flow is established for this proposal. |

## Gap matrix and phase gates

| Epic phase | Deliverable described by the issue | T0 finding / gate |
| --- | --- | --- |
| T0 | Inventory, gap matrix, architecture record | **Complete in this document.** Documentation does not unfreeze implementation scope. |
| T1 | Personal twin provisioning, memory schema, RLS, isolation tests | **Blocked:** requires recorded V1/FUTURE boundary decision, identity binding/uniqueness design, approved data classification, and an authorized migration plan. No production database changes. |
| T2 | Role lens, persona, scoped tools, workspace-switch integration | **Blocked:** depends on issues #196 and #199 as stated in the epic and the T1 authority gate. Do not add a parallel role engine or speculative interfaces while the feature itself remains frozen. |
| T3 | Sleep/wake events, queue, ephemeral worker, budget, kill switch, observability | **Blocked:** requires authorized runtime ownership and resolution of the V1 worker, gateway, and metering gaps. No live event source or cost behavior is claimed. |
| T4 | Role playbooks, predictions, away brief, growth ledger | **Blocked:** derived intelligence, model-context policy, and data-minimization controls need separate authorization and verification. Predictions must not modify canonical records. |
| T5 | Assistant panel and away brief across workspaces | **Blocked:** no authorized Twin API or lens contract exists to safely render. UI work must follow backend enforcement and include desktop/mobile evidence. |
| T6 | Isolation, injection, cost, and evidence verification | **Blocked until implementation is authorized:** tests must prove tenant/user/role isolation, approval and audit behavior, and measured idle/runtime costs; documentation alone is not evidence of these properties. |

## Required authorization before implementation

1. Record a human decision resolving D4: whether this exact personal, role-contextual Twin capability is an ACTIVE-V1 organizational capability, a mixed capability with a bounded V1 portion, or remains FUTURE-UNASSIGNED. Identify the owner and canonical architecture destination.
2. If any portion is authorized, state its exact version target and scope. Preserve the existing generic twin freeze outside that boundary.
3. Reconcile T1 with the existing memory owner and security posture before proposing migrations. Decide how user self-access is proven, how support access uses audited grants, and whether database-enforced `FORCE ROW LEVEL SECURITY` is required on each new table.
4. Define the role-lens contract as a constrained consumer of active role/workspace authorization, not an independent permission source. Define what information may persist across roles and what must remain lens-local.
5. Authorize each implementation phase separately with a rollback and verification plan. All migrations remain files until explicit apply authorization.

## Security and verification invariants for a future authorized design

- One authenticated identity and one tenant context must be resolved server-side; never trust a client-supplied identity, tenant, role, or workspace.
- Every memory read/write must be tenant- and owner-scoped, purpose-bound, sensitivity-aware, and audited. A role lens may narrow authority, never widen it.
- Keep Hermes observations, canonical records, personal memory, predictions, and proposed actions distinct. Do not treat generated or unverified information as canonical truth.
- Minimize and redact model context, defend against injected content, and keep AI providers behind the existing gateway.
- Require human approval for sensitive actions and record proposals, decisions, execution, and denial in the canonical audit path.
- Verify cross-tenant, cross-user, cross-role, revoked-access, and expired-access denial before deployment. UI restrictions are not authorization.

## Status summary

- **T0 inventory:** documented in this file.
- **Twin identity/provisioning, role lens, runtime, recommendations, UI:** not implemented or verified by this work.
- **Deployment:** none.
- **Known blocker:** Phase 16 D4 and explicit version-target authorization remain unresolved.

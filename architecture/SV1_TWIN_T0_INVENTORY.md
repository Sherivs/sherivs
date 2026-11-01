# SV1-TWIN T0 inventory and scope decision

**Status:** T0 inventory complete; this artifact is an inventory, not implementation evidence.

**Capability version target:** ACTIVE-V1 for the bounded personal-twin slice named in `docs/v1/V1-SCOPE-LOCK.md`; physical/device twins and V3 Reality Intelligence remain frozen.

**Scope of this document:** Analysis and proposal only. No schema, runtime, API, or UI change is authorized here.

## Executive decision

The repository has reusable twin, role/workspace, memory, and observation foundations, but does not establish a personal twin per identity or the issue's role-contextual sleep/wake service. The owner-authorized V1 scope record in `docs/v1/V1-SCOPE-LOCK.md` explicitly names #223's bounded personal-twin slice. This resolves the version-target blocker for that named slice only; physical/device twins and V3 Reality Intelligence remain outside the authorization.

Accordingly, T1–T6 are authorized V1 work but remain unimplemented until their technical, security, owner, and operational gates are satisfied. This T0 inventory does not authorize production database changes or establish that any SV1-TWIN capability is implemented. Existing V1 identity, workspace, memory, and worker work remain governed by their existing owners and boundaries.

## Existing repository evidence

| Area | Existing substrate | Gap against SV1-TWIN |
| --- | --- | --- |
| Twin domain | `frontend/src/lib/twin-core.ts` defines generic tenant-scoped twin identities, kinds, lifecycle, provenance, and ownership references. `frontend/src/lib/twin-state.ts` defines observation, state-history, and synchronization contracts. Unit tests cover these domain behaviors. The legacy `database/supabase/migrations/20260626133221_e95464b7-e864-413c-a934-7428cb26da47.sql` defines `digital_twin_config` (one configuration per school) and `digital_twin_calls`; `frontend/src/lib/runtime/scholar/digital-twin.functions.ts` exposes school-admin configuration and outbound-call functions, including a guardian-consent check for student-related calls. | Neither the generic models nor the school-level legacy configuration establish one personal twin per authenticated identity or an identity-to-twin uniqueness constraint. The legacy call table stores recipient phone numbers, transcripts, and recording URLs under school-admin RLS; it is not the personal memory substrate and must not be reused without a separate privacy, retention, authorization, and audit review. |
| V1 boundary | `docs/v1/V1-SCOPE-LOCK.md` authorizes the bounded personal-twin slice in #223. The underlying catalog's `FUTURE-V3/V2` classification remains applicable to physical/device twins and unrelated capabilities. | The authorization resolves the version-target blocker for the named slice only; technical and security gates remain. |
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
| T1 | Personal twin provisioning, memory schema, RLS, isolation tests | **Not implemented:** requires identity binding/uniqueness design, approved data classification, and an authorized migration plan. No production database changes. |
| T2 | Role lens, persona, scoped tools, workspace-switch integration | **Not implemented:** depends on issues #196 and #199 as stated in the epic and completion of T1. Do not add a parallel role engine. |
| T3 | Sleep/wake events, queue, ephemeral worker, budget, kill switch, observability | **Not implemented:** requires runtime ownership and resolution of the V1 worker, gateway, and metering gaps. No live event source or cost behavior is claimed. |
| T4 | Role playbooks, predictions, away brief, growth ledger | **Not implemented:** derived intelligence, model-context policy, and data-minimization controls require design and verification. Predictions must not modify canonical records. |
| T5 | Assistant panel and away brief across workspaces | **Not implemented:** no Twin API or lens contract exists to safely render. UI work must follow backend enforcement and include desktop/mobile evidence. |
| T6 | Isolation, injection, cost, and evidence verification | **Not implemented:** tests must prove tenant/user/role isolation, approval and audit behavior, and measured idle/runtime costs; documentation alone is not evidence of these properties. |

## Remaining governance gates before implementation

1. Keep the #223 version authorization bounded to the personal, role-contextual Twin capability; preserve the existing generic physical/device twin freeze outside that scope.
2. Reconcile T1 with the existing memory owner and security posture before proposing migrations. Decide how user self-access is proven, how support access uses audited grants, and whether database-enforced `FORCE ROW LEVEL SECURITY` is required on each new table.
3. Define the role-lens contract as a constrained consumer of active role/workspace authorization, not an independent permission source. Define what information may persist across roles and what must remain lens-local.
4. Require phase-specific owner review, rollback, and verification plans before implementation; all migrations remain files until explicit apply authorization.

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

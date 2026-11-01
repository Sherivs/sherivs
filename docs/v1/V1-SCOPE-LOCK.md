# V1 scope lock

- **Authority:** Owner directive in issue [#233](https://github.com/vibeoraai-bit/coregrid-scholar-migration/issues/233), dated 2026-11-01.
- **Version target:** V1 organizational capability envelope only.
- **Status:** Documentation scope record; it is not evidence of implementation, testing, deployment, or production verification.
- **Companion evidence:** [V1-GAP-REPORT.md](./V1-GAP-REPORT.md).

## Governing boundary

The V5.3 execution boundary in `AGENTS.md` §45 remains in force: V2 device/IoT, V3 Reality Intelligence, and future-unassigned capabilities remain frozen unless an explicit human authorization record names the capability and version target. Issue #233 is the explicit owner authorization for the bounded V1 slices below. It does not reclassify an entire architecture phase, authorize unrelated future capability, or claim that any listed epic is complete.

The V1 baseline remains the 33 organizational capability areas in `architecture/coregrid-mvp-architecture/foundation/COREGRID_V1_SCOPE_LOCK.json`. The exact list is identity, tenancy, organization, entity, relationship, state, event, authorization, workspace, workflow, mission, workforce, AI worker, intelligence gateway, context, practical memory, minimal application builder, website, customer workspace, communication, payments, files, notifications, integrations, minimal metering, minimal observability, audit, evidence, verification, security, domain configuration, Scholar runtime, and practical search.

## Authorized V1 epic slices

| Epic | Authorized V1 scope | Scope constraints and source |
|---|---|---|
| [#196 Roles](https://github.com/vibeoraai-bit/coregrid-scholar-migration/pull/196) | Tenant-scoped role/responsibility engine, effective-dated assignments, authorized mutation paths, fail-closed workspace manifest, and its tests. | Reuse existing permission IDs and role/workspace contracts. No parallel authorization engine. The PR says no live database changes were included; authorization does not imply deployment. |
| [#218 WhatsApp Cloud](https://github.com/vibeoraai-bit/coregrid-scholar-migration/pull/218) and [#222 shared communications](https://github.com/vibeoraai-bit/coregrid-scholar-migration/pull/222) | Organization-scoped WhatsApp messaging, webhook processing, verified recipient resolution, governed proposal/approval, shared gateway, and communications inbox/log. | Server-resolve organization and recipients; preserve consent, forced RLS, audit, and approval boundaries. #222 is an open draft at this snapshot and is not treated as merged or deployed. |
| [#219 Africa’s Talking voice](https://github.com/vibeoraai-bit/coregrid-scholar-migration/pull/219) and [#220 organization voice add-on](https://github.com/vibeoraai-bit/coregrid-scholar-migration/pull/220) | Consented support callback and the explicitly requested tenant-scoped voice AI add-on, with governed provider adapters and human escalation. | Keep live voice disabled unless explicitly enabled; consent before recording; tenant/entitlement checks, rate limits, audit, and test-mode safety. #220 remains an open draft with no implementation changes in its description. |
| [#223 Personal twins](https://github.com/vibeoraai-bit/coregrid-scholar-migration/issues/223) | Exactly one identity-bound personal twin with role-context lenses, bounded memory, event-triggered runtime, approved recommendations, and workspace surfaces. | Reuse existing identity, workspace, memory, and Hermes/worker primitives; lens permissions only narrow active authorization. No physical/device twin, tenant crossing, autonomous sensitive action, or claims based on generic twin contracts. |
| [#225 JARVIS](https://github.com/vibeoraai-bit/coregrid-scholar-migration/issues/225) | Bounded internal agent registry/workforce, risk-tier policy, approval inbox, escalation ladder, role playbooks, existing-coordinator routing, and minimized read-only report feed. | Extend Hermes and existing workforce/approval/communications contracts; no second agent runtime. T3 requires human passkey approval, T4 is denied, and agents receive no standing privileged credentials. |
| [#227 Scheduling](https://github.com/vibeoraai-bit/coregrid-scholar-migration/issues/227) | The named bell designer and AI timetable workflow, including only the requirements of the epic’s ten-row S0 matrix and its bounded S1–S5 delivery. | This is a narrow authorization despite the prior V2-frozen classification in `progress/v1-wave/SV1-SCHED-S0-gap-matrix.md`. It does not unfreeze all Phase 12 or authorize unrelated scheduling, simulation, or future capabilities. Existing generic scheduling primitives are not proof the Scholar workflow is complete. |
| [#229 Reality Engine and arm picker](https://github.com/vibeoraai-bit/coregrid-scholar-migration/issues/229) | The named educational Reality Engine and class-arm picker, built by extending the existing Scholar operating model and reality/workforce structures. | Reuse canonical tenant, organization, role, workspace, website, and scheduling owners; do not create duplicate stores or engines. Keep V2/V3 physical/reality-intelligence capabilities frozen. Issue #229's phase-specific written approval gate for R1+ remains in force. “Authorized V1” is scope authority, not implementation evidence; report each delivered phase with evidence. |
| [#231 SV1-PAY](https://github.com/vibeoraai-bit/coregrid-scholar-migration/issues/231) | Paystack TEST-key-only hardening: tenant-safe routing, verified/idempotent webhooks, ledger reconciliation, refunds/partial payments/plans/receipts, security tests, and a live-switch runbook only. | No live Paystack keys or live switch. Server-derived amounts, currency and tenant context; no client-trusted payment values or client service-role key. |
| [#232 SV1-LITE](https://github.com/vibeoraai-bit/coregrid-scholar-migration/issues/232) | Offline-first app-shell and requested data reads, conflict-safe outbox, Data Saver behavior, sync UI, tenant-local data lifecycle, and Slow 3G verification. | Extend existing PWA/offline code; local data is tenant-scoped and wiped on logout/role switch. No new mobile framework or unsafe cross-user cache. |

## Explicitly out of scope

- V2 device/IoT, hardware control, sensors, telemetry, edge orchestration, and physical twins.
- V3 Reality Intelligence, geospatial/physical simulation, and future intelligence systems outside the expressly named Reality Engine slice.
- Future-unassigned capabilities not listed above.
- Any second runtime, second role engine, second memory store, or duplicate scheduling/reality/payment/communications engine.
- Production database changes, live provider credentials/sends/calls/payments, or irreversible operations without separate explicit authorization and operational evidence.
- Treating closed issues, merged documentation-only PRs, architecture text, unit tests, or code presence as proof of production deployment or verification.

## Evidence and implementation gates

1. Use [V1-GAP-REPORT.md](./V1-GAP-REPORT.md) as the current evidence inventory and gap-to-issue proposal list. Status is tracked independently for design, implementation, tests, deployment, and production verification.
2. Before implementation, create one focused issue per remaining gap after owner review of the documentation-only change. Each issue must state its exact authorized V1 slice, canonical owner, acceptance tests, tenant/security invariants, deployment boundary, rollback, and evidence expected.
3. Keep all migrations file-only until separately authorized to apply. Preserve tenant isolation, server-resolved identity and recipient scope, least privilege, RLS, immutable audit, data minimization, and human approval for sensitive actions.
4. Do not extend an epic beyond the scope named here. Any conflict with frozen V2/V3 or future-unassigned scope requires a further explicit owner authorization record before implementation.
5. Record actual deployment and production verification only when supported by live evidence; no such evidence is implied by this lock.

## Issue-creation status

The current coding-session toolset does not expose a GitHub issue-creation operation. The gap report therefore supplies a one-to-one proposed issue title for every identified remaining gap but does not claim that those issues have been opened. This scope-lock update is documentation-only and awaits owner review.

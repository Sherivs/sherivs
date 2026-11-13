# ADR-035: SV1 JARVIS Governed Agent Registry and Risk Policy

| Field                      | Value                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status                     | PROPOSED (operator ratification required before deployment)                                                                                                                                                                                                                                                                                                                                                                                     |
| Date                       | 2026-11-04                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Author                     | `copilot-swe-agent[bot]` (SV1-JARVIS-01 implementation)                                                                                                                                                                                                                                                                                                                                                                                         |
| Creator                    | `copilot-swe-agent[bot]`                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Mission                    | SV1-JARVIS-01 (V1 organizational capability envelope)                                                                                                                                                                                                                                                                                                                                                                                           |
| Capabilities               | Existing CORE-05 worker identity, capability, and delegation substrate                                                                                                                                                                                                                                                                                                                                                                          |
| Supersedes-in-part         | None                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Cites                      | [V1 scope lock](../../docs/v1/V1-SCOPE-LOCK.md); [J0 threat model](../../docs/jarvis/J0-inventory-gap-and-threat-model.md); [worker registry](../../frontend/src/lib/workforce/worker-registry.ts); [capability registry](../../frontend/src/lib/workforce/capability-registry.ts); [worker definition migration](../../database/supabase/migrations/20261002000002_coregrid_v1_worker_definitions.sql); AGENTS.md §§13, 16, 17, 21, 28, 31, 45 |
| Minimal ownership artifact | This ADR and the versioned risk-policy/authority contracts; no new registry table                                                                                                                                                                                                                                                                                                                                                               |

## Context

The bounded JARVIS V1 slice is authorized, but the existing CORE-05 worker definition is tenant-scoped and its declared capabilities alone grant no authority. The J0 threat model requires a platform-scoped worker context that does not masquerade as a tenant, a versioned T0–T4 mapping, execution-time approval revalidation, and no new agent runtime or duplicate registry. The existing worker definitions, capability declarations, and delegation state are the canonical workforce substrate; the capability registry rejects unknown claims.

## Options

### Option 1 — Create a JARVIS-specific agent registry (rejected)

Persist another list of internal agents and their grants separately from `cg_worker_*`.

- **Consequences:** creates competing identity and authority records, permits drift from CORE-05 lifecycle/delegation controls, and violates the no-second-registry constraint.

### Option 2 — Treat declared worker capabilities as platform authority (rejected)

Project a worker definition directly into a platform context without requiring a current delegation.

- **Consequences:** converts declarations into grants, bypasses revocation and expiry, and conflicts with CORE-05's deny-by-default worker model.

### Option 3 — Resolve platform context from CORE-05 records and enforce a versioned policy (ruled)

Resolve a platform authority context only from an active AI worker definition, a live matching delegation, declared platform control-plane scope, and registered capabilities. Apply a policy-versioned action map at each decision; require an action-bound human console approval for T2, Sheriff passkey approval for T3, and deny T4 unconditionally.

- **Consequences:** preserves one canonical worker registry and the existing capability/risk vocabulary. A platform-scoped delegation must be server-resolved and revalidated for each action; this contract does not create a persistent grant source or claim an execution adapter.

## Recommendation (decision)

**Use Option 3. Do not add a worker/agent table or migration. The authority resolver is a request-time projection of CORE-05 records, not another registry; it returns no tenant authority and grants nothing unless definition, delegation, capability registration, lifecycle, scope, and risk ceilings all validate. Each policy decision carries version `1.0.0` and a stable action reference; approvals bind to that exact action and worker. T2 requires current console approval, T3 requires current Sheriff console approval with passkey step-up, and T4 is always denied.**

## Consequences (summary)

- **Positive:** unknown actions, stale authority, unregistered capabilities, and risk-ceiling mismatches fail closed. Policy decisions are attributable to an explicit policy version.
- **Negative / obligations:** callers must load grants through trusted server-side workforce infrastructure and revalidate them immediately before execution. This ADR does not implement a durable platform-grant adapter, approval inbox, passkey ceremony, executor, or audit persistence; those remain explicit follow-up work and no action execution is claimed here.
- **For the wave/program specifically:** JARVIS reuses CORE-05 workforce identity and capability records and Hermes remains the sole coordinator/runtime.

## Golden Questions

- **WHO?** SV1-JARVIS owns this bounded V1 policy contract; the operator ratifies it.
- **WHAT?** Existing governed workers receive only fresh, delegated platform authority subject to versioned T0–T4 policy.
- **WHERE?** This ADR; `platform-agent-authority.ts`; `risk-policy.ts`; CORE-05 worker and capability records.
- **WHY?** J0 identified the missing platform-scoped worker context and unverified T0–T4 mapping.
- **UNDER WHICH POLICY?** V1 scope lock, AGENTS.md security and V1 boundaries, CORE-05 worker lifecycle and delegation constraints, and JARVIS T3/T4 invariants.

## UNKNOWNs

- **Platform delegation persistence:** WORKFORCE must define how a server-side platform-scoped grant is represented/retrieved without treating the Control Plane as a tenant; close before connecting execution.
- **Approval and audit adapters:** later JARVIS phases must connect approval revalidation to the human console/passkey path and persist policy/action evidence to the shared append-only audit stream before any execution is enabled.
- **External sends:** communications execution must remain behind existing governed connectors; tests and test-mode operations must never contact real recipients.

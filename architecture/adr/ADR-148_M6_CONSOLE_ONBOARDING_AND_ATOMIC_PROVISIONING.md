# ADR-148: Console Onboarding Review and One-Transaction Provisioning from an Approved Plan

| Field                      | Value                                                                                                                                                                                                                                                                                    |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status                     | PROPOSED (founder approval required before the migration is applied; NOT APPLIED)                                                                                                                                                                                                        |
| Date                       | 2026-11-18                                                                                                                                                                                                                                                                               |
| Author                     | Claude Code agent (mission M6 implementation)                                                                                                                                                                                                                                            |
| Creator                    | Claude Code agent, mission E-016 (M6 console onboarding queue and provisioning)                                                                                                                                                                                                          |
| Mission                    | M6 (master brief §8.4, §11.3, §12.1 M6)                                                                                                                                                                                                                                                  |
| Capabilities               | Staff review a pre-tenant onboarding request and its generated plan, approve it with a passkey bound to the plan hash, and provision it in one transaction                                                                                                                               |
| Cites                      | [ADR-102](./ADR-102_M1_CANONICAL_ORGANIZATION_ROOT.md); [ADR-107](./ADR-107_M5A_REALITY_INTERVIEW_QUESTION_GRAPH.md); [ADR-108](./ADR-108_M5_PRE_TENANT_ONBOARDING_REQUESTS.md); [ADR-114](./ADR-114_M2_ROLE_PACK_ENGINE_DATA_MODEL.md); JARVIS step-up (`lib/jarvis-bridge/step-up.ts`) |
| Minimal ownership artifact | `database/supabase/migrations/20261117003100_sherivs_m6_onboarding_provisioning.sql`                                                                                                                                                                                                     |

## Context

M5b stores pre-tenant onboarding requests and interview answers; M5a turns answers into a plan; M2b installs role packs; M1 defines the organization root and `organization_root_gaps()`. Nothing connected them. The existing TypeScript provisioner (`lib/onboarding/provision-organization.ts`) writes through PostgREST under a compensation ledger and itself records that native atomicity needs a database function. `onboarding_sessions` already carries `plan`, `plan_hash` and `applied_result` but needs an existing organization.

## Options

- **A. Drive provisioning from TypeScript with the compensation ledger.** Rejected: a crash between writes leaves a partial tenant, which the brief forbids.
- **B. A new provisioning table family and engine.** Rejected: duplicates `onboarding_requests`, `onboarding_sessions` and the provisioner.
- **C. Extend the existing records and add one service-role SECURITY DEFINER function that provisions in one transaction.** Chosen.

## Decision

1. **Review state lives on `onboarding_requests`** (generated plan, plan under review, database-computed sha-256 `plan_hash`, revision, editor, approver, approval time, step-up flag, provisioned organization). Any edit withdraws an earlier approval.
2. **`onboarding_sessions` stays the application record.** Provisioning writes one row per organization with `plan`, `plan_hash`, `applied_result`, linked by a new unique `onboarding_request_id`, which is also the idempotency key.
3. **One function, one transaction.** `onboarding_provision_from_plan` writes the root (`schools`), the kernel record (`cg_tenant` with the same id, plus `school_tenant_map`), the console record (`platform_organization` and a transition row), `institution_profile`, org units, the role pack through `role_pack_install`, the first-admin invitation, the website draft (`websites` exists on master), the application record and the request status, then refuses to commit if `organization_root_gaps()` lists the new organization. Admissions settings and authority links have no table on master and are recorded as pending in `applied_result`.
4. **Idempotent.** A provisioned request returns the stored `applied_result` with `replay: true` and writes nothing; a different hash is refused.
5. **Authority.** Every function is EXECUTE for `service_role` only. The acting staff member is passed by the console server and re-checked in the database: `platform.onboarding.handle` to assign, generate and edit; `platform.tenants.manage` to approve and provision. A super-admin flag alone is not a staff role, matching the console's existing rule. AAL2 is required in the server for approve and provision.
6. **Passkey step-up bound to the plan.** The JARVIS binding gains an optional `subjectDigest`; the onboarding challenge binds signer, `onboarding-request:<id>`, `approve`, a one-time nonce and the plan hash. Bindings without a digest are byte-identical to before. The database also refuses approval and provisioning for any hash other than the current one.
7. **Separation of duties.** The staff member who last edited the plan cannot approve it (enforced in the database). An unedited generated plan may be approved by any holder of `platform.tenants.manage`.
8. **Self-serve stays off.** Flag `self_serve_provisioning` is seeded OFF and locked in `feature_flags`. The `self_serve` channel is refused while it is off; even when on it needs a staff-approved plan, a private institution and a confirmed account with the request's email.
9. **Unit-tree audit identity.** The production unit-tree audit trigger refuses a write without an actor, so the function sets `request.jwt.claim.sub` to the verified staff id for the unit inserts only and restores it immediately after.
10. **First-admin invitation** is stored in a new `organization_invitations` table, the database form of `lib/onboarding/invitations.ts` (which had no persistence). Delivery stays with the communications layer and is not done here.

## Consequences

- A placeholder role pack (`ng.<type>@0.1.0`, unpublished) cannot be provisioned; staff must edit the plan to a published institution pack. None is published on master today, so nothing can be provisioned in production until one is.
- Plan ownership and calendar values the stored profile cannot represent (for example `unspecified`, `government`, `continuous`, `not_applicable`) are refused; staff edit them.
- `cg_tenant.environment` keeps its column default; the founder should decide the production value.

## UNKNOWNs

- Whether the founder wants the editor-cannot-approve rule while there is a single staff identity.
- Invitation delivery channel and acceptance flow (later mission).

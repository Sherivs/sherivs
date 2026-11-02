# Console subscriptions and entitlements assessment

**Snapshot:** 2026-10-31  
**Version target:** V1 organizational capability envelope. This is a read-only
assessment; no production database or payment provider was accessed.

## Existing sources and display contract

| Signal                         | Source and calculation                                                                                                                                                                                                 | Units / window                                                                                                                       | Freshness                                                                                  | Authorization and limits                                                                                                                                                                                   |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Organization lifecycle         | `platform_organization.lifecycle_state`; display the current case state, or count cases by state.                                                                                                                      | State per organization; current records.                                                                                             | Read at page load.                                                                         | Console read is capability-gated. This is the staff onboarding case, not a billing state.                                                                                                                  |
| School access flags            | `schools.is_active`, `subscription_status`, `subscription_tier`, and `subscription_expires_at`. Activation, suspension, and restore update `is_active` and `subscription_status`; deactivation sets `is_active` false. | State/tier per linked school; `subscription_expires_at` is an expiry timestamp, not proof of renewal.                                | Read from the school row; there is no separate freshness marker.                           | Lifecycle/access signals only. Neither an active status nor a tier grants a user's permission.                                                                                                             |
| CoreGrid tenant lifecycle      | `cg_tenant.status`; the schema defines provisioning, active, restricted, suspended, migrating, archived, terminating, and terminated states.                                                                           | State per CoreGrid tenant; current row.                                                                                              | `updated_at` is present.                                                                   | The tenant-role helper does not read this status; it is not currently composed into that helper's role decision.                                                                                           |
| Subscription history           | `public.subscriptions`: the Console reads plan, status, amount paid, payment reference, `started_at`, and `expires_at`; the metric counts payment-history rows.                                                        | Subscription rows; current ledger selection (up to 200 rows). `amount_paid` has no currency or billing-period column in this schema. | Page-load read; ordered by `created_at`, with no `updated_at` or reconciliation timestamp. | Console billing read requires `platform.finance.read` or `platform.tenants.manage`. This is payment history, not recognized revenue, MRR, or a renewal forecast.                                           |
| Configured school price        | `school_platform_pricing.per_student_fee`; the Console lists the configured value.                                                                                                                                     | Numeric amount per student; the row does not encode currency or billing period.                                                      | `updated_at` exists; the Console reads current rows (up to 200).                           | The Console uses the same billing-read capability. Do not format as currency or infer a period absent an approved contract.                                                                                |
| Commercial feature entitlement | `org_entitlements` → `entitlement_plans.features` / `entitlement_plan_quotas`; `entitlement_overrides` add temporary quota.                                                                                            | Feature keys or quota by meter and declared period; quota is a count/quantity, not a price.                                          | `org_entitlements.updated_at`; overrides include `expires_at`.                             | SHERIVS-013 is marked not applied; SHERIVS-016 is marked not applied to production and labels quota values as placeholders. These are not verified production entitlements and have no Console read model. |
| Runtime availability           | Existing Scholar health/runtime contract.                                                                                                                                                                              | Runtime status, not a subscription count.                                                                                            | Health check / page-load freshness as reported by its source.                              | Availability is not authorization and does not give a user access.                                                                                                                                         |
| User permission                | Existing tenant identity, role/capability, feature gate, policy, and RLS boundaries.                                                                                                                                   | Per actor, tenant, resource, action, and feature.                                                                                    | Re-evaluated by the server/database on request.                                            | This is the authorization decision; Console workspace membership is not permission.                                                                                                                        |

The existing Billing screen currently displays subscription plan, status, amount,
and payment reference, but not the queried start/expiry timestamps or entitlement
facts. Its amount display has no currency/unit label. The subscription table has
no explicit renewal schedule, auto-renewal state, grace period, or renewal
outcome; `expires_at` can be presented only as a recorded expiry date. No
recognized revenue, MRR, or renewal status should be inferred.

## Backend relationship: assessment

These are separate signals, not one existing authorization function:

1. `platform_organization.lifecycle_state` tracks the control-plane onboarding
   case. It is not a tenant identity or subscription record.
2. The Console's activation/suspension operations update the linked school's
   `is_active` and coarse `subscription_status` flags. Those writes record
   lifecycle/access state; they do not assign an actor role or capability.
3. Subscription payment history and plan entitlements are distinct sources.
   The payment ledger does not prove that a feature entitlement has been
   provisioned or that a user is authorized to use it.
4. Runtime health answers whether Scholar is available, not whether an
   organization or actor is authorized.
5. Existing role/feature authorization requires an authenticated identity,
   resolved tenant, role/capability and policy decision, and database RLS. The
   Scholar feature gate fails closed for missing identity, tenant, role category,
   grant, or installed feature.

**Target invariant (not implemented as one resolver):** permission/RLS is
necessary but not sufficient for an allowed operation where organization
lifecycle, subscription, entitlement, or runtime eligibility applies. Each
required gate must allow; a status or commercial entitlement cannot itself
authorize the actor; missing or unknown inputs fail closed. Runtime health
remains availability, not permission.

There is a specific integration gap: `public.holds_tenant_role` checks an active,
time-valid role assignment or membership, and `public.is_tenant_admin` delegates
to it; neither checks `cg_tenant.status`. The Scholar feature gate likewise does
not receive organization or subscription status. The lifecycle contract says
tenant API access is denied while the school is inactive and subscription status
is suspended, but this assessment did not find a single authorization decision
that joins and enforces those conditions across runtime APIs/RLS. Do not claim
that relationship is verified or implemented. Do not introduce a
Console-specific role engine or weaken RLS to close the gap.

## Gaps and safe integration boundary

- The Console billing reader is a bounded history/pricing view, not an
  entitlement reader; `started_at` and `expires_at` are fetched but not shown.
- Subscription `amount_paid` and the pricing row have no encoded currency and
  billing-period contract. There is no approved basis here to render currency,
  renewal, or revenue figures.
- SHERIVS-013 is review-only and SHERIVS-016 explicitly says not applied to
  production; SHERIVS-016 also marks quota figures as placeholders. Do not
  create a new plan, price, entitlement table, or production migration in this
  phase.
- No unified org-status × subscription × entitlement × runtime × permission
  resolver is present. In particular, neutral role authorization does not
  evaluate `cg_tenant.status`; the wider `schools.is_active` / subscription
  lifecycle enforcement is not established by this inspection. Database,
  integration, and production state were not independently verified.
- This change adds no payment initiation or charge behavior. A pre-existing
  Console Paystack checkout path is present in
  `operations-screens.tsx` / `operations.store.server.ts`; it is not invoked or
  changed by this assessment and must not be treated as part of the read-only
  entitlement integration.

## Evidence

- Console billing read model and checkout path:
  [`operations.store.server.ts`](../../frontend/src/lib/internal-console/operations.store.server.ts#L455-L615),
  [`operations-screens.tsx`](../../frontend/src/components/internal-console/operations-screens.tsx#L438-L573).
- Metric source and semantics:
  [`metrics.ts`](../../frontend/src/lib/internal-console/metrics.ts#L216-L226).
- School lifecycle updates and status distinction:
  [`organization.store.server.ts`](../../frontend/src/lib/internal-console/organization.store.server.ts#L672-L742);
  [`organization-lifecycle.ts`](../../frontend/src/lib/internal-console/organization-lifecycle.ts#L238-L274).
- Subscription and pricing schemas:
  [`schools` schema](../../database/supabase/migrations/20260620122048_50e590c2-5911-4c98-8931-fb46a4b509f3.sql#L7-L35),
  [`subscriptions` schema](../../database/supabase/migrations/20260620122048_50e590c2-5911-4c98-8931-fb46a4b509f3.sql#L512-L522),
  [`cg_tenant` status schema](../../database/supabase/migrations/20260904020000_coregrid_l2_identity_tenancy.sql#L45-L63),
  [`holds_tenant_role` / `is_tenant_admin`](../../database/supabase/migrations/20261002000001_coregrid_v1_neutral_tenant_primitives.sql#L153-L212),
  [`school_platform_pricing` migration](../../database/supabase/migrations/20261025100250_sherivs_paystack_split_fee.sql#L1-L29).
- Entitlement migration status and placeholder quota note:
  [`SHERIVS-013`](../../database/supabase/migrations/20261022000200_sherivs_013_payments_audit_entitlements.sql#L1-L10),
  [`SHERIVS-016`](../../database/supabase/migrations/20261024000230_sherivs_016_lifecycle_grading_tiers_audit.sql#L1-L8),
  [tier-to-entitlement migration section](../../database/supabase/migrations/20261024000230_sherivs_016_lifecycle_grading_tiers_audit.sql#L479-L555).
- Permission boundary:
  [`feature-gate.ts`](../../frontend/src/lib/scholar/feature-gate.ts#L1-L12),
  [`scholar-feature-access.functions.ts`](../../frontend/src/lib/runtime/scholar/scholar-feature-access.functions.ts#L69-L112).
- Phase A gap record:
  [`gap-matrix.md`](./gap-matrix.md#L16-L16),
  [`SUBSCRIPTION-ENTITLEMENT-ASSESSMENT.md`](../../progress/internal-console/SUBSCRIPTION-ENTITLEMENT-ASSESSMENT.md#L1-L30).
- Owner decisions on workspace scope, Support assignment, and Platform Operations
  bypass are recorded on [#199](https://github.com/vibeoraai-bit/coregrid-scholar-migration/issues/199#issuecomment-6544198944)
  and [Phase A #206](https://github.com/vibeoraai-bit/coregrid-scholar-migration/pull/206#issuecomment-6544198606).

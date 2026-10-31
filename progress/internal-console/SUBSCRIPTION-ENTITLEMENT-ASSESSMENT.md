# Subscription and entitlement assessment — ACTIVE-V1

## Authoritative sources in the repository

| Source | What it is | Console use |
|---|---|---|
| `public.schools.subscription_tier` / `subscription_status` / `subscription_expires_at` | Coarse tenant flags. Status CHECK: active, suspended, expired, cancelled. | Written on activate/suspend/restore. Not displayed as a commercial subscription. |
| `public.subscriptions` | Paystack-oriented payment history per school | Listed on `/console/activity/billing`. Counted as a metric. Not treated as recognized revenue. |
| `org_entitlements` and related tables | Draft SHERIVS-013, absent from generated Database types | Not applied; not console-wired |
| `platform_organization.lifecycle_state` | Staff onboarding case | Displayed; not billing status |

## Decision

Do not create a second billing system. Do not show MRR, trials, renewals, or recognized revenue.

Provisioning no longer writes `subscription_status = trial`, which is not in the database CHECK. Inactive provisioned schools keep `is_active = false`. Activation sets `is_active = true` and `subscription_status = active` as an access lever.

## Relationship to access

Organization active ≠ every user may read that school's data.

Subscription status ≠ authorization.

Product entitlement ≠ runtime launch.

User permissions remain RBAC/RLS on the school tenant.

## Integration boundary

The Internal Console billing module reads `public.subscriptions` and `school_platform_pricing` through a server function gated by `platform.finance.read` or `platform.tenants.manage`. Paystack Inline can collect a linked school's configured `monthly_fee`. Settlement is webhook compare-and-set on pending rows (`csub_` references). Revenue, MRR, trials, and entitlements are still not calculated.

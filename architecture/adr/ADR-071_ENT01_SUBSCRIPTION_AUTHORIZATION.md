# ADR-071: Only the Platform Changes an Organization's Subscription; New Organizations Start in Trial

|| Field | Value |
||---|---|
|| Status | PROPOSED (security review and operator approval before any production migration) |
|| Date | 2026-11-13 |
|| Author | Claude Code coding agent (Claude Sonnet 5.5) under the ENT-01 mission authorization of 2026-11-13. Closes a defect found by the COMMS-03 entitlement review (issue #330) in the tier and entitlement catalog. The paid-SMS send path it protects was delivered by `copilot-swe-agent[bot]` in PR #222 (issue #221). |
|| Mission | ENT-01 — school administrators must not be able to promote their own organization to Enterprise |
|| Capabilities | V1 subscription tiers and entitlements; organization onboarding; paid-SMS entitlement used by communications |
|| Supersedes-in-part | None. This ADR corrects the tier default of migration `20260707225659` and the entitlement catalog of `20261024000230_sherivs_016_lifecycle_grading_tiers_audit.sql`. It does not change prices, wallet rules (ADR-070) or message dispatch (COMMS-03). |
|| Cites | `database/supabase/migrations/20261104051000_sherivs_ent01_subscription_authorization.sql`; its rollback; `tests/integration/ent-01-subscription-authorization.local.sql`; `tests/integration/ent-01-subscription-concurrency.local.mjs`; `tests/unit/ent-01-tier-parity.test.ts`; `frontend/src/lib/subscription-tiers.ts` |
|| Minimal ownership artifact | `database/supabase/migrations/20261104051000_sherivs_ent01_subscription_authorization.sql` and its matching rollback |

## Context

An organization's subscription decides what it may use and what it pays for. It lives in commercial columns on the organization row (`subscription_tier`, `subscription_status`, `subscription_expires_at`, `monthly_fee`, `max_students`, `max_teachers`). A trigger turns the tier into the organization's entitlement plan.

A database built from the repository migrations, without this change, shows these defects. Each was reproduced by a failing test before any fix (`tests/integration/ent-01-subscription-authorization.local.sql`: 22 pass and 42 fail on the unfixed database; `ent-01-subscription-concurrency.local.mjs`: 4 pass and 4 fail):

1. **A school administrator could promote their own organization.** The row-level policy "School admin updates own school" admits any update of the administrator's own row, and the client roles hold column privileges on the commercial columns. One update of `subscription_tier` from `trial` to `enterprise` succeeded, and the entitlement trigger then granted the Enterprise plan. The same update could change status, expiry, fee and the student and teacher limits. The same held for a principal, for the founder of a self-serve organization, and for 24 concurrent attempts.
2. **Every self-serve organization started on Enterprise.** The column default was set to `enterprise` by migration `20260707225659`, and `create_organization_with_founder` relies on it.
3. **Trial silently became Starter, and Starter had paid SMS.** The tier-to-plan mapping had no `trial` row, so a trial organization received the starter plan through a fallback. The starter plan carried the `sms` feature with a 500 per month quota. The application catalog (`subscription-tiers.ts`) says trial and starter have no SMS.
4. **Commercial changes were not audited.**

Properties that were already correct and are pinned as guards by the tests: a teacher cannot update the organization; one administrator cannot update another organization; anonymous callers cannot update; a client cannot insert an organization row; a service-role change updates the entitlement plan.

Production state, from a read-only catalog and aggregate check on 2026-11-13 (SELECT only, no customer data read): the exposure is **live at the privilege and schema layer** (the client roles hold the column privileges, the policy and the enterprise default are present), but the platform has **zero organizations**, so no organization has been promoted and none carries the enterprise default. Nothing was changed in production.

## Options

### Option 1 — Revoke the column privileges from the client roles (rejected)

- **Consequences:** Column grants are the first line of defence but are brittle. A later `GRANT UPDATE` on the table, a new column, or a role added by the platform restores the hole silently, and a revoke does not express who is allowed. It does not cover inserts through other paths. It is not enough alone.

### Option 2 — Narrow the row-level policy with a column list (rejected)

- **Consequences:** Row-level security cannot restrict columns. A policy `WITH CHECK` that compares old and new values needs the old row, which a policy cannot see.

### Option 3 — A trigger that refuses commercial changes from client sessions, plus a Trial default, a real Trial plan and a database SMS entitlement (ruled)

- A `BEFORE INSERT OR UPDATE` trigger on the organization row refuses any change to a commercial column when the statement runs as `authenticated` or `anon` and the caller is not a platform super administrator (SQLSTATE `42501`). The test uses `current_user`, the role the statement runs as, not a request claim a caller could supply. `SECURITY DEFINER` functions (they run as their owner), the service role, the database owner and super administrators are not affected, so every legitimate writer keeps working: the internal console plan update and organization provisioning (service role), the founder's onboarding function, and migrations. The guard is a deny-list of the two client roles; a new client-facing role must be added to it.
- Writing the unchanged value back (a full-row form submit) is not a change and is allowed. Ordinary administration of the organization row is unchanged.
- The tier column default becomes `trial`. Existing rows are not touched.
- Trial becomes a real entitlement plan (feature `core`, quotas copied from starter with SMS 0), mapped from the `trial` tier. The starter plan loses the `sms` feature and its SMS quota becomes 0, in line with the application catalog and the stated policy that Trial and Starter get no paid SMS. Entitlements are re-derived from tiers, which writes only `org_entitlements`.
- Two service-role-only functions give PostgreSQL the authoritative answer: `tier_sms_entitled(tier)` (the tier's plan carries `sms` with a positive quota; a missing or unknown tier is not entitled) and `sms_plan_entitled(org)` (from the tier stored on the organization row). COMMS-03 wires its send path to the second function; this change does not touch dispatch.
- Every change to a commercial column writes one `subscription.change` audit row with the six commercial columns old and new, the acting user id and the database role, and no other organization data.
- A unit test derives the database SMS entitlement of every tier from the migrations and fails the build if it differs from `subscription-tiers.ts`.

## Recommendation (decision)

**Use Option 3.** The commercial columns are changed only by the platform. A school administrator can administer their organization but cannot change what it has bought. PostgreSQL is authoritative for entitlement, and the application catalog is checked against it.

The migration does not rewrite any existing organization and is not applied to production by this change.

### Explicit residual risk (stated, bounded, owned — not hidden)

- **An upgrade request still needs a human.** `request_plan_change` records a tenant's request (effective next term). The repository's writers of the tier are server code using the service role (the internal console plan update and provisioning); this ADR adds no billing-driven tier change.
- **Suspended and expired organizations.** `sms_plan_entitled` answers from the tier only. Whether `subscription_status` (suspended, expired, cancelled) should also stop paid SMS is a commercial decision this change does not make; the send path (COMMS-03) or the owner must decide it.
- **`entitlement_overrides`.** The table exists for per-organization exceptions; `sms_plan_entitled` does not read it. Overrides are written only by platform staff.
- **The status vocabulary differs between layers.** The database allows `active, suspended, expired, cancelled`; the application's update schema lists `trial` where the database says `cancelled`. Noted, not changed here.
- **Existing Trial-tier organizations lose the fallback Starter SMS.** Intended by policy. There are none in production today.
- **Owner of the residual risk:** the platform owner, for the commercial rules above.

### Neutrality baseline extension (ADR-004)

The audit row is keyed by `audit_logs.school_id`, the live organization key. If the neutrality guard reports it, the observed `school_id` hits of this one migration file are recorded in `NEUTRALITY_GUARD_BASELINE.json` under this ADR. No new vocabulary is introduced elsewhere.

## Consequences (summary)

- **Positive:** A school administrator, principal or founder cannot change their organization's tier, status, expiry, fee or limits through the API. New organizations start in Trial. Trial and Starter have no paid SMS in the database and in the application, and a test keeps them aligned. Every commercial change is audited.
- **Negative / obligations:** Applying `20261104051000` is an operator step. Any client code that edited commercial columns as a signed-in non-super-administrator stops working; the repository's own writers use the service role. Starter organizations lose the `sms` feature in `org_entitlements`.
- **Rollback:** `database/supabase/rollbacks/20261104051000_sherivs_ent01_subscription_authorization.sql` removes the triggers and functions, restores the enterprise default, the starter plan with SMS and the unmapped trial. **Rolling back re-opens the vulnerability.** It never rewrites an organization's commercial columns.

## Golden Questions

- **WHO?** The platform (service role, definer functions, owner) and platform super administrators change subscriptions. School administrators, principals, teachers, parents, students and anonymous callers do not.
- **WHAT?** A guard trigger on the commercial columns, a Trial default and plan, no paid SMS for Trial and Starter, two entitlement functions and an audit row per change.
- **WHERE?** Migration `20261104051000_sherivs_ent01_subscription_authorization.sql`, its rollback, the two integration suites, the parity unit test and the CI `migrations-sim` job.
- **WHY?** An organization could grant itself every paid feature, including the messaging that spends the platform's provider budget.
- **UNDER WHICH POLICY?** Forced row-level security stays as it is. No secret is read or stored. Prices, wallet rules and dispatch are unchanged.

## Pre-apply read-only checks and apply order

Run these before applying `20261104051000`. They only read.

```sql
-- 1. Organizations by tier (the migration changes none of them) and how many have no entitlement row
SELECT subscription_tier, count(*) FROM public.schools GROUP BY 1 ORDER BY 1;
SELECT count(*) AS without_entitlement FROM public.schools s WHERE NOT EXISTS (SELECT 1 FROM public.org_entitlements e WHERE e.org_id = s.id);

-- 2. Organizations whose plan WILL change: only tier 'trial' (starter to trial)
SELECT count(*) AS trial_orgs FROM public.schools WHERE lower(btrim(subscription_tier)) = 'trial';

-- 3. Who can update the commercial columns today
SELECT grantee, column_name, privilege_type FROM information_schema.column_privileges
WHERE table_schema = 'public' AND table_name = 'schools' AND column_name IN ('subscription_tier','subscription_status','max_students','monthly_fee')
  AND grantee IN ('anon','authenticated','service_role') AND privilege_type = 'UPDATE';

-- 4. Any past self-promotion: organizations on a paid tier that no operator set (compare against billing records)
SELECT subscription_tier, count(*) FROM public.schools WHERE subscription_tier <> 'trial' GROUP BY 1;
```

Apply order: after `20261104050000`. After applying, run both ENT-01 suites against a restored copy.

## UNKNOWNs

- **Whether any organization was self-promoted before this change.** On 2026-11-13 there were no organizations. Re-run the pre-apply checks immediately before applying; before the first organization onboards is the safest window.
- **Behavior on the production PostgreSQL major version.** The suites ran on PostgreSQL 16 locally; the repository's CI job builds PostgreSQL 17. The CI result is the authority and has not been observed for this change.
- **Whether any out-of-repository caller** (an n8n flow, an edge function not in this repository, a client build) updates commercial columns as a signed-in user. The repository contains none; check the edge function sources before applying.
- **The commercial numbers.** Quotas other than SMS in the new Trial plan are copied from Starter and remain placeholders for the owner to confirm, as the existing catalog states.

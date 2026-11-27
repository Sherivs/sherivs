# ADR-119: PUSH-01b RLS Initplan Fix and Service Role Write Grants

|| Field | Value |
||---|---|
|| Status | PROPOSED (migration CI dry-run + staging rehearsal) |
|| Date | 2026-11-24 |
|| Author | copilot-swe-agent[bot] |
|| Mission | PUSH-01b (mobile-push; RLS/grant hardening) |
|| Capabilities | V1CAP-push-send [V1CAP-push-register, V1CAP-push-prefs] |
|| Supersedes-in-part | [ADR-112_PUSH01_DEVICE_REGISTRY_AND_PUSH_PREFERENCES.md](./ADR-112_PUSH01_DEVICE_REGISTRY_AND_PUSH_PREFERENCES.md) — the policy syntax and service-role grant boundaries only; device table, RPCs, and preferences logic stand unchanged |
|| Cites | PUSH-01 ADR-112 (2026-11-24), ADR-102 (neutrality baseline), AGENTS §44–49 (authorization law), database/supabase/migrations/20261124000000_sherivs_push01_mobile_push_devices.sql (line 36), Supabase advisory WARN `auth_rls_initplan` (staging rehearsal dvxszhracsjwdancijdc), Sherivs/sherivs#487, Sherivs/sherivs#501 |
|| Minimal ownership artifact | Forward migration `20261124170000_sherivs_push01b_rls_initplan.sql` + matching rollback + staging test suite |

## Context

PUSH-01 (ADR-112, migration `20261124000000`) added the `mobile_push_devices` device registry with RLS policies and RPCs (`register_push_device`, `unregister_push_device`) for end-user push token management.

After staging rehearsal on `dvxszhracsjwdancijdc`, the Supabase advisor flagged **WARN `auth_rls_initplan`** on the policy `mobile_push_devices_read_own` (line 36 of PUSH-01 migration):

```sql
CREATE POLICY mobile_push_devices_read_own
  ON public.mobile_push_devices
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());
```

The warning occurs because `auth.uid()` is used bare in the USING clause. Supabase's planner cannot evaluate `auth.uid()` at plan time, forcing it into an initplan (sub-plan). The fix is to wrap it: `(select auth.uid())`, allowing plan-time optimization.

Concurrently, PUSH-02 (device-pruning sender) requires `service_role` to UPDATE and DELETE rows on `mobile_push_devices` to revoke stale/unregistered tokens (setting `revoked_at`, disabling via `enabled`, or deleting). PUSH-01 granted `service_role` SELECT-only; UPDATE and DELETE are blocked by the absence of grants and policies.

## Options

### Option 1 — Edit the existing PUSH-01 migration (rejected)

Rewriting or re-applying PUSH-01 violates ADR-112, the mandate against rolling back applied migrations, and the operational requirement (no production apply in this mission). AGENTS §39: "Never renumber, rewrite, or delete an existing ADR — a new ADR supersedes."

### Option 2 — Create a follow-up migration with the initplan wrap and service-role write grants (ruled)

After PUSH-01 (`20261124000000`), apply a new forward migration `20261124170000_sherivs_push01b_rls_initplan.sql` that:

1. **Fixes the initplan warning:**
   - Drop and recreate `mobile_push_devices_read_own` with `USING (user_id = (select auth.uid()))`.
   - Keep the policy name, role (`TO authenticated`), and command (`FOR SELECT`).
   - Do not change the predicate meaning (owner read isolation).

2. **Grants service_role UPDATE and DELETE:**
   - GRANT UPDATE, DELETE to `service_role` on `mobile_push_devices`.
   - Add `mobile_push_devices_service_update` policy: `FOR UPDATE TO service_role USING (true) WITH CHECK (true)`.
   - Add `mobile_push_devices_service_delete` policy: `FOR DELETE TO service_role USING (true)`.
   - Service-role INSERT remains ungranted (not needed for pruning; only RPCs may insert).
   - Authenticated and anon receive no new grants.

3. **Matching rollback** at `20261124170000_sherivs_push01b_rls_initplan.sql` (rollback dir) that:
   - Drops the new write policies.
   - Revokes UPDATE and DELETE from `service_role`.
   - Restores `mobile_push_devices_read_own` to bare `auth.uid()`.

**Rationale:**
- Fixes the Supabase advisor warning without touching PUSH-01 artifacts.
- Preserves the owner-read isolation for `authenticated` (USING wrapping is plan-only, not semantic).
- Unblocks PUSH-02 device pruning by granting `service_role` table-level UPDATE/DELETE; policies ensure the data-plane remains unrestricted (service-role performs server-side pruning, not user-initiated mutation).
- Maintains the prohibition on authenticated/anon writes to `mobile_push_devices` (write RPCs remain the sole user path).
- Testable in staging without applying to production (dry-run only).

**Consequences:**
- Service-role can now UPDATE and DELETE rows, necessary for PUSH-02 token pruning (revoke/expiry).
- Policy syntax change is transparent to applications (bare `auth.uid()` → `(select auth.uid())` is a plan-time optimization, not a data-plane change).
- Rollback is symmetric and restores pre-PUSH-01b state.

## Recommendation

**Create a new forward migration `20261124170000_sherivs_push01b_rls_initplan.sql` that wraps `auth.uid()` in the owner-read policy, adds `service_role` UPDATE and DELETE policies, and grants `service_role` table-level UPDATE and DELETE privileges. This unblocks PUSH-02 device pruning and clears the Supabase advisor `auth_rls_initplan` warning. Provide a matching rollback. Do not modify PUSH-01 migration or rollback. Do not apply either migration in this mission (staging/production apply is separate, requires Muhammad's written approval for production).**

## Consequences

- **Positive:** Supabase advisor warning cleared; PUSH-02 sender unblocked to prune stale devices; plan-time optimization possible for owner-read queries; architecture layering preserved (authenticated users still cannot UPDATE/DELETE, server-side operation remains RPC + service-role path).
- **Negative / obligations:** Rollback testing required (staging: apply PUSH-01, then PUSH-01b, verify (select auth.uid()) and service_role UPDATE/DELETE work, then rollback PUSH-01b, verify bare auth.uid() and service_role SELECT-only restored); neutrality baseline unaffected (no new tables, no school_id/org_id structural changes).
- **For PUSH-02 specifically:** Removes the blocker on `service_role` UPDATE/DELETE; sender now has the table-level privilege to prune. The pruning logic (which rows, when) is PUSH-02's responsibility.

## Golden Questions

- **WHO?** PUSH-01b mission owns this ADR and migration. PUSH-02 sender is the consumer of the new service_role UPDATE/DELETE privilege. Muhammad owns production apply decision and gates it out of this scope.
- **WHAT?** Add a follow-up migration that wraps bare `auth.uid()` in the owner-read policy (plan optimization), grants service_role UPDATE/DELETE (table level), and adds matching write policies.
- **WHERE?** Migration: `database/supabase/migrations/20261124170000_sherivs_push01b_rls_initplan.sql`. Rollback: `database/supabase/rollbacks/20261124170000_sherivs_push01b_rls_initplan.sql`. Tests: `tests/integration/push01b-rls-initplan.staging.sql`. Decision: this ADR.
- **WHY?** Supabase advisor warning on PUSH-01's `mobile_push_devices_read_own` policy (bare `auth.uid()`); PUSH-02 blocked by lack of service_role UPDATE/DELETE grants; ADR-112 prohibits editing existing migrations.
- **UNDER WHICH POLICY?** ADR-102 (neutrality: no new tables, no org_id/school_id changes); ADR-112 (device table design and RPC contract); AGENTS §39 (never edit past ADRs/migrations); AGENTS §44–49 (authorization model: role-based grants, RLS policies, service-role boundaries).

## UNKNOWNs

- Production apply gate: Muhammad's written approval, outside this mission.
- Staging deployment: tested in dry-run; timing for staging rehearsal TBD.
- PUSH-02 pruning semantics: which rows and when are pruned is PUSH-02's design; this ADR only unblocks the privilege.

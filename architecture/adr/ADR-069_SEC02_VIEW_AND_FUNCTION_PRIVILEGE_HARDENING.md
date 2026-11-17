# ADR-069: SEC-02 Removes Write Privileges From Views and Pins Helper Function Search Paths

| Field | Value |
|---|---|
| Status | PROPOSED |
| Date | 2026-11-13 |
| Author | Claude (production security audit) |
| Creator | Claude Code agent, mission S-002 (audit finding) |
| Mission | SEC-02 — least-privilege hardening |
| Cites | AGENTS.md tenant-isolation and RLS rules; `database/supabase/migrations/20261104034500_sherivs_sec02_privilege_hardening.sql`; `tests/integration/sec02-privilege-hardening.local.sql` |
| Minimal ownership artifact | This ADR and the SEC-02 migration with its rollback |

## Context

A read-only audit of the production project on 2026-11-13 found that all 379 public tables have row level security enabled and forced. It also found a privilege gap that row level security does not cover.

Supabase default privileges (`pg_default_acl`, owner `postgres`, schema `public`) grant `anon` and `authenticated` all table rights on every new object, including views. `public.org_credential_inventory` is declared `security_invoker = false` so it can show non-secret credential metadata without exposing ciphertext. That choice means the view runs as its owner and skips row level security on `org_credentials`. The migration that created it granted only SELECT, but the default privileges had already given `authenticated` INSERT, UPDATE and DELETE. A single-table view is auto-updatable, so a tenant administrator could write credential rows through it, including changing `org_id`.

The local harness reproduces this with synthetic data: before the migration an administrator of organization A updates a row and moves it to organization B; after it, both are refused.

Two aggregate fee views (`cg_fee_invoice_balances`, `cg_fee_receipt_sequence_status`) are `security_invoker = true` and cannot be updated, but `anon` held SELECT and UPDATE. Eleven trigger or helper functions had a mutable `search_path`. One trigger function, `schools_audit_commercial_change()`, was executable by `anon`.

## Options

1. **Change the credential view to `security_invoker = true`** (rejected): the view would then return nothing, because `org_credentials` has no client policies by design.
2. **Revoke write privileges on the views and keep SELECT** (ruled): removes the gap without changing behaviour that clients rely on.
3. **Change the default privileges for the schema** (not done here): this is a platform-level setting. It is recommended as a follow-up owner decision, because it affects every future object.

## Decision

Option 2, plus pinning `search_path = pg_catalog` on eleven functions whose bodies use only built-in objects, and revoking EXECUTE on the trigger function from `anon`, `authenticated` and PUBLIC. The migration is forward-only, idempotent and changes no table, policy, row or function body. A unit test fails if a future migration creates a public view without revoking its write privileges.

## Explicit residual risks

- **Default privileges are unchanged.** Any new object still starts with broad grants. The unit test covers views only. Tables are protected by forced row level security.
- **`schools_audit_commercial_change()` is not defined in any repository migration.** It exists in production only, so it was not tested locally with its real body. The harness uses a stand-in function with the same signature. The migration skips it if absent.
- **15 anonymous and 356 signed-in SECURITY DEFINER functions are executable.** Most are intended public or role-gated RPCs. This change does not review them. A per-function review is a separate mission.
- **Leaked-password protection is off** in Supabase Auth. That is a dashboard setting, not a migration.
- **Not applied.** Applying it to production needs owner approval.

## Pre-apply read-only checks

```sql
select has_table_privilege('authenticated','public.org_credential_inventory','UPDATE');   -- expect true before, false after
select has_function_privilege('anon','public.schools_audit_commercial_change()','EXECUTE'); -- expect true before, false after
```

## Golden Questions

- **WHO?** Tenant administrators read their own credential inventory; only the service role writes credentials.
- **WHAT?** Privileges on three views, search paths on eleven functions, EXECUTE on one trigger function.
- **WHERE?** Schema `public` only.
- **WHY?** Closing a write path that bypasses row level security.
- **UNDER WHICH POLICY?** AGENTS tenant isolation and RLS rules.

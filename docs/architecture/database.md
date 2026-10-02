# Database Architecture

> Status: Canonical. Verified from `database/supabase/migrations` (60
> migration files as of 2026-10-02, including the canonical hardening
> series `20261002000005`–`20261002000013`, each with a matching rollback
> under `database/supabase/rollbacks/`) and the generated types.

## Stack

- Postgres hosted on Supabase. The canonical database target for applied
  hardening migrations is recorded in
  `architecture/proofs/CANONICAL_APPLY_RECORD_HARDENING.json` (earlier
  Scholar-era docs referenced the dev project `srhmfaoyhpvhdfxmagho`).
- Schema defined by the migration files under
  `database/supabase/migrations/`; immutable history.
- Client: `@supabase/supabase-js` with generated types in
  `frontend/src/integrations/supabase/types.ts`.

## Schema shape

- `schools` - tenant root with branding, subscription, section toggles.
- `users` - all roles in one table (`role` enum) with `school_id`.
- Domain tables: `students`, `classes`, `grades`, `attendance`,
  `attendance_logs`, `fees`, `timetables`, `lesson_plans`, `messages`,
  `notifications`, `news`, `events`, `blog_posts`, `testimonials`, `faqs`,
  `school_calendar`, `subscriptions`, `webhook_logs`, `audit_logs`,
  `fraud_attempts`, `qr_tokens`, `teacher_performance_profiles`, etc.
- Every tenant table carries `school_id`.

## RLS model

- RLS enabled on tenant tables.
- Scholar tenant tables: helper functions `get_my_school_id()`,
  `is_super_admin()`, `get_my_role()`; policies give tenant-scoped access,
  public read only for published marketing content, super-admin bypass.
- Canonical substrate (`cg_*`) tables: dual posture, database-proven by the
  RLS isolation battery (36/36 PASS, 0 findings, 2026-10-02):
  - zero-policy deny-by-default (RLS enabled, zero permissive policies,
    zero client grants) for the eight substrate adapter families
    (migrations `20261002000005`–`20261002000012`);
  - policy-backed neutral tenant-membership on `cg_role_assignment`,
    `cg_role_grant`, `cg_org_membership` (FORCED RLS, nine tenant-scoped
    policies on `get_my_tenant_id` / `is_tenant_admin` /
    `holds_tenant_role`; migration `20261002000013`).
- Regression gates: `database/queries/rls-isolation-check.sql` (Scholar
  tables) and `scripts/verify-rls-isolation-battery.mjs` (canonical `cg_*`
  tables; CI-wired in `.github/workflows/security-batteries.yml`).

## Retention

- Personal-data retention is governed by the machine-readable schedule
  `architecture/coregrid-mvp-architecture/RETENTION_POLICY_SCHEDULE.json`
  (ADR-005 Option 2: tombstone erasure, immutable audit records never
  mutated or deleted), enforced offline by
  `scripts/verify-retention-schedule.mjs`.

## Rules

- Applied migrations are never edited or deleted.
- Schema changes are new forward migrations with GRANTs + RLS.
- No SQL from application code outside the database layer.


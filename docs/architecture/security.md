# Security Architecture

> Status: Canonical. Verified security posture; open items are explicit.

## Authentication

- Supabase Auth (email/password), JWT claims, rate-limited password reset
  (`lib/auth-helpers.ts`).
- Server-side token validation middleware (`auth-middleware.ts`) for
  authenticated server functions.

## Authorization

- Application: roles -> portal routing (`lib/roles.ts`) + `role-guard.tsx`.
- Database: RLS policies + helper functions.

## Tenant isolation

- RLS on tenant tables; `school_id` scope; super-admin bypass.
- Canonical substrate (`cg_*` tables): database-proven dual posture as of
  2026-10-02 — zero-policy deny-by-default (RLS enabled, zero client grants)
  and, on the J-005/J-006 membership tables (`cg_role_assignment`,
  `cg_role_grant`, `cg_org_membership`), FORCED RLS with nine tenant-scoped
  policies built only on the neutral primitives (`get_my_tenant_id`,
  `is_tenant_admin`, `holds_tenant_role`).
- Regression gate: `scripts/verify-rls-isolation-battery.mjs` — live
  36/36 dual-posture PASS, 0 findings against the canonical database
  (`architecture/coregrid-mvp-architecture/ratification/RLS_ISOLATION_BATTERY.md`).
  CI-wired in `.github/workflows/security-batteries.yml` (weekly + manual,
  live-credential-gated).

## Secrets

- `.env` local-only and ignored; `.env.example` documents names.
- `SUPABASE_SERVICE_ROLE_KEY`, `PAYSTACK_SECRET_KEY`, VAPID private keys,
  AI keys are server-side.
- `.mcp.json` no longer embeds credential material (verified 2026-10-02);
  AD-181 (DECISIONS.md, RATIFIED 2026-09-03) forbids credential material in
  tracked tooling/configuration files.
- Known risk: credentials existed in git history; rotation is pending
  (tracked in `remaining-work.md`).

## Attack surface notes

- Paystack webhook verifies HMAC-SHA512 signatures.
- Public audit endpoint never reveals validation details (anti-enumeration).
- Import-protection linting blocks service-role imports in client bundles.
- RLS isolation battery guards cross-tenant reads on the canonical database;
  `npm run verify` includes the repository secret scan.

## Open hardening (in progress / planned)

- CI secret scanning and security checks: shipped for the PR gate
  (`.github/workflows/verify.yml` secret scan) and the canonical-database
  batteries (`.github/workflows/security-batteries.yml`); e2e remains a
  local Playwright run.
- Retention gate (`scripts/verify-retention-schedule.mjs`) is standalone —
  not yet in the committed `npm run verify` chain.
- Security Engine phase (`architecture/phase-08-security-engine.md`) for
  RBAC/ABAC/ReBAC/PBAC and audit hardening continues.


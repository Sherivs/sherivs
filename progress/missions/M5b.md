# Mission M5 part B: Pre-tenant onboarding requests and public intake

Authority: SHERIVS MASTER EXECUTION PROMPT v1.0 (16 Nov 2026), §4.4, §8.3, §12.1 M5; /tmp/agents/RULES.md.
Origin: Claude Code agent, mission E-010 (M5 part B onboarding requests)
Creator: Claude Code agent
Created: 2026-11-17

Status: IMPLEMENTED and TESTED on branch `mission/M5b-onboarding-requests`. Not merged. Migration NOT APPLIED.
Active persona: Postgres and RLS Security Engineer, with the Frontend Engineer.

## Objective

Replace the mailto forms on `/onboarding` and `/request-demo` with a real, abuse-resistant intake that records an onboarding request and a resumable interview session before any tenant exists (ADR-108).

## Reconnaissance

| Item                               | Finding                                                                                                                                                                                                    |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `onboarding_sessions` (production) | Read-only `SELECT` on information_schema, 2026-11-17: id, school_id NOT NULL, answers, status, plan, plan_hash, applied_at, applied_result, created_by, timestamps. Tenant-bound, so not usable pre-tenant |
| `audit_logs` (production)          | `school_id` is nullable. The bridge-to-chain trigger skips rows with no organization (read-only `SELECT` of the function definition)                                                                       |
| Capability                         | `platform.onboarding.read` already exists on the `onboarding` platform role (ENGINE-13 migration)                                                                                                          |
| Public endpoint pattern            | `createServerFn` POST, `clientIpFromHeaders`, `checkPublicRateLimit` (as in `resolve-sign-in-identifier.functions.ts`)                                                                                     |
| Turnstile                          | Client widget only. There was no server-side verify, so this mission adds `verifyTurnstileToken`, enabled by `TURNSTILE_SECRET_KEY`                                                                        |

## Scope and file boundaries

Migration `20261117001300_sherivs_m5_onboarding_requests.sql` plus rollback; `tests/sql/m5-onboarding-requests.sql`; `frontend/src/lib/onboarding/intake{,.server,.functions,-form}.ts`; `app-onboarding-screen.tsx`; the `/request-demo` route and a new `components/public/demo-request-form.tsx` (the shared `mailto-form.tsx` still serves `/contact` and `/support` and is unchanged); a one-line meta-description fix in `routes/onboarding.tsx`, which otherwise would still say "opens your email app"; tests; ADR-108; INDEX row. No route file was added, so `routeTree.gen.ts` is unchanged.

## Acceptance tests

- SQL: `tests/sql/m5-onboarding-requests.sql`, 77 assertions covering posture, anon and authenticated denial, token isolation, expiry, the size bound, stale revision, purge, audit with no personal data, a second run and the rollback.
- Unit: `tests/unit/m5b-onboarding-intake.test.ts` (17 tests), plus updated `onboarding-experience` and `app-entry-host` tests.

## Report

See the PR description for evidence. Not done: the adaptive interview UI (it depends on the question-graph agent), magic-link delivery, DSR coverage of the new tables, scheduling the purge, the request-retention purge, and screenshots and axe scans.

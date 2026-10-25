# Track E: QA, security and mobile readiness (24 Oct 2026)

Scope: `master` @ 5496cb8. Database checks ran against the local sim lab (Postgres 17 + PostgREST, every repo migration
applied, ~33k synthetic users), never against prod. Live checks against `app.sherivs.com` were read-only (response headers,
one unsigned webhook POST that was rejected). A read-only audit of the prod database (`nwrflbpbhyiqdptmlccm`) could **not** run:
the direct DB host is IPv6-only from this box and the Supabase management token in the environment is rejected
("Invalid access token"). Run `AUDIT_DB_URL=<pooler url> node tools/sim-lab/sim/security-audit.mjs` (the session is forced read-only) to confirm on prod.

## Findings

| # | Severity | Area | Finding | Evidence | Status |
|---|---|---|---|---|---|
| 1 | **Critical** | Secrets (git history) | Commit `144e60c9` ("Backup before CoreGrid Scholar migration", 15 Aug 2026) contains `.env` with a Supabase **service_role** JWT and anon key for the old project `qimawwdlgjtudzufgeox`, plus a GitHub PAT in `.mcp.json` and an NVIDIA API key (`.env`, `claude-flow*.json`). The files are gone from HEAD, but the history is public to anyone with repo access. | gitleaks 8.21.2: 119 hits, 9 real after allowlisting fixtures | **Action needed (owner):** rotate/revoke the old project's service_role key (or delete that project), revoke the GitHub PAT, rotate the NVIDIA key. Rewriting history needs a force-push, so it is not done here. |
| 2 | **High** | RLS | Permissive `school_id = get_my_school_id()` policies for ALL commands on `attendance`, `clinic_visits`, `discipline_records`, `hostel_allocations`, `hostel_attendance`, `library_borrowings`, `staff_payroll`, `staff_leave`. Writes were already limited by restrictive `sv4_*` policies, but **reads were not**: any student, parent, driver or alumni account could read the whole school's attendance, health visits, discipline records and staff payroll/leave. Reproduced: one student read 239,980 other students' attendance rows. | `results/rls-e-check-without-fix.json` (40/40 users leak) | **Fixed** in `20261024000910_sherivs_e_rls_read_scoping.sql` (restrictive SELECT policies: staff roles, own/linked students, own HR rows). After: 0 leaks (`rls-e-check-after-e.json`). |
| 3 | Medium | RLS | 129 of 251 public tables had RLS enabled but not FORCED. | `security-audit-master.json` | **Fixed** (`…000900`): every public table is ENABLE + FORCE. `postgres`/`service_role` keep BYPASSRLS, so server jobs are unaffected; 216/216 sim scenarios pass. |
| 4 | Medium | Functions / RPC surface | 20 SECURITY DEFINER functions were executable by `anon`, including 10 trigger/event-trigger functions (`rls_auto_enable`, `platform_config_audit`, `sync_organization_membership_on_user_write`, …). | audit JSON | **Fixed** (`…000900`): EXECUTE revoked from PUBLIC/anon/authenticated on all SECURITY DEFINER trigger functions. The remaining 11 anon RPCs are intended public endpoints; `check_result`, `verify_transcript`, `siwes_supervisor_verify` have attempt throttling in SQL; `resolve_school_by_host`, `ui_strings`, `public_*` are read-only. |
| 5 | Low | Functions | All 212 SECURITY DEFINER functions pin `search_path`; one (`rls_auto_enable`) pins `pg_catalog` only, which is safe. | audit JSON | OK |
| 6 | Low | Views | `org_credential_inventory` is a definer view (self-filters to admins, exposes metadata only) and was granted to `anon`. | audit JSON | **Fixed**: anon grant revoked. |
| 7 | Medium | HTTP headers | CSP is **report-only** in prod; HSTS, XFO=DENY, nosniff, Referrer-Policy, Permissions-Policy are present. | `curl -I https://app.sherivs.com/auth` | **Partly fixed** (`security-headers.ts`): enforced CSP for `frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'; upgrade-insecure-requests` + COOP `same-origin-allow-popups` (Paystack popups keep working). Full script/style CSP stays report-only until a violation baseline exists (next step: add a `report-to` endpoint, then drop `'unsafe-inline'` with nonces). |
| 8 | OK | Webhooks | Paystack: HMAC-SHA512 over the raw body, constant-time compare, 256 KB cap, rate limit 600/min, idempotent settlement keyed by reference (prod returns 401 for a bad signature). WhatsApp: HMAC-SHA256 constant-time. USSD: shared secret, constant-time. Cron: bearer secret, constant-time. | code + live probe | **Hardened**: WhatsApp `hub.verify_token` now compared in constant time (was `===`). |
| 9 | Low | Storage | Buckets in migrations are private (`school-media`, `sherivs-files`). Policy `anon can upload admission docs` lets anyone upload into `student-documents/admissions/…`; reads are admin-only. | `storage_policies` in audit JSON | Recommend: set `file_size_limit` and `allowed_mime_types` on that bucket and keep the admissions form behind Turnstile (already used on public forms). |
| 10 | Info | RLS | 58 tables (mostly `cg_*` kernel tables) have RLS with no policies, so clients get nothing (service-role only). | audit JSON | Intended. |
| 11 | Low | PII | `users` "same school can see each other" is row-wide, but column grants hide salary, account number, NIN and face data; `bank_name` is still readable school-wide. | PostgREST probe | Recommend revoking `bank_name` from `authenticated` (left alone because Track B owns the console code that reads it). |
| 12 | Info | CI | Workflows triggered on `main` but the default branch is `master`, so pushes never ran Verify / Drift Watch / Infra Verify. | `.github/workflows` | **Fixed**; see CI section. |

## Load test (sim lab, 8-core box shared with 4 other sim stacks)

k6 `tools/sim-lab/load/flows.js`: login bootstrap (15%), results (30%), CBT start/autosave (20%), fees (15%), attendance (20%),
real JWTs and RLS through PostgREST, 1–3 s think time, ramp 0 → peak over 90 s then 60 s at peak.

| Run | Requests | Req/s | Errors | p50 | p95 |
|---|---|---|---|---|---|
| Before, 3,000 VUs | 36,867 | 212 | **49.7%** | 10.0 s | 13.97 s |
| After, 3,000 VUs | 237,223 | 1,416 | **0.00%** | 11 ms | 581 ms |
| After, 5,000 VUs | 219,799 | 1,256 | 0.02% | 1.10 s | 3.10 s |

Bottlenecks found (EXPLAIN ANALYZE as real users, `results/explain-flows-after-e.json`):

| Query | Before | After | Fix |
|---|---|---|---|
| Student fee list | 1,063 ms | 1.9 ms | `fees_read` used `is_linked_to_student(student_id)` per row; now one `my_linked_student_ids()` initplan array |
| Student attendance history | 128–166 ms | 1.5 ms | per-row `get_my_school_id()`; initplan wrap + explicit `student_id` filter in clients |
| `my_linked_student_ids()` itself | 36 ms | <1 ms | OR across user/parent/map/e-mail forced a full school scan; UNION of indexed lookups + `(school_id, lower(parent_email))` index |
| Teacher class register | 20 ms | 0.1 ms | new `attendance (class_id, date)` index |
| Student results | 64 ms | 3.4 ms | explicit `student_id` filter (index `(student_id, academic_year)`) |

At 5,000 VUs the remaining limit is CPU on the shared box (k6 + PostgREST + five Postgres instances), not a query plan.
For prod: size the Supabase compute for ~1.5k req/s at results-day peaks, keep PostgREST pool ≥ 60, and add CDN caching for the
anonymous `resolve_school_by_host` / `ui_strings` RPCs.

## Reproduce
```bash
SIM_PG_PORT=54390 tools/sim-lab/up.sh && cd tools/sim-lab
export SIM_PG_PORT=54390
node sim/gen.mjs && node sim/seed-flows.mjs && node sim/scenarios.mjs
node sim/security-audit.mjs > results/security-audit-after-e.json && node sim/rls-e-check.mjs
node load/tokens.mjs && bin/postgrest load/postgrest.conf &   # edit the port if you changed it
cd load && PEAK=3000 ../bin/k6 run flows.js
```

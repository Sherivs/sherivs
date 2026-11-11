# Security audit — 2026-10-29 (M006)

This note is pull request #171.

Scope: `master` at `5f6cfce2` (Sherivs Scholar / CoreGrid V1). Stack reviewed: TanStack Start, Vite, React 19, Supabase (Postgres RLS, Auth, WebAuthn, Google OAuth, Turnstile), Vercel, GitHub Actions, Expo (`mobile/app.json`). Production headers were read from `https://www.sherivs.com/` (HEAD only). No migration was applied to production. No secret values are recorded in this document.

Version target: V1 organizational capability. Nothing here un-freezes V2 or V3.

## Tooling

| Check | Result |
|---|---|
| Sim security audit (`tools/sim-lab/sim/security-audit.mjs` on local Postgres 17, all repo migrations) | 314 public tables. RLS disabled: 0. RLS not forced: 0. SECURITY DEFINER missing `search_path`: 0. Permissive non-SELECT `USING (true)`: 0. Anon/public `SELECT` using `true`: `ui_translations`, `website_block_types` (catalogues). Definer views: `org_credential_inventory` (anon grant already revoked). |
| RLS leak regression (`sim/rls-e-check.mjs` after `SIM_SCALE=0.02` seed) | 40 student/parent users, 0 foreign-row leaks on attendance, clinic, discipline, hostel, library, payroll, leave. |
| Result-checker proof (`sim/check-result-ratelimit.mjs`, after the fix migration on the sim only) | `limiter_rows: 10`, `rate_limited_responses: 4`, valid card still returned Mathematics. |
| RLS isolation battery (`scripts/verify-rls-isolation-battery.mjs`) | Exit 2. `SUPABASE_URL` and `SUPABASE_ACCESS_TOKEN` are unset. With `SHERIVS_DATABASE_TARGET=development` the script stops at `TARGET_PROJECT_REF_MISSING` and does not default to production. No live canonical proof. |
| `node scripts/verification/secret-scan.mjs` | Pass on tracked HEAD. |
| gitleaks 8.21.2, full history, `--redact` | 898 commits, 9 findings, all in `144e60c9`. See M006-01. |
| `npm audit --omit=dev` before the seroval pin | 1 moderate (`seroval` 1.6.8). After pin: clean. |
| `npm audit` (including dev) | 3 moderate. `seroval` is pinned in #169. Vitest / `@vitest/mocker` remain (dev only). |
| Domain neutrality and registry guards | Pass (neutrality warnings are the existing quarantine baseline). |
| Production response headers | HSTS, `X-Frame-Options: DENY`, nosniff, `Referrer-Policy`, `Permissions-Policy`, COOP, and an enforced CSP of `frame-ancestors`, `base-uri`, `object-src`, `form-action`, `upgrade-insecure-requests`. Script and style CSP is report-only and still allows `'unsafe-inline'`. |

## Findings

| ID | Severity | Area | Location | Description and exploit scenario | Status |
|---|---|---|---|---|---|
| M006-01 | Critical | Secrets in git history | `144e60c9` `.env` (JWT lines 3, 4, 7, 8; generic key line 9), `.mcp.json` (GitHub PAT line 64, service-role key line 78), `claude-flow.config.json` line 43 | The commit is not on HEAD, but it is still in history. It contains a Supabase **service_role** JWT (including a `VITE_SUPABASE_SERVICE_ROLE_KEY` copy), the publishable JWT, an NVIDIA API key, and a GitHub personal access token. Anyone who can read history can replay those credentials. | **Recommended.** Rotate or revoke the service-role key (or delete that old project), the GitHub PAT, and the NVIDIA key. Do not rewrite history from this change set. |
| M006-02 | High | Rate limits | `frontend/src/lib/security/request-safety.ts:54` | `clientIpFromHeaders` preferred `cf-connecting-ip`, then the left-most `x-forwarded-for` hop. Vercel overwrites `x-vercel-forwarded-for` with the connecting peer and forwards other headers. A direct request to the deployment can set `cf-connecting-ip` to a fresh address on every call and skip the org-id login, WebAuthn, audit, and webhook buckets. | **Fixed** in PR #165. |
| M006-03 | High | Audit integrity | `frontend/src/routes/api/public/audit.password-reset.ts:22` and `:53` | The public ingest accepted `login_succeeded` and `password_reset_completed` with a client-supplied `user_id` and wrote them through the service role. An unauthenticated caller could record a successful login or a completed password reset against any account. `login_failed` was also bound to the directory user for the claimed email. | **Fixed** in PR #165. Session-bound events require `auth.getClaims`. Client user ids are ignored. |
| M006-04 | High | Result checker | `database/supabase/migrations/20261024000270_sherivs_020_comms_results_admissions.sql:185` | `check_result` calls `rate_limit_take`, then `RAISE`s when the admission number does not match. A raise rolls the limiter row back. Someone who has the scratch-card serial and PIN can try admission numbers without the 10/hour cap; the raised error is also a different response from a wrong PIN. Published grades are the payload. | **Fixed** in PR #166. **Needs a production database apply.** Not applied here. |
| M006-05 | Medium | Schema privilege | SECURITY DEFINER functions with `search_path = public` (example `database/supabase/migrations/20261028001000_sherivs_webauthn_passkeys.sql:91`). No migration revoked `CREATE` on `public`. | If the hosted project still grants `CREATE` on `public` to `anon` or `authenticated` (historical Supabase default; **not** true in this sim: `has_schema_privilege` is false), a caller can plant an object that a definer function resolves. The sim catalog cannot prove the hosted grant either way. | **Fixed** in PR #166 (`REVOKE CREATE`, and future `postgres` functions no longer default-grant `EXECUTE` to those roles). **Needs a production apply** to take effect. Sim already denied `CREATE`. |
| M006-06 | Medium | SSRF | `frontend/src/lib/integrations-hub/http.server.ts:13` | `isPublicAddress` missed NAT64 (`64:ff9b::/96`), local NAT64, 6to4, Teredo, `fec0::/10`, `100::/64`, `192.0.0.0/24`, and `192.88.99.0/24`. A school admin who can set a connector URL can pass an address literal whose embedded IPv4 is loopback or link-local. The cron worker then fetches it with `safeFetch`. | **Fixed** in PR #167. DNS rebinding between check and connect remains (see M006-13). |
| M006-07 | Medium | XSS sink | `frontend/src/components/public/json-ld.tsx:3` | `JSON.stringify` does not escape `<`. A string that reaches `JsonLd` (FAQ, article, breadcrumb) can close the `application/ld+json` script on `www.sherivs.com`. Current marketing copy is repo-authored; the sink is still live. The school-site builder already escaped `<`. | **Fixed** in PR #167. |
| M006-08 | Medium | CI supply chain | `.github/workflows/verify.yml:166` (`vercel@latest`); floating `actions/*@v4` and `hashicorp/setup-terraform@v3` in the other workflows; gitleaks installed with `curl \| tar` and no checksum | The preview job holds `VERCEL_TOKEN`. An unpinned CLI or action runs that code in the job. The gitleaks job has `contents: read` only, but it still executed an unchecked binary. No `pull_request_target`. Workflow token is `contents: read` (preview adds `pull-requests: write`). | **Fixed** in PR #168. |
| M006-09 | Medium | Dependency | `package.json` / lockfile: `seroval@1.6.8` via TanStack Start and Router | npm advisory range `1.5.5–1.6.10`: typed-array constructor and RegExp serialization. TanStack uses this package to serialize server payloads. | **Fixed** in PR #169 (`overrides.seroval` `1.6.12`). Prod `npm audit` clean afterwards. |
| M006-10 | Medium | Storage | `database/supabase/migrations/20260626133249_c712dcde-8e28-4f72-968d-a101b1bd5f7e.sql:3` | `anon can upload admission docs` allows any object under `admissions/` with no size or type limit in policy or bucket settings in this repo. Reads are limited to admins (`20261020000040_sherivs_002_admissions_and_media_privacy.sql`). No in-repo uploader was found, so a mime allow-list was not applied (it could reject a form this repo does not show). | **Recommended.** Set `file_size_limit` and `allowed_mime_types` on `student-documents`, and require the second path segment to be a real school id. |
| M006-11 | Low | HTTP headers | `frontend/src/lib/security/security-headers.ts:9` and production HEAD | Enforced CSP does not include `script-src`. The report-only policy allows `'unsafe-inline'`. Clickjacking, base, object, and form targets are already enforced, and production matches that code. A full script CSP without a violation baseline can break Paystack, Turnstile, and the theme bootstrap. | **Accepted** for this pass. Next step is a report endpoint, then nonces. |
| M006-12 | Low | Dev dependency | `vitest` `2.1.0-beta.1–4.1.10`, `@vitest/mocker` | npm: path traversal in the dev mocker and unauthenticated mock registration. Not in the production bundle. The fix npm offers moves Vitest major. | **Recommended.** Upgrade Vitest on its own change, not mixed into these fixes. |
| M006-13 | Low | SSRF residual | `frontend/src/lib/integrations-hub/http.server.ts` header comment | DNS can change between `lookup` and `fetch`. Closing that means connecting to the checked address (custom lookup). Left as residual so this pass does not change connector TLS behaviour. | **Accepted.** |
| M006-14 | Info | Public RPC | `database/supabase/migrations/20260620123741_7e8b6a59-b1d0-4885-bcfb-ae0dd2dac64e.sql:19` | `public_teachers` is executable by `anon` and returns teacher user id, name, avatar, and subject for an active school slug. That matches a public faculty page. | **Accepted.** |
| M006-15 | Info | Turnstile | `frontend/src/lib/security/turnstile-config.ts` and sign-in callers | The widget token is sent to GoTrue as `captchaToken`. This repo cannot see whether the Supabase project rejects logins without a valid token. A client-only check is bypassed by calling Auth directly. | **Recommended.** Confirm captcha enforcement is on in the Supabase Auth settings for the production project. |

## Reviewed and not changed

- Webhooks. Paystack: HMAC-SHA512 over the raw body, 256 KB cap, constant-time compare (`frontend/src/routes/api/public/webhooks/paystack.ts`). WhatsApp: HMAC-SHA256 and constant-time verify token (`whatsapp.ts`). USSD: shared secret, constant-time, disabled without the secret (`ussd.ts`). Integration ingest: HMAC over `timestamp.rawBody`, five-minute window (`webhooks/integrations/$webhookId.ts`). Cron: bearer secret, constant-time (`cron/integrations-sync.ts`, `cron/wallet-topup-reconcile.ts`).
- WebAuthn challenges are single-use, expired in SQL, and granted to `service_role` only (`database/supabase/migrations/20261028001000_sherivs_webauthn_passkeys.sql`). Relying-party selection fails closed for unverified origins (`frontend/src/lib/auth/webauthn-relying-party.ts`).
- Google redirect helper builds the return URL from the page origin plus a path (`frontend/src/lib/auth/google-sign-in.ts`). Console `next` is limited to console paths (`frontend/src/lib/experience/console-host-routing.ts` `sanitizeConsoleNextPath`).
- Fee and wallet settlement re-check the Paystack verify API and an RLS-visible row before the service role settles (`paystack.functions.ts`, `wallet-topup.functions.ts`).
- Server functions under `frontend/src/lib/**/*.functions.ts` use `requireSupabaseAuth` except the intentional public ones: passkey authentication, org-id sign-in, the public site loader, and the experience-host hostname read.
- Current `VITE_` / `import.meta.env` names are publishable configuration (Supabase URL and publishable key, Turnstile site key, PostHog, Sentry DSN, VAPID public key). No service-role key in the current client bundle.
- Mobile: `associatedDomains` is `webcredentials:sherivs.com`. No cleartext flag and no secret material in `mobile/app.json`. The EAS project id is an identifier, not a credential.
- Buckets present in the sim: `school-media` and `sherivs-files`, both private.
- Anon SECURITY DEFINER execute list from the sim: `check_result`, `verify_transcript`, `siwes_supervisor_verify`, `resolve_school_by_host`, `website_public`, `ui_strings`, `donation_campaign_progress`, `gov_jurisdiction_by_host`, `public_school_stats`, `public_teachers`, `get_my_school_id`, `is_school_admin`, `is_super_admin`. The last three only describe the caller. The others are the intended public RPCs and are throttled inside SQL where they return personal data (`check_result`, `verify_transcript`, `siwes_supervisor_verify`).

## Production database

Apply only `database/supabase/migrations/20261029002000_sherivs_m006_checker_and_schema.sql` (PR #166), forward-only, after review. It was applied to the local sim and not to production. Rollback: `database/supabase/rollbacks/20261029002000_sherivs_m006_checker_and_schema.sql` (restores the old `check_result` body and does not re-grant `CREATE`).

#165, #167, #168, and #169 do not change the database.

`verify.yml` is edited by both #166 and #168. Merge will need both hunks kept (the rate-limit sim step and the pinned actions).

## Secret rotation

Rotate, without pasting the values anywhere:

- Supabase **service_role** key from commit `144e60c9` (`.env` `SUPABASE_SERVICE_ROLE_KEY` and `VITE_SUPABASE_SERVICE_ROLE_KEY`, and `.mcp.json`).
- GitHub personal access token from that commit's `.mcp.json`.
- NVIDIA API key from that commit's `.env` and `claude-flow.config.json`.

The publishable JWTs in the same commit are public by design; treat the old project as compromised because the service-role key sat beside them. HEAD does not contain these files (`secret-scan` passed).

## Limitations

- The canonical RLS isolation battery and the restore drill did not run. Credentials are not in this environment, and the battery refuses to assume the production project.
- `npm audit` for Vitest was not cleared.
- Full sim scenarios and the k6 smoke were not re-run. The leak check and the result-checker proof were.
- Supabase Auth captcha, OAuth redirect allow-lists, and storage bucket limits that live only in the hosted project were not visible from the repo.
- DNS rebinding on connector fetch was not closed.
- This pass did not attempt a production exploit, a production migration, or a history rewrite.

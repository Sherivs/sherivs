# ADR-108: Pre-Tenant Onboarding Requests and Resumable Interview Sessions

| Field                      | Value                                                                                                                                           |
| -------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Status                     | PROPOSED (founder approval required before the migration is applied; legal points marked COUNSEL need counsel)                                  |
| Date                       | 2026-11-17                                                                                                                                      |
| Author                     | Claude Code agent (mission M5 part B implementation)                                                                                            |
| Creator                    | Claude Code agent, mission E-010 (M5 part B onboarding requests)                                                                                |
| Mission                    | M5 part B (master brief §4.4, §8.3, §12.1 M5)                                                                                                   |
| Capabilities               | Record an onboarding request and a resumable, token-bound interview session before any organization exists, with no anonymous reads             |
| Cites                      | [ADR-101](./ADR-101_SEC_M0_ANONYMOUS_SURFACE_AND_PRIVATE_BY_DEFAULT.md); ADR-005 (retention mechanism); `docs/compliance/retention-schedule.md` |
| Minimal ownership artifact | `database/supabase/migrations/20261117001300_sherivs_m5_onboarding_requests.sql`                                                                |

## Context

`/onboarding` and `/request-demo` built a `mailto:` draft. Nothing was recorded, nothing could be resumed, and staff had no queue. The reality interview needs somewhere to keep answers before a tenant exists, and the founder rule (brief §8.4, rule 16) keeps onboarding request-based: no self-service tenant creation.

## Options

- **A. Keep mailto.** Rejected: no record, no consent record, no resume.
- **B. Anonymous INSERT grant on a table (like `admission_applications`).** Rejected: it widens the anonymous surface of ADR-101, and Turnstile, rate limit and honeypot could not be enforced in the database.
- **C. Platform tables with no client privilege; a rate-limited, captcha-checked server function writes them with the service role.** Chosen.

## Decision

1. **Pre-tenant model.** `onboarding_requests` (organization name, coarse type, state, LGA, contact name, email, optional phone, role and note, consent record, source, status, assigned staff) and `reality_interview_sessions` (request, `resume_token_hash`, graph version, opaque `answers` JSON capped at 64 KB, revision, completion, expiry default 30 days). No tenant column. After provisioning, answers move to `cg_org_profile`, and the plan and its application record go in `onboarding_sessions` (`plan`, `plan_hash`, `applied_result`). That is a later mission.
2. **Privileges.** ENABLE and FORCE RLS. anon and authenticated hold no table privilege and cannot execute any function in the migration. The service role writes. SELECT policies for staff holding `platform.onboarding.read` (the existing `onboarding` platform role, checked by `public.has_platform_capability`) are created but stay **dormant**: no table grant goes to authenticated. The console reads through the server after checking that capability. A later console mission may grant SELECT, and the policies then decide which rows are visible. The SQL test proves both states.
3. **Server functions** (service role only, `SECURITY INVOKER`, `search_path = ''`): create the request and its session; load by token hash only while the session has not expired; save with optimistic concurrency on `revision` (a stale revision raises `PT409`; a missing or expired session raises `PT404`); mark complete (a completed session is read-only); purge expired sessions using the database clock.
4. **Resume token.** 32 bytes from the CSPRNG, base64url. It is shown to the visitor once, and only its sha-256 hex is stored. Lookup is by hash, and the server then compares the hash in constant time. No response contains the hash, and no log line contains the token, the hash, an address or a form value.
5. **Audit.** Every write on both tables appends an `audit_logs` row with no organization and no personal data: ids, status, source, revision and completion only.

## Lawful basis, consent and minimum data (NDPA 2023) — no legal conclusions

- **Purpose:** review an onboarding or demo request, contact the requester about it, and prepare an organization setup plan.
- **Basis recorded:** the visitor's consent. The table stores `consent_given` (it must be true), `consent_version` (`INTAKE_CONSENT_VERSION`) and `consent_given_at` (server time). Whether consent is the right basis, or whether pre-contract steps or legitimate interest fit better, is a question for **COUNSEL**. The wording on both forms also needs **COUNSEL** review.
- **Minimum data:** phone, role, state, LGA and message are optional, and no learner or minor data is requested. The message field asks people not to include passwords or unnecessary personal data. Interview answers are opaque here. The question graph mission must classify each question (`data_class`) and keep personal questions to what the plan needs.
- **Data-subject requests:** requests are not yet covered by `lib/compliance/dsr.ts`. Adding them is follow-up work. Until then, erasure is a service-role delete, and the session rows cascade with it.

## Retention (LEGAL REVIEW REQUIRED)

`RETENTION_POLICY_SCHEDULE.json` has no platform-scope policy for prospect contact data. Provisional rule proposed here, with only the first part implemented:

| Data                                               | Rule                                                              | Mechanism                                                                                   |
| -------------------------------------------------- | ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `reality_interview_sessions`                       | deleted at `expires_at` (30 days by default)                      | `public.onboarding_intake_purge_expired()`, called by the retention job (not scheduled yet) |
| `onboarding_requests` rejected or never progressed | erased 365 days after the last update (aligned with RP-COMMS-ORG) | not implemented; needs a schedule entry and founder and counsel approval                    |
| `onboarding_requests` provisioned                  | follows the new tenant's identity-profile policy (RP-IDPRO-ORG)   | not implemented                                                                             |
| `audit_logs` rows written here                     | RP-AUDIT-PLT; they hold no personal data                          | existing                                                                                    |

## Abuse controls

- The submit path is rate limited by platform-observed address (`clientIpFromHeaders`): 5 requests per 10 minutes. The session paths allow 30 per minute. Both use the existing `checkPublicRateLimit`, which runs in-process unless Redis is configured.
- **Honeypot:** a hidden `website` field. When it is filled, the visitor gets a success-shaped answer and nothing is stored.
- **Turnstile** (free tier): when `TURNSTILE_SECRET_KEY` is set on the server, a token is required (`captchaRequired`) and verified with Cloudflare siteverify, failing closed. When the secret is unset, the server does not require a token. **The founder must set the secret in production for this control to be active.**
- **No enumeration:** email is not unique, a repeat request is accepted the same way, and errors are generic.
- **Size bounds:** every text column has a length check, the request envelope is capped at 80 KB, and answers are capped at 64 KB in both zod and the database.

## Consequences

- No row is readable by any client role today. A console view needs a server function, or a later grant.
- A visitor who loses the resume code cannot resume, because Sherivs cannot recover it. Delivering a magic link by email or WhatsApp is follow-up work (Resend keys are pending).
- The in-process limiter is per instance on serverless hosts. Configure Redis for a global limit.

## UNKNOWNs

- Whether PostgREST surfaces `PT404`/`PT409` as the error `code` exactly as the server maps it (UNVERIFIED against a live PostgREST; the mapping falls back to "unavailable").
- Lawful basis, consent wording and retention durations: COUNSEL.

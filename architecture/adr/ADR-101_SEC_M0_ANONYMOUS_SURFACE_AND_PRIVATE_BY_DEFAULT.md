# ADR-101: The Anonymous Surface and Private-by-Default Privileges

| Field                      | Value                                                                                                                             |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Status                     | PROPOSED (founder approval and an independent security review are required before any apply)                                      |
| Date                       | 2026-11-16                                                                                                                        |
| Author                     | Claude Code agent (mission M0 implementation)                                                                                     |
| Creator                    | Claude Code agent, mission E-003 (M0 stabilise and secure)                                                                        |
| Mission                    | M0 (stabilise and secure), SEC-M0                                                                                                 |
| Capabilities               | Name every object an anonymous visitor may reach; make everything else, and every new object, private until a migration grants it |
| Cites                      | [ADR-069](./ADR-069_SEC02_VIEW_AND_FUNCTION_PRIVILEGE_HARDENING.md); PR #377 (SEC-03); PR #417 (SEC-H3); the audit of 2026-11-16  |
| Minimal ownership artifact | `database/proposals/SEC-M0_privilege_consolidation.sql`                                                                           |

## Context

Read-only queries on production on 2026-11-16 showed that the `anon` role holds privileges on 81 tables, can execute 50 functions, and that every new table, sequence and function is granted to `anon` and `authenticated` by default. Row-level security denies most of it today, so the grants are a second lock left open: one loosened policy would expose data. Separately, an organization administrator can write their own `subscriptions` row.

## Options

- **A. Leave grants as they are and rely on RLS.** Rejected: one layer, and the default makes every future table reachable.
- **B. Revoke per object from a fixed list.** Rejected: the list goes stale as soon as a table is added.
- **C. Revoke everything from `anon`, grant back a named allowlist, and make new objects private by default.** Chosen.

## Decision

1. **The anonymous surface is this list and nothing else.**
   - Read (rows limited by a "published" policy): `academic_programs`, `blog_posts`, `events`, `faqs`, `news`, `school_facilities`, `school_gallery`, `school_meals`, `school_sports`, `school_staff`, `school_staff_types`, `school_transport`, `testimonials`, `ui_translations`, `website_block_types`, `why_us_items`.
   - Column-limited read: `schools`. anon keeps the column-level SELECT it already holds (every column except `grading_scale_id` and `institution_category`, the SHERIVS-002 design) and holds no table-level privilege. The sitemap, the web manifest, organization branding before sign-in and the admission form's policy depend on it. The apply stops if anon ever holds table-level SELECT there.
   - Insert only: `admission_applications` (the public admission form).
   - Execute, by exact signature so a later overload is not covered. Public endpoints: `check_result`, `donation_campaign_progress`, `gov_jurisdiction_by_host`, `public_school_stats`, `public_teachers`, `resolve_school_by_host`, `siwes_supervisor_verify`, `ui_strings`, `verify_transcript`, `website_public`, `website_public_post`.
   - Execute, policy helpers: `get_my_school_id`, `is_school_admin`, `is_super_admin`. Policies on the readable tables call them for every caller; without EXECUTE an anonymous read fails outright instead of returning published rows. They return nothing useful to an anonymous caller. `is_school_admin` stays: on 2026-11-16 two SELECT or ALL policies on these tables referenced it.
   - Removed on purpose: anon's column-level SELECT on `users` (33 of 38 columns). No anonymous path reads it.
2. **Adding to the surface needs a migration that grants it and an update to this list.**
3. **Signed-in users keep what they have**, except writes on `subscriptions`, which become service-role only.
4. **New tables, sequences and functions are private by default.** A migration must grant what its policies need; `scripts/verify-migration-grants.mjs` fails a new table that no GRANT or REVOKE names.
5. **The rollback restores exactly the previous state** from a snapshot the apply takes into `ops_private`, a schema no client role can use. It never grants wholesale.

## Consequences

- A future migration that forgets a grant fails closed and loudly, which is the intended direction.
- `supabase_admin`'s defaults may not be changeable by `postgres`; the proposal reports it rather than failing. Objects here are created by `postgres`.
- Column-level grants do not appear in `information_schema.role_table_grants`; the first draft of this decision missed `schools` for that reason and an independent review caught it. Audits must use the `has_*_privilege` functions.
- Four allowlisted endpoints have no caller in the web or mobile code today (`donation_campaign_progress`, `public_school_stats`, `public_teachers`, `gov_jurisdiction_by_host`). They stay as they are now; removing them is a founder decision.
- Open PRs #313 and #324 create tables with policies and no grant; they must add grants when rebased.
- Not covered: which functions `authenticated` may execute (the audit lists 4 workforce functions), and 91 tables with RLS and no policy. Both are separate reviews.
- The behaviour test runs on a production-shaped fixture, not a replay of production. Before an apply, the verification queries at the foot of the proposal must be run and each public page checked.
- Nothing is applied by this ADR.

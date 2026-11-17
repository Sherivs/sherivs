# Seed platform role packs and founder staff row (2026-11-15)

Applied to production by the founder's approval ("start from the 2").

- 13 packs published (v1.0.0): 6 tenant roles (principal, teacher, bursar, parent, student, admin), JARVIS executive, and 6 platform departments (support, engineering, security, finance, sales, operations). All start in shadow.
- The other 18 platform packs (compliance … investor) and the 17 organisation packs are NOT published yet: ADR-091/095 list them as definition-only pending owner ratification.
- Founder staff row created with the `platform_admin` role only. That role has no agent pack, so the context is `pending_pack` by design.
- Verified: see verify.sql (13 / 1 / 1 / pending_pack / 0 failures).
- No secrets are stored here; the email is read from auth.users inside the statement.

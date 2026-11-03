# ADR-041: SEC-01 Preserves the Public Result-Checker Contract

|| Field | Value |
||---|---|
|| Status | PROPOSED (draft implementation; operator ratification requested; no production database changes authorized) |
|| Date | 2026-11-03 |
|| Author | `copilot-swe-agent[bot]` (GitHub Copilot Coding Agent; issue #299) |
|| Mission | SEC-01 (V1 organizational security hardening) |
|| Capabilities | V1 organizational result checking and consent |
|| Supersedes-in-part | None |
|| Cites | `AGENTS.md` §§16–18, 22–24, 26–31, 45; `database/supabase/migrations/20261024000270_sherivs_020_comms_results_admissions.sql:148-194`; `database/supabase/migrations/20261103140000_sherivs_sec01_check_result_uniform.sql`; `scripts/verify-domain-neutrality.mjs:16-38`; `architecture/coregrid-mvp-architecture/NEUTRALITY_GUARD_BASELINE.json` |
|| Minimal ownership artifact | This ADR and the SEC-01 neutrality-baseline exception |

## Context

The public `check_result` API is implemented on the existing result-card, student, grade, and school tables. Replacing its function body must preserve its signature and successful response for existing clients. The new migration necessarily references existing Scholar table and payload vocabulary, causing five findings on the scanned migration surface under the neutrality guard. The migration does not add domain code or alter RLS, authorization, or checker grants.

## Options

### Option 1 — Omit the findings from the baseline (rejected)

Leave the migration blocked by the neutrality guard or rename/rewrite its references.

- **Consequences:** preserves a shrink-only baseline but prevents shipping the scoped database security correction or changes the existing function contract. Renaming real tables or payload keys is outside this security fix and risks breaking public result checking.

### Option 2 — Record only observed migration findings under this ADR (ruled)

Use the existing migration-only quarantine mechanism for the exact guard findings; do not add application-code or privilege exceptions.

- **Consequences:** the required additive baseline exception is machine-checkable and attributable, while the guard continues to warn on the legacy vocabulary. The exception remains until a separately authorized neutral-schema conversion can remove the references.

## Recommendation (decision)

**Use Option 2.** Preserve the public function signature, success payload, rate limit, and existing grants; return uniform JSON failures after the limiter so failed attempts commit. Restrict the consent actor RPC to `service_role`. Add only the five observed findings for the new checker migration, with no RLS, authentication, audit, or tenant-boundary changes.

## Consequences (summary)

- **Positive:** closes the admission-number enumeration and rate-limit rollback behavior while retaining the public result-checker contract.
- **Negative / obligations:** the neutrality guard will continue to warn on the five quarantined migration findings; a future approved schema conversion should remove them.
- **For the wave/program:** delivers only V1 organizational security hardening; it does not introduce new result-checking or consent capabilities.

## Golden Questions

- **WHO?** SEC-01 owns the migration and tests; operator ratification remains the decision gate.
- **WHAT?** Preserve existing V1 data and API boundaries while correcting checker failure semantics and consent RPC grants.
- **WHERE?** Function changes are in the SEC-01 migration; the exact vocabulary findings are in the neutrality baseline; assertions live in `tests/unit/sec01-check-result.test.ts`.
- **WHY?** The existing checker’s post-limiter exceptions disclose student matching and roll back limiter writes.
- **UNDER WHICH POLICY?** `AGENTS.md` security, authorization, tenant, testing, and V1-boundary rules; the neutrality guard’s ADR-gated baseline mechanism.

## UNKNOWNs

- **Operator ratification:** the operator must approve this proposed decision before treating it as binding.
- **Neutral schema conversion:** the owning future migration must remove the five baseline findings when the existing result tables and public contract are safely converted.

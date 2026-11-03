# ADR-017: Purpose-Bound Consent and Explicit Learner Relationships (M09)

|| Field | Value |
||---|---|
|| Status | PROPOSED (draft implementation; operator ratification and legal review remain required; no production database changes authorized) |
|| Date | 2026-11-03 |
|| Author | GitHub Copilot Coding Agent (M09 / issue #188) |
|| Creator | copilot-swe-agent[bot] |
|| Mission | M09 / issue #188 (V1 organizational consent and guardian relationships) |
|| Capabilities | V1 NDPA consent and learner-family relationship records |
|| Supersedes-in-part | None |
|| Cites | Issue #175 and #188; owner instruction on #188 reserving ADR-017; `AGENTS.md` §§13, 16–19, 26–28, 31, 38, 42, 45; `database/supabase/migrations/20261102180300_sherivs_m04_tenant_authority_links.sql`; `database/supabase/migrations/20261020000060_sherivs_003_ndpa_foundations.sql`; `database/supabase/migrations/20261025100160_sherivs_b04_consent_breakglass_delegation.sql`; `docs/compliance/ndpa-overview.md` |
|| Minimal ownership artifact | This ADR only — a decision artifact |

## Context

The existing V1 consent store keeps one mutable `consent_records` row per
learner-purpose and an append-only `consent_events` table. Its current
`consent_gate` treats `core_education` as allowed without a grant. Guardian
authorization relies on the coarse `parent_student_map`; that representation
does not distinguish a legal guardian, parent, caregiver, or fee payer, nor
does it carry effective dates or a separate record-access decision.

M04 keeps the active tenant root in `schools` and resolves the caller's tenant
through the existing membership helpers. The existing NDPA consent and audit
tables are already tenant-scoped. M09 must therefore extend those stores rather
than create a second tenant identity or weaken existing row-level security.
Issue #175 requires adult learners to consent for themselves, purpose-specific
lawful-basis and grantor evidence, immediate withdrawal enforcement, and
append-only audited history.

## Options

### Option 1 — Keep the mutable consent row as the history (rejected)

Continue updating `consent_records` and rely on callers to append a matching
event.

- **Consequences:** This is the smallest schema change, but a failed event write
  could leave a changed consent state without an auditable history entry. The
  existing default-allow gate also does not satisfy purpose-specific withdrawal.

### Option 2 — Replace M04 or the legacy tenant identity model (rejected)

Move M09 records to a different tenant substrate or rewrite prior migrations.

- **Consequences:** This would create a second tenant authority or rewrite
  deployed history, contrary to M04 and the forward-only migration constraint.

### Option 3 — Add relationship evidence and a transactional consent ledger (proposed)

Add tenant-scoped effective-dated relationship rows with an explicit record
access flag; retain `consent_records` only as the current decision projection;
append each decision to `consent_events` and audit it in the same transaction.

- **Consequences:** This preserves the active M04 tenant contract and makes
  withdrawal and provenance enforceable. Legacy grants without lawful-basis
  and grantor evidence fail closed, and existing family links require explicit
  relationship confirmation before they may grant consent.

## Recommendation (decision)

**Use Option 3 for M09.** A fee-payer relationship is constrained from granting
record access; only an active parent or legal guardian may give consent for a
learner treated as under 18, and an adult learner must consent as themself.
Every processing check requires a current grant with lawful basis, grantor,
policy version, and grant timestamp; withdrawal blocks the purpose immediately.
All database changes are additive, tenant-scoped, RLS-enabled and forced, with
no migration apply to a live database.

### Explicit residual risk (stated, bounded, owned — not hidden)

- **The residual risk:** Consent defaults and lawful-basis choices are
  engineering controls and are not legal determinations under NDPA 2023.
- **The sharpest instance:** Existing grants without M09 attribution will no
  longer authorize processing until the controller reviews and records them.
- **The accepted rationale:** Failing closed avoids inventing evidence or
  treating a fee/payment relationship as parental authority.
- **Owner of the residual risk:** The institution as data controller, with its
  DPO/legal counsel; review purpose notices and lawful bases before production
  use.

## Consequences (summary)

- **Positive:** Withdrawal enforcement is purpose-specific, consent history is
  immutable and audited, and relationship roles no longer conflate payment and
  record access.
- **Negative / obligations:** Existing guardian links need explicit M09
  relationship records; controllers must supply evidence references and decide
  lawful bases; the migration and rollback remain unapplied and destructive
  rollback requires evidence export.
- **For the wave/program specifically:** M09 extends the V1 NDPA layer and
  consumes M04 tenant context; it does not implement frozen V2/V3 capability.

## Golden Questions

- **WHO?** M09 owns the V1 consent and learner-relationship implementation; the
  institution's controller and DPO own lawful-basis decisions.
- **WHAT?** Purpose grants are explicit, attributed, withdrawal-aware, and
  recorded against distinct effective-dated relationships.
- **WHERE?** This decision is here; schema and enforcement are in the
  20261103110000 M09 migration; rollback and local-only SQL tests accompany it.
- **WHY?** Issue #188 requires adult self-consent, guardian distinctions,
  immediate withdrawal blocking, fee-payer isolation, and auditable history.
- **UNDER WHICH POLICY?** AGENTS §§13, 16–19, 26–28, 31, 38, 42, 45; issue #175
  non-negotiables; M04's active tenant contract; no-live-DB and
  forward-only-migration constraints.

## UNKNOWNs

- Operator ratification of this proposed ADR and application of the migration
  remain unapproved.
- Each controller/DPO must validate the lawful basis and notice for each
  processing purpose before production reliance.
- Existing family links are not backfilled as legally verified relationships;
  institutions must verify relationship evidence through an authorized process.

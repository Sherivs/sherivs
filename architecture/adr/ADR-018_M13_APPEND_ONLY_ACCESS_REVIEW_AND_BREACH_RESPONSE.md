# ADR-018: Tenant-Scoped Access Reviews and Append-Only Review Evidence

|| Field | Value |
||---|---|
|| Status | PROPOSED (draft implementation; operator ratification requested; no production database changes authorized) |
|| Date | 2026-11-03 |
|| Author | `copilot-swe-agent[bot]` (GitHub Copilot Coding Agent; issue #192) |
|| Mission | M13 (M009 Stage A foundation; V1 organizational governance) |
|| Capabilities | V1 organizational audit and access review |
|| Supersedes-in-part | None |
|| Cites | `AGENTS.md` §§16–18, 28–31, 45; `architecture/adr/ADR-014_M04_TENANT_MODEL_LEGACY_STORE_ADAPTER.md`; `database/supabase/migrations/20261101000010_sherivs_m009_a1_role_responsibility_engine.sql`; `database/supabase/migrations/20261102180300_sherivs_m04_tenant_authority_links.sql`; `architecture/coregrid-mvp-architecture/adr/ADR-005_RETENTION_VS_IMMUTABLE_AUDIT.md`; `database/supabase/migrations/20261020000060_sherivs_003_ndpa_foundations.sql` |
|| Minimal ownership artifact | This ADR and the M13 access-review migration contract |

## Context

M009 provides tenant-scoped role assignments and immutable assignment audit events; M04 keeps the organization tenant boundary on the existing school identity. Neither defines periodic review campaigns for role assignments. The existing NDPA foundation already provides `public.security_incidents` and its `detected_at + 72 hours` timer, while the issue requires an operational 72-hour checklist. M13 must add access review without replacing either established substrate or weakening RLS, tenant isolation, or audit immutability.

## Options

### Option 1 — Reuse assignment audit events as the campaign store (rejected)

Represent pending reviews and their decisions as loosely structured audit rows.

- **Consequences:** avoids a new workflow table, but makes pending work, campaign deadlines, and decision state difficult to constrain or query. It also mixes mutable workflow state with immutable evidence.

### Option 2 — Add tenant-scoped review workflow tables and a separate immutable review log (ruled)

Snapshot active assignments into a campaign; expose decisions only through authenticated SECURITY DEFINER functions that re-check tenant membership and `roles.assign`; record every campaign and decision in an append-only event table. Revocation ends the existing assignment through its normal audit-triggered path.

- **Consequences:** makes due work and review outcomes explicit and testable, while adding a small bounded schema. A campaign is a point-in-time snapshot; later grants require a later campaign. Unresolved items stay open and visible after their deadline rather than being silently auto-approved.

## Recommendation (decision)

**Use Option 2.** All review state is tenant-scoped to M04's existing organization identity, RLS is both enabled and forced, direct writes are denied, and review actions are authorized with the existing role engine. Role revocation updates the existing assignment so the M009 role audit remains canonical; M13 records the review decision in its own immutable log. The 72-hour response checklist uses the already-established `security_incidents` record and timer rather than creating a competing incident register.

## Consequences (summary)

- **Positive:** gives each campaign an auditable snapshot, deadline, explicit retain/revoke decision, and tenant-constrained reviewer workflow; preserves the existing role-assignment and breach-record substrates.
- **Negative / obligations:** review snapshots can become stale, so the decision function must treat missing, expired, or ended assignments as already ended and never reactivate them. Operators must monitor overdue open campaigns. Breach notice decisions and deadlines require DPO/legal review.
- **For the wave/program:** delivers M13's V1 Stage A audit/access-review scope only; it does not add self-service onboarding, government reporting, or future-version capabilities.

## Golden Questions

- **WHO?** M13 owns the workflow; tenant role administrators review assignments; the DPO and incident commander own breach response.
- **WHAT?** Add tenant-scoped periodic role reviews with append-only evidence and a 72-hour breach runbook.
- **WHERE?** The migration, rollback, and SQL harness live under `database/supabase/` and `tests/integration/`; the operational checklist lives at `docs/security/breach-72h.md`.
- **WHY?** The M009 role engine has assignment audit but no review campaign; NDPA response needs an actionable timeline using the existing incident register.
- **UNDER WHICH POLICY?** `AGENTS.md` security, authorization, privacy, RLS, audit, testing, and V1-boundary rules; M04's tenant model; M009's role engine; ADR-005's immutable-audit/privacy relationship.

## UNKNOWNs

- **Operator ratification:** the operator must approve this proposed decision before treating it as binding.
- **Legal content:** the DPO/legal counsel must confirm the current NDPA threshold, channels, templates, and any phased-notification details before operational use.
- **Retention:** retention and erasure treatment for campaign snapshots and review events remains governed by the existing privacy/retention policy and ADR-005; M13 does not introduce a new retention period.

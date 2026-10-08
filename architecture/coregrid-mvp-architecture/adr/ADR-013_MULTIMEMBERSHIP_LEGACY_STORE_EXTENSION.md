# ADR-013: Multi-Membership Migration Extends the Live Legacy Identity Store In Place (neutrality-guard baseline extension)

| Field | Value |
|---|---|
| Status | PROPOSED (operator ratification requested — same mechanism as ADR-012) |
| Date | 2026-10-08 |
| Author | Sherivs refoundation agent (multi-membership identity store mission) |
| Capabilities | V1CAP-067 (domain-neutrality guard); §11 identity chain (SHERIVS EXPERIENCE REFOUNDATION) |
| Cites | ADR-004 §Recommendation ("nothing may increase it without a new ADR" — this is that ADR); ADR-012 (precedent mechanism); AGENTS §17/§26/§28; J-005/J-006 predicate law; COND-003 (tenant uuid-vs-text) |
| Supersedes | Nothing (extends the ADR-012 mechanism to a second migration) |

## Context

The Sherivs refoundation's §11 law — authentication resolves memberships → organizations → roles → runtime → workspace, with users holding MORE THAN ONE organization membership — required the multi-membership migration `20261008000050_coregrid_organization_memberships.sql`. The migration trips 47 guard hits in 9 groups (`structural:school_id`, `vocabulary:get_my_school_id`, `vocabulary:is_school_admin`, `vocabulary:school`, plus the tenant role-name literals `admin`/`principal`/`teacher`/`parent`/`student`/`bursar`) because:

1. **It extends the LIVE legacy identity store, not the neutral substrate.** The destination law, organization selector, and server identity resolver already handle N memberships (landed earlier in the refoundation); what was missing was storage — the identity store held exactly one membership per user (`public.users.school_id`). Enabling N memberships is a data-model change on the store every live tenant RLS predicate resolves through. That store IS school-domain vocabulary by construction: `users.school_id`, `get_my_school_id()`, `is_school_admin()`.
2. **The neutral universal org-model substrate cannot host it.** `cg_org_membership` (20261001000000, AUTHORED NOT APPLIED, `tenant_id text`) is the deliberately-unapplied universal layer; COND-003 (tenant uuid-vs-text) governs unification, and the live tenant RLS is keyed on uuid `schools.id`. Migrating live tenancy onto the neutral text-typed substrate is the SAME blocked conversion ADR-012 records (`conversionPath`), not something this mission may execute (AGENTS §40 — never implement future functionality without authority; §45 — the frozen boundary).
3. **§26 (data and database safety) forbids the alternative.** A "neutral" rewrite of the identity store would rename or re-key the ACTIVE-CONTEXT binding every live RLS predicate resolves through — a destructive, non-additive change to the applied schema. The migration is strictly additive: no rename, no drop, no legacy row modified; `users.school_id` REMAINS the active-context binding, now switchable server-side.

## Options considered

**O-A — Host memberships on the neutral `cg_org_membership` substrate now.** Rejected: COND-003 (tenant uuid vs text) is unresolved; the substrate is unapplied by design; wiring live tenant RLS through it would be the frozen V2/V3-class conversion executed without a human authorization record (AGENTS §45).

**O-B — Name the table/columns neutrally (`organization_id`, etc.) while still extending the legacy store.** Rejected: the table must join on `public.schools(id)` and mirror `users.school_id`/`users.role`/`is_school_admin()`; a neutral-named table whose every predicate resolves through guarded legacy helpers would be obfuscation, not neutrality — the guard would flag the joins and helpers anyway, and the schema would lie about what it is.

**O-C — Obfuscate identifiers in SQL (string construction).** Rejected outright (ADR-012 O-C): dishonest, breaks observability.

**O-D — Quarantine the migration's legacy-vocabulary references via THIS ADR (adopted).** The nine observed violation groups join the migration's legacy owners in the baseline (`streamIRef: "ADR-013"`) until the neutral-tenant substrate conversion lands (COND-003), at which point they are removed in the same change as ADR-012's entries (shrink-only law resumes).

## Decision

1. The observed violation groups (47 hits at authoring; 48 after the amendment below — ten groups total) for `database/supabase/migrations/20261008000050_coregrid_organization_memberships.sql` are added to `NEUTRALITY_GUARD_BASELINE.json`, marked with this ADR as their authority (`streamIRef: "ADR-013"`).
2. The migration introduces NO new domain code on the universal surface: one additive table (UNIQUE(user_id, school_id), declared tenant-role CHECK — no `super_admin`), a dual-write trigger on `public.users` (the store's existing write surface), an idempotent backfill, RLS ENABLED + FORCED with a four-policy member/admin/super-admin posture, and redefinitions of `get_my_school_id()`/`get_my_role()` that keep their exact signatures and semantics (ONE active organization) with legacy fallback, plus `get_my_memberships()` (definer, revoked from PUBLIC/anon).
3. Security note (no regression): the migration authorizes ZERO new client privileges. Table DML is granted to `authenticated` only, gated by the four RLS policies (member reads own rows; organization admin manages only the active organization's rows; internal workforce manages all; anon revoked entirely). TRUNCATE/REFERENCES/TRIGGER are revoked from `authenticated` — TRUNCATE is not RLS-gated, so leaving it granted would be a policy-bypassing write path outside the declared posture. The ACTIVE-context switch is a server function that validates the caller's own RLS-scoped membership and audits the write.
4. **Amendment (2026-10-08, same ADR authority) — applied under explicit operator authorization.** Pre-apply verification against the LIVE schema exposed two roles the migration's original CHECK omitted (`alumni`, `driver` — the live `users_role_check` carries nine tenant roles), which failed the backfill inside the runner's implicit transaction (clean rollback, no partial state). The CHECK was corrected to mirror `users_role_check` EXACTLY — required so the dual-write trigger can mirror every role the identity store legally holds — and the migration was then applied to the canonical project via `scripts/db-apply-one.mjs`. This adds one quarantine group (`vocabulary-literal:driver`; `alumni` is outside the guard's token vocabulary). Post-apply verification recorded: RLS ENABLED+FORCED, four policies present, backfill 8/8 users with 0 unmatched rows, grants exactly (anon: none; authenticated: SELECT/INSERT/UPDATE/DELETE; service_role: ALL), behavioral RLS matrix (non-admin member reads exactly their own row and cannot update, delete, or self-grant — violations fail closed; org admin reads/manages their one organization's rows), and a live dual-write trigger exercise (role move upserts in place; school move creates a second primary membership while preserving the prior affiliation — exercised inside a rolled-back transaction).
5. Recorded follow-up (conversionPath): when the neutral-tenant substrate conversion (COND-003) provides an expressible neutral predicate, these entries — together with ADR-012's three — are REMOVED in the same change.

## Golden Questions

- **WHO?** The Sherivs refoundation mission authors; the operator ratifies; the neutral-tenant substrate conversion removes the entries.
- **WHAT?** Nine baseline quarantine groups (47 hits) for one multi-membership migration's legacy identity-store vocabulary.
- **WHERE?** `NEUTRALITY_GUARD_BASELINE.json` (+ `summary`/`lastRatchet`); the migration itself is unchanged.
- **WHY?** §11 multi-membership is a data-model change on the LIVE legacy identity store — the only store the live tenant RLS can resolve through today — and the neutrality ratchet must stay honest (warn-every-run, never silent).
- **UNDER WHICH POLICY?** ADR-004's ADR-for-increase mechanism; ADR-012's precedent; AGENTS §17 (RLS mandatory), §26 (additive-only database change), §28 (migrations as state of record), §38 (this ADR is the change-management record), §45 (V1 envelope — organizational capability, not frozen V2/V3 scope).

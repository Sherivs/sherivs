# ADR-024: Verified Authority Evidence for Executive Workspaces (M009 Stage B-1)

|| Field | Value |
||---|---|
|| Status | PROPOSED (operator review required before production rollout) |
|| Date | 2026-11-03 |
|| Author | Copilot Coding Agent (M009 Stage B-1) |
|| Creator | copilot-swe-agent[bot] |
|| Mission | M009 Stage B-1 (Institutional Executive workspace; V1 organizational capability) |
|| Capabilities | Executive workspace and authority-gated role assignments |
|| Supersedes-in-part | None |
|| Cites | `AGENTS.md` §§13–18, 22–28, 31, 45; `database/supabase/migrations/20261102180300_sherivs_m04_tenant_authority_links.sql`; `database/supabase/migrations/20261103145000_sherivs_m009_b1_verified_executive_authority.sql`; `frontend/src/lib/workspaces/manifest-resolver.ts`; `scripts/generate-workspace-permission-matrix.mjs` |
|| Minimal ownership artifact | This ADR only — a decision artifact |

## Context

The executive workspace uses existing role assignments and tenant-scoped workspace data. M04 records institution-authority relationships with verification and effective dates, but a role title or relationship alone is not an authorization grant. The prior role catalog has authority-bearing executive and governance templates; tertiary leadership and some governance templates are explicitly unverified in the static catalog. Workspace manifests already derive visibility from active role assignments and responsibilities, and the live widget feed is tenant-scoped and permission-controlled.

The issue requires executive workspaces for distinct institutional roles without treating a proprietor, public principal, vice-chancellor, board member, dean, or HOD as interchangeable. Unverified relationships must grant nothing, and no authority, mandate, or relationship may be invented or seeded.

The domain-neutrality guard scans every SQL migration. This additive migration necessarily references the existing role-engine template family and permission identifiers, as well as M04's `school_id` tenant binding; these are database-contract references, not domain logic added to the universal TypeScript surface. Obfuscating them or moving the SQL out of Supabase's migration directory would hide or break the contract. Under ADR-004, this ADR proposes a neutrality-baseline exception limited to the exact observed vocabulary and structural groups for this migration, subject to operator ratification. The baseline continues to report those references as warnings; this does not authorize unrelated baseline growth or a tenant-model conversion.

## Options

### Option 1 — Infer authority from the role title (rejected)

Use the displayed title to enable executive actions or data visibility.

- **Consequences:** This is easy to present but violates the identity/authorization distinction and cannot prove institutional authority. It risks granting powers based on a client-visible label and breaks tenant policy boundaries.

### Option 2 — Require a verified M04 relationship as the permission grant (rejected)

Treat a verified institution-authority relationship as sufficient to grant actions.

- **Consequences:** This makes relationship verification operationally simple but conflates an institutional link with an individual’s permission. It would bypass role-engine permissions, assignment scope, RLS, and policy checks.

### Option 3 — Require verified relationship evidence for flagged assignments while retaining role-engine permissions (retained)

Flag only authority-dependent global role templates. A flagged assignment is effective only when its evidence references exactly one same-tenant M04 link that is verified and effective at evaluation time. The existing role template, assigned responsibilities, scope, policy, and RLS remain the permission source. The tertiary fallback is read-only and maps to the existing principal workspace family; the migration fails rather than overwriting any pre-existing fallback template data.

- **Consequences:** It prevents title-only and stale-link access while preserving distinctions among existing role templates. It adds a required evidence selection to assignment and fails closed if M04 data or evidence is missing. Existing M04 authority records are not created or modified by this decision.

## Recommendation (decision)

**Use Option 3: independently verified authority relationship evidence is an eligibility gate, never a permission grant.** Enforce the gate both when an active authority-dependent assignment is written and when effective permissions are resolved; require a single UUID reference, matching tenant, verified status, active effective dates, and a verifier distinct from both the assigning actor and assignee. Keep assignment responsibility, scope, RLS, policy, and audit enforcement intact; do not infer powers from titles or seed authority records.

## Consequences (summary)

- **Positive:** The eligibility invariant is machine-checkable and re-evaluated at permission resolution, so verification expiry or revocation fails closed. The tertiary read-only fallback carries no expense or payroll approval permission.
- **Negative / obligations:** Assignment clients must surface eligible verified links and provide an explicit selection. Permission-matrix output must disclose the gate. Tests must cover unverified, expired, not-yet-effective, wrong-tenant, ambiguous, malformed, same-verifier/assigner, same-verifier/assignee, and valid evidence.
- **For the wave/program specifically:** M009 Stage B-1 consumes M04 authority links and Stage A role assignments; it remains within the V1 organizational capability envelope. The live dashboard must display only authorized widget data and use “Not configured” for missing sources.

## Golden Questions

- **WHO?** M009 Stage B-1 owns the workspace integration; the operator reviews this proposed decision and controls production rollout.
- **WHAT?** A verified, effective M04 relationship is required evidence for flagged assignments, but never grants permissions itself.
- **WHERE?** This decision is recorded here; the migration and resolver enforce it; the permission-matrix generator documents it; focused tests verify it.
- **WHY?** Executive titles and institutional relationships do not independently establish a user’s authority or permitted scope.
- **UNDER WHICH POLICY?** AGENTS §§13–18 and 22–28; the M04 tenant-authority contract; the M009 assignment, tenant-isolation, RLS, and audit invariants.

## UNKNOWNs

- **Production authority evidence:** The operator must verify institution-specific source evidence and mandates before any relationship is marked verified. This ADR does not establish that evidence.
- **Verification authority:** M04 currently permits tenant members with `settings.manage` to mark authority links verified; the update is stamped with `verified_by` and recorded in the immutable authority-link audit. This remains tenant-side, self-attested verification, not independent operator verification. Whether verification must become operator-only is an open operator decision; this ADR does not grant that capability.
- **Executive data coverage:** Academic, workforce, compliance-deadline, and corrective-action sources may be absent. The workspace must show “Not configured” until an authorized source and widget contract exist.
- **Operator ruling:** This proposed ADR remains unratified until the operator explicitly reviews and approves it.

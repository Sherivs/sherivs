# ADR-044: M06 Tenant-Scoped Assessment and Results Workflow

|| Field | Value |
||---|---|
|| Status | PROPOSED (operator review before migration execution) |
|| Date | 2026-11-03 |
|| Author | `copilot-swe-agent[bot]` (GitHub Copilot Coding Agent; issue #185) |
|| Mission | M06 CA and terminal results (V1 organizational academic capability) |
|| Capabilities | Tenant-scoped assessment and result records |
|| Supersedes-in-part | None |
|| Cites | `AGENTS.md` §§13, 17, 26–28, 30–31, 38, 42–45; `database/supabase/migrations/20261024000220_sherivs_015_privacy_lockdown_rls_speed.sql`; `database/supabase/migrations/20261101000010_sherivs_m009_a1_role_responsibility_engine.sql`; `architecture/coregrid-mvp-architecture/NEUTRALITY_GUARD_BASELINE.json`; `scripts/ops/quarantine-migration-vocabulary.mjs`; issues #175 and #185 |
|| Minimal ownership artifact | This ADR, its five exact SQL-only neutrality entries, and the M06 migration |

## Context

The existing Scholar `grades` table is tenant-scoped and already has score,
grade, and publication fields, but its legacy score defaults and generated total
coalesce missing CA/exam scores to zero. The M009 role engine records the result
author and separates author from approver/publisher, but there is no M06
configuration for per-subject/term assessment weights, no explicit approval
state, and no amendment evidence store. The M06 assignment requires these
controls without changing existing migrations or touching a live database.

## Options

### Option 1 — Replace the legacy grades subsystem (rejected)

Create a separate academic result store and migrate or redirect existing readers.

- **Consequences:** It would avoid altering the legacy score calculation but
  duplicate authoritative result records and require unrelated client,
  integration, and migration changes.

### Option 2 — Extend existing grades with an additive M06 workflow (ruled)

Keep the existing tenant-bound grade record as the published result; store CA
component scores and per-subject/term weight profiles in new forced-RLS tables.
Use database RPCs and triggers to calculate scores, enforce author/approver/
publisher separation, lock published scores, and require immutable amendment
evidence. Missing configured marks leave CA/total/grade unavailable.

- **Consequences:** Existing readers retain the `grades` record contract, and
  M06 can enforce its workflow in the database. The legacy `total_score` column
  becomes an ordinary trigger-maintained column to support a NULL total when a
  required score is missing; rollback preserves its former coalescing behavior
  but does not restore the generated-column storage attribute. Weight profiles
  are locked after the first component score is recorded.

## Recommendation (decision)

**Extend the existing grades contract additively for V1 only. Configure CA
component weights and terminal-exam weights per tenant/subject/term/year;
persist blank component marks as NULL; calculate weighted values and grades
server-side; require a distinct authorized approver; publish only approved
results; and require a distinct authorized actor plus append-only evidence for
every approved/published score amendment. The migration and rollback are files
only and are never applied to a live database by this change.**

## Migration neutrality evidence

The domain-neutrality verifier reports five groups confined to the M06 SQL
migration: structural `school_id` (67 hits), and vocabulary
`get_my_school_id` (8), `grade` (4), `scholar` (3), and `teacher` (2). The
existing tenant and role substrate requires these terms in database-owned
policies and functions, and SQL migrations cannot be relocated to the runtime
namespace. Following ADR-004, the baseline records only those exact observed
groups under `STREAM I: M06-ISSUE-185` using
`scripts/ops/quarantine-migration-vocabulary.mjs`. This does not alter the
verifier, quarantine TypeScript, or weaken any security control; these
migration-only entries remain subject to removal when the underlying substrate
is replaced. The proposed migration remains unapplied.

## Consequences (summary)

- **Positive:** Missing marks cannot silently become zero; tenant isolation,
  authorization, approval, publication, and amendment evidence are enforced
  below the UI.
- **Negative / obligations:** Existing integrations that write legacy scores
  remain trusted server-side compatibility paths; the M06 RPCs are the governed
  path for new assessments. A configured weight profile cannot be changed after
  scores are recorded for that scope.
- **For the wave/program specifically:** M06 consumes the existing M009 role
  engine, `grades.enter`, `grades.approve`, `results.publish`, and
  `results.unpublish` permissions. It does not create roles, permissions,
  tenants, or accounts.

## Golden Questions

- **WHO?** Subject teachers enter scores; a different authorized academic
  approver approves; an authorized publisher releases results; an authorized
  non-approver submits an audited amendment.
- **WHAT?** Weighted CA and terminal scores resolve into a nullable total and
  configured grade, followed by approval and publication states.
- **WHERE?** This decision is recorded here; the migration and rollback define
  the persistence contract; the M06 unit and disposable SQL harnesses verify
  its computation and controls.
- **WHY?** Existing grade totals treated missing scores as zero and did not
  provide M06's complete approval/amendment workflow.
- **UNDER WHICH POLICY?** AGENTS §§13, 17, 26–28, 30–31, 38, 42–45; epic #175;
  M06 issue #185; existing Scholar RLS and M009 role-engine contracts.

## UNKNOWNs

- Operator review and approval of this proposed ADR and the forward-only
  migration are still required before any production execution.
- Existing result-import integrations continue to produce legacy rows; their
  conversion to the M06 scoring workflow remains a separately reviewed
  integration decision.

# ADR-025: Academic and Teaching Workspace Is a Narrowing View of the Permitted Manifest (M009 Stage B-2)

| Field | Value |
|---|---|
| Status | PROPOSED (operator review required before production rollout) |
| Date | 2026-11-13 |
| Author | Claude (M009 Stage B-2 build) |
| Creator | Claude Code agent, mission B-2 (issue #281) |
| Mission | M009 Stage B-2 — Academic and Teaching workspace |
| Cites | `AGENTS.md` identity versus authorization and honesty rules; ADR-024; `frontend/src/lib/workspaces/category-workspace.ts`; `frontend/src/lib/workspaces/academic-teaching.ts`; `tests/unit/m009-b2-academic-teaching.test.ts` |
| Minimal ownership artifact | This ADR and the category workspace library |

## Context

Teachers, exams staff, librarians and counsellors already receive a manifest computed by the database from assignments, responsibilities and permissions. B-2 asks for a workspace with real daily actions (registers, assessment entry, results hand-off) and restricted handling of counselling and special-needs data, without letting a title or the UI widen access.

## Options

### Option 1 — New role-specific permission checks in the client (rejected)

Duplicates the database as a second source of truth and can drift from it.

### Option 2 — Seed new catalog rows and migrations for each role (rejected for B-2)

Not needed: every daily action and queue already exists in the workspace item catalog. No migration is created, as the issue allows when none is needed.

### Option 3 — Presentation layer that can only narrow the manifest (retained)

A spec names queue and action keys. The builder includes a key only if the caller's manifest already contains it, and, for restricted keys, only if the named permission itself granted the item. A category with nothing permitted renders nothing.

## Recommendation (decision)

Adopt Option 3. The view never adds an item, never reads data the widget feed did not return, and labels absent data "Not configured". Learner-risk and safeguarding items require `welfare.pastoral` specifically, because other permissions (for example `reports.academic`) also unlock the same catalog widget and must not expose counselling-adjacent data.

## Consequences

- **Positive:** No schema change, no new permission, no second permission list. Behaviour is covered by unit tests over the real role-template catalog.
- **Negative:** Roles whose templates hold fewer than three primary items keep fewer primary sections; they are reported, not padded.
- **Not done:** Clinical placements, fieldwork and research supervision modules have no data source and are shown as "Not configured". Backend end-to-end tests (assignment, visibility, notification, audit) need a non-production Supabase stack and were not run here.

## Golden Questions

- **WHO?** M009 Stage B-2 owns the view; the operator ratifies it.
- **WHAT?** A narrowing presentation of the already-permitted manifest.
- **WHERE?** `frontend/src/lib/workspaces/`, home screen, unit tests.
- **WHY?** Titles and UI must never grant access; restricted learner data needs the specific permission.
- **UNDER WHICH POLICY?** AGENTS identity versus authorization, tenant isolation and honesty rules.

## UNKNOWNs

- **Counselling and special-needs data model:** no dedicated catalog widget exists yet; only the existing learner-risk and safeguarding items are gated.
- **Operator ruling:** unratified until the operator reviews and approves.

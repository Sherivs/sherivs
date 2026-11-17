# ADR-027: Student and Family Workspaces Are Separate Views With Mutually Forbidden Items (M009 Stage B-4)

| Field | Value |
|---|---|
| Status | PROPOSED (operator review required before production rollout) |
| Date | 2026-11-13 |
| Author | Claude (M009 Stage B-4 build) |
| Creator | Claude Code agent, mission B-004 (issue #283) |
| Mission | M009 Stage B-4 — Student, Parent and Family workspace |
| Cites | ADR-025; ADR-017 (guardian relationships and consent); `frontend/src/lib/workspaces/student-family.ts`; `tests/unit/m009-b4-student-family.test.ts` |
| Minimal ownership artifact | This ADR and the student/family specs |

## Context

Access depends on the actual verified relationship. A fee payer does not get full records, adult tertiary students do not inherit parental supervision, and consent and guardian checks fail closed on the server (M09).

## Options

1. **One combined family and learner view** — rejected: blurs the relationship and lets one set of items appear under the wrong heading.
2. **New relationship roles such as "fee payer"** — rejected: the issue forbids inventing relationships or mandates, and the catalog has no such template.
3. **Two separate views, each forbidding the other's items (retained)** — the guardian view requires `children.view` for every item and forbids learner self-service items; the learner view requires `self.view_own` and forbids guardian items.

## Recommendation (decision)

Adopt option 3. No migration and no new permission. Guardian relationship and consent verification remain server-side; the view cannot relax them.

## Consequences

- **Positive:** A manifest that wrongly mixed both sets still renders each view correctly (tested). Fee permission alone never opens children's records.
- **Negative:** There is no "fee payer only" experience, because no such role exists; it needs an operator decision and a catalog change.
- **Not done:** Alumni and student-representative workspaces have no data sources. Backend end-to-end tests (assignment, visibility, notification, audit) need a non-production Supabase stack.

## Golden Questions

- **WHO?** M009 Stage B-4 owns the views; the operator ratifies them.
- **WHAT?** Two relationship-specific narrowing views.
- **WHERE?** `frontend/src/lib/workspaces/`, unit tests.
- **WHY?** Relationship, not title or payment, decides access.
- **UNDER WHICH POLICY?** AGENTS identity versus authorization, M09 consent gates, honesty rules.

## UNKNOWNs

- How the `pta` template (which holds `children.view` as mandatory) is meant to be scoped; the database's relationship check is assumed to limit it to linked children and was not tested here.
- Operator ruling: unratified until reviewed.

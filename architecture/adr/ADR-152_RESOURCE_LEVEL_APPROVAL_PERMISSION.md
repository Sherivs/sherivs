# ADR-152: Resource-Level Approval Permission (CS-01)

- Creator: Claude Code agent, mission CS-01 (class-scope approval defect) (provenance id W-016); AI-generated
- Origin: Mission: W-016; Authority: founder instruction in chat, 27 Nov 2026 ("add one resource-level permission check and move the approval functions onto it; don't loosen the assignment guard")

- Status: PROPOSED. The migration is not applied to any hosted database. Needs the founder's approval, a backup, and Tumi's review on Monday 30 Nov 2026.
- Date: 2026-11-27

## Problem

`course_reg_decide`, `malpractice_decide`, `role_scope_set_add` and `role_scope_set_remove` asked "does this person hold the permission for the whole organisation?" (`scholar_can`). Since A7, role templates scoped to one class (the adviser) cannot be assigned wider than a class, so a correctly assigned holder could never pass. Six sim scenarios were baselined as failing for this reason (issue #465).

## Decision

1. Add `public.scholar_can_on(org, perm, kind, id)`, one resource-level check. Everything the organisation-level check allows is still allowed. Otherwise the caller must hold the permission through an assignment and `authz_check` must allow the specific resource (kind `student` or `class`, resource in the same organisation).
2. With no resource, it accepts only assignments at organisation or institution scope, so scope-set functions stay wider-than-class only.
3. The four functions change only their permission line. `course_reg_decide` and `malpractice_decide` check the request's student; scope-set functions use the organisation form.
4. **The assignment guard is not touched.** An adviser can still not be assigned at organisation scope.
5. Fails closed: unauthenticated caller, unsupported kind, resource in another organisation.

## Known limitation

Department and faculty scopes cannot be evaluated because no class-to-organisation-unit mapping exists. Such holders are refused until a mapping is built (separate mission).

## Verification

Sim-lab 300/300 on a fresh database (the 6 baselined scenarios plus the biometric scenario's own consent fixture now pass; the baseline is empty). `tests/integration/cs01-resource-level-approvals.local.sql` covers grants, fail-closed cases and the untouched guard. Rollback restores the original four functions.

## Neutrality baseline

The migration necessarily names `school_id` and `student` (5 hits). Added to the baseline under CS-01, as WF-15a2 did; needs the founder's approval.

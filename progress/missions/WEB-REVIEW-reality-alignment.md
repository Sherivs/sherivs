# WEB-REVIEW: generated texts reviewed, interview answers placed, alignment reported

Status: built, not applied anywhere. Draft PR only. ADR-164, gap W-030.

## What changed
- Generator marks rules/policies blocks `review: "pending"`; option `standardTexts: "omit"` leaves them out. Setup (`bootstrap.ts`) and the interview publish use `omit`.
- Migration `20261128001100_sherivs_website_review_gate.sql` makes `website_publish` refuse while any block is pending. Rollback restores the earlier body.
- `review.ts`: list pending, accept, remove, add standard texts. Screen `website-review` (registry key `website-review`).
- `reality-sync.ts`: `streams_offered` and `examinations` mapped to the academics page.
- `alignment.ts`: report in the preview; contradictions shown in the sync panel.

## Evidence
- `tests/integration/web-review-gate.local.sql`: WEBR ALL PASS: 11 checks (clean publish, refusal with count, accept, remove, no permission 42501, cross tenant 42501, rollback).
- `tests/unit/website-review-alignment.test.ts`: 23 tests. Existing website, reality, registry and ledger suites pass; tsc shows only the one earlier unrelated error.
- Neutrality baseline extended (tag WEB-REVIEW, 2 groups, 8 hits, reused function body).

## Not built / needs a decision
- Registry questions for boarding, faith, languages, leadership, facilities, registration are not public-safe; flipping them is a disclosure decision for the registry owner.
- The admin builder host route is not mounted in this tree, so the review screen is the only review path.
- Not in the combined 243-migration proof.

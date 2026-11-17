# ADR-054: Reality Engine R9 Website Sync from Approved Reality

| Field                      | Value                                                                                                                                                                     |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status                     | PROPOSED (operator ratification required before deployment)                                                                                                               |
| Date                       | 2026-11-13                                                                                                                                                                |
| Author                     | Claude Code agent (SV1-REALITY R9 implementation)                                                                                                                         |
| Creator                    | Claude Code agent, mission R-009 (issue #335)                                                                                                                             |
| Mission                    | SV1-REALITY R9 (start the public website from approved school reality, #335 (child of #229))                                                                              |
| Capabilities               | Scholar runtime and public website generation (V1; creche, primary, secondary only)                                                                                       |
| Supersedes-in-part         | None                                                                                                                                                                      |
| Cites                      | ADR-051 (R1 registry), ADR-053 (R3 interview), website engine #135 (`generateSite`, `website_facts`, `website_save_draft`, `website_publish`), `docs/v1/V1-SCOPE-LOCK.md` |
| Minimal ownership artifact | `frontend/src/lib/website/reality-sync.ts` (pure mapping) with `reality-website.functions.ts` and the Start your public website panel                                     |

## Context

R3 produces an approved snapshot of a school's answers. R9 must let an authorized school administrator use the approved, public-safe part of it to populate the institution's public website, without a second generator, without inferring consent from interview completion, and without exposing private answers. The existing website engine already provides a pure generator over `Facts`, a create-only bootstrap (`ensureWebsite`), draft and publish RPCs guarded by `website.manage`, and a website audit trail.

### Options considered

- **Option 1, a new publishing path or new site tables (rejected):** duplicates #135 and widens the reviewed surface.
- **Option 2, overlay approved answers onto the generator's existing inputs and publish through the existing RPCs (ruled):** reuses the generator, the guard, the audit trail and the publish limit.

## Decision

**Adopt Option 2.** `planRealitySync` takes the R3 `approvedSnapshot` and a base `Facts` and returns an overlay copy, the list of applied fields, the list of approved public-safe fields that have no existing place on the site (`notSupported`), a count of withheld answers, and a hash of the plan.

Invariants:

- Input is only the approved snapshot, which is empty unless the interview approval is valid. Unapproved, unknown, pending, conflicting, not-applicable and dormant answers cannot appear.
- An answer is considered only if the registry marks it public-safe and gives it a website field key. Answers that are not public-safe are counted, never listed or applied.
- Only keys in an allow-list map (`institution_type`, `levels_offered`) are applied. Any other public-safe key is reported as not supported and is not published. No new site field is invented.
- Interview approval never publishes. Publishing is a second, explicit action after a preview that lists exactly what will be used.
- The server re-derives the plan on every call and refuses a publish whose plan hash differs from the previewed one (stale preview).
- Create-only: if a website already exists, nothing is written and the admin is told. It never overwrites a draft or a published site (same rule as `ensureWebsite`; `website_save_draft` is called with expected revision 0).
- The tenant comes from the verified school-admin scope; the client sends only the plan hash. Calls run as the signed-in admin, so the existing `website.manage` guard, the website audit trail and the 60 per hour publish limit apply. The publish note records the plan hash.

No migration is added.

## Consequences

- Positive: no parallel generator, no new tables, no migration; existing guards and audit apply.
- **Limit, narrow mapping:** only institution type and levels have an existing place in the generator's inputs, and they change which vocabulary the generated site uses rather than printing the answer. Campus count, senior streams and external examinations are approved and public-safe but have no existing field, so they are shown as not published. Adding them needs new catalog fields and, for data-driven blocks, a migration; that is an owner decision.
- **Limit, create-only:** an existing website is never updated by this step. Updating a customised site needs a merge design and owner approval.
- **Limit, inherited base data:** the generator input still comes from `website_facts`, exactly as `ensureWebsite` does today; R9 does not change what that bundle contains.
- **Limit, partial failure:** if the draft is saved and publish then fails (for example the hourly limit), the admin is told the site exists as a draft and must publish from the website builder.
- **Limit, not atomic:** the checks and writes are separate calls; the create-only expected revision protects an existing site from being overwritten.
- The plan hash is 32-bit drift detection, not a secret and not an integrity proof.
- Nothing is merged, applied, deployed or activated by this change. CI is blocked by an organization billing hold, so all evidence is local.

## Verification

- Unit tests: `tests/unit/reality-r9-website-sync.test.ts` (17, including a 2000-run seeded property test and server-boundary source guards) and `tests/unit/reality-r9-ui.test.tsx` (23). Six mutants (public-safe check removed, prototype-key guard removed, constant hash, base mutated, stale check removed, not create-only) were each caught.
- Leakage tests: a private sentinel answer never appears in the plan or in the generated site; a hostile website field key (`__proto__`, `constructor`) cannot reach `Object.prototype`.
- Accessibility audit and 1440 and 390 px screenshots of the panel from a local demo fixture in `docs/evidence/r9/`.
- Not exercised: a live database or the real RPCs. After the billing hold is cleared, re-run all checks, and verify the create-only path against staging before any production use.

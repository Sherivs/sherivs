# ADR-164: Generated Standard Texts Are Reviewed Before Publishing, and the Site Reports How It Matches the Interview

| Field                      | Value                                                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Status                     | PROPOSED (migration not applied; needs founder approval and a backup before any hosted database)                                                        |
| Date                       | 2026-11-28                                                                                                                                             |
| Author                     | Claude Code agent (website reality alignment)                                                                                                          |
| Creator                    | Claude Code agent, mission WEB-REVIEW                                                                                                                  |
| Origin                     | Founder question 28 Nov 2026 on whether the organization website builder follows the reality interview; founder instruction to build the three fixes   |
| Mission                    | WEB-REVIEW, gap W-030                                                                                                                                  |
| Capabilities               | Review gate for generated text; interview streams and examinations on the site; site-versus-interview alignment report                                  |
| Cites                      | ADR-150                                                                                                                                                |
| Minimal ownership artifact | `database/supabase/migrations/20261128001100_sherivs_website_review_gate.sql`                                                                          |

## Context

The site generator follows the facts it is given and leaves empty blocks out. Three gaps remained. It emitted generic rules, policies, privacy and safeguarding texts that the school never wrote, and two paths (first-time setup and the one-step interview publish) put them live without anyone reading them. Only two interview answers reached the site; other public-safe answers were reported as unsupported. Nothing told the administrator where the site and the approved interview disagreed.

## Decision

1. Generated standard texts carry `review: "pending"`. The automatic paths (setup and the interview publish) generate without them. The database function `website_publish` refuses to publish while any block is still pending (22023, with a count). A school accepts the texts, removes them, or adds them later from the review screen.
2. Approved `streams_offered` and `examinations` answers are mapped into the academics page as a plain statement, restricted to the allowed options.
3. The preview returns an alignment report: each approved answer is used, used but not visible, not supported, or contradicted by a recorded fact (campus count against the named campuses), plus any unreviewed standard text.

## Consequences

- New sites go live without rules and policies until the school adds and accepts them. This is deliberate.
- The `policies` block can mix school-given and boilerplate text; the whole block is marked pending.
- Flipping more interview questions to public-safe is a disclosure decision for the registry owner and is not done here.
- Rollback restores the earlier `website_publish` body; documents keep any review marks harmlessly.

## Verification

`tests/integration/web-review-gate.local.sql` (WEBR ALL PASS: 11 checks) and `tests/unit/website-review-alignment.test.ts` (23 tests).

# Sherivs Experience Constitution

Subordinate to the CoreGrid ASI Engineering Constitution (`AGENTS.md`). Where they conflict, `AGENTS.md` wins. This document does not modify governance rules.

## Articles

1. **Honesty.** Never fabricate customers, logos, metrics, testimonials, certifications, social accounts, live activity or AI activity. If content does not exist, the surface shows an honest empty state or does not exist. Enforced by the route registry (DEFERRED entries), the empty `PUBLISHED_CONTENT`, and an honesty scan of public copy in `sherivs-public-routes.test.ts`.
2. **Pages only where capability exists.** A page is created only when real content or a real capability backs it. Deferred pages carry a recorded reason.
3. **The UI is not security.** Hidden buttons, hidden routes and frontend checks are never an enforcement layer. The Experience Contract may only remove options. Server functions, RLS and policy remain authoritative (AGENTS.md §§16, 17, 34).
4. **Command obeys authorization.** Command UI never bypasses policy. High-risk commands resolve to `REQUIRE_APPROVAL`; unauthorized commands are removed, not disabled-with-hint-of-existence where that would leak.
5. **Separate internal boundary.** The Sherivs internal workspace is never reachable from customer navigation. It requires `platformOperator` and is not a tenant.
6. **No implied AI work.** Never show "thinking", typing dots or progress unless the backend is actually processing. `SystemState` `data-live` and `VerificationState` `live` are driven by real state only.
7. **Distinguish what is known.** AI/derived statements are always labelled as observation, inference, recommendation, action, evidence or verification, with provenance and confidence where available. AI output is untrusted by default (AGENTS.md §21).
8. **Login does not imply Scholar.** Never route `LOGIN -> SCHOLAR` by default. Landing is determined by role/capabilities/modules.
9. **No destructive rebrand.** Customer-facing strings migrate; technical identifiers (package names, DB, buckets, migrations, env vars, kernel types, AI prompts) are preserved. Enforced line-by-line by `scripts/experience/brand-classifier.mjs` and `sherivs-brand-migration.test.ts`.
10. **Accessible by construction.** WCAG 2.2 AA is a build property: contrast pairs are tested for four theme variants, motion respects `prefers-reduced-motion`, focus is always visible, headings are ordered, landmarks exist.
11. **Organization brand is a controlled layer.** Organizations may supply one validated accent color; the system guarantees AA text/foreground derivations. Organizations cannot restyle structure, spacing or status colors.
12. **Distinctive, not generic.** No gradient-hero SaaS template, no glass-card grids, no glowing orb. The visual language is the four-plane model.
13. **Claim discipline.** Every implementation claim states a version-target classification and a status of `LIVE`, `CONTRACT_ONLY`, `DEFERRED` or `NOT_STARTED`, backed by a test or artifact. Unbacked claims are unverified (AGENTS.md §45).

## Design review gates

Gate definitions and current results are in `SHERIVS_EXPERIENCE_STATUS.md` (section "Design review gates").

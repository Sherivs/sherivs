# Sherivs remaining-work blueprint

Date: 2026-10-25. Branch: `cursor/sherivs-website-v2-b509`. Classification: V1 organizational envelope.

This is the recommended order after the 25 Oct merge wave. Do not treat leftover open PRs as unfinished school-core work.

## 1. What is already on `master`

The previous merge job completed. These are **already merged** (do not re-merge):

| Band | PRs | What landed |
| --- | --- | --- |
| School core | #95–#106, #109, #111, #114, #122, #125, #127, #128, #132, #133 | Fees, exams, attendance, transfers, custom domains, checkout net amount, offline teacher attendance |
| Government / consoles | #107, #108, #110, #112, #115, #119, #124, #126 | Head console, gov realm, inspections, consent/break-glass, group console |
| Integration hub | #113, #116, #117, #118 | Connectors, KMS, scheduled pulls |
| Workspaces / mobile / load | #120, #121, #123 | Track E security + 3k/5k VU fixes, Expo workspace, UX workspaces |
| Website engine v1 | #129, #130, #131 | Block engine, SSR, builder; Lovable prototype removed |
| Paystack split | #134 | Split code is now wired in code (TEST key only) |

`master` HEAD at branch-off: `53557e07` (#134).

## 2. What must not be merged

These open PRs are **unsafe or obsolete**. Leave them draft.

| PR | Why it stays closed |
| --- | --- |
| #71 | Pastes a production SQL bundle for older #60 migrations. Owner-run only, after a verified backup. |
| #56 | Rollout *plan* only. Title says do not merge. |
| #58 | Stacked on a Saturday freeze branch, not `master`. |
| #7 | Phase 52 / standing-fleet claim on the old `coregrid-scholar-migration` base. V2/V3 stay frozen. |
| #6, #5 | Old experience-refoundation branches. Their customer-facing work is already on `master`. |

This agent cannot merge GitHub PRs (read-only `gh`). Production merge of this website v2 PR stays a human action after staging apply.

## 3. This PR (website engine v2)

Draft #135 already built SHERIVS-101. This branch is that work plus typography and per-school chrome hardening.

What the three demo schools now get from one engine (no per-school fork):

- **Little Pearls (nursery/primary):** Nunito, round marks, warm hero.
- **GSS Gwange (secondary):** Playfair + Source Sans, primary header rule.
- **FU Arewawa (university):** Source Serif 4, secondary underline on the header, square buttons.

Also included:

- Rules / code of conduct, policies (NDPA, safeguarding, anti-bullying where the kind requires them), blog/news posts, calendar, downloads, careers, PTA.
- Palette derived from `schools.primary_color` / `secondary_color`, WCAG AA checked.
- Self-hosted variable fonts (no Google Fonts on org sites).
- Heading word-spacing so titles stay `What we offer`, never `Whatweoffer`.
- Optional hideable “Website by Sherivs” credit.

**Database:** `20261025100260_sherivs_101_website_v2` + rollback. Apply on staging first, one migration, stop on error. Do not apply to production until this PR is reviewed and the backup is confirmed.

## 4. Recommended build order (next)

Do these in order. Stop if a step fails.

1. **Confirm production backup** (Supabase + any AWS copy). Do not paste credentials in chat; put them in the Cursor environment secrets store.
2. **Staging apply** of `20261025100260_sherivs_101_website_v2`. Re-run website unit + sim tests.
3. **Human merge** of this website v2 PR to `master` after review.
4. **Production apply** of that one migration only. Stop on first error.
5. **Paystack split verification on TEST key** (`#134` is already on `master`). Confirm one student / one term / school subaccount / Sherivs share. Do not switch the live secret until finance signs off.
6. **3,000-user load** against staging, not production: `tools/sim-lab` already has 1k website SSR and Track E 3k/5k VU work from #120. Re-run those; fix leaks or timeouts before any public school is enrolled.
7. **School photos and copy.** Seeded policy/rules text needs a native speaker pass (EN/HA/YO/IG/PCM). Replace demo images.
8. **Mail provider** for officer invites (B07 is stubbed).
9. **Mobile install environment** (`mobile/node_modules` + device build). Not claimed ready.
10. **Your personal upgrades.** After 1–6, say which already-built surfaces you want deepened (fees UX, attendance, government console, website builder, etc.). Those are product choices, not missing merges.

## 5. Production risk (honest)

- Production is still on the Paystack **test** key.
- Website v2 is **not** production-live until the migration is applied.
- Code merge ≠ database apply. A GitHub merge without the SQL apply leaves `/admin/website` v2 talking to a v1 schema.
- AWS + Supabase split: this agent can review repo + PRs without AWS. If you want a live inventory of AWS objects, add read-only keys as **environment secrets**, never in this chat.

## 6. 3,000-user test plan

- Unit: `vitest run tests/unit/website-v2.test.tsx tests/unit/website-engine.test.ts tests/unit/website-renderer.test.tsx tests/unit/website-builder.test.ts`
- Sim: `tools/sim-lab/sim/website-v2.mjs` (cross-tenant posts, scheduled hide, anon isolation)
- Load: `tools/sim-lab/load/website-v2.js` (1k VUs already recorded). Scale to 3k VUs on staging only after 1k is clean.
- Tenant A cannot read Tenant B posts, drafts, or unpublished policies.

## 7. Version-target

V1 organizational / Scholar public site. No V2 device/IoT and no V3 Reality Intelligence work.

# Sherivs UI design system baseline (UI-01)

Status: proposed, draft PR. Nothing here has been viewed in a browser.

## What this is

The Sherivs UI already has a design system: navy and off-white themes, a brand blue sampled from the logo, a glass surface style, Inter and Plus Jakarta Sans, and school-chosen brand colors on top. This baseline keeps that identity and fixes the measurable gaps found when the UI was checked against the [ui-ux-pro-max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill) guidance (MIT licensed, fetched into the workspace and run from there).

## What the skill recommended, and what we took

The skill was asked for a design system for a school management dashboard with these dials: variance 3, motion 3, density 7.

| Skill output                                                                                             | Decision                                                                                 | Why                                                                                              |
| -------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| Style: Minimalism and Swiss, light and dark supported                                                    | Keep the current glass-on-navy and off-white look                                        | The skill's pick is close to what exists; replacing the identity would be churn, not improvement |
| First run (default framing): Claymorphism, Baloo 2, indigo and orange                                    | Rejected                                                                                 | Tuned for children's apps; wrong for administrators, bursars and proprietors                     |
| Colors: slate with a status green                                                                        | Keep the logo-derived brand scale; adopt its rule that status colors carry text contrast | Brand is a business asset                                                                        |
| Fonts: Fira Code and Fira Sans                                                                           | Keep Inter and Plus Jakarta Sans                                                         | Already self-hosted; no new network font request                                                 |
| Motion: subtle, respect reduced motion                                                                   | Adopted: global reduced-motion rule                                                      | Was set in 11 places, never globally                                                             |
| Checklist: contrast 4.5:1, visible focus, reduced motion, no emoji icons, hover transitions 150 to 300ms | Adopted, with tests                                                                      | See below                                                                                        |

## What was measured, and what changed

| Finding                                                   | Before                                                                                          | After                                                                                                                                     |
| --------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| Muted text, dark theme                                    | 3.18:1                                                                                          | 4.4:1 or better (white at 50%)                                                                                                            |
| Muted text, light theme                                   | 2.6:1                                                                                           | 4.6:1 or better (ink at 62%); secondary raised to 72%                                                                                     |
| Status text, light theme (success, warning, danger, info) | 3.25, 2.81, 4.01, 4.37                                                                          | all 4.6:1 or better on their tint                                                                                                         |
| Status text, dark theme (danger, info)                    | 4.49, 4.46                                                                                      | 5.9 and 6.3                                                                                                                               |
| Tenant brand colors                                       | Text on them was always white; any value was written into CSS as given                          | White, navy or black text, whichever reads best (4.5:1 or better for every sampled color); a value that is not a hex color counts as none |
| Focus                                                     | Six rules removed the outline; three search fields had no replacement; one thin 1px button ring | Zero-specificity focus ring on both themes (9.0 and 8.7:1), wrapper ring for the three search fields, 2px button ring                     |
| Fixed bottom navigation                                   | Could cover the focused element                                                                 | `scroll-padding-bottom` while it is on screen                                                                                             |
| Motion                                                    | 11 reduced-motion rules, no global one                                                          | One global rule                                                                                                                           |
| Touch targets                                             | Buttons 32 to 36px                                                                              | 44px minimum on touch screens only; desktop density unchanged                                                                             |
| Text under 12px                                           | 45 declarations from 0.62rem to 0.7rem                                                          | Floored at 0.75rem                                                                                                                        |
| `transition: all`                                         | 5 places                                                                                        | Specific properties only                                                                                                                  |

The WCAG 2.2 AA target size minimum for web is 24 CSS pixels; the 44px touch size is a product choice, not a requirement.

## Rules for new UI

1. Text uses the `--text-*` tokens. Do not write a white or ink alpha by hand; tokens are tested.
2. Text on a school color uses `--primary-foreground` or `--secondary-foreground`, never a fixed white.
3. Interactive elements get the default focus ring. If you hide an outline, give the wrapper a visible focus state.
4. Animate named properties, not `all`, and keep motion safe under reduced motion.
5. No text under 12px.
6. The tests in `tests/unit/ui-design-tokens.test.ts` and `tests/unit/tenant-contrast.test.ts` enforce these. A failing test is a design regression, not a flaky test.

## Not done, needs a browser

- Every changed screen needs a visual check at 375, 768, 1024 and 1440px, in both themes. The 12px floor and the 44px touch size can change layout in tight places (bottom navigation labels, badges, the student mobility screen).
- The 17 flagged labels are mostly uppercase eyebrows; the larger size makes them wider.
- Icon-only buttons need accessible labels. No lint rule enforces this yet.
- Tenant brand colors used as text on dark surfaces (links in a school's blue on navy) are not yet contrast-fitted; the brand blue itself is 3.2:1 on navy and is fine for large text and graphics only.
- Placeholder text in the entry screens is about 2.6:1.
- The skill's data-driven search is not part of the build. It ran in a workspace copy.

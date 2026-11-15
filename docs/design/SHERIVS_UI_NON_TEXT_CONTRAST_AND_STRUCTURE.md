# Sherivs UI non-text contrast and page structure (UI-04)

Status: proposed, draft PR. Measured in a real browser, on fixtures and public pages only.

## What was measured

From rendered pixels (WCAG 1.4.11, 3:1) on the public home, contact and request-demo pages, `/auth`, the workspace-preview fixture and the console fixture, in light and dark:

- Form field boundaries: the border pixel, the fill and the surface outside the field.
- Keyboard focus rings: the ring colour against the surface next to it, on up to 30 tab stops per page.
- Icon-only buttons: the icon colour against the button surface.

Structure, from the DOM and Chrome's accessibility snapshot: heading order, landmarks, page titles, labels, duplicate ids, generic link text; reflow at 200 percent (720 px) and 400 percent (320 px) zoom; and WCAG 1.4.12 text spacing (line height 1.5, letter spacing 0.12em, word spacing 0.16em, paragraph spacing 2em).

## Findings and fixes

| Finding                                                                                    | Before                     | After                                                          |
| ------------------------------------------------------------------------------------------ | -------------------------- | -------------------------------------------------------------- |
| Form field borders (contact, request demo, sign-in, console, app-shell selects and search) | 1.2:1                      | `#76819a`, 3.3 to 3.9:1                                        |
| Sign-in focus ring `#7aa2ff` on a light card                                               | 2.2 to 2.4:1               | `#0d37ca`, 8.7:1                                               |
| App-shell focus ring amber `#ffbf47` on a light surface                                    | 1.6:1                      | `#0d37ca`; the navy header keeps a light ring (`#93b0ff`, 9:1) |
| Focus ring on the public dark bands                                                        | 2.9:1                      | light ring; cards inside the bands keep the dark one           |
| Public form placeholder `#9aa3b8` (missed in UI-03)                                        | 2.5:1                      | `#566179`, 6:1                                                 |
| `/auth` page title was the marketing title                                                 | no description of the page | "Sign in — Sherivs"                                            |

Icon-only buttons already pass: every icon measured at least 3:1 on all surfaces.

## Passed without change

- Heading order: one h1 per page, no skipped levels in the accessibility tree. The FAQ page's visually hidden h2 sits between its h1 and the question h3s.
- Every form control has a label; no duplicate ids; no generic link text; `lang` is set; every image has alt text; named landmarks where there are several navs.
- Reflow at 200 and 400 percent: no horizontal scroll on home, about, FAQ, contact, privacy, sign-in or the workspace preview. Text spacing overrides caused no horizontal overflow and no clipped text. Four to thirteen decorative icon tiles per screen grow taller than their frame under the overrides; they contain no text.

## Guarded

`tests/unit/ui-non-text-contrast.test.ts` (8 tests). Each changed file was reverted in turn and a test failed.

## Not done

- A human screen-reader pass (NVDA, VoiceOver, TalkBack) and a human check of real browser zoom. The structural checks above are what a script can verify; they do not tell you how the page sounds.
- Real authenticated screens: needs a staging login that only the owner can provide.
- The hero's right half. Filling it properly needs real product imagery. Inventing a dashboard picture would claim capabilities the site deliberately does not claim, so it was left as is.
- The two search boxes (console and workspace) report a 0 px border on the inner input; the visible border is on the wrapper, which now meets 3:1.

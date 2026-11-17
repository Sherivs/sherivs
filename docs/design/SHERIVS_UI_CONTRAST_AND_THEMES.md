# Sherivs UI contrast, themes and role fixtures (UI-03)

Status: proposed, draft PR. Measured in a real browser, on fixtures and public pages only.

## What was measured, and why axe was not enough

axe-core reports zero violations on every page, but it marks text over gradients and translucent glass as "incomplete" and never fails it. On the scanned pages that was 34 to 66 elements each. So contrast was also measured directly: every text element was tagged, its text hidden, the page scrolled and screenshotted in steps, the real background sampled behind each element, and the ratio computed against the element's own colour (4.5:1, or 3:1 for large text). Coverage was 269 of 287 text elements on the home page; the rest are off-canvas or hidden.

Scanned: public home, about, FAQ, contact, privacy, trust, request-demo; `/auth`; the workspace-preview fixture; the console fixture. Themes: light and dark. Widths: 390, 1024, 1440 px. Also all 56 role fixtures in both themes at 390 and 1440 px (224 axe scans), 320 px reflow, and the keyboard tab order on home, sign-in and the app shell.

## Results

| Check                                                 | Before                                    | After     |
| ----------------------------------------------------- | ----------------------------------------- | --------- |
| axe violations, all scans                             | 0                                         | 0         |
| Role fixtures (56 roles x 2 themes x 2 widths)        | 0 violations, 0 overflow                  | unchanged |
| 320 px reflow (home, contact, sign-in, workspace)     | no horizontal scroll                      | unchanged |
| Keyboard: focus ring on every stop, 45 stops per page | present                                   | unchanged |
| Home page text under AA                               | 113 elements                              | 0         |
| Console text under AA                                 | 28 elements                               | 0         |
| Sign-in text under AA                                 | 4 (helper text 2.9:1, placeholders 2.5:1) | 0         |

## What changed

- One muted ink: `#6b7690` (3.4 to 4.4:1 on the pale gradients) became `#566179` (4.6 to 6.2:1) on the public site, sign-in and console. The sign-in greys `#8b93a7` and `#9aa3b8` went with it.
- Cyan text on light pages was 2.4:1. Text links now use `--sherivs-link` (`#0b5ec0`); bright cyan stays inside dark bands.
- Cards inside dark bands were 78% white over navy, which rendered a murky grey where muted text was 3:1 and the "In development" badge 1.3:1. They are now solid `#f4f7fb`. Amber text on light surfaces is `#8a5300`; dark bands keep the bright amber.
- White text on blue gradients started at `#4b86ff` (3.6:1). Tops are now `#3366ff` (4.7:1) on the primary button, sign-in submit, console avatar and the app-shell and passkey buttons.
- Console active navigation text is `#1238c9` (the brand blue was 4.3:1 over the glow); console amber is `#92400e`.
- Brand blue as text on dark (the UI-01 leftover, 3.2:1): new `--primary-text` token. Defaults are fitted for each theme (`#4f78fd` on dark, the brand blue on light). A school's own colour is fitted at runtime by `fitTextOn` (moves toward white or black, keeping hue, until 4.5:1) and cleared when no custom colour is set. The three components that painted text with the raw brand colour now use it.
- Dark-band secondary button is a clean light surface instead of a dull translucent grey.

`tests/unit/ui-contrast-surfaces.test.ts` (19 tests) guards the tokens and the fitting function. Each changed file was reverted in turn and a test failed.

## Findings that need no code

- The public pages (`.sherivs-public`) ignore the theme on purpose: light and dark scans of them are identical. Only the app (sign-in card excepted), console and workspace respond to the dark class.
- Icon-only buttons: axe `button-name` passes on every scanned surface, including all 56 role fixtures. No unlabelled icon button was found, so no change was made. There is still no lint rule enforcing it.

## Not done

- Real authenticated screens. Only fixtures with synthetic data were scanned. This needs a staging login that only the owner can provide.
- Screen-reader announcements and 200 to 400 percent browser zoom were not tested by a human or with a screen reader. Reflow at 320 px was checked.
- Contrast was measured on text; non-text contrast (icons, input borders, focus rings, 3:1) was not.
- The hero's right half at 1440 px is empty. Left alone as a design decision.
- The contrast sampler takes the most common background colour behind each text box, which can misjudge text over a strong gradient; every flag was checked by eye, and two false alarms (white text on a dark header and on a circular avatar) were ignored.

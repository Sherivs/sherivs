# Sherivs UI surfaces: accessibility pass (UI-02)

Status: proposed, draft PR. Measured in a real browser, on fixtures only.

## What was measured

System Chrome driven by Playwright, with axe-core (WCAG 2 A/AA, 2.1 AA, 2.2 AA and best-practice rules), at 390, 768 and 1440 px, light theme. Surfaces:

- Public site: home, about, FAQ, contact.
- App entry: `/auth`.
- App shell: the local workspace preview fixture (`VITE_WORKSPACE_VISUAL_FIXTURE=1`, dev-only, synthetic data).
- Internal console: the dev-only console fixture (`VITE_CONSOLE_VISUAL_FIXTURE=1`).

No horizontal overflow and no console errors were found on any of them before or after.

## What was wrong, and what changed

| Surface                     | Finding (axe rule)                                                          | Change                                                                                                                       |
| --------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Console                     | `aria-expanded` on the search textbox (aria-allowed-attr, critical)         | Removed; `aria-controls` stays while results are open                                                                        |
| Console, sign-in, app shell | Skip link had no target (skip-link, region)                                 | Every surface exposes `<main id="main-content" tabIndex=-1>`; the console skip link now uses the same id                     |
| Sign-in                     | No `main` landmark                                                          | Both render paths (loading and form) are `<main>`                                                                            |
| App-shell fixture           | `article` under `role="listitem"` (aria-allowed-role)                       | `div`                                                                                                                        |
| Public site                 | Privacy link in dark band distinguished by colour only (link-in-text-block) | Underlined                                                                                                                   |
| Public site                 | Reality map SVG had a description but no name (svg-img-alt)                 | `aria-labelledby` the section title                                                                                          |
| Public, sign-in, contact    | Standalone links 17 to 20 px tall (target size)                             | 24 px minimum: footer Privacy, Terms, Back to top, breadcrumbs, social links, Forgot password, Back to site, Remember me row |
| Console                     | Sidebar toggle rendered 38x16 px (flex squash)                              | `flex: none`                                                                                                                 |

Result: axe reports zero violations on all of the above. `tests/unit/ui-surface-accessibility.test.ts` guards each change; every source fix was reverted in turn and the test failed, so the guards are not vacuous.

## Not done

- Only fixtures and public pages were scanned. Real authenticated screens (teacher, parent, student, finance, admin) have not been opened in a browser.
- Dark theme and 1024 px were not scanned.
- Remaining sub-24 px items are by design or exempt: skip links (1 px until focused), links inside a sentence (WCAG 2.5.8 inline exception), the 18 px "Remember me" checkbox (its 24 px label is the target), and the fixture search input (its label wraps it).
- axe finds roughly a third of accessibility problems. Keyboard order, screen-reader announcements and zoom behaviour need a human pass.
- From UI-01, still open: brand blue text on dark (3.22:1), placeholder contrast, and labels on icon-only buttons.
- The hero's right half is empty at 1440 px. That is a design call for the owner, not a defect, and was left alone.

# Application shell and Internal Console UI/UX upgrade

Scope: presentation-only changes. No data access, auth, RLS, routing or permission logic changed.

## Method

Rendered the real components with the existing dev-only fixtures
(`VITE_CONSOLE_VISUAL_FIXTURE=1`, `VITE_WORKSPACE_VISUAL_FIXTURE=1`, localhost only) in headless
Chrome at 1440x900 and 390x844, then measured DOM landmarks and touch-target sizes.

## Findings and changes

| # | Finding (measured) | Change |
|---|---|---|
| 1 | Console, 390px: two stacked warning banners plus a role-simulator row pushed the first real content to y~480 of 844. | One compact environment bar (`console-environment-bar`). The full wording is kept in an "Environment notes" disclosure. First content now starts at y~280. |
| 2 | Console, 390px: header chips wrapped onto a second row. | Chips stay on one row with ellipsis on long names; smaller environment pill. |
| 3 | Console role select was 38px tall. | 44px minimum. `console-fixture-role-switcher` test id is unchanged. |
| 4 | `/auth` had no `<main>` landmark, so the root "Skip to main content" link had no target. | Both auth render branches are now `<main id="main-content">`. |
| 5 | `/auth` "Forgot password?" was 21px tall, "Back to site" 16px, and the remember checkbox target was small. | 44px minimum hit areas for all three. |
| 6 | Shell widget and bottom-nav labels used 0.62-0.68rem (about 10px). | Raised to 0.7-0.74rem. |
| 7 | "Pending count unavailable" reads like a zero count. | "Sync queue status unavailable". |

Evidence: `docs/screenshots/ui-upgrade/` holds before and after captures. Regression coverage is
`tests/unit/ui-shell-console-ux.test.ts`.

## Not changed, and why

- The duplicate "primary sections" chip row exists only in the dev workspace preview fixture,
  and e2e specs depend on it. The production home screen does not render it.
- Authenticated shell home screens could not be rendered locally because browser Supabase
  environment variables are not available here. Their changes are limited to shared CSS and copy.
- No accessibility audit was run with a screen reader. Measured checks are landmark count,
  heading count and target sizes only.

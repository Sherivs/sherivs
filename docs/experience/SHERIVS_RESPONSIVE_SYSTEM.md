# Sherivs Responsive System

Breakpoints, in pixels, from `frontend/src/lib/sherivs/tokens.ts`:

360, 390, 430, 768, 1024, 1280, 1440, 1600, 1920, 2560.

## Public behavior

| Width | Behavior |
| --- | --- |
| Under 768 | Disclosure menu. Account actions move into it. Sections stack. The section index is a list |
| 768 and up | Horizontal primary navigation and account actions |
| 1024 and up | Narrative becomes two columns: argument, then a sticky section index. Section numbers sit in a narrow first column |

The measure of prose stays near 46rem. The page grid caps at 1440px.

## Application

The existing portal already collapses the sidebar and, for parent and student roles, shows a bottom navigation. Tables already scroll. This program did not redesign those layouts.

## Verification

A static render of the homepage narrative was screenshotted at 1440 and 390 CSS pixels, in light, and at 1440 in dark. That render uses the public CSS. It is not a substitute for a signed-in pass through every education portal.

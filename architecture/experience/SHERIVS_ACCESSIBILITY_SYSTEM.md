# Sherivs Accessibility System

Status: WCAG 2.2 AA target and release gate  
Version target: ACTIVE-V1

## Baseline

Sherivs supports semantic HTML, keyboard navigation, persistent visible focus, logical reading and
focus order, skip navigation, screen-reader names/descriptions, 200% text zoom and 400% reflow
where applicable, reduced motion, non-color state cues, accessible forms/tables/dialogs, and
44×44px coarse-pointer targets.

## Shell requirements

- One `main` landmark with a stable skip target.
- Named navigation regions and unique page `h1`.
- Context changes announce organization/workspace without unexpectedly moving focus.
- Route changes move focus to the page heading after content is ready.
- Mobile and desktop navigation expose equivalent destinations and labels.
- Notifications and command palette preserve trigger focus on close.

## Components

- Buttons use `button`; links navigate; disabled semantics match behavior.
- Icon-only controls have accessible names and adequate targets.
- Dialogs have title/description, initial focus, trap, Escape behavior, and focus restoration.
- Popovers and tooltips do not contain the only copy of required information.
- Forms expose visible labels, instructions, required state, field association, error summary, and
  live error announcement. Input is preserved after failure.
- Tables use caption, headers, scope, and a mobile alternative that retains relationships.
- Charts provide text summary, source, units, timeframe, and accessible data alternative.
- Drag/gesture features have keyboard/button alternatives.
- Status uses text/icon/pattern in addition to color.

## AI and evidence

Streaming output is not announced token by token. Announce completion or meaningful sections.
Citations are keyboard reachable and state source title/type. Confidence never relies on color
alone. Observation, inference, recommendation, action, evidence, and verification use headings and
text labels.

## Authentication and security

Authentication works with password managers, browser zoom, paste, and assistive technology.
One-time codes use appropriate autocomplete. Timeouts warn users and permit extension when policy
allows. Security errors reveal no account enumeration detail. Step-up verification explains why it
is required.

## Themes and branding

Normal text reaches 4.5:1 and large text 3:1; non-text controls/focus reach 3:1. Organization
branding is rejected or corrected if contrast fails. High-contrast and forced-colors behavior is
tested. Focus is never represented by color change alone.

## Test matrix

- Automated: semantic linting, axe, contrast/token tests, component unit tests.
- Keyboard: Tab/Shift+Tab, Enter/Space, arrows, Escape, Home/End as appropriate.
- Screen reader: landmarks, route changes, forms/errors, dialogs, tables, live regions.
- Visual: 200% text, 400% reflow, 360px width, dark/light/high contrast.
- Preferences: reduced motion, forced colors, increased text.
- Touch: target sizing, orientation, gesture alternative.

Automated scans do not satisfy human review.

## Current evidence and gaps

Existing strengths include the root skip link, semantic public sections, visible focus CSS,
44px coarse-pointer controls, dialog primitives, accessible skeleton labels, and typed contrast
utilities. Gaps include no global reduced-motion media query, duplicated focus colors, route-level
focus restoration not proven, limited automated axe/E2E coverage, card helpers with hard-coded
white text, and accessibility claims in contracts that exceed demonstrated UI evidence.

## Release rule

A surface is not accessible because a contract says it is. It passes only with recorded automated
and manual evidence against real states, including empty, error, denied, loading, stale, and mobile.

# Sherivs Accessibility System

Status: `BASELINE PARTIAL / TARGET WCAG 2.2 AA`  
Version target: `ACTIVE-V1`

## Observed baseline

Implemented: skip links, Radix semantics/focus behavior, selected ARIA states, a polite offline live region, focus-visible styling, responsive-table captions, and role-based Playwright queries.

Gaps: no automated axe suite, no React component accessibility tests, reduced-motion preference is detected but not consistently enforced, and mobile/web behavior is not governed by one accessibility contract.

## Requirements

### Structure and navigation

- One descriptive H1 and logical heading order.
- Landmarks and a working skip link on every shell.
- Keyboard access without traps; predictable tab order.
- Visible focus in all themes and organization brands.
- Route changes move focus to a meaningful heading or preserve focus intentionally.

### Controls and forms

- Native elements first; every control has name, role, value, and state.
- Minimum 44×44 CSS pixel touch targets where practical.
- Labels persist; placeholders are examples, not labels.
- Error summary links to fields; errors are announced and do not rely on color.
- Sensitive confirmation explains scope and consequence.

### Overlays and dynamic content

- Dialogs trap focus, name themselves, support Escape where safe, and restore focus.
- Toasts do not contain the only path to important information.
- Loading, offline, completion, and errors use appropriate live regions without chatter.
- Background updates do not unexpectedly move focus or reorder content.

### Data and visualization

- Tables use captions and header associations.
- Charts provide text summaries, units, source, and keyboard-accessible details where interactive.
- Confidence, status, and trends never rely only on hue.

### Visual and cognitive

- WCAG AA contrast for text and UI; high-contrast mode where practical.
- Support 200% text zoom and 400% reflow without loss.
- Plain, specific language; consistent names and locations.
- Reduced motion removes nonessential movement.
- Time limits are absent or adjustable unless security requires them.

## Verification matrix

| Gate      | Evidence                                                   |
| --------- | ---------------------------------------------------------- |
| Static    | semantic lint and invalid ARIA checks                      |
| Component | keyboard, name/role/state, focus, axe                      |
| Route     | skip link, landmarks, heading, zoom/reflow                 |
| Workflow  | screen reader and keyboard completion                      |
| Themes    | contrast in light, dark, high contrast, organization brand |
| Mobile    | touch target, orientation, screen-reader order             |
| Motion    | reduced-motion capture                                     |

Automated tools cannot establish conformance alone. Major workflows require human keyboard and screen-reader review.

## Release blockers

Unreachable actions, focus loss, inaccessible authentication, unlabeled controls, contrast failures, keyboard traps, unannounced blocking errors, and reduced-motion violations on essential workflows block release.

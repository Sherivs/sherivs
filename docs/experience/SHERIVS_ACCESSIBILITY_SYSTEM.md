# SHERIVS Accessibility System

Version: V1 foundation (2026-10-08) · Classification: **V1**
Target: WCAG 2.2 AA or better, practical everywhere; release gate.

## 1. Built-in guarantees

- Skip links on public shell, app shell and root (`#main-content`,
  `#sherivs-content`).
- Landmarks: header/nav/main/footer; one H1 per view; section labeling.
- Keyboard: full operability, visible brand-tinted focus, focus-trapped
  dialogs, roving tabindex where idiomatic, shortcut help surface.
- Screen readers: dynamic states via `role="status"`/`aria-live`
  (loading, error, offline, reasoning); meters with min/max/now;
  tables with headers; forms with labels + error announcements.
- Contrast: text ≥ 4.5:1, UI components ≥ 3:1, verified in both themes;
  `prefers-contrast: more` strips shadow/atmosphere.
- Motion/text: `prefers-reduced-motion` honored; 200% text scaling without
  breakage; 44px minimum touch targets on mobile.
- Touch: thumb-zone placement, gesture-safe (no gesture-only actions).

## 2. Per-surface checklist (gate)

Keyboard walk · screen-reader walk · contrast pass · reduced-motion pass ·
200% zoom · 360px viewport · empty/loading/error states announced ·
form errors announced · time limits avoidable or extended.

## 3. Responsibilities

Component authors ship the checklist with the component (states in
`system-states.tsx` already announce). Data-dense views ship table
semantics + text alternatives before richer visualization. Barriers are
defects: report via administrator escalation or `/contact` paths, with
page, task attempted and assistive technology used.

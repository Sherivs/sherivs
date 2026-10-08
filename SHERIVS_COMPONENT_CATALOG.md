# Sherivs Component Catalog

Status: `INVENTORIED / TARGET DEFINED`  
Version target: `ACTIVE-V1`

## Existing canonical candidates

| Family | Existing source | Disposition |
|---|---|---|
| Primitives | `frontend/src/components/ui/` | Adopt; preserve Radix semantics |
| Shell/page | `portal-shell.tsx`, `portal-sidebar.tsx`, `shell/*` | Reconcile into platform-neutral shell patterns |
| System states | `planned-capability-state.tsx`, `offline-banner.tsx`, error boundaries | Adopt; consolidate duplicate skeletons |
| Responsive | `responsive-table.tsx`, mobile navigation/sidebar | Expand adoption |
| Public | `components/public/*` | Generalize organization assumptions |
| Command | `command-center/command-palette.tsx` | Retain discovery; enforce actions server-side |
| AI | `components/ai/*` | Reframe by trust state; no generic chatbot default |
| Data | `ui/table.tsx`, `ui/chart.tsx`, calendar/timetable components | Define question-led visualization contracts |

## Catalog

Every entry requires default, hover, focus, active, disabled, loading, success, error, warning, empty, partial, offline, unauthorized, forbidden, expired, and stale behavior where meaningful.

### Brand

Logo, symbol, wordmark, lockup, partner lockup, favicon, app icon. Animated marks are deferred until a static identity and reduced-motion alternative are approved.

### Navigation

Global header, workspace navigation, runtime navigation, section navigation, breadcrumbs, tabs, mobile bottom navigation, mobile drawer, footer navigation, contextual actions.

### Actions

Button, icon button, link, split action, segmented control, command item. Destructive actions state object, consequence, verification, and recovery.

### Inputs

Input, textarea, select, combobox, checkbox, radio, switch, date, time, timezone, currency, file upload, consent, validation summary, multi-step form.

### Overlays

Tooltip, popover, menu, command palette, drawer, sheet, dialog, alert dialog. Each defines trigger semantics, focus trap, escape behavior, focus restoration, and mobile transformation.

### Content

Editorial section, narrative block, capability explanation, architecture diagram, process, quote, statistic, timeline, comparison, callout, announcement, article preview. Statistics require source and timestamp.

### Records and data

List, grid, table, responsive record list, metric, chart, status, activity, timeline, relationship view, progress, score, confidence, provenance, evidence indicator.

### Product objects

Organization, workspace, person, team, mission, worker, evidence, approval, integration, runtime, notification, audit event, file, content item. A card is not mandated; choose a representation by task.

### Trust

Source citation, evidence item, confidence label, verification seal, approval state, provenance trail, timestamp, actor identity, model identity, action record, outcome record.

### AI

Observation, inference, recommendation, proposed action, approval request, execution state, evidence bundle, verification result. These types must never collapse into visually identical chat bubbles.

### System

Skeleton, progress, empty, planned, no results, error, warning, success, offline, maintenance, permission denied, not found, expired session, stale data, partial data.

## Required documentation template

```text
Purpose
Anatomy
Variants
Properties
States
Responsive behavior
Accessibility
Motion
Examples
Anti-patterns
Owner
Version target
```

## Anti-patterns

- nested cards used only to create hierarchy;
- icon-only controls without names;
- color-only state;
- modal workflows that need a URL or history;
- tables converted to unreadable horizontal scroll by default;
- loaders with no progress or cancellation for long work;
- confidence represented as false mathematical precision;
- AI output without type, source, or action boundary.

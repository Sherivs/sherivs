# Sherivs Component Catalog

Status: Target taxonomy with current implementation mapping  
Version target: ACTIVE-V1

Every component requires purpose, anatomy, variants, typed properties, full state matrix,
responsive behavior, accessibility contract, motion contract, examples, anti-patterns, and
authorization/data assumptions.

## Public families

| Family | Canonical components | Current evidence | State |
| --- | --- | --- | --- |
| Brand | symbol, wordmark, lockup, partner lockup, favicon | favicon/PWA icons only | gap |
| Navigation | primary, secondary, mega menu, mobile, breadcrumb, section, footer, contextual | public navbar/footer, navigation-menu | partial |
| Hero | editorial, split, immersive, product, technical, media, minimal | organization hero | partial |
| Content | editorial, capability, architecture, comparison, quote, statistic, timeline, process, narrative, callout, announcement, insight, article preview | public sections | partial |
| Product | capability, runtime, mission, integration, security, architecture layer | public CoreGrid page | migration required |
| Interaction | button, icon button, link, segmented control, tabs, accordion, tooltip, popover, modal, drawer, command palette | shadcn/Radix set | strong partial |
| Data | table, list, grid, chart, metric, status, activity, timeline, progress, confidence, evidence | table/chart/progress and portal helpers | partial |
| Forms | input, textarea, select, combobox, date, time, timezone, currency, upload, multi-step, consent | primitives + route-local forms | partial |
| System | loading, skeleton, empty, error, offline, maintenance, success, warning, denied, not found | skeleton/error/offline/not-found | partial |

## Application families

- **Shell:** global header, organization/workspace context, capability navigation, mobile
  navigation, page frame, contextual panel, help, profile, status.
- **Discovery:** universal search, scoped filters, recent searches, no-result state, command
  palette, shortcuts.
- **Account:** profile, preference group, security method, session, device, recovery, verification.
- **Communication:** notification item/inbox, message thread, mention, approval request.
- **Time:** timezone control, calendar month/week/day/agenda, event editor, conflict indicator.
- **Trust:** source chip, provenance trail, confidence indicator, approval state, verification
  state, audit event, actor/model/worker identity.
- **AI:** intelligence response sections for Observation, Inference, Recommendation, Proposed
  Action, Evidence, Verification; execution and approval states.
- **Mission:** mission row/detail, plan, dependency, execution step, evidence bundle, approval,
  rollback, cost/risk/authority summaries. Only ACTIVE-V1 bounded contracts may be interactive.

## Layout selection

| Pattern | Use | Do not use |
| --- | --- | --- |
| Card | portable object with bounded metadata/action | default page section |
| List | scan ordered or heterogeneous items | multidimensional comparison |
| Table | compare consistent fields | narrow mobile primary experience |
| Timeline | temporal sequence and provenance | arbitrary vertical decoration |
| Panel | persistent supporting context | unrelated content container |
| Canvas | spatial/relationship work | ordinary record collection |
| Split view | selection plus detail | when either side needs full focus |
| Drawer | short contextual task | complex irreversible workflow |
| Modal | focused decision/interruption | navigation or long-form work |
| Full page | deep task, configuration, or record | tiny confirmation |
| Command | discover/execute known authorized action | bypass policy or collect complex data |

## State contract

All interactive primitives support, where meaningful: default, hover, focus-visible, active,
selected, disabled, read-only, loading, success, error, warning, partial, offline, unauthorized,
forbidden, expired, and stale. Empty collections distinguish:

- no records exist;
- filters produce no results;
- capability is not configured;
- viewer lacks permission;
- data is unavailable or offline.

## Existing implementation map

- `frontend/src/components/ui/`: reusable Radix/shadcn primitives.
- `frontend/src/components/portal-shell.tsx`: page, cards, metrics, empty, errors, skeletons,
  pagination; currently overuses glass/card treatment and contains duplicated visual values.
- `frontend/src/components/shell/`: notifications, profile, header actions, workspace switcher.
- `frontend/src/components/public/`: Scholar-specific organization-public sections.
- `frontend/src/components/command-center/`: command palette.
- `frontend/src/components/ai/`: role-specific Scholar assistants; migrate toward one typed
  intelligence anatomy.

## Accessibility baseline

Prefer native semantics. Icon-only controls require accessible names. Dialogs trap focus and
restore it. Tables preserve headers and captions. Form errors are associated and announced.
Tooltips never contain required information. Drag interactions have keyboard alternatives.
Minimum coarse-pointer target is 44×44px.

## Anti-patterns

No arbitrary component renderer from database values; no visual-only disabled action; no clickable
`div`; no nested interactive controls; no status encoded by color only; no skeleton unrelated to
final layout; no infinite animation; no generic card grid where a list, table, narrative, or
spatial composition answers the task better.

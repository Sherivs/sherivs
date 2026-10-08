# SHERIVS Motion System

Version: V1 foundation (2026-10-08) · Classification: **V1**
Tokens: `--sherivs-duration-*`, `--sherivs-ease-*` (`styles.css`).

## 1. Principle

Motion communicates system state. If it does not tell the user something
true — arrived, working, done, failed, verified — it does not ship.

## 2. Vocabulary

| Pattern | Use | Spec |
|---|---|---|
| Page/route transition | progress bar + content settle | 150–240ms ease-out |
| Hover / focus / press | affordance confirmation | 80–150ms |
| Skeleton shimmer | loading data | 1.6s loop, muted tones |
| Count-up stats | arrived metrics | ≤1200ms ease-out cubic |
| AI phases | gathering → checking → verifying (real backend states) | spinner + labeled phase |
| Mission progress | execution/verification transitions | stepped, resumable |
| Notification arrival | single subtle slide | 240ms once, never looping |
| Dialog/drawer/sheet/palette | layer enter/exit | 150–240ms ease-out |

Prohibited: bouncing, particles, perpetual ambient animation, parallax as
decoration, transitions slower than 400ms.

## 3. Intelligence motion

Contextual light movement and progressive evidence disclosure are allowed
only when bound to real state (streamed reasoning, verification results,
live mission events). Never animate "thinking" during a idle wait; use
`ReasoningState` phases that the backend actually reports.

## 4. Accessibility

`prefers-reduced-motion: reduce` collapses all animation to state changes
(see stylesheet guard). Motion never carries information alone — every
animated state has a text/aria-live equivalent.

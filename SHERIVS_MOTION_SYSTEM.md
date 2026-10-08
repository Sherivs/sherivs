# Sherivs Motion System

Status: `PROPOSED`  
Version target: `ACTIVE-V1`

## Purpose

Motion communicates relationship, state change, progress, arrival, and verification. It is never evidence that backend work is occurring.

## Tokens

| Token      |      Range | Use                             |
| ---------- | ---------: | ------------------------------- |
| instant    |    0–80 ms | pressed/selected feedback       |
| fast       | 120–160 ms | hover, focus, small disclosure  |
| standard   | 180–240 ms | panel and navigation transition |
| deliberate | 280–400 ms | modal or major spatial change   |

Easing families: enter decelerates, exit accelerates, movement uses restrained spring only when spatial continuity benefits. Repeated bounce and constant ambient animation are prohibited.

## Patterns

- Page: preserve shell; cross-fade or translate content subtly.
- Navigation: active indicator moves only between adjacent known locations.
- Overlay: trigger and overlay retain spatial relationship; focus moves on completion.
- Loading: skeleton or progress reflects real wait; indefinite activity remains calm.
- Data arrival: emphasize changed region once, without reordering unexpectedly.
- AI: processing animation starts only from an actual processing state and stops on completion, failure, or cancellation.
- Mission: progress follows backend lifecycle; no simulated steps.
- Verification: evidence arrival, review, approval, and verified outcome are distinct transitions.
- Notification: new item announces accessibly without stealing focus.

## Reduced motion

`prefers-reduced-motion: reduce` removes nonessential transform, parallax, shimmer, and auto-animation. State changes remain visible through color-independent static indicators and immediate content updates.

The current repository detects reduced motion in `use-client-platform.ts` but does not consistently apply it. Global CSS and component-level animation must be gated before conformance.

## Performance

Animate opacity and transform where possible; avoid layout-triggering properties and large blurred layers. Long-running animations pause offscreen and when the document is hidden. Motion cannot delay interaction or semantic state announcements.

## Acceptance

Every motion specifies trigger, represented state, duration, interruption behavior, reduced-motion equivalent, focus behavior, and performance cost. Decorative motion without an answer to “what state does this communicate?” is rejected.

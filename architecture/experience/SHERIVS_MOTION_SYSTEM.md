# Sherivs Motion System

Status: Target specification; current motion is partially conformant  
Version target: ACTIVE-V1

## Purpose

Motion explains continuity, hierarchy, causality, progress, arrival, and verification. It does not
decorate idle surfaces or imply backend work.

## Tokens

| Token | Range | Use |
| --- | --- | --- |
| instant | 0–80ms | state swap and press feedback |
| fast | 120–160ms | hover, focus-adjacent response, small reveal |
| normal | 180–240ms | panels, menus, route content continuity |
| deliberate | 280–400ms | major composition change with spatial meaning |

Enter easing decelerates; exit is slightly faster; transform uses small distance/scale. Spring
easing is restricted to direct manipulation where settling communicates physics. No repeated
bounce.

## Patterns

- Route: preserve shell; fade/translate only changed content; focus page heading.
- Navigation: active indicator moves or crossfades without delaying navigation.
- Panel/drawer/modal: origin matches spatial relationship; backdrop and surface coordinate.
- Loading: skeleton matches final geometry; determinate work uses progress; indeterminate motion
  appears only while a real request is pending.
- Data arrival: changed rows/values receive a brief non-color emphasis, then settle.
- Success/error: one concise transition plus accessible announcement; no celebration loop.
- Notification: arrival is subtle and never steals focus.
- Command palette: fast scale/fade from command origin; keyboard focus enters search immediately.
- Mission: state transitions respond to actual mission events; paused, waiting approval, failed,
  rolled back, verified, and stale are distinct.
- Verification: evidence becomes verified only after the verification record arrives.

## Intelligence motion

Do not animate “thinking” unless a backend request is actively processing. Streaming indicates
received output, not hidden reasoning. Evidence may appear progressively as sources resolve.
Observation, inference, recommendation, proposed action, execution, and verification transitions
follow real state changes and remain labelled in static form.

## Reduced motion

`prefers-reduced-motion: reduce` removes nonessential transform, parallax, auto-scroll, shimmer,
count-up, and looping animation. State changes remain immediate or use short opacity transitions.
Focus movement and announcements preserve orientation. Video never autoplays with motion unless
the user initiates it.

## Current findings and migration

`frontend/src/styles.css` defines multiple overlapping duration/easing sets, automatic staggered
page animation, count-up metrics, shimmer, floating particles, pulse/glow, and AI bouncing dots.
It does not provide a global reduced-motion override. Migration order:

1. add canonical duration/easing tokens;
2. implement the reduced-motion baseline;
3. bind loading/AI/mission motion to real state;
4. remove automatic count-up and page staggering where they delay comprehension;
5. delete unused particle, glow, and duplicate keyframes after usage evidence;
6. test keyboard focus, interrupted animation, background tabs, and low-power devices.

## Performance

Prefer opacity and transform; avoid layout thrash and large blurred layers. No essential content
waits for animation. Motion remains responsive under CPU throttling and does not materially degrade
INP or induce CLS.

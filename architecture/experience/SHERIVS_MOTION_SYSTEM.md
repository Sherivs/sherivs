# Sherivs Motion System

Motion communicates state: navigation, focus, press, loading, data arrival, mission progress, verification. Not particles, bounce, or constant glow.

## Tokens

`--duration-instant` 50ms · `--duration-fast` 100ms · `--duration-normal` 200ms · `--duration-slow` 300ms  
`--ease-out`, `--ease-default`. Avoid `--ease-spring` except tiny press feedback.

## Intelligence motion

AI “thinking” only while a request is in flight. Evidence can appear progressively when it is actually arriving. Worker and mission transitions follow real status enums.

## Reduced motion

`prefers-reduced-motion: reduce` and `html.sherivs-reduced-motion` both collapse animation/transition durations. Account setting: system / full / reduced.

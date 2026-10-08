# Sherivs Motion System

**Version-target:** ACTIVE-V1

Motion communicates state: navigation arrival, focus, press, loading, verification, panel open/close.

| Token | Value |
|---|---|
| instant | 50ms |
| fast | 120ms |
| normal | 200ms |
| slow | 320ms |
| easing | cubic-bezier(0.16, 1, 0.3, 1) |

`prefers-reduced-motion: reduce` is enforced globally in `styles.css` (durations collapse).

Intelligence motion (evidence appearing, worker state, mission progress) may only run when the backend is actually processing. Marketing pages do not loop “thinking” animations.

Prohibited: bouncing particles, constant parallax, slow cinematic page wipes, AI orbs.

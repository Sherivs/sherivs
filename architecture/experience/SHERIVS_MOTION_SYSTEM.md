# Sherivs Motion System

Tokens: `sherivs.tokens.json` -> `--sv-duration-*`, `--sv-ease-*`; consumed in `sherivs.css`; typed in `design-tokens.ts` (`SHERIVS_MOTION`).

## Durations

| Token | Value | Use |
| --- | --- | --- |
| `instant` | 80ms | Pressed feedback |
| `fast` | 140ms | Hover, color, small transforms (`sv-pressable`) |
| `base` | 220ms | Fades (`sv-fade`) |
| `slow` | 360ms | Entrance rise (`sv-rise`) |
| `deliberate` | 560ms | Plane-line draw (`sv-draw`), live-indicator pulse |

Easing: `standard` (`cubic-bezier(0.2,0,0,1)`) and `emphasized`. No bounce, no parallax, no scroll-jacking.

## Principles

1. **Motion communicates state, not decoration.** Entrance rises are staggered with `--i` and are short; nothing loops except genuine activity indicators.
2. **Activity indicators are truthful.** `.sv-state[data-live="true"]` and `.sv-progress[data-active="true"]` animate only when the caller passes real in-flight state. Components never fabricate "thinking" (Constitution article 6).
3. **Reduced motion is honored.** Under `prefers-reduced-motion: reduce`, all animation and transition durations collapse to ~0 and `scroll-behavior` becomes `auto`. Information is never carried only by motion.
4. **No layout shift from motion.** Entrance animations use opacity/transform only.

## Verification

* Token duration/ease values are covered by `sherivs-design-tokens.test.ts` (generated CSS sync).
* The reduced-motion rule is present in `sherivs.css`; a runtime check under emulated reduced motion is **not** part of the automated suite (listed in status as a gap).

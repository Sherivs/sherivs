# SHERIVS MOTION SYSTEM (SMS-v1.0)
**System:** State Transitions, Physics Curves, and Perceived Intelligence Choreography  
**Status:** Canonical Motion Specification  

---

## 1. The Purpose of Motion in Sherivs

Motion in Sherivs is not decoration. It serves three distinct architectural functions:
1. **Spatial Navigation:** Clarifies where the user came from and where they are going (e.g., drawer slides from right, modal elevates from canvas).
2. **State Confirmation:** Visually proves that an asynchronous operation is acknowledging, executing, or verified.
3. **Cognitive Load Reduction:** Guides the operator's eye to incoming telemetry changes or required approval alerts without sudden, jarring visual flashes.

---

## 2. Timing, Duration & Easing Curves

All motion curves are based on cubic bezier functions that simulate physical momentum with instantaneous initial acceleration and smooth, restrained deceleration:

| Curve Name | Bezier Cubic | Timing (ms) | Usage |
|---|---|---|---|
| **Fast Affirmation** | `cubic-bezier(0.2, 0, 0, 1)` | 120ms | Button presses, checkbox toggles, badge appearances |
| **Spatial Slide** | `cubic-bezier(0.16, 1, 0.3, 1)` | 240ms | Drawer openings, dropdown menus, tab transitions |
| **Elevation Rise** | `cubic-bezier(0.16, 1, 0.3, 1)` | 300ms | Modal dialogue presentations, command palette entry |
| **Telemetry Pulse** | `cubic-bezier(0.4, 0, 0.6, 1)` | 1500ms (Loop) | Live connection beacon, background task execution |

---

## 3. Intelligence & Telemetry Choreography

When Jarvis or an AI Worker executes a task, motion communicates real backend state:
1. **Intent Formulation:** Subtle, calm breathing border (`--sherivs-cyan-glow`) around the active execution well.
2. **Streaming Reasoning:** Lines appear progressively with a 20ms fade-in, avoiding artificial typing delays when data is already available.
3. **Evidence Stamping:** Brief 300ms emerald perimeter flash upon cryptographic confirmation.
4. **Approval Required:** Soft amber pulse on the primary action button until the human operator signs off.

---

## 4. Accessibility & Reduced Motion Governance

In strict compliance with **WCAG 2.2 Criterion 2.3.3**:
```css
@media (prefers-reduced-motion: reduce) {
  *, ::before, ::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
  .telemetry-pulse,
  .shimmer-sweep {
    animation: none !important;
  }
}
```
When reduced motion is requested, all spatial sliding collapses to instant opacity switches, preserving immediate interaction without vestibular discomfort.

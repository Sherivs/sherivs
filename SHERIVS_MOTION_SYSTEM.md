# SHERIVS MOTION SYSTEM
## Physics, State Choreography, Perception Curves & Motion Invariants
**Document Identifier:** SMS-2026-V1  
**Product Category:** Institutional Intelligence Infrastructure  
**Core Thesis:** Motion as System Observability  

---

## 1. Principles of Institutional Motion

1. **Information-Carrying Motion:** Motion in Sherivs is not decoration; it communicates spatial relationships, state transitions, and background computations.
2. **Subtle Physics:** We utilize damped harmonic spring curves that reflect precision engineering, avoiding whimsical bouncing, playful oscillations, or exaggerated rubber-banding.
3. **Respect for Focus:** Animations never distract an operator while reading critical data or executing emergency procedures.
4. **Reduced Motion Default:** Any system with `prefers-reduced-motion: reduce` instantly replaces non-essential motion with instantaneous transitions or simple opacity changes.

---

## 2. Timing, Easing & Duration Curves

### The Sherivs Easing Curves
```css
/* Cubic Bezier Curves */
--ease-standard:      cubic-bezier(0.16, 1, 0.3, 1);    /* High-velocity deceleration (Out) */
--ease-enter:         cubic-bezier(0, 0, 0.2, 1);       /* Decelerate in */
--ease-exit:          cubic-bezier(0.4, 0, 1, 1);       /* Accelerate out */
--ease-intelligence:  cubic-bezier(0.25, 0.1, 0.25, 1); /* Continuous ambient curve */
```

### Duration Hierarchy
| Interaction Type | Duration | Easing | Intent |
| :--- | :--- | :--- | :--- |
| **Micro-interaction** (Hover, Focus, Press) | `100ms`–`150ms` | `--ease-standard` | Tactile responsiveness without drag |
| **Dropdown / Tooltip / Popover** | `150ms` | `--ease-standard` | Instantaneous spatial arrival |
| **Drawer / Contextual Sheet** | `250ms`–`300ms` | `--ease-standard` | Decisive spatial slide-in from edge |
| **Command Palette (`⌘K`)** | `200ms` | `--ease-standard` | Centered subtle scale + fade entrance |
| **Page Route Transition** | `200ms` | `--ease-standard` | Soft cross-fade with 4px vertical glide |
| **Data Update Flash (Live Telemetry)** | `400ms` | `--ease-enter` | Subtle green/cyan background highlight fading out |

---

## 3. Motion Language for Intelligence & Workers

Sherivs interfaces must visually reflect the reality of AI cognition without deceit:

1. **Jarvis Cognition Pulse:**
   - When Jarvis is waiting for backend LLM streaming tokens:
   - Visual: A subtle, rhythmic 1.5s luminance pulse on the Jarvis glyph border (`rgba(6, 182, 212, 0.3)` to `rgba(6, 182, 212, 0.8)`).
   - Invariant: Stops instantly when the stream terminates.

2. **Progressive Evidence Materialization:**
   - When a mission produces evidence, steps appear sequentially as they are verified:
   - Stagger: `60ms` per verified assertion.
   - Entrance: `translateY(8px)` to `translateY(0)` with opacity fade.

3. **Cryptographic Verification Check:**
   - When an independent verifier signs off on a state transition:
   - Visual: A sharp 180ms checkmark stroke drawing animation with a brief micro-glow (`rgba(16, 185, 129, 0.4)`).
   - Signifies: Tamper-proof validation confirmed.

4. **Quarantine / Breach Warning Motion:**
   - When an untrusted agent attempts an unauthorized action:
   - Visual: A single, non-looping 200ms horizontal shake (±4px) and rose-red border highlight (`#f43f5e`).
   - Signifies: Action rejected by policy enforcement.

---

## 4. Implementation in CSS & Tailwind

```css
@keyframes sherivs-fade-in {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes sherivs-slide-up {
  from { opacity: 0; transform: translateY(12px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes sherivs-pulse-subtle {
  0%, 100% { opacity: 0.7; transform: scale(1); }
  50% { opacity: 1; transform: scale(1.02); }
}

@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
```

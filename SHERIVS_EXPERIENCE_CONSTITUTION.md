# SHERIVS EXPERIENCE CONSTITUTION
## Principles, Invariants, and Standards of the Sherivs User Experience
**Document Identifier:** SEC-2026-V1  
**Authority:** Platform Design & Frontend Architecture Council  
**Classification:** Mandatory Architectural Invariant  

---

## 1. The Prime Experience Directive
**No surface, component, or interaction in Sherivs may optimize local aesthetic novelty at the expense of systemic coherence, institutional trust, or architectural integrity.**

An interface that looks attractive but conceals systemic failure, fabricates artificial intelligence progress, or blurs security boundaries is defective by definition.

---

## 2. Institutional Quality Bar ("$1M-Class Standard")
Sherivs interfaces must project the rigor of critical aerospace, defense, scientific, and institutional infrastructure:
1. **Mathematical Precision:** Layout alignments, pixel grids, typography leading, and tabular numerics adhere to disciplined proportions.
2. **Restrained Elegance:** Avoid saturated rainbow gradients, unnecessary particle fields, oversized decorative illustrations, or fake "glowing neon" borders.
3. **Calm Authority:** High-density information layouts designed for professionals making high-stakes institutional decisions.
4. **Instant Comprehension:** Visual hierarchy guides attention to critical operational deltas within 300 milliseconds.

---

## 3. The Seven Anti-Patterns (Strictly Prohibited)
The following design paradigms are prohibited across all Sherivs products:

1. **The Generic SaaS Card Salad:** Tiling arbitrary content into dozens of identical rounded cards with drop shadows. Layout must be determined by information structure (data tables, timelines, split inspect panes, relational trees).
2. **The Fake AI Spinner:** Displaying a pulsing holographic ring or oscillating "AI is thinking" wave when no background inference or model processing is actively executing.
3. **The Cosmetic Security Button:** Hiding or disabling buttons in the browser without identical server-side role and policy verification.
4. **The Fabricated Metric:** Displaying static vanity numbers (e.g., "99.99% operational efficiency", "10,000+ happy students") on product dashboards without real telemetry data backing.
5. **The Unanchored Modal Storm:** Layering modal dialogs on top of modal dialogs. Use contextual sheets, split master-detail views, or progressive inline disclosure instead.
6. **The Destructive Global Search:** Returning search results across tenants or restricted resources without pre-filtering by viewer authorization.
7. **The Blanket Glassmorphism Trap:** Applying frosted glass (`backdrop-filter`) indiscriminately across every surface. Translucency is reserved exclusively for elevated spatial overlays (headers, palettes, dropdown menus).

---

## 4. The Spatial Hierarchy Invariant
Every operational surface must communicate the four levels of reality:

```
[ LEVEL 1: CANONICAL REALITY ]
Verified records, database transactions, physical events, and state ledger.
                              │
                              ▼
[ LEVEL 2: DERIVED INTELLIGENCE ]
Contextual memory, relationship graphs, statistical forecasting, and AI evaluations.
                              │
                              ▼
[ LEVEL 3: GOVERNED ACTION ]
Approved mission proposals, human-in-the-loop clearances, and automated triggers.
                              │
                              ▼
[ LEVEL 4: VERIFIABLE EVIDENCE ]
Cryptographic hashes, execution logs, validator receipts, and audit stamps.
```

An operator must always understand whether they are looking at verified historical truth (Level 1) or an AI-generated hypothesis (Level 2).

---

## 5. Tenancy & Boundary Invariants
1. **Tenant Context Persistence:** Every surface displays the active organization, workspace, and role context prominently.
2. **Zero Cross-Bleed:** Switching organizations clears all contextual caches, search indices, and recent item histories instantly.
3. **Runtime Segregation:** A visitor to an organization utilizing the Scholar runtime sees Scholar domain nomenclature; a corporate enterprise user sees universal institutional nomenclature. Neither sees an accidental collision.

---

## 6. System State Completeness
No component is complete if it only satisfies the "happy path". Every interactive or data-driven component must explicitly handle and gracefully render sixteen distinct states:
1. `DEFAULT`
2. `HOVER`
3. `FOCUS-VISIBLE`
4. `ACTIVE`
5. `DISABLED`
6. `LOADING (Skeleton/Shimmer)`
7. `EMPTY (With constructive guidance)`
8. `PARTIAL (Data streaming in)`
9. `SUCCESS (Confirmed state)`
10. `WARNING (Degraded or approaching quota)`
11. `ERROR (Actionable recovery)`
12. `OFFLINE (Cached read-only)`
13. `UNAUTHORIZED (Session expired/missing)`
14. `FORBIDDEN (Policy denial)`
15. `STALE (Out of sync with reality)`
16. `DESTRUCTIVE (Explicit confirmation barrier)`

---

## 7. Motion & Physics Principles
1. Motion must convey physical cause and effect: elements slide in the direction of navigation, elevate on interaction, and dissolve on completion.
2. Durations are crisp and rapid:
   - Micro-interactions (hover, press): 100ms–150ms.
   - Panel transitions & sheets: 200ms–300ms.
   - Page transitions: 250ms with subtle opacity cross-fade.
3. The platform must honor `prefers-reduced-motion` across every animation, collapsing movement to instantaneous or simple opacity transitions.

---

## 8. Accessibility as an Architectural Invariant
1. All core workflows must be 100% operable via keyboard alone with visible, high-contrast focus indicators.
2. Color cannot be the sole conveyor of information (e.g. status dots must accompany textual labels or distinct shapes).
3. Contrast ratios meet or exceed WCAG 2.2 AA standards (minimum 4.5:1 for body copy, 3:1 for large display headers and interactive borders).

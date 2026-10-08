# SHERIVS RESPONSIVE SYSTEM
## Multi-Device Ergonomics, Viewport Adapters, Breakpoint Matrix & Mobile Primitives
**Document Identifier:** SRS-2026-V1  
**Product Category:** Institutional Intelligence Infrastructure  
**Core Strategy:** Fluid Adaptive Workspaces from Handheld to Ultrawide Command Centers  

---

## 1. Responsive Philosophy

Sherivs refuses to simply "shrink desktop screens to fit mobile". A mobile device used by a campus security guard, field auditor, or travelling executive represents a fundamentally different operational context than a triple-monitor security operations center.

The Sherivs Responsive System adapts layout density, navigation modality, and interaction ergonomics to the specific constraints of the viewport.

---

## 2. Breakpoint Matrix & Layout Archetypes

| Viewport Category | Width Range | Primary Devices | Navigation Pattern | Workspace Layout Archetype |
| :--- | :--- | :--- | :--- | :--- |
| **Micro Mobile** | `360px` – `389px` | Budget smartphones, rugged handhelds | Bottom 4-icon nav, sheet drawers | Single-column linear flow, carded tables |
| **Standard Mobile**| `390px` – `429px` | Modern smartphones (iPhone, Galaxy) | Bottom 5-icon nav, gesture drawer | Stacked widgets, horizontal swipe carousels |
| **Large Mobile** | `430px` – `767px` | Pro Max phones, compact phablets | Bottom nav + quick action FAB | 1-to-2 column adaptive grid |
| **Tablet Portrait**| `768px` – `1023px`| iPad Mini, iPad, Surface Go | Icon-only collapsed rail (64px) | 2-column balanced grid, modal sheets |
| **Tablet Landscape**| `1024px` – `1279px`| iPad Pro, standard laptops | Full expandable sidebar (240px) | 3-column split view (Nav / Master / Detail)|
| **Standard Desktop**| `1280px` – `1599px`| MacBooks, 1080p desktop monitors | Full persistent sidebar (260px) | Full master-detail with persistent telemetry|
| **Wide Desktop** | `1600px` – `1919px`| 2K monitors, professional workstations| Full sidebar + persistent right drawer| 4-column metrics, expanded data grid |
| **Ultrawide & SOC**| `1920px` – `2560px`+| 4K displays, multi-monitor walls | Permanent sidebar + multi-panel grid | Bounded container (1600px max) with live feed |

---

## 3. Mobile Navigation & Touch Ergonomics

1. **The Thumb Zone Rule:**
   - 80% of routine actions on mobile must occur within the bottom 40% of the screen (the comfortable reach of the human thumb).
   - Primary destinations reside in the fixed `MobileBottomBar`.
   - Complex menus and filters open from bottom sheets (`Drawer` / `Vaul`) rather than top dropdowns.

2. **Responsive Data Grids:**
   - On desktop: Full high-density tabular view with 8–12 columns.
   - On mobile: Automatically converts into structured, stacked operational entity cards displaying primary identifier, status badge, key delta, and disclosure arrow.

3. **Gesture Safety:**
   - Swiping from the left screen edge opens the full hierarchical navigation drawer.
   - Pull-down gesture on tables and overview feeds triggers optimistic data synchronization.
   - All interactive controls provide a minimum 44px hit-box.

---

## 4. Density Modes & Viewport Scaling
- **Default Density:** Standard enterprise density with 16px body copy and 48px row heights.
- **Compact Density (Desktop / Wide):** 13px body copy and 36px row heights for data-intensive operations (financial audit, scheduling grid).
- **Comfortable Density (Touch / Mobile):** 15px body copy and 56px row heights with generous touch margins.

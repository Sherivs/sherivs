# SHERIVS RESPONSIVE SYSTEM (SRS-v1.0)
**System:** Multi-Device Viewport Geometry, Ergonomics, and Breakpoint Engineering  
**Status:** Canonical Responsive Specification  

---

## 1. Breakpoint Taxonomy

Sherivs designs independently for the complete spectrum of institutional devices:

| Breakpoint | Pixel Range | Primary Target Devices | Layout Behavior |
|---|---|---|---|
| **Compact Mobile (xs)** | 360px – 389px | Older smartphones, ultra-compact screens | Single-column, stacked controls, bottom bar |
| **Standard Mobile (sm)** | 390px – 429px | iPhone 14/15/16, Galaxy S-series | Bottom navigation, full-width touch cards |
| **Large Mobile (md)** | 430px – 767px | Pro Max phones, foldable compacts | Expanded cards, secondary inline filters |
| **Tablet Portrait (lg)** | 768px – 1023px | iPad Mini, iPad 10.2", small tablets | Collapsible sidebar, 2-column grid |
| **Tablet Landscape / Laptop (xl)** | 1024px – 1279px | iPad Pro 11", standard laptops | Persistent compact sidebar, multi-panel layout |
| **Standard Desktop (2xl)** | 1280px – 1599px | Desktop monitors, MacBook Pro 14/16" | Full sidebar, 3-column operational canvas |
| **Wide Workstation (3xl)** | 1600px – 1919px | 27" QHD displays, iMac 24" | Full canvas + persistent right inspector panel |
| **Ultra-Wide Operations (4xl)** | 1920px – 2560px+| Ultrawide monitors, multi-display ops rooms | Multi-column telemetry grids, dual inspection |

---

## 2. Responsive Interaction Paradigms

### Mobile Ergonomics (360px – 767px)
- **Thumb Zone Design:** Primary actions and quick navigation reside within the bottom 30% of the screen.
- **Drawers Over Modals:** Dialogs transform into bottom-anchored sheets (`vaul` drawer) that can be dismissed with a natural downward swipe gesture.
- **Responsive Tables:** Dense tabular data transforms into stacked metric cards or horizontally scrollable containers with frozen identifier columns.

### Tablet & Laptop Ergonomics (768px – 1279px)
- **Fluid Sidebars:** Sidebars default to icon-only rail mode to maximize data canvas width, expanding on hover or click.
- **Adaptive Split Views:** Master-detail interfaces display side-by-side on landscape orientation and stack on portrait orientation.

### Workstation Ergonomics (1280px+)
- **Multi-Panel Workstations:** Three-panel layouts (Left Navigation, Center Operational Canvas, Right Telemetry & Jarvis Inspector) operate simultaneously without modal blocking.

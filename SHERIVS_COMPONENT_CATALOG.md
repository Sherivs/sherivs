# SHERIVS COMPONENT CATALOG
## Canonical Library of Institutional Experience Components
**Document Identifier:** SCC-2026-V1  
**Product Category:** Institutional Intelligence Infrastructure  
**Implementation Technology:** React 19 · Tailwind CSS 4 · Radix UI · Lucide Icons  

---

## 1. Catalog Overview & Taxonomic Structure

The Sherivs Component Catalog provides modular, accessibility-tested, performance-optimized building blocks across nine specialized component families:

```
[ SHERIVS COMPONENT CATALOG ]
 ├── 01. Brand & Identity (Logos, Symbols, Wordmarks, Marks)
 ├── 02. Navigation & Chrome (Headers, Sidebars, Menus, Breadcrumbs)
 ├── 03. Hero & Editorial (Split, Narrative, Technical, Immersive)
 ├── 04. Content & Narrative (Architecture, Capabilities, Comparisons)
 ├── 05. Product & Operational (Mission Cards, Worker Profiles, Run Cards)
 ├── 06. Interaction & Control (Command Palette, Segmented Controls, Sheets)
 ├── 07. Data & Telemetry (Tables, Timelines, Confidence Gauges, Feeds)
 ├── 08. Forms & Inputs (Validations, Comboboxes, Multi-step, File Drop)
 └── 09. System & Resilience (Skeletons, Empty States, Error Announcers)
```

---

## 2. Component Specifications by Family

### Family 01: Brand & Identity
| Component | Identifier | Purpose | States / Variants |
| :--- | :--- | :--- | :--- |
| **Sherivs Logo** | `SherivsLogo` | Canonical brand lockup with logomark + wordmark | Light, Dark, Monochromatic, Inverted |
| **Sherivs Symbol** | `SherivsSymbol` | Isolated geometric intelligence node mark | Static, Breathing (Subtle glow), Responsive 24/32/48 |
| **Institutional Lockup** | `PartnerLockup` | Tenant brand + "Powered by Sherivs" sub-mark | Compact, Full, Co-branded |
| **Jarvis Glyph** | `JarvisGlyph` | Hexagonal executive intelligence glyph | Dormant, Active, Processing, Verified |

### Family 02: Navigation & Chrome
| Component | Identifier | Purpose | Behavior & Accessibility |
| :--- | :--- | :--- | :--- |
| **Universal Header** | `UniversalHeader` | Top-level persistent platform chrome | Sticky, backdrop-filter, `role="banner"`, skip-to-content |
| **Contextual Sidebar** | `ContextualSidebar` | Primary hierarchical workspace navigation | Collapsible, keyboard navigable, aria-expanded, tooltips |
| **Command Palette** | `CommandPalette` | Instant action/navigation modal (`⌘K`) | `cmdk` primitive, fuzzy search, role-gated action lists |
| **Workspace Switcher**| `WorkspaceSwitcher` | Secure tenant & reality switcher | Dropdown with keyboard selection, verified context |
| **Dynamic Breadcrumbs**| `Breadcrumbs` | Deep navigational trail with schema.org data | Truncated path, current page `aria-current="page"` |
| **Mobile Bottom Bar** | `MobileBottomBar` | Thumb-friendly 4-to-5 destination mobile tray | Fixed bottom, safe-area-inset, haptic trigger support |

### Family 03: Hero & Editorial
| Component | Identifier | Purpose | Composition |
| :--- | :--- | :--- | :--- |
| **Institutional Hero** | `InstitutionalHero` | High-impact homepage narrative opener | Eyebrow tag, Display headline, lead text, twin CTAs |
| **Split Architecture Hero**| `SplitHero` | Narrative lead with interactive reality visualizer | 50/50 desktop split, responsive vertical stack |
| **Technical Hero** | `TechnicalHero` | Deep dive platform header with live metrics | Breadcrumbs, title, telemetry pills, quick filters |

### Family 04: Content & Architecture
| Component | Identifier | Purpose | Composition |
| :--- | :--- | :--- | :--- |
| **Narrative Section** | `NarrativeSection` | Editorial block explaining systemic reality | Numbered index (01..12), lead text, side evidence card |
| **Capability Matrix** | `CapabilityMatrix` | Grid of architectural capabilities | Clean borders, icon badges, capability codes, provenance |
| **Layer Architecture Diagram**| `ArchitectureLayers`| Visual stack from Reality to Intelligence | Layered interactive SVG/CSS planes showing data flows |
| **Comparison Grid** | `ComparisonGrid` | Legacy ERP/SaaS vs Institutional Infrastructure | Feature row check/cross comparison with explicit rationales |

### Family 05: Product & Operational Entities
| Component | Identifier | Purpose | Critical Data Fields |
| :--- | :--- | :--- | :--- |
| **Mission Card** | `MissionCard` | Compact/Expanded mission execution card | Status pill, worker avatars, step progress, evidence count |
| **Worker Profile Card**| `WorkerCard` | Governed AI worker identity card | Name, Model, Lease expiration, Reliability score, Authority |
| **Reality Node Card** | `RealityNodeCard` | Visual model of a person, device, or campus | Entity ID, Active state, Twin graph relations, Last observation |
| **Evidence Card** | `EvidenceCard` | Verifiable audit artifact card | SHA-256 hash, Validator signatures, Timestamp, Source link |

### Family 06: Interaction & Contextual Controls
| Component | Identifier | Purpose | Invariants |
| :--- | :--- | :--- | :--- |
| **Button** | `Button` | Universal interaction primitive | `primary`, `secondary`, `outline`, `ghost`, `destructive` |
| **Segmented Control** | `SegmentedControl` | Multi-view toggle (e.g. Month/Week/Day) | Keyboard arrow-key navigation, smooth highlight slide |
| **Contextual Sheet** | `ContextualSheet` | Slide-out inspection drawer for missions/evidence | Accessible focus trap, `ESC` to close, backdrop dismiss |
| **Confirmation Barrier**| `DestructiveModal` | Double-check confirmation for irreversible actions | Explicit typed phrase requirement, countdown safety latch |

### Family 07: Data & Telemetry
| Component | Identifier | Purpose | Features |
| :--- | :--- | :--- | :--- |
| **Institutional Data Table**| `DataTable` | High-density data grid | Virtualized rows, sort, multi-column filter, sticky header |
| **Evidence Timeline** | `EvidenceTimeline` | Sequential audit of mission execution steps | Provenance links, pass/fail indicators, live streaming log |
| **Confidence Gauge** | `ConfidenceGauge` | Mathematical probability indicator | High-precision percentage, calibrated color tiers |
| **Status Beacon** | `StatusBeacon` | Live system health beacon | Operational, Degraded, Critical, Maintenance |

### Family 08: Forms & Governed Inputs
| Component | Identifier | Purpose | Validation |
| :--- | :--- | :--- | :--- |
| **Governed Input** | `Input` | High-precision text input field | Zod schema validation, inline error message, accessible label |
| **Timezone Selector** | `TimezoneSelect` | Searchable IANA timezone picker | Local time offset indicator, geographic grouping |
| **File Drop Zone** | `FileDropZone` | Drag-and-drop evidence upload zone | Cryptographic hash generation on client before upload |

### Family 09: System States & Resilience
| Component | Identifier | Purpose | Experience Delivery |
| :--- | :--- | :--- | :--- |
| **Shimmer Skeleton** | `TableSkeleton`, `CardSkeleton` | Low-friction layout placeholder | Precise geometry matching final content, no content jump |
| **Constructive Empty State**| `EmptyState` | Empty workspace or query placeholder | Meaningful explanation, authorized next action CTA |
| **Error Boundary Box** | `ErrorBoundary` | Graceful catch for unexpected exceptions | Error code, stack trace toggle, retry & rollback triggers |
| **Offline Banner** | `OfflineBanner` | Persistent warning when offline | Shows cached state warning, sync queue counter |

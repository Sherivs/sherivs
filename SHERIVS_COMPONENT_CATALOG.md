# SHERIVS COMPONENT CATALOG (SCC-v1.0)
**System:** Sherivs Universal Component Architecture  
**Status:** Canonical Implementation Reference  

---

## 1. Component Family Taxonomy

The Sherivs Component Catalog provides an exhaustive, typed inventory of reusable primitives and composite patterns across all product surfaces:

```
┌────────────────────────────────────────────────────────┐
│               SHERIVS COMPONENT TAXONOMY               │
├────────────────────────┬───────────────────────────────┤
│ 1. Brand               │ 7. Interaction & Overlays     │
│ 2. Navigation & Chrome │ 8. Data & Telemetry           │
│ 3. Hero & Narrative    │ 9. Form Primitives            │
│ 4. Editorial & Content │ 10. AI & Jarvis Primitives    │
│ 5. Product & Runtimes  │ 11. Evidence & Verification   │
│ 6. Workspace Surfaces  │ 12. System States & Fallbacks │
└────────────────────────┴───────────────────────────────┘
```

---

## 2. Detailed Family Specifications

### Family 1: Brand Architecture
- `SherivsLogo`: Canonical vector mark combining the isometric institutional polygon with precision typography. Supports sizes `sm` (24px), `md` (32px), `lg` (48px), and `hero` (64px).
- `SherivsSymbol`: Standalone glyph for compact chrome, mobile headers, and favicons.
- `SherivsWordmark`: Pure typographic lockup in *Plus Jakarta Sans*.
- `BrandLockup`: Dynamic lockup pairing Sherivs with an installed runtime (e.g., `Sherivs · Scholar`) or customer tenant (e.g., `Sherivs · Apex Academy`).
- `PartnerBadge`: High-contrast cryptographic seal verifying authorized ecosystem participation.

### Family 2: Navigation & Chrome
- `UniversalHeader`: Top bar hosting organizational context, global search input, quick Jarvis launcher, notification bell, and user avatar.
- `ContextualSidebar`: Multi-tier navigable sidebar with collapsible capability sections, tenant badge, pinned shortcuts, and collapse toggle.
- `WorkspaceSwitcher`: Fast dropdown for moving between Organization Workspace, Domain Runtime (Scholar), and Platform HQ.
- `BreadcrumbTrail`: Automatic hierarchy breadcrumb with root home link and micro-separators.
- `MobileBottomNav`: Ergonomic 5-slot bottom bar pinned to mobile viewports for quick primary routing.

### Family 3: Hero & Narrative Surfaces
- `NarrativeHero`: Full-width homepage hero with category headline, value statement, dual-CTA, and background architectural light sweep.
- `SplitHero`: Two-column layout pairing institutional statement with interactive live capability preview.
- `FeatureHero`: Dense, technical hero for platform capability deep-dives (`/platform/*`).

### Family 4: Editorial & Content Primitives
- `EditorialSection`: Section container with uppercase eyebrow, display title, lead paragraph, and responsive child slot.
- `ArchitectureDiagram`: SVG-based architectural flow renderer for reality-to-outcome pipelines.
- `CaseStudyBlock`: Metric-first institutional proof block showcasing real-world performance.
- `ArticleCard`: Card primitive for blog, documentation, guides, and changelog posts.

### Family 5: Product & Runtimes
- `CapabilityCard`: Interactive card showcasing a specific kernel capability (e.g., Knowledge Currency, Reality Kernel, Mission Engine).
- `RuntimeCard`: Deep-dive card presenting an installed vertical runtime (e.g., Sherivs Scholar).
- `WorkforceProfileCard`: Detailed view of a governed AI worker: ID, model, permissions, current mission, and lease expiry.

### Family 6: Workspace & Workstation Surfaces
- `WorkspaceCanvas`: Padded, responsive workstation area hosting page content.
- `PageHeader`: Standardized view header containing title, subtitle, status pills, and contextual actions (e.g., `Export`, `Create Mission`, `Filter`).
- `FilterBar`: Segmented search and filtering controls for multi-dimensional entity tables.
- `InspectorDrawer`: Right-hand slide-over sheet for inspecting deep object telemetry without page navigation.

### Family 7: Interaction & Overlays
- `Button`: Primary, secondary, ghost, destructive, and outline variants with loading spinner and icon slots.
- `CommandPalette`: Keyboard-activated (`Cmd+K`) dialog providing instant access to all routes, actions, and Jarvis queries.
- `NotificationDrawer`: Slide-out panel presenting unread operational notices, mission completion alerts, and approval requests.
- `ConfirmDialog`: Two-step modal requiring explicit confirmation for destructive operations.

### Family 8: Data & Telemetry
- `DataTable`: High-density tabular grid with column sorting, cell truncation, pagination, and multi-row selection.
- `MetricCard`: KPI card displaying live value, trend delta, sparkline, and verification source timestamp.
- `AuditTimeline`: Vertical event stream showing signed system changes with actor hashes and diff tags.
- `ConfidenceGauge`: Visual radial or bar indicator displaying AI inference confidence percentage.

### Family 9: Form Primitives
- `FormField`: Accessible wrapper coordinating label, input, description, and error message via ARIA IDs.
- `TextInput` / `PasswordInput`: Precision text inputs with focus rings and optional icon prefixes/suffixes.
- `SelectDropdown`: Radix-based accessible select component with search filtering.
- `SwitchToggle`: Accessible toggle for binary feature states.

### Family 10: AI & Jarvis Primitives
- `JarvisSheet`: Dedicated executive intelligence console for briefing summaries, anomaly alerts, and mission drafting.
- `ReasoningBlock`: Collapsible trace showing the structured steps taken by an AI worker before proposing an action.
- `CategorizedAIOutput`: Visual renderer partitioning AI responses into *Observation*, *Inference*, *Recommendation*, and *Action*.

### Family 11: Evidence & Verification Primitives
- `EvidencePill`: Micro-badge displaying cryptographic proof status (`Verified`, `Pending Verification`, `Dual-Control Required`).
- `ProvenanceCard`: Modal or popover detailing the exact actor ID, model signature, UTC timestamp, and input hash for any mutation.
- `ApprovalBanner`: Sticky contextual alert notifying authorized personnel of an action awaiting their cryptographic sign-off.

### Family 12: System States & Fallbacks
- `EmptyState`: Clean spatial container with vector illustration, explanatory message, and primary recovery action.
- `LoadingState`: Skeletal shimmer matching the exact layout geometry of the expected data table or card.
- `ErrorState`: High-contrast diagnostic screen with error code, stack correlation ID, and retry button.
- `OfflineBanner`: Floating notification indicating loss of network connectivity and active offline queue.

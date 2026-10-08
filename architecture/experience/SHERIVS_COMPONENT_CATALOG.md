# Sherivs Component Catalog

Location: `frontend/src/components/sherivs/`. Foundations (Radix/shadcn primitives under `components/ui/`, `lucide-react`) are reused, not replaced. Status values: LIVE (exists, tested), CONTRACT_ONLY, NOT_STARTED.

| Component | File | Purpose | Status | Tests |
| --- | --- | --- | --- | --- |
| `SherivsSymbol`, `SherivsWordmark`, `SherivsLockup` | `brand.tsx` | Stratum mark, wordmark, lockup | LIVE | `sherivs-components.test.ts` |
| `SherivsProductLockup` | `brand.tsx` | "Sherivs Scholar" style product lockups | LIVE | same |
| `SherivsPartnerLockup` | `brand.tsx` | Organization lockup inside a Sherivs frame ("on Sherivs") | LIVE | same |
| `Container`, `Section`, `PlaneRail`, `PlaneMarker` | `primitives.tsx` | Layout widths, sectioning, four-plane marker | LIVE | same |
| `DefinitionRows` | `primitives.tsx` | Key/value definition lists (instead of card grids) | LIVE | same |
| `SvLink`, `LinkButton`, `ExternalAnchor`, `linkButtonClass` | `primitives.tsx` | Router-aware link and button-style link; external links get safe `rel` | LIVE | same |
| `SystemState` | `states.tsx` | 13 canonical states: loading, empty, partial, stale, error, offline, unauthorized, forbidden, expired, not-found, maintenance, success, warning | LIVE | same |
| `StatementBadge` | `evidence.tsx` | Labels observation / inference / recommendation / action / evidence / verification | LIVE | same |
| `ConfidenceMeter` | `evidence.tsx` | Confidence as text + bar; no meter if value absent | LIVE | same |
| `VerificationState` | `evidence.tsx` | unverified / pending / verified / failed / stale; live announcement only for pending | LIVE | same |
| `ProvenanceTrace`, `EvidenceChip` | `evidence.tsx` | Source chain and evidence references | LIVE | same |
| `AiStatement` | `evidence.tsx` | Composite: statement kind + provenance + confidence + verification | LIVE | same |
| `PlaneStack`, `MissionFlow`, `ExperienceEquation`, `LayerStack` | `diagrams.tsx` | Inline SVG/HTML diagrams of the platform model (no raster assets) | LIVE | same |
| `PublicHeader`, `PublicFooter`, `PublicShell` | `public-shell.tsx` | Skip link, primary nav (registry-derived), platform popover, mobile sheet, footer | LIVE | e2e `sherivs-public.spec.ts` |
| `Breadcrumbs`, `PageTitle`, `ProseBlock` | `page-chrome.tsx` | Page header with breadcrumb JSON-LD source | LIVE | `sherivs-public-routes.test.ts` |
| `HomePage` | `home-page.tsx` | Public narrative home | LIVE | e2e |

## Rules

* No component renders an AI-activity indicator unless the caller passes real in-flight state.
* No component fabricates data; evidence components render only what they are given and show an explicit "none" state otherwise.
* Interactive elements have a 44px minimum touch target (`sv-touch`) and a visible `:focus-visible` ring.

## Not started (tracked, not claimed)

Command palette redesign, global search results UI, calendar views, notification center, mission board, workforce roster, approval inbox, data tables, form system, onboarding wizard. The pre-existing `components/command-center/command-palette.tsx` and `components/shell/*` remain legacy-styled. See the status document.

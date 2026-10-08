# Sherivs Component Catalog

## Brand

`SherivsMark`, `SherivsLockup` — `frontend/src/components/experience/sherivs-mark.tsx`

## Public

- `PublicShell` — header, mobile nav, enterprise footer  
- `PublicHome` — narrative homepage  
- `PublicArticle`, capability/solution/legal/resource pages — `public-pages.tsx`  
- `ExperienceSection`, `PlaneList`, `ProcessStrip`, `BreadcrumbTrail`  
- `EmptyCatalog`, `PermissionDeniedState`, `OfflineState`  
- `IntelligenceKindBadge`, `ConfidenceMeter`, `ProvenanceLine`

## Application (existing, platform-owned)

shadcn/ui in `frontend/src/components/ui/*` (dialog, sheet, table, form, sidebar, command, etc.)

Shell: `shell-header-actions`, `workspace-switcher`, `notification-bell`, `profile-menu`, `portal-sidebar`, `mobile-bottom-nav`, `command-palette`

## Usage rules

- Do not default to cards.  
- Public CTAs link to real routes (`/auth`, `/provision`, `/platform`).  
- Empty catalogs use `EmptyCatalog`.  
- AI text must carry an `IntelligenceKindBadge` when it is inference or recommendation.  
- Anti-pattern: generic glass card grids, fake stats, glowing orbs, invented logos.

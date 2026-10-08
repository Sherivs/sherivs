# Sherivs Brand Migration

**Version-target:** ACTIVE-V1  
**Rule:** Classify first. No destructive global replace.

## Must become Sherivs (customer-facing)

| Surface | Treatment this program |
|---|---|
| `PLATFORM_NAME` and page titles | Sherivs |
| Public website `/` and `/(site)` | Sherivs narrative + alias `/coregrid` → `/` |
| PWA apple title, SW default title, offline string | Sherivs |
| Mobile `expo.name` and user-visible strings | Sherivs |
| Auth portal copy | Sherivs account; no default Scholar narration |
| robots.txt sitemap hint | sherivs.com |

## Preserve CoreGrid (technical)

- npm packages (`coregrid-scholar`, `@coregrid/contracts`, `coregrid-mobile` slug)
- Bundle identifiers `com.coregrid.app`, URL scheme `coregrid`
- SQL migrations, rollbacks, generated types
- TypeScript identifiers (`CoreGridSupabaseClient`, …)
- Headers `x-coregrid-*`, SW cache name `coregrid-app-shell-v1`
- Architecture/governance corpus (`AGENTS.md`, `architecture/coregrid-mvp-architecture/**`)
- File-header comments on domain modules

## Dual-name rule

Public sentence: “Sherivs is the product. CoreGrid is the engineering kernel name preserved in architecture and schema.”

## DNS

`sherivs.com` is added to `PLATFORM_HOSTS`. Existing `universalschoolos.com` hosts remain until cutover. OG image URLs still point at the currently served origin so previews do not 404.

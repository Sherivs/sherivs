# Sherivs Brand Migration

Customer-facing CoreGrid was classified, then changed. Technical identifiers were left in place.

## Renamed in the interface

- `PLATFORM_NAME` and the public tagline
- Document title, Apple web app title, theme color
- Public pages, kernel page, marketplace and generated-environment titles
- Authenticated shell wordmark and unlinked-account copy
- Operator-facing titles on super-admin and command-centre pages
- Push notification fallback title
- PWA manifest description
- Mobile display name and the sentences a person reads in the mobile app
- Footer line on organization sites: "Organization access" instead of "School portal"
- Platform hosts now include `sherivs.com`, `www.sherivs.com`, and `app.sherivs.com`. Previous hosts remain so existing tenants keep resolving

## Preserved on purpose

- Package name `coregrid-scholar`
- Database, migration, and policy identifiers
- Type names such as `CoreGridDatabase`
- Cache name `coregrid-app-shell-v1`
- Mobile slug, URL scheme, and bundle identifiers
- Module comments that describe the technical substrate
- Architecture documents, phase blueprints, and `AGENTS.md`
- The route `/coregrid`, which is the capability proof page, not the brand name
- Scholar, as the education runtime
- Jarvis, as the executive intelligence contract name

## Not claimed

A full purge of the word CoreGrid from comments or from operator copy that describes the substrate. Blind replacement would break imports, migrations, and tests that lock technical strings.

## Social and legal

No Sherivs social account was added, because none is published in this repository. Legal pages describe implemented controls and state that they are not counsel-authored instruments.

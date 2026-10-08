# Sherivs Brand Migration

Status: `CLASSIFIED — NO BLIND REPLACEMENT`  
Version target: `ACTIVE-V1`

## Decision

Customer-facing platform identity migrates from CoreGrid to **Sherivs**. The education runtime becomes **Sherivs Scholar**. Existing technical identifiers remain compatible until an explicit migration changes them safely.

This document records the requested brand authority. It does not itself prove DNS, trademark, social, email, certificate, application-store, or production deployment readiness.

## Classification

### Customer-facing: migrate

- `frontend/src/lib/platform.ts` platform name, title, tagline, description.
- root metadata and Apple web-app title in `routes/__root.tsx`.
- marketing shell and `/coregrid` content.
- platform/home/command-centre public copy.
- authentication chrome and public-site attribution.
- mobile visible name and sign-in copy.
- service-worker visible notification title.
- documentation explicitly presented to customers.

Copy must use evidenced V1 capability. “Universal Reality Intelligence Platform” is not an acceptable shipped-capability claim under the current freeze.

### Domain/runtime: controlled rename

- Display name: `Scholar` → `Sherivs Scholar`.
- Runtime ID `runtime:scholar` remains stable.
- Source namespace `lib/runtime/scholar`, database records, migrations, and contracts remain stable unless separately migrated.

### Technical compatibility: preserve

- npm package `coregrid-scholar` and `@coregrid/contracts`.
- `cg_*` database identifiers and historical migrations.
- environment variables, storage keys, notification tags, API contracts, and bundle IDs.
- architecture/progress/proof history.

Renaming these requires compatibility aliases, forward migration, rollback, and consumer inventory.

### Historical/governance: preserve

CoreGrid, Vibeora, and Universal School OS references in migration reports, ADRs, proofs, snapshots, audit trails, and historical documents are not rewritten. Add clarifying headers only when readers could mistake history for current brand.

### Legacy customer-facing debt

Visible Vibeora references remain in AI/admin copy. `universalschoolos.com` remains in canonical URLs, sitemap, images, and host logic. These are migration targets, not technical strings to ignore.

## Domain migration

Target public domain: `sherivs.com`.

Required coordinated change:

1. Verify DNS, TLS, email, canonical host, and tenant-host strategy.
2. Add host configuration and deployment environment.
3. Update canonical URLs, OpenGraph assets, sitemap, robots, manifest, and tenant resolver.
4. Install permanent redirects from verified legacy hosts.
5. Verify tenant subdomains and prevent cross-tenant canonical leakage.
6. Monitor crawl, errors, authentication callbacks, webhooks, and notification links.
7. Retain rollback to prior canonical host until evidence is stable.

## Mobile migration

Visible app name can change independently. Scheme, bundle/package identifiers, Expo owner, deep links, notification channels, and store records require a release migration; do not rename them from marketing code.

## Copy taxonomy

- **Sherivs:** company/platform experience.
- **Institutional Intelligence Infrastructure:** category statement.
- **Sherivs Scholar:** installed education runtime.
- **Jarvis:** verified executive intelligence interface, never generic assistant branding.
- **Sherivs AI Workforce:** governed worker system only where worker identity, authority, mission, evidence, and verification exist.

## Acceptance

No customer-facing CoreGrid/Vibeora/legacy-domain string remains unintentionally; no compatibility identifier changes accidentally; all claims map to evidence; redirects and callbacks work; search metadata is consistent; mobile and PWA display names are coherent; historical evidence remains intact.

# Sherivs Brand Migration

Status: Classified migration plan; no blind replacement authorized  
Version target: ACTIVE-V1 customer-facing brand migration

## Canonical names

- Customer platform: **SHERIVS**
- Public domain: **sherivs.com**
- Category: **Institutional Intelligence Infrastructure**
- Education runtime: **SHERIVS SCHOLAR**
- Executive intelligence: **JARVIS**
- Governed workers: **SHERIVS AI WORKFORCE**

## Classification

| Class | Examples | Treatment |
| --- | --- | --- |
| Customer-facing copy | titles, nav, auth copy, marketing, emails, PWA labels | migrate to Sherivs after claim/content review |
| Customer-facing URL/metadata | canonical URLs, OG images, sitemap, manifest, favicon | migrate with domain/deployment readiness |
| Runtime display name | “CoreGrid Scholar” | migrate to Sherivs Scholar |
| Technical identifiers | `@coregrid/contracts`, `cg_*`, env keys, internal IDs | preserve unless separately versioned |
| Database/migrations | migration filenames/comments, tables/functions | immutable/preserve |
| Historical governance/evidence | architecture records, proofs, reports, git history | preserve; add current naming note when needed |
| Source comments | architecture-bearing CoreGrid language | preserve until owning boundary is renamed |
| Test fixtures/snapshots | expected customer strings vs technical identifiers | update selectively |

## Current audit summary

Customer-facing CoreGrid remains in `frontend/src/lib/platform.ts`, root metadata/PWA labels,
`/(site)` marketing routes, `/` command centre metadata, auth copy, shell notifications/profile,
organization-public fallbacks, generated-site copy, and platform/operator surfaces. The old
`universalschoolos.com` domain appears in root OpenGraph/canonical metadata, sitemap, and tenant
host resolution; the referenced `og-image.png` is not present in `public/`. Technical CoreGrid is
widespread across packages, contracts, types, comments, architecture, tests, SQL migrations, and
`cg_*` database objects.

Current public copy also describes a “Universal Reality Intelligence Platform,” a “51-phase
governed platform,” and broad capability availability even though V3 is frozen and many registry
capabilities are architecture-defined rather than deployed. These are claim-review items, not
approved Sherivs copy.

Scholar assumptions are widespread in route namespaces (`/admin`, `/teacher`, `/parent`,
`/student`, `/bursar`, `/driver`), organization-public components, `school` context, and role
resolution. Those are runtime boundaries, not simple brand strings.

## Migration sequence

1. Establish customer-facing Sherivs constants and asset provenance.
2. Replace public metadata, manifest display labels, public shell, auth shell, and email-facing
   copy where capability claims are verified.
3. Rename runtime display copy to Sherivs Scholar without changing `runtime:scholar` identifiers.
4. Introduce explicit organization-neutral shell vocabulary while preserving runtime labels inside
   Scholar contributions.
5. Move canonical URLs only when `sherivs.com` routing, redirects, certificates, sitemap, robots,
   social images, and analytics are ready.
6. Complete public legal navigation, including real privacy, terms, cookies, and accessibility
   destinations; labels without working routes are not sufficient.
7. Update tests by classification; technical compatibility expectations remain CoreGrid.
8. Measure old-name references and maintain an allowlist with owner/reason.
9. Remove compatibility aliases only through a separate semver/migration decision.

## Safety rules

- Never edit applied migration files.
- Never rename `cg_*` objects, package names, environment variables, or runtime IDs as a branding
  side effect.
- Never rewrite historical evidence.
- Never create a Sherivs social account URL, customer logo, claim, certification, or domain
  ownership assertion without evidence.
- Preserve redirects and canonical behavior; avoid duplicate indexed content.
- Public and organization brands remain distinct: Sherivs chrome must not impersonate a customer,
  and customer theming must not obscure Sherivs security controls.

## Acceptance

- No customer-facing CoreGrid reference remains outside an approved compatibility notice.
- Every remaining reference is classified with owner and removal/retention rationale.
- Auth never defaults to Scholar.
- Organization-public surfaces are neutral until Scholar contributions are resolved.
- Metadata and PWA install labels use Sherivs only after real assets and deployment are available.
- Technical identifiers and historical evidence remain compatible.

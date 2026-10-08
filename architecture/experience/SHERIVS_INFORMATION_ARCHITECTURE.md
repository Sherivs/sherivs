# Sherivs Information Architecture

## Public IA (LIVE)

```
Home
Platform
  Reality · Memory · Intelligence · AI workforce · Missions · Governance · Integrations
Solutions
  For organizations · Sherivs Scholar
Security
Pricing
Resources (empty state until content is published)
Status
Legal: Accessibility
```

Header shows Platform (popover), Solutions, Security, Pricing, Resources, Sign in. Footer groups: Platform, Solutions, Trust, Resources, Legal. All derived from `PUBLIC_ROUTES` LIVE entries.

## Universal organization workspace IA (target; `UNIVERSAL_WORKSPACE_DESTINATIONS`)

Overview, Reality, People, Teams, Work, Missions, Knowledge, Memory, Communications, Calendar, Tasks, Files, Data, Reports, Automation, AI Workforce, Integrations, Analytics, Governance, Settings.

Rules:

* A destination renders only if (a) `availability` is `available`, (b) every required capability is held, (c) the owning runtime is active for the tenant. Scholar-only destinations appear only when the Scholar runtime is installed.
* Today, `available` entries are Overview (`/command-centre`), Reality (`/runtime`), Communications (`/messages`), Settings (`/settings`). All others are `planned` and never render.

## Internal IA (Sherivs operators; separate boundary)

Architecture (`/super-admin/architecture`), Organization (`/super-admin/organization`), existing `hq` and command-centre operator tools. Not part of the universal catalog.

## Content IA

Kinds: see `SHERIVS_CONTENT_ARCHITECTURE.md`. Access levels: `public`, `authenticated`, `organization`, `internal`.

## Naming

* "Sherivs Scholar" is the education runtime name; copy elsewhere says "education runtime" rather than describing the platform as a Scholar product (enforced by `platform-neutrality.test.ts`).
* "Mission", "evidence", "verification", "authority" are used in their platform meaning consistently.

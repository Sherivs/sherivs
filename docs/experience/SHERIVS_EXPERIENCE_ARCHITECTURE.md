# Sherivs Experience Architecture

Version target: **V1 organizational envelope**. Device fleets and Reality Intelligence products stay frozen. This document describes the experience system that sits on the existing platform. It does not rename the technical substrate.

## Brand boundary

| Name | Role | Treatment |
| --- | --- | --- |
| Sherivs | Customer-facing platform | UI, titles, public site, mobile display name |
| CoreGrid | Technical substrate | Packages, database, migrations, cache keys, type names, architecture comments |
| Scholar | Installed education runtime | Runtime layer only. Not the platform identity |
| Jarvis | Executive intelligence contracts | Preserved. No public chat surface |

Canonical origin: `https://sherivs.com`.

The customer-facing constants live in `frontend/src/lib/platform.ts`. Classification rules live in `frontend/src/lib/sherivs/brand.ts`.

## Planes

```
Sherivs
  Experience system
    Public          Sherivs website, organization public sites
    Application     Universal shell for authenticated work
    Runtime         Installed domain runtime (Scholar today)
  Experience services
    Identity, account, calendar, settings, communication
    Context, memory, notifications, evidence, governance
    Search, AI, missions, workforce, data
  Design system
    Tokens, components, motion, accessibility, responsive behavior, themes
  Reality model
    Verified records, separate from derived intelligence
```

An experience configuration is validated before it can describe a plane. Organization planes require a tenant. The internal plane rejects a customer tenant. The application plane requires an actor. See `frontend/src/lib/sherivs/experience-contract.ts`.

## Shells

| Shell | What it is | Where it lives now |
| --- | --- | --- |
| Public | Sherivs website chrome | `components/sherivs/public-shell.tsx`, route group `(site)`, and `/` when no tenant is resolved |
| Organization public | A customer's public site | `components/public/`. Education sections render only when `runtime:scholar` is installed |
| Application | Header, sidebar, mobile nav, command palette | `routes/_authenticated/route.tsx` |
| Organization workspace | Capability-filtered navigation inside the application shell | Installed runtime contribution catalog. Target capability list is data, not a second sidebar |
| Internal | Sherivs company workspace | Generated projection at `/platform/org`, `noindex`. Operator provisioning at `/command-centre/provision`, super-admin only |
| Runtime | Education-specific routes | `/admin`, `/teacher`, `/parent`, `/student`, `/bursar`, `/driver`, and related portals |

The application shell is not an organization. The wordmark reads Sherivs. The organization name is separate.

## Authentication

Sign-in, sign-up, and password reset are `/auth` and `/reset-password`. `/login` redirects to `/auth`. After authentication, the actor is sent to the workspace their membership grants. The default is not an education route unless that membership's home is an education route.

Magic link, passkey, MFA, and SSO are not offered. The account map says so.

## What `/` is

On a platform host with no tenant, `/` is the Sherivs narrative. It is not the operator console. Organization provisioning moved to `/command-centre/provision` behind the super-admin guard.

A resolved tenant still renders that organization's public site.

## Routes, navigation, content

See the companion documents in this directory. Public links are limited to routes that exist. Empty publishing shelves say they are empty.

## Security boundaries

- The interface is not authorization. Command actions and navigation do not bypass policy.
- Client-supplied tenant ids and roles are not trusted.
- The internal workspace is not linked from the public navigation.
- `/platform/org` remains publicly reachable as a generated structural projection and is marked `noindex`. Authenticating that route is remaining work; deleting it would break the audited projection tests.
- Legal routes state that they are not legal instruments. No contract text was invented.

## State, errors, loading, offline

| Concern | Behavior |
| --- | --- |
| Loading | Public `/` shows a loading state until the session check settles, then the narrative, a tenant site, or a workspace redirect |
| Empty | Publishing shelves, careers, and unmatched documentation search |
| Error | Status page if `/health.json` does not respond. Root error boundary remains |
| Offline | Existing service worker and offline banner. Push title is Sherivs |
| Unauthorized | Authenticated layout redirects to `/auth`. Unlinked accounts see an organization-neutral explanation |

## Version boundary

V1 organizational capability only. The public narrative states that device fleets and a broader reality-intelligence product are not in this release.

# Sherivs Experience Architecture

Version target: **V1 organizational capability envelope**.

Sherivs is the customer-facing brand. CoreGrid remains the technical kernel name for schemas, migrations, and internal contracts. This document describes the experience system that sits on that kernel. It does not reclassify frozen V2 (device/IoT) or V3 (reality intelligence) work as shipped.

## Planes

| Plane | Who it is for | Entry | Security boundary |
| --- | --- | --- | --- |
| Public | Visitors | `/` | No tenant data |
| Organization public | An organization's audience | `/` when a tenant is resolved | That tenant's published content |
| Application shell | Signed-in members | `/_authenticated` layout | Session + role guard. UI is not the control |
| Organization workspace | Members of one organization | Capability-filtered navigation | Tenant + capability. Backend re-checks |
| Internal workspace | Sherivs operators | `/super-admin`, `/command-centre`, `/operate` | `super_admin` on live ops. `/operate` is the provisioning console and is `noindex` |
| Runtime | Installed domain runtime | Education routes under the shell | Only when `runtime:scholar` is installed |
| Account | The signed-in person | `/settings`, `/auth` | Session |
| Mobile | Native client | `mobile/app` | Same identity, smaller IA |

The application shell is not an organization. It is chrome: header, sidebar, content, command surface. Runtime navigation is admitted from the installed-runtime registry (`frontend/src/lib/shell-nav.ts`).

## Experience formula

```
installed runtime
+ capabilities
+ authentication
+ plane
= visible navigation
```

Implemented in `resolveExperienceConfiguration`. A section with a `runtimeId` is withheld unless that runtime is installed. A section with a `requiredCapability` is withheld unless the caller holds it. Withholding is cosmetic. Server functions still authenticate, resolve tenant, authorize, validate, execute, audit, and return permitted data.

## Routes

Public pages that exist are listed in `frontend/src/lib/experience/public-pages.ts`. Each page carries an evidence note. Pages without a true statement — platform blog, case studies, careers, a contact form that stores nothing — are not registered.

The public host at `/` renders `SherivsPublicHome` when no tenant is in context. A resolved tenant still renders that organization's public site. A signed-in person on the platform host is sent to the workspace home of their role, which today comes from the only installed runtime's navigation catalog. That is not a hardcoded student destination.

Operator provisioning lives at `/operate`, not on the homepage.

## Shells

- **Public shell** — `SherivsFrame`: wordmark, primary nav, footer groups, skip target `#main-content`.
- **Organization public shell** — existing `PublicSchoolSite` composer. Education sections (admissions, programs) are runtime-gated in the experience configuration and, on the live school site, by the organization's section flags.
- **Application shell** — existing authenticated layout: sidebar from admitted contributions, workspace switcher, notifications, profile, offline banner, command palette, mobile bottom nav for parent and student portals.
- **Internal shell** — super-admin and command-centre role guards. `/platform/org` renders a generated department catalog, is not in customer navigation, and is `noindex`.

## Account, search, commands, AI

- Account entry is `/auth` (sign in, sign up, password reset) and `/settings` for a linked profile. MFA, passkeys, device inventory, and account deletion screens are not built.
- Search and the command palette already exist inside the authenticated shell and filter by role. New command admission is `admitCommands`: a missing capability is a denial, and a signed-out visitor sees none of the authenticated commands.
- AI inside the product is the existing assistant surfaces plus the workforce and mission contracts. Public copy names Jarvis as executive intelligence that stays inside the same authority model. It does not draw a chatbot panel on the marketing site.

## States

Public pages have a written empty case: resources says the blog does not exist; contact says there is no inbox; status points at `/health.json` and does not invent uptime. Authenticated loading, offline, unlinked-account, and not-found states already exist on the shell and root.

## What this architecture refuses

- Login does not mean "open the education product" as a brand statement. The account screen says the workspace follows organization and role.
- Customer navigation does not link the internal workspace.
- Glass, gradients, and cards are not the brand. The public site is a numbered narrative: reality, intelligence, action, evidence.

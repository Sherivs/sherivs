# Sherivs Experience Architecture

**Version-target:** V1 organizational envelope  
**Status:** Implementing (Wave 1 — constitution, brand, public plane, shells)  
**Authority:** Customer-facing experience. Kernel engineering name remains CoreGrid.

## Mission

Sherivs is institutional intelligence infrastructure. The experience system is one environment, not a pile of portals. CoreGrid is not the customer-facing brand.

## Experience planes

| Plane | Audience | Shell | Security boundary |
|---|---|---|---|
| Public Sherivs | Visitors | `PublicShell` | Unauthenticated, no tenant data |
| Organization public | An organization's public | Org public engine → Scholar adapter | Public org records only |
| Application shell | Authenticated members | `_authenticated` layout | Session required |
| Organization workspace | Tenant members | Capability-driven sidebar | Tenant + role + policy |
| Internal Sherivs | Super-admin / platform ops | Same shell, distinct identity chrome | `super_admin` RoleGuard + server gates |
| Domain runtime | Scholar (installed) | Runtime nav contributions | Runtime capabilities |
| Authentication | Anyone | Standalone `/auth` | Supabase session |
| Account | Signed-in identity | `/settings` | Self-only profile APIs |

The application shell is not an organization. Internal Sherivs is never listed in customer navigation.

## Route resolver at `/`

1. Tenant slug (`?school=` or subdomain) → organization public site  
2. Signed-in, no tenant → role workspace home (not a forced Scholar marketing page)  
3. Unsigned platform host → Sherivs public homepage  

Organization provisioning lives at `/provision`. It is not the public homepage.

## Shells

**Public shell:** brand lockup, platform/solutions/security/pricing/resources, sign-in, request access, enterprise footer, status, legal. No fabricated social profiles.

**Application shell:** Sherivs mark or tenant identity, workspace switcher, command palette, help, notifications, theme, profile, capability sidebar, mobile bottom nav where the runtime declares it.

**Internal shell:** same application shell with “Sherivs internal” identity when there is no tenant school. Super-admin routes remain a separate RBAC boundary.

## Global systems

| System | Current truth |
|---|---|
| Search / command | ⌘K palette; actions must not bypass policy |
| Notifications | Bell + `/notifications` |
| AI | Role assistants + Jarvis contracts; output untrusted |
| Missions / workforce | Super-admin worker missions + mobile mission surfaces |
| Account | Profile, password, privacy, appearance, accessibility |
| Time | User/org locale foundation (`en` shipped); no hardcoded TZ in new chrome |
| PWA | Dynamic manifest, SW `sherivs-app-shell-v1` |
| Status | `/status` reads `/health.json` |

## Frozen scope

V2 device/IoT and V3 Reality Intelligence remain frozen. Existing twin/geospatial admin routes are not expanded by this program.

## Contracts

Experience configuration is `ExperienceConfigurationSchema` in `frontend/src/lib/experience/experience-contract.ts`. Database rows do not become UI without authorization and schema validation.

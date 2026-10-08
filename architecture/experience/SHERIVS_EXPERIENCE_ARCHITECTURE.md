# Sherivs Experience Architecture

**Version-target:** ACTIVE-V1 (organizational capability envelope)  
**Status:** Implementing — architecture locked; surfaces land incrementally  
**Engineering kernel name (preserved):** CoreGrid  
**Customer-facing brand:** Sherivs  
**Canonical public domain:** sherivs.com

This document is the experience-plane constitution for Sherivs. It does not un-freeze V2 (device/IoT) or V3 (Reality Intelligence). Those remain inspectable architecture, not implementation.

---

## 1. Experience planes

```
SHERIVS
  └── EXPERIENCE SYSTEM
        ├── PUBLIC
        │     ├── Sherivs website          / and /(site)/*
        │     └── Organization public      /?school= or tenant host
        ├── APPLICATION SHELLS
        │     ├── Universal shell          /_authenticated
        │     ├── Organization workspace   capability-projected nav
        │     └── Internal Sherivs         /super-admin, /command-centre
        └── RUNTIME
              └── Scholar (installed)      education domain only
```

The application shell is not an organization. It is the universal authenticated chrome: header, sidebar, command, search, notifications, account.

Internal Sherivs is a **separate security boundary**. It is never linked from customer navigation.

---

## 2. Route groups

| Plane | Route group | Authority |
|---|---|---|
| Public Sherivs | `/`, `/(site)/*` | Platform marketing & disclosure |
| Auth | `/auth`, `/reset-password`, `/login` → `/auth` | Identity |
| Organization public | `/` when tenant resolved | Organization + runtime contributions |
| Authenticated shell | `/_authenticated/*` | Platform shell + runtime nav |
| Internal | `/super-admin/*`, `/command-centre` | Platform operators only |
| Compatibility alias | `/coregrid` → `/` | Brand migration |

Authentication **must not** resolve LOGIN → Scholar by default. Post-login home is the viewer's authorized workspace, which today is projected from the installed runtime's nav catalog because Scholar is the only installed runtime.

---

## 3. Shells

**Public shell** — brand, primary nav (Platform, Solutions, Security, Enterprise, Resources), request demo, sign in, enterprise footer, skip link consumption via `#main-content`.

**Organization public shell** — organization identity + sections composed by `composeOrganizationPublicExperience`. Scholar-only sections (admissions, programs, faculty, facilities, …) load only when `runtimeId === runtime:scholar`.

**Universal application shell** — logo/wordmark, workspace switcher (wired to the current tenant; multi-workspace switch remains contract-complete, data-incomplete), command palette, Jarvis access when the role has an intelligence surface, notifications, theme, profile, capability-driven sidebar, mobile bottom nav where the runtime declares it, offline banner.

**Internal shell** — same chrome, super-admin nav contributions, not listed on the public site.

---

## 4. Global systems

| System | Behavior | Honesty |
|---|---|---|
| Search / command | ⌘K palette; role-filtered destinations | Command UI cannot grant extra authority |
| Notifications | Bell + `/notifications` | Push requires user grant |
| Jarvis | Header link to the authorized assistant route | Hidden when the session has no AI surface |
| Account | `/settings` profile, appearance, password, AI opt-out | MFA/SSO UI is not fabricated |
| Calendar / time | Role calendar routes + timezone-aware primitives | No single hardcoded institution timezone in new surfaces |
| Missions / workforce | Super-admin launch + mobile read path + contracts | No fake live worker activity on marketing |
| Status | `/status` reads `/health.json` | No invented uptime % |

---

## 5. Security boundaries

1. Tenant context on every request.  
2. RLS for tenant-sensitive data.  
3. Server functions: authenticate → tenant → authorize → validate → execute → audit.  
4. Command palette and hidden routes are not authorization.  
5. Internal Sherivs is not a customer nav item.  
6. AI output is untrusted; the UI must not imply processing when the backend is idle.

---

## 6. Experience configuration contract

```
Organization reality
+ installed runtime
+ capabilities
+ role
+ permissions
+ context
+ theme
+ content
= experience configuration
```

The frontend consumes governed contracts (`experience-core`, `experience-platform`, `workspace-experience`, `sherivs-public-ia`, `organization-public`). Arbitrary database rows do not become UI without schema validation and authorization.

---

## 7. What this program does **not** claim

- Careers, case studies, platform blog posts, or social profiles that do not exist.  
- V2 device/IoT experience.  
- V3 physical digital-twin / planetary intelligence experience.  
- MFA, passkeys, or SSO screens without a working backend.  
- Multi-organization switcher completion beyond the current single-tenant option list.

See `SHERIVS_EXPERIENCE_STATUS.md` for surface-by-surface evidence.

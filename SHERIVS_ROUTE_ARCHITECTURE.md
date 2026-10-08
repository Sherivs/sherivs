# SHERIVS ROUTE ARCHITECTURE (SRA-v1.0)
**System:** Complete URI & Navigation Architecture  
**Router:** TanStack Router / TanStack Start  
**Status:** Canonical Routing Specification  

---

## 1. Route Topology & Pathing Principles

Sherivs uses a strictly governed, hierarchical routing structure designed to separate public presentation, tenant operations, internal platform stewardship, and vertical runtimes:

```
/ (Root)
│
├── Public Platform Surfaces (Plane A)
│   ├── /platform
│   │   ├── /reality
│   │   ├── /memory
│   │   ├── /ai-workforce
│   │   ├── /missions
│   │   ├── /intelligence
│   │   ├── /governance
│   │   └── /integrations
│   ├── /solutions
│   │   ├── /organizations
│   │   ├── /enterprise
│   │   ├── /education
│   │   ├── /operations
│   │   └── /ai-workforce
│   ├── /security
│   │   └── /enterprise
│   ├── /pricing
│   ├── /resources
│   │   ├── /blog & /blog/$slug
│   │   ├── /docs & /docs/$slug
│   │   ├── /guides & /guides/$slug
│   │   ├── /case-studies & /case-studies/$slug
│   │   └── /changelog & /changelog/$slug
│   ├── /about
│   ├── /company
│   ├── /careers
│   ├── /contact
│   ├── /request-demo
│   ├── /legal
│   │   ├── /privacy
│   │   ├── /terms
│   │   ├── /cookies
│   │   └── /accessibility
│   └── /status
│
├── Authentication & Onboarding (Plane E / L)
│   ├── /auth (Sign In, Sign Up, Magic Link, Passkey)
│   ├── /reset-password
│   └── /super-admin-bootstrap
│
├── Authenticated Application Shell (/_authenticated)
│   │
│   ├── Universal Organization Workspace (Plane D)
│   │   ├── /_authenticated/overview
│   │   ├── /_authenticated/reality
│   │   ├── /_authenticated/missions
│   │   ├── /_authenticated/workforce
│   │   ├── /_authenticated/memory
│   │   ├── /_authenticated/calendar
│   │   ├── /_authenticated/messages
│   │   ├── /_authenticated/notifications
│   │   └── /_authenticated/settings
│   │
│   ├── Sherivs Internal Headquarters (Plane C)
│   │   ├── /_authenticated/super-admin/dashboard
│   │   ├── /_authenticated/super-admin/tenants
│   │   ├── /_authenticated/super-admin/worker-missions
│   │   ├── /_authenticated/super-admin/agent-governance
│   │   ├── /_authenticated/super-admin/trust-fabric
│   │   ├── /_authenticated/super-admin/runtime-contracts
│   │   ├── /_authenticated/super-admin/communication-steward
│   │   └── /_authenticated/super-admin/platform-config
│   │
│   └── Installed Domain Runtime: Sherivs Scholar (Plane F)
│       ├── /_authenticated/admin/* (50+ school governance surfaces)
│       ├── /_authenticated/teacher/* (Gradebook, attendance, lesson plans)
│       ├── /_authenticated/student/* (Grades, AI tutor, timetable)
│       ├── /_authenticated/parent/* (Child tracking, bus, fee payments)
│       ├── /_authenticated/bursar/* (Reconciliation, receipts, audit)
│       └── /_authenticated/driver/* (Route tracking, student transit)
│
└── System & API Handlers
    ├── /health.json
    ├── /sitemap.xml
    ├── /manifest.webmanifest
    └── /api/public/*
```

---

## 2. Route Protection & Resolution Matrix

| Route Group | Context Requirement | Authorization Gate | Redirection on Failure |
|---|---|---|---|
| Public Marketing (`/(site)/*`, `/platform/*`) | None (Public) | None | N/A |
| Organization Public Site (`/?school=[slug]`) | Tenant Slug Valid | Active Organization | 404 Institutional Site Not Found |
| Authentication (`/auth`) | Anonymous or Authenticated | None | If signed in, redirects to viewer's assigned workspace |
| Universal Workspace (`/_authenticated/*`) | Authenticated Session | Tenant Member Profile | Redirects to `/auth` |
| Platform HQ (`/_authenticated/super-admin/*`) | Authenticated Session | `super_admins` Table Check | 403 Forbidden Security Wall |
| Scholar Runtime (`/_authenticated/[role]/*`) | Authenticated Session | Scholar Role Granted | Redirects to tenant overview |

---

## 3. Dynamic Deep Linking & State Preservation

- All filter parameters, search queries, pagination offsets, and tab selections in the workspace are reflected in the URL query string (e.g., `?view=table&page=2&status=active&search=alpha`).
- Deep links preserve operational state across page reloads and team sharing without leaking confidential data across tenant boundaries.

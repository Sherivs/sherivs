# SHERIVS EXPERIENCE ARCHITECTURE (SEA-v1.0)
**System:** Sherivs — Institutional Intelligence Infrastructure  
**Canonical Domain:** `sherivs.com`  
**Classification:** Core Experience & Interaction Architecture  
**Status:** Canonical Reference Specification  

---

## 1. Executive Summary & Philosophy

Sherivs is an **Institutional Intelligence Infrastructure**. It is not an admin dashboard, a school-management utility, an AI wrapper, or a collection of SaaS templates. It is a unified, multi-plane technological environment where human leaders, organizational reality, digital twins, and governed AI workforces operate with continuous evidence, verifiable trust, and mathematical precision.

The design benchmark is **institutional-grade technology** — an elite, coherent experience engineered to handle high-stakes governance, multi-tenant institutional operations, real-time command, and autonomous mission orchestration.

```
                             SHERIVS
                                │
                       EXPERIENCE SYSTEM
                                │
       ┌────────────────────────┼─────────────────────────┐
       │                        │                         │
     PUBLIC                APPLICATION                RUNTIME
       │                     SHELLS                      │
       │                        │                         │
       │          ┌─────────────┼─────────────┐           │
       │          │             │             │           │
   Sherivs       Universal   Organization   Internal   Scholar
   Website        Shell       Workspace      Sherivs    Runtime
       │          │             │             │           │
       │          │             │             │           │
       └──────────┴─────────────┴─────────────┴───────────┘
                                │
                        EXPERIENCE SERVICES
                                │
             ┌──────────────────┼──────────────────┐
             │                  │                  │
          Identity           Context            Search
          Account            Memory             AI
          Calendar           Notifications      Missions
          Settings           Evidence           Workforce
          Communication      Governance          Data
             │                  │                  │
             └──────────────────┼──────────────────┘
                                │
                         DESIGN SYSTEM
                                │
            Tokens • Components • Patterns • Motion
            Accessibility • Responsive • Themes
                                │
                           REALITY MODEL
                                │
                          SHERIVS PLATFORM
```

---

## 2. The Twelve Experience Planes

Sherivs organizes every digital touchpoint across twelve distinct but interconnected experience planes:

### Plane A: Sherivs Public Experience (`sherivs.com`)
- **Audience:** Global institutions, enterprise executives, sovereign entities, system architects, press, and developers.
- **Tone:** Authoritative, calm, visionary, technologically sophisticated.
- **Key Routes:** `/`, `/platform/*`, `/solutions/*`, `/security`, `/enterprise`, `/pricing`, `/resources/*`, `/about`, `/contact`, `/status`.
- **Purpose:** Articulate the new category of Institutional Intelligence Infrastructure, explain organizational reality models, demonstrate governed AI workforces, and convert qualified institutions.

### Plane B: Organization Public Experience Engine (`[tenant].sherivs.com` or custom domain)
- **Audience:** External stakeholders of a specific customer institution (clients, citizens, parents, partners, visitors).
- **Tone:** Institution-branded, trustworthy, informative, accessible.
- **Engine:** Domain-neutral presentation engine that dynamically renders organizational identity, leadership, programs, facilities, directory, news, calendar, and public interaction forms without hardcoding vertical assumptions.
- **Runtime Injection:** If the institution runs **Sherivs Scholar**, vertical capabilities (admissions, academic calendars, curriculum overviews) load dynamically via runtime adapters.

### Plane C: Sherivs Workspace (Internal Headquarters)
- **Audience:** Sherivs executive leadership, mission directors, platform engineers, and AI safety stewards.
- **Tone:** Sovereign command center, telemetry-rich, high-density, real-time.
- **Security Boundary:** Isolated by `super_admin` definer checks and multi-factor hardware keys. Customer tenants have zero route or data access to this plane.
- **Surfaces:** Executive overview, Jarvis central interface, Planetary fleet monitoring, mission dispatch, tenant provisioning, trust fabric analysis, and incident escalation.

### Plane D: Organization Workspace (Universal Tenant Operating System)
- **Audience:** Institutional executives, team leaders, and staff across any industry.
- **Tone:** Focused, calm, capability-driven, highly productive.
- **Capabilities:** Reality explorer, workforce orchestration, missions, memory currency, communications, universal calendar, file repository, audit feeds, and organization settings.
- **Principle:** Zero clutter. Navigation and surfaces are dynamically generated based on granted capabilities and active runtime licenses.

### Plane E: Universal Sherivs Application Shell
- **Role:** The foundational viewport substrate shared across all authenticated surfaces.
- **Anatomy:**
  - **Global Header:** Sherivs symbol, organization switcher, workspace switcher, global search trigger (`Cmd+K`), Jarvis executive access trigger, notification center, system health pill, and authenticated profile anchor.
  - **Contextual Sidebar:** Capability-derived hierarchy, collapsible modes, pinned shortcuts, recent entities, and tenant branding accents.
  - **Canvas / Content Area:** Layered spatial depth, standard breadcrumbs, contextual page action header, filter rails, responsive content grids, and slide-over inspectors.
  - **Universal Command & Notification Layers:** Cross-plane quick launcher, keyboard-first navigation, and real-time operational notifications.

### Plane F: Domain Runtime Experience (e.g., Sherivs Scholar)
- **Role:** Vertical-specific workflows installed atop the universal kernel.
- **Architecture:** Consumes universal primitives (`cg_entity`, `cg_relationship`, `cg_event`, `cg_observation`) while presenting domain-specific vocabulary and interfaces (e.g., Gradebooks, Timetables, Bursar reconciliation, Biometrics, Report Cards).
- **Independence:** The universal shell functions identically whether one, ten, or zero runtimes are installed.

### Plane G: Mobile Experience
- **Role:** Native-first mobile interaction layer designed specifically for touch viewports (360px–430px).
- **Anatomy:** Ergonomic thumb-zone bottom navigation, swipe-to-reveal contextual drawers, high-contrast touch targets (minimum 44x44px), compact data cards, and gesture-driven filters.
- **Sync:** Seamless integration with the mobile offline queue and server-function contracts.

### Plane H: Progressive Web Application (PWA) Experience
- **Role:** Desktop and mobile standalone installable client.
- **Features:** Web manifest (`/manifest.webmanifest`), offline service worker caching, background synchronization, push notification subscription (`refreshPushTokenIfGranted`), and biometric authentication triggers.

### Plane I: Embedded & Contextual Experience
- **Role:** Slide-over panels, inline intelligence popovers, and contextual inspectors that appear directly within operational workflows.
- **Examples:** Evidence verification drawer, identity provenance popover, mission audit timeline, and live confidence score badges.

### Plane J: AI & Conversational Experience (Jarvis & Worker Interfaces)
- **Role:** The conversational, advisory, and execution interface for **Jarvis** and **Sherivs AI Workforce**.
- **Visual Categorization:** Visual distinction of AI outputs into:
  1. *Observation:* Grounded reality facts from the database.
  2. *Inference:* Derived statistical or semantic deductions.
  3. *Recommendation:* Proposed organizational actions.
  4. *Action:* Explicit system mutations awaiting or executing under policy approval.
  5. *Evidence:* Cryptographic hash, database timestamp, and source actor binding.
  6. *Verification:* Independent dual-control verification proof.

### Plane K: Developer & API Experience
- **Role:** Institutional engineering interface.
- **Surfaces:** API reference, OpenAPI schemas, webhook subscriptions, API key lifecycle management, rate-limiting telemetry, and sandbox testing harness.

### Plane L: System & Operational Experience
- **Role:** Resiliency and platform posture surfaces.
- **Surfaces:** Public status page (`/status`), incident communication feeds, offline connection banner, maintenance state screen, unauthorized/forbidden boundary walls, and session timeout handlers.

---

## 3. Spatial Design, Surfaces & Layering

Sherivs abandons flat card-soup layouts in favor of an **Elevation & Depth Hierarchy**:

| Layer | Semantic Role | Background Token | Border Token | Usage |
|---|---|---|---|---|
| **Base Surface (L0)** | Institutional Void / Foundation | `--surface-1` (`#07090e`) | None | Viewport canvas, background radial atmosphere |
| **Recessed Surface (L-1)**| Data Wells & Code Blocks | `--surface-0` (`#030508`) | `rgba(255,255,255,0.04)` | Terminals, JSON inspectors, audit logs |
| **Structural Surface (L1)**| Nav, Sidebar, Page Headers | `--surface-2` (`#0c1019`) | `rgba(255,255,255,0.06)` | Application shell headers, persistent sidebars |
| **Elevated Surface (L2)**| Content Panels & Workstations | `--surface-3` (`#111726`) | `rgba(255,255,255,0.08)` | Primary content cards, data tables, metrics |
| **Interactive Surface (L3)**| Modals, Drawers, Sheets | `--surface-4` (`#182033`) | `rgba(255,255,255,0.12)` | Slide-out drawers, dialogs, command palette |
| **Floating Surface (L4)** | Tooltips, Popovers, Menus | `--surface-5` (`#1f2a42`) | `rgba(255,255,255,0.16)` | Popovers, active dropdowns, context menus |

---

## 4. Proprietary Visual Language

1. **Color Geometry:**
   - **Deep Neutral Foundation:** Deep space ink (`#07090e` through `#182033`), avoiding muddy grays or harsh pure blacks.
   - **Luminous Intelligent Accents:**
     - *Sherivs Cyan (`#00f0ff` / `#0ea5e9`):* Platform intelligence, active focus, primary interaction.
     - *Verification Emerald (`#10b981`):* Provenance verified, cryptographic match, healthy lease.
     - *Escalation Amber (`#f59e0b`):* Requires human approval, lease expiring, threshold alert.
     - *Security Rose (`#f43f5e`):* Policy denial, boundary breach, revoked token.
     - *Cognitive Violet (`#8b5cf6`):* Jarvis reasoning stream, memory currency indexing.
2. **Typography:**
   - **Display & Headlines:** *Plus Jakarta Sans* / *Space Grotesk* — engineered for geometric clarity, institutional weight, and legibility.
   - **Body & Interface:** *Inter* — optimized for high-density UI, variable weight clarity, and tabular data.
   - **Code & Telemetry:** *JetBrains Mono* / *Fira Code* — fixed-width tabular numbers, zero ambiguous characters (`0` vs `O`, `1` vs `l`).
3. **Restrained Translucency:**
   - Glassmorphism is used exclusively to reinforce spatial layering (sticky headers, slide-over modals, command palette backdrop).
   - Strict rule: Glass is never decorative. Background content behind glass must remain readable, and blur filters are disabled if `prefers-reduced-motion` is active.

---

## 5. Security & Isolation Boundaries

In strict compliance with **the engineering constitution §13–§17**:
1. **Tenant Isolation:** Every data request and RPC must carry explicit tenant context derived from the actor's session. Client-supplied tenant IDs are untrusted.
2. **Layered Authorization:** All mutations pass through RBAC + ABAC + PBAC + RLS. The UI is never the security boundary.
3. **AI Sovereignty:** AI models and agents never possess independent authority to bypass security invariants, modify database schemas, or claim higher credentials.
4. **Independent Verification:** The actor who proposes or executes a mission cannot verify that same mission (enforced by `checkVerificationIndependence`).

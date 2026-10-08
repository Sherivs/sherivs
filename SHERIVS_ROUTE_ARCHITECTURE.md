# SHERIVS ROUTE ARCHITECTURE
## Complete URL Taxonomy, Routing Hierarchies & Surface Navigation Map
**Document Identifier:** SRA-2026-V1  
**Product Category:** Institutional Intelligence Infrastructure  
**Routing Framework:** TanStack Router & TanStack Start  

---

## 1. Global Route Map

Sherivs routes are organized into four primary zones:
1. **Public Marketing & Platform Surfaces:** Root domain `sherivs.com/`
2. **Organization Public Engine:** Subdomain or slug-scoped `[org].sherivs.com/` or `/?school=[slug]`
3. **Authentication & Session Gates:** `/auth`, `/login`, `/reset-password`
4. **Universal Authenticated Application Shell:** `/_authenticated/*`

---

## 2. Public Platform Routes (`sherivs.com`)

| URL Route | File Path | Purpose & Surface | Access Level |
| :--- | :--- | :--- | :--- |
| `/` | `frontend/src/routes/index.tsx` | Sherivs Public Homepage (12-stage narrative) or Tenant Engine | Public |
| `/platform` | `frontend/src/routes/platform.tsx` | Platform Architecture & 51-Phase Kernel Capabilities | Public |
| `/platform/reality` | `frontend/src/routes/platform.reality.tsx` | Organizational Reality Model & Digital Twin Substrate | Public |
| `/platform/memory` | `frontend/src/routes/platform.memory.tsx` | Institutional Memory, Knowledge Graph & Provenance | Public |
| `/platform/ai-workforce`| `frontend/src/routes/platform.ai-workforce.tsx`| Governed AI Workforce, Worker Leases & Supervision | Public |
| `/platform/missions`| `frontend/src/routes/platform.missions.tsx` | Mission Model: Planning, Execution & Outcomes | Public |
| `/platform/intelligence`| `frontend/src/routes/platform.intelligence.tsx`| Cognitive Processing, Jarvis & Contextual Insight | Public |
| `/platform/governance`| `frontend/src/routes/platform.governance.tsx` | Zero Trust Defense, RLS, Authorization & Security | Public |
| `/platform/integrations`| `frontend/src/routes/platform.integrations.tsx`| Enterprise Adapters, Legacy ERP Bridges & Webhooks | Public |
| `/solutions` | `frontend/src/routes/solutions.tsx` | Solutions Index & Industry Architecture Overview | Public |
| `/solutions/organizations`| `frontend/src/routes/solutions.organizations.tsx`| Large Institutional & Conglomerate Operating Systems | Public |
| `/solutions/enterprise`| `frontend/src/routes/solutions.enterprise.tsx`| Global Enterprise & Holding Infrastructure | Public |
| `/solutions/education`| `frontend/src/routes/solutions.education.tsx`| Educational Runtime (Sherivs Scholar Showcase) | Public |
| `/solutions/operations`| `frontend/src/routes/solutions.operations.tsx`| Operational Command, Logistics & Resource Dispatch | Public |
| `/solutions/ai-workforce`| `frontend/src/routes/solutions.ai-workforce.tsx`| Autonomous & Hybrid Human-AI Teams | Public |
| `/security` | `frontend/src/routes/security.tsx` | Trust Fabric, Cryptographic Evidence & Compliance | Public |
| `/enterprise` | `frontend/src/routes/enterprise.tsx` | Enterprise Tier, Dedicated VPCs, BYOC & SLAs | Public |
| `/pricing` | `frontend/src/routes/pricing.tsx` | Transparent Commercial Tiers & Capacity Calculator | Public |
| `/resources` | `frontend/src/routes/resources.tsx` | Knowledge Hub, Publications & Documentation Directory | Public |
| `/resources/blog` | `frontend/src/routes/resources.blog.tsx` | Institutional Research & Architecture Journal | Public |
| `/resources/blog/$slug`| `frontend/src/routes/resources.blog.$slug.tsx`| In-depth Research Paper / Product Editorial | Public |
| `/resources/docs` | `frontend/src/routes/resources.docs.tsx` | Developer & Systems Documentation Index | Public |
| `/resources/docs/$slug`| `frontend/src/routes/resources.docs.$slug.tsx`| Specific Documentation Guide / Architecture Note | Public |
| `/resources/guides` | `frontend/src/routes/resources.guides.tsx` | Step-by-Step Implementation & Migration Playbooks | Public |
| `/resources/guides/$slug`| `frontend/src/routes/resources.guides.$slug.tsx`| Specific Implementation Guide | Public |
| `/resources/case-studies`| `frontend/src/routes/resources.case-studies.tsx`| Real Institutional Transformations & Deployments | Public |
| `/resources/case-studies/$slug`| `frontend/src/routes/resources.case-studies.$slug.tsx`| Detailed Case Study Report | Public |
| `/resources/changelog`| `frontend/src/routes/resources.changelog.tsx`| Platform Releases, Substrate Migrations & Audit Logs | Public |
| `/about` | `frontend/src/routes/about.tsx` | Sherivs Mission, Leadership & Engineering Culture | Public |
| `/company` | `frontend/src/routes/company.tsx` | Corporate Entity, Global Offices & Investor Governance | Public |
| `/careers` | `frontend/src/routes/careers.tsx` | Open Positions in Architecture, Systems & AI Systems | Public |
| `/contact` | `frontend/src/routes/contact.tsx` | Institutional Briefing & Direct Inquiries | Public |
| `/request-demo` | `frontend/src/routes/request-demo.tsx` | Tailored Architecture Walkthrough Request | Public |
| `/status` | `frontend/src/routes/status.tsx` | Real-time Platform Health, Incident Reports & Uptime | Public |
| `/legal/privacy` | `frontend/src/routes/legal.privacy.tsx` | Privacy Policy & Data Sovereignty Guarantee | Public |
| `/legal/terms` | `frontend/src/routes/legal.terms.tsx` | Master Services Agreement & Terms of Service | Public |
| `/legal/cookies` | `frontend/src/routes/legal.cookies.tsx` | Cookie Preferences & Local Storage Policy | Public |
| `/legal/accessibility`| `frontend/src/routes/legal.accessibility.tsx`| WCAG 2.2 AA Compliance Statement & Accommodations | Public |

---

## 3. Organization Public Experience Engine

When visiting on a customer tenant domain (e.g. `meridian.sherivs.com`) or via `?school=[slug]`, the engine renders dynamic sections:
- `/` — Organization Landing Page (Identity, Hero, Leadership, Programs, Facilities)
- `/about` — Detailed Institutional History, Accreditation & Leadership
- `/programs` / `/programs/$id` — Academic or Operational Program Catalog
- `/events` / `/events/$id` — Public Institutional Calendar & Event RSVP
- `/news` / `/news/$id` — Official Press Releases & Announcements
- `/admissions` — Public Admissions Intake & Inquiry Form (Scholar Runtime active)
- `/contact` — Campus Maps, Department Phone Directory & Direct Inquiry

---

## 4. Authentication & Identity Routes

| URL Route | File Path | Invariant & Flow |
| :--- | :--- | :--- |
| `/auth` | `frontend/src/routes/auth.tsx` | Primary context-resolving sign-in / sign-up / forgot password |
| `/login` | `frontend/src/routes/login.tsx` | Dedicated direct sign-in surface with tenant awareness |
| `/reset-password`| `frontend/src/routes/reset-password.tsx` | Cryptographically signed token recovery form |

---

## 5. Universal Authenticated Application Shell (`/_authenticated/*`)

### Universal Organization Workspace Routes
Accessible to authorized members based on capability grants:
- `/_authenticated/overview` — Executive summary, active alerts, operational cadence.
- `/_authenticated/reality` — Canonical reality explorer (people, spaces, assets, events).
- `/_authenticated/people` — Directory of members, staff, students, contacts.
- `/_authenticated/teams` — Operational divisions, committees, faculties.
- `/_authenticated/work` — Active task queues, operational workflows.
- `/_authenticated/missions` — Governed AI & human missions, planning, execution.
- `/_authenticated/knowledge` — Verified institutional documents, procedures, curriculum.
- `/_authenticated/memory` — Contextual history, audit trails, event lineage.
- `/_authenticated/communications` — Secure channels, announcements, message center.
- `/_authenticated/calendar` — Temporal planning, schedule conflict detection.
- `/_authenticated/tasks` — Action items with SLA tracking and delegations.
- `/_authenticated/files` — Governed document storage with zero-trust access control.
- `/_authenticated/data` — Institutional query interface, analytics extracts.
- `/_authenticated/reports` — Statutory, academic, operational, and financial reports.
- `/_authenticated/automation` — Configured workflows, event triggers, webhook actions.
- `/_authenticated/ai-workforce` — Governed worker profiles, lease status, capability matching.
- `/_authenticated/integrations` — ERP connectors, payment gateways, messaging relays.
- `/_authenticated/analytics` — Statistical distributions, trends, capacity planning.
- `/_authenticated/governance` — Policy inspection, RLS rules, permission auditor.
- `/_authenticated/settings` — Organization preferences, branding, domain binding.

### Personal Account Routes
- `/_authenticated/settings/profile` — Name, contact information, personal avatar.
- `/_authenticated/settings/preferences` — Timezone, date/time format, language, regional currency.
- `/_authenticated/settings/appearance` — Light, dark, system, high contrast mode.
- `/_authenticated/settings/accessibility` — Screen reader hints, reduced motion, font scaling.
- `/_authenticated/settings/security` — Password change, MFA authenticators, session list.
- `/_authenticated/settings/sessions` — Active devices, remote logout, login history.
- `/_authenticated/settings/notifications` — Granular channel preferences (in-app, push, email).

### Sherivs Internal Workspace Routes (Platform Staff Only)
Protected by platform super-admin server-side gate:
- `/_authenticated/super-admin/dashboard` — Platform overview, tenant metrics.
- `/_authenticated/super-admin/tenants` — Tenant provisioning, quotas, suspensions.
- `/_authenticated/super-admin/worker-missions` — Operational worker mission launcher.
- `/_authenticated/super-admin/agent-governance` — AI agent state machine & policy validator.
- `/_authenticated/super-admin/trust-fabric` — Cryptographic trust assertions & key rotation.
- `/_authenticated/super-admin/runtime-contracts` — 51-phase contract verification status.
- `/_authenticated/super-admin/platform-config` — System flags, egress allowlists, model registry.

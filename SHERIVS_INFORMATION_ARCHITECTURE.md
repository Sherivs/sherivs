# SHERIVS INFORMATION ARCHITECTURE
## Structural Hierarchies, Ontologies, Navigation Models & Progressive Disclosure
**Document Identifier:** SIA-2026-V1  
**Product Category:** Institutional Intelligence Infrastructure  
**Core Model:** Multi-plane Relational Reality Representation  

---

## 1. Information Architecture Philosophy

Traditional SaaS information architecture organizes content into arbitrary silos (cards, tables, folders). Sherivs organizes information around **Institutional Reality**:
1. **Entities (Nodes):** People, Organizations, Campuses, Buildings, Rooms, Devices, Classes, Ledgers.
2. **Relationships (Edges):** Enrollment, Employment, Ownership, Authorization, Dependency, Authorship.
3. **Temporal State (Moments):** Attendance events, Transaction timestamps, Mission executions, Policy evaluations.
4. **Intelligence Projections (Views):** Executive summaries, Student transcripts, Financial balances, Capacity forecasts.

---

## 2. Global Navigation Taxonomy

```
SHERIVS GLOBAL NAVIGATION
│
├── 01. CONTEXT STRIP (Header)
│    ├── Institutional Anchor: Brand mark + Organization Selector
│    ├── Environment Context: Production / Staging / Sandbox Mode
│    ├── Temporal Context: Local Institutional Time (e.g. 14:32 WAT)
│    ├── Global Telemetry: Status Beacon (Operational / Degraded)
│    ├── Universal Tools: Global Search (`⌘K`), Jarvis Trigger, Alerts
│    └── Personal Anchor: Profile, Session Scope, Theme, Sign Out
│
├── 02. PRIMARY WORKSPACE NAVIGATOR (Left Rail)
│    ├── CORE PERSPECTIVES
│    │    ├── Overview (Daily operational cadence, pending actions)
│    │    ├── Reality (Digital twin navigator: people, spaces, assets)
│    │    ├── Missions (Active governed operations and executions)
│    │    └── Intelligence (Jarvis executive advisory & pattern briefs)
│    │
│    ├── OPERATIONAL SURFACES (Dynamic based on authorized role & runtime)
│    │    ├── People & Teams (Faculties, departments, cohorts, students)
│    │    ├── Calendar & Scheduling (Timetables, rooms, conflicts)
│    │    ├── Communications (Announcements, direct channels)
│    │    ├── Work & Tasks (Assigned actions, approvals, SLAs)
│    │    └── Knowledge & Documents (Policies, curriculum, records)
│    │
│    ├── FISCAL & INFRASTRUCTURE
│    │    ├── Financial Operations (Billing, invoices, bursar ledger)
│    │    ├── Physical Spaces (Buildings, rooms, transport fleets)
│    │    └── Reports & Statutory (Audit extracts, compliance certificates)
│    │
│    └── GOVERNANCE & INTEGRATION
│         ├── AI Workforce (Worker registry, capability matching, leases)
│         ├── Security & Access (Roles, policies, session audits)
│         └── Workspace Settings (Branding, domains, webhooks)
│
└── 03. CONTEXTUAL INSPECTION DRAWER (Right Rail - Dynamic)
     ├── Entity Inspector (Properties of selected row/card)
     ├── Evidence Dossier (Underlying raw transactions and signatures)
     ├── Jarvis Contextual Copilot (Relevant analysis for current view)
     └── Execution Log (Real-time telemetry of in-flight mission)
```

---

## 3. Mental Models & Progressive Disclosure

Sherivs interfaces adhere to a strict **Three-Tier Progressive Disclosure Rule**:

### Tier 1: The Ambient Brief (Glanceable)
- **Goal:** Allow an operator to verify overall health in under 2 seconds.
- **UI Mechanism:** Status beacons, single-metric delta counters, high-priority alert cards, and calendar timeline anchors.
- **Example:** "Attendance: 96.4% on track · 3 Missions in progress · 0 Critical Incidents".

### Tier 2: The Structured Ledger (Operational)
- **Goal:** Enable standard operational throughput with zero unnecessary clicks.
- **UI Mechanism:** High-density data tables, search/filter bars, sortable columns, and quick action inline triggers.
- **Example:** A paginated table of students, invoice batches, or worker missions with clear status badges and action menus.

### Tier 3: The Deep Evidence Dossier (Auditable)
- **Goal:** Provide forensic, mathematical verification of why a state exists or why an AI recommendation was made.
- **UI Mechanism:** Slide-out inspection sheets, cryptographic hash displays, historical change diffs, and validator signatures.
- **Example:** An inspector clicks an AI-suggested timetable change and views the underlying room capacity constraints, teacher work-hour limits, and the cryptographic validation token.

---

## 4. Search & Command Information Model

Universal search (`⌘K`) acts as a global associative graph query:
1. **Entity Resolution:**
   - Typing `@Sarah` matches Members, Students, and Faculty across active permissions.
   - Typing `#M-104` directly jumps to Mission #104.
   - Typing `!Room 204` resolves the physical campus room twin.
2. **Authorized Action Dispatch:**
   - Typing `Create Mission` initiates the mission planning wizard.
   - Typing `Export Attendance` prompts the PDF/CSV generation engine.
   - Typing `Ask Jarvis` opens the natural language cognitive interface.
3. **Audit Invariant:**
   - Search results are strictly filtered by the caller's server-resolved permissions. If a user cannot view a financial record in the table, that record never appears in search autocompletion.

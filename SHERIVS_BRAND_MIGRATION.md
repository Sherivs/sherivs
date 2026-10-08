# SHERIVS BRAND MIGRATION SPECIFICATION
## Customer-Facing Brand Transformation & Architectural Classification
**Document Identifier:** SBM-2026-V1  
**Target Brand:** SHERIVS · Institutional Intelligence Infrastructure  
**Legacy Brand Reference:** CoreGrid  
**Canonical Domain:** `sherivs.com`  

---

## 1. Brand Hierarchy & Nomenclature

| Concept | Customer-Facing Identity (New) | Architectural Role | Technical/Database Boundary (Internal) |
| :--- | :--- | :--- | :--- |
| **Platform Brand** | **SHERIVS** | Institutional Intelligence Infrastructure | Kernel / CoreGrid Substrate preserved where required |
| **Public Domain** | **`sherivs.com`** | Primary public portal & documentation | Cloud routing / DNS layer |
| **Education Runtime** | **Sherivs Scholar** | Domain vertical runtime for learning institutions | `runtime:scholar` manifest ID |
| **Executive Intelligence** | **JARVIS** | Cognitive multi-agent executive advisor | Centralized intelligence gateway (`ai-gateway`) |
| **Autonomous Workforce** | **Sherivs AI Workforce** | Governed AI workers operating with leases | Workforce position & mission registry |
| **Command Surface** | **Sherivs Command Center** | Universal operations & policy console | Platform operational projection |

---

## 2. Classification of "CoreGrid" References

To prevent breaking existing databases, tests, migrations, and kernel contracts, all references to "CoreGrid" in the codebase have been classified into three distinct categories:

### Category 1: Customer-Facing (MUST BECOME SHERIVS)
*Surfaces:*
- Browser Document Titles (`<title>`)
- Meta Tags (`og:title`, `og:description`, `twitter:title`, `apple-mobile-web-app-title`)
- Public Marketing Pages (`/`, `/platform`, `/solutions`, `/security`, `/pricing`, `/about`)
- Public Navbars, Headers, and Footers
- Authenticated Application Shell Header (when not displaying an organization's custom brand)
- Customer Email Templates, Push Notification alerts, and Onboarding Welcome Dialogs
- Commercial pricing tables and SLA guarantees

### Category 2: Internal Engineering & Governance (PRESERVED AS CONSTITUTIONAL CITATION)
*Surfaces:*
- `AGENTS.md` (CoreGrid ASI Engineering Constitution v1.0)
- Historical Architectural Decision Records (ADRs) and Wave Plans
- Engineering comment blocks referencing Phase numbers (e.g. "CoreGrid Phase 06 Workspace Engine")
- Internal git branch names and commit provenance records

### Category 3: Technical Substrate & Database Compatibility (STRICTLY PRESERVED)
*Surfaces:*
- PostgreSQL table prefixes, migration filenames (e.g. `20261002000000_coregrid_v1_kernel_envelope.sql`)
- Database types and contract packages (e.g. `@coregrid/contracts`, `coregrid-scholar`)
- LocalStorage keys and internal system cookies (e.g. `x-coregrid-manifest`)
- Verification scripts verifying registry drift against evolution baselines

---

## 3. Brand Tone & Voice Guidelines

1. **Authoritative, Not Arrogant:** Speak with the certainty of a verified mathematical proof. Avoid conversational fluff, buzzwords ("game-changer", "magic"), or synthetic warmth.
2. **Institutional & Calm:** Communicate durability, safety, and reliability. Sherivs is built to govern institutions for decades, not for rapid consumer novelty.
3. **Transparent on Intelligence:** Always explain what the AI did, which model was used, what evidence was gathered, and what confidence level was achieved. Never present AI as infallible.

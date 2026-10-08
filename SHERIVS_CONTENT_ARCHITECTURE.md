# SHERIVS CONTENT ARCHITECTURE
## Structured Content Types, Editorial Schemas, Metadata & SEO Architecture
**Document Identifier:** SCA-2026-V1  
**Product Category:** Institutional Intelligence Infrastructure  
**Content Engine:** Type-Safe View-Models & Governed Headless Publishing  

---

## 1. Content Architecture Principles

1. **Truth Over Hype:** All content must be precise, educational, and technically accurate. Avoid exaggerated marketing claims ("revolutionary magic").
2. **Structural Typing:** Content is strictly typed via TypeScript and Zod contracts. No unstructured HTML blobs are committed to the codebase.
3. **Multi-Tenant Content Isolation:** Platform content (public marketing, docs) is segregated from customer organizational content (school news, announcements, curriculum).

---

## 2. Content Type Taxonomy

### A. Public Platform Content Types (`sherivs.com`)
1. **Research & Blog Articles (`BlogPost`):**
   - `slug`: Unique URL-safe identifier (e.g., `zero-trust-institutional-infrastructure`).
   - `title`: Concise, authoritative headline.
   - `excerpt`: 160-character summary used for OpenGraph and meta descriptions.
   - `body`: Structured markdown sections with code examples and architectural diagrams.
   - `author`: Name, title, and verified cryptographic or team attribution.
   - `category`: `Architecture`, `AI Governance`, `Security`, `Case Studies`.
   - `publishedAt`: ISO 8601 timestamp.
   - `readingTime`: Calculated minutes.
   - `tags`: Indexed searchable tokens.

2. **System Documentation & Guides (`DocEntry`):**
   - `id`: Stable identifier (e.g., `doc:runtime-scholar-setup`).
   - `category`: `Getting Started`, `Core Kernel`, `Security & RLS`, `AI Workforce`.
   - `title`: Procedural or architectural title.
   - `content`: Step-by-step instructions with verified shell commands and code snippets.
   - `prerequisites`: Required permissions and software dependencies.

3. **Case Studies (`CaseStudy`):**
   - `organizationName`: Verified institutional partner.
   - `headline`: Quantitative institutional transformation outcome.
   - `challenge`: Pre-Sherivs fragmented legacy systems.
   - `solution`: Deployment of Sherivs kernel and runtime.
   - `verifiedImpact`: Hard metrics (e.g. 99.8% fee reconciliation, zero attendance fraud).

4. **Changelog Releases (`ReleaseNote`):**
   - `version`: SemVer string (e.g. `v1.2.0`).
   - `releaseDate`: ISO date.
   - `phase`: Associated platform phase (e.g. Phase 25 Workforce Identity).
   - `highlights`: Key operational capabilities added.
   - `securityAdvisories`: Patches, CVE resolutions, or authorization hardening.

### B. Customer Organization Content Types
1. **Institutional Announcements (`Announcement`):**
   - Scoped to `tenantId`.
   - Audience: `All`, `Staff`, `Faculty`, `Parents`, `Students`.
   - Priority: `Urgent / Alert`, `Standard`, `Informational`.
   - Delivery channels: In-app banner, Push notification, Email digest.

2. **Official Events (`CalendarEvent`):**
   - Title, Description, Location (Physical campus room or Virtual room).
   - Start time, End time, Timezone.
   - Recurrence rule (RRULE), RSVP roster, and Conflict status.

---

## 3. SEO & Structured Data Architecture

Every public page dynamically emits compliant Schema.org JSON-LD structured data:
- **Homepage:** `Organization` and `SoftwareApplication` with `operatingSystem: "Universal"`, `applicationCategory: "BusinessApplication"`.
- **Blog & Research:** `TechArticle` or `BlogPosting` with `headline`, `author`, `publisher`, `datePublished`.
- **Documentation:** `TechArticle` with breadcrumbs.
- **Organization Public Pages:** `EducationalOrganization` or `GovernmentOrganization` with postal address, geolocation, and verified telephone.

### Meta Tag Invariants
```html
<title>Sherivs — Institutional Intelligence Infrastructure</title>
<meta name="description" content="Sherivs is the AI-native institutional intelligence infrastructure..." />
<meta property="og:title" content="Sherivs — Institutional Intelligence Infrastructure" />
<meta property="og:description" content="..." />
<meta property="og:type" content="website" />
<meta property="og:url" content="https://sherivs.com/" />
<meta property="og:image" content="https://sherivs.com/og-image.png" />
<meta name="twitter:card" content="summary_large_image" />
<meta name="twitter:title" content="Sherivs — Institutional Intelligence Infrastructure" />
<meta name="twitter:description" content="..." />
<meta name="twitter:image" content="https://sherivs.com/og-image.png" />
<link rel="canonical" href="https://sherivs.com/" />
```

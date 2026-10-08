# SHERIVS CONTENT ARCHITECTURE (SCA-v1.0)
**System:** Editorial Standards, Structured Schemas, and Publishing Systems  
**Status:** Canonical Content Specification  

---

## 1. Editorial Voice & Narrative Principles

The voice of Sherivs reflects an elite technological institution:
- **Calm, Certain, Precise:** Free of breathless marketing hype, buzzwords, or exaggerated claims.
- **Institutional Weight:** Uses clear, authoritative terminology (e.g., *Infrastructure*, *Substrate*, *Evidence*, *Governance*, *Dual-Control*, *Autonomous Workforce*).
- **Zero Fabrication:** Never claims features, customers, partners, or capabilities that do not exist in verified repository code.
- **Clarity Over Jargon:** Complex distributed systems and mathematical concepts are explained with architectural elegance and immediate practical clarity.

---

## 2. Structured Content Types

The publishing and content engine (`/resources/*`) is backed by typed, schema-validated content structures:

### Schema 1: Blog & Thought Leadership (`/resources/blog/$slug`)
```typescript
interface BlogPost {
  slug: string;
  title: string;
  eyebrow: string;
  summary: string;
  publishedAt: string;
  updatedAt: string;
  author: {
    name: string;
    role: string;
    avatarUrl?: string;
  };
  readingTimeMinutes: number;
  tags: string[];
  category: "Architecture" | "Governance" | "Workforce" | "Intelligence" | "Security";
  contentMarkdown: string;
  relatedSlugs: string[];
}
```

### Schema 2: Platform Documentation (`/resources/docs/$slug`)
```typescript
interface DocumentationArticle {
  slug: string;
  title: string;
  section: "Getting Started" | "Reality Kernel" | "Workforce & Missions" | "Security & RLS" | "API Reference";
  lead: string;
  lastVerifiedAt: string;
  prerequisites: string[];
  codeExamples: Array<{
    language: "typescript" | "bash" | "sql";
    title: string;
    code: string;
  }>;
  relatedDocSlugs: string[];
}
```

### Schema 3: Institutional Case Studies (`/resources/case-studies/$slug`)
```typescript
interface CaseStudy {
  slug: string;
  institutionName: string;
  industry: "Higher Education" | "K-12 Network" | "Vocational Institute" | "Government Academy";
  headline: string;
  verifiedMetrics: Array<{
    label: string;
    value: string;
    delta: string;
    evidenceContext: string;
  }>;
  challenge: string;
  solutionArchitecture: string;
  executiveQuote: {
    quote: string;
    author: string;
    title: string;
  };
}
```

### Schema 4: Platform Changelog (`/resources/changelog/$slug`)
```typescript
interface ChangelogEntry {
  version: string;
  releaseDate: string;
  summary: string;
  highlights: string[];
  changes: Array<{
    type: "feature" | "improvement" | "security" | "fix";
    description: string;
    affectedPlanes: string[];
  }>;
}
```

---

## 3. SEO & Structured Data Standards

Every public page dynamically emits canonical JSON-LD metadata:
- **Platform Homepage:** `Organization` + `SoftwareApplication` + `WebSite` schema with official name `Sherivs` and domain `sherivs.com`.
- **Tenant Public Sites:** `EducationalOrganization` or `GovernmentOrganization` schema based on the active institutional profile.
- **Articles & Resources:** `TechArticle` or `BlogPosting` with author provenance, publish dates, and structured breadcrumb lists.

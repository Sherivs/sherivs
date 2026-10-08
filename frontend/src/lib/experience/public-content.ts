/**
 * Sherivs public experience — typed content view-models
 * (SHERIVS_CONTENT_ARCHITECTURE.md §3 "Public: platform pages").
 *
 * Presentation-only copy for the Sherivs public plane. Every statement here
 * describes a capability that exists in this repository (the `backedBy`
 * field names the owning modules so a reviewer can verify the claim) or is a
 * commercial fact mirrored from the platform's tier catalog. No customer
 * names, metrics, logos or social proof are invented.
 *
 * The platform is narrated neutrally: a runtime's name belongs to the
 * runtime layer and the platform speaks about an INSTALLED runtime, never
 * about itself as one (platform-neutrality LAW 3 / LAW 5).
 */
import type { PlaneOfMeaning } from "./design-tokens";

/* ── Platform pillars (/platform/$pillar) ─────────────────────────── */

export interface PlatformPillar {
  slug: string;
  title: string;
  plane: PlaneOfMeaning;
  /** One-line category statement. */
  statement: string;
  /** Narrative paragraphs (2–3). */
  narrative: readonly string[];
  /** Concrete, verifiable properties of the implementation. */
  properties: readonly { title: string; detail: string }[];
  /** Repository modules a reviewer can open to verify the claims above. */
  backedBy: readonly string[];
}

export const PLATFORM_PILLARS: readonly PlatformPillar[] = [
  {
    slug: "reality",
    title: "Reality",
    plane: "reality",
    statement: "A canonical, bi-temporal model of what is actually true in an organization.",
    narrative: [
      "Sherivs represents an organization as entities, relationships, events and observations — people, systems, knowledge, places, decisions and the state between them. Verified records are kept apart from derived understanding, so a prediction can never quietly overwrite a fact.",
      "Every persistent object carries a kernel envelope: identity, tenant, provenance and bi-temporal validity. Anonymous objects are rejected at the contract boundary, and the database — not the application — enforces the constraints.",
    ],
    properties: [
      { title: "Entities, relationships, events, observations", detail: "Typed substrate tables with CHECK constraints, indexes and row-level security." },
      { title: "Canonical envelope", detail: "Identity, tenant, provenance and validity stamped on every persistent object; unstamped objects fail closed." },
      { title: "Bi-temporal truth", detail: "Valid-time and transaction-time are both recorded, so the system can answer what was known, and when." },
      { title: "Reality ≠ Intelligence", detail: "Direct observation is the only evidence class that can support a canonical-truth claim." },
    ],
    backedBy: ["frontend/src/lib/kernel/reality.ts", "frontend/src/lib/evidence/capture.ts", "database/supabase/migrations"],
  },
  {
    slug: "memory",
    title: "Memory",
    plane: "intel",
    statement: "Durable organizational memory that is scoped, authorized and audited on every access.",
    narrative: [
      "Memory in Sherivs is not a vector store with a search box. Retrieval requires an identity, a tenant and a declared scope; any of the three missing is a denial before a single record is evaluated.",
      "Every retrieval — granted, partial or denied — appends an access record, and records withheld by authorization are recorded as first-class exclusions. Writes are bounded by a declared scope, so memory cannot silently expand.",
    ],
    properties: [
      { title: "Scoped retrieval", detail: "Identity + tenant + declared scope are mandatory inputs; similarity alone can never return a record." },
      { title: "Access ledger", detail: "One auditable record per retrieval, including what was withheld and why." },
      { title: "Bounded writes", detail: "A write whose actor, tenant, mission, domain or sensitivity exceeds its declared scope is rejected." },
      { title: "Knowledge currency", detail: "Memory carries freshness so stale knowledge is visible, not silently trusted." },
    ],
    backedBy: ["frontend/src/lib/memory/memory-store.ts", "frontend/src/lib/memory/knowledge-currency.ts", "frontend/src/lib/context/memory-scope-enforcement.ts"],
  },
  {
    slug: "ai-workforce",
    title: "AI Workforce",
    plane: "action",
    statement: "Governed AI workers: persistent definitions, delegated authority, ephemeral runtimes.",
    narrative: [
      "A Sherivs worker is a governed actor, not a character. Its definition — capabilities, authority bounds, delegation history — is persistent and envelope-stamped; the runtime instance that executes is ephemeral and can die and restart without losing the definition.",
      "Workers resolve through the same identity-actor primitive as people. A runtime claims authority only by intersecting an explicit delegation with the definition's declared capability set; authority beyond the definition is denied, never clamped.",
    ],
    properties: [
      { title: "Definition → Delegation → Assignment → Runtime → Evidence → Verification → Outcome", detail: "The governed chain every worker action follows." },
      { title: "No self-expansion", detail: "No API accepts an authority input that is not first checked against the persistent definition." },
      { title: "Leases and lifecycle", detail: "Worker lifecycle states are a subset of the identity lifecycle; execution runs under bounded leases." },
      { title: "Tool runtime", detail: "Tools are declared capabilities with their own registry and runtime boundary." },
    ],
    backedBy: ["frontend/src/lib/workforce/worker-definition.ts", "frontend/src/lib/workforce/worker-registry.ts", "frontend/src/lib/workforce/tool-runtime.ts", "frontend/src/lib/agent-runtime"],
  },
  {
    slug: "missions",
    title: "Missions",
    plane: "action",
    statement: "Work expressed as first-class governed objects with owners, gates, evidence and outcomes.",
    narrative: [
      "A mission declares an objective, a tenant scope, an accountable owner and authorized actors, a decomposition into tasks, admission gates, success criteria and a bounded lifetime. A mission missing any required element is rejected at the contract boundary.",
      "The mission lifecycle composes with the one canonical workflow lifecycle rather than forking it, and every mission leaves an auditable trail from proposal to verified outcome.",
    ],
    properties: [
      { title: "Admission gates", detail: "Execution is admitted only through the foundation loop's authorization path — the mission contract never admits itself." },
      { title: "Delegation contract", detail: "Who may act, under which authority, for how long — declared before execution." },
      { title: "Execution store and leases", detail: "Persistent execution state with lease-bounded actors." },
      { title: "Evidence to outcome", detail: "Mission → Workforce → Execution → Evidence → Verification → Outcome." },
    ],
    backedBy: ["frontend/src/lib/mission/mission-contract.ts", "frontend/src/lib/mission/gates.ts", "frontend/src/lib/missions/mission-execution.ts", "frontend/src/lib/control-plane/foundation-mission.ts"],
  },
  {
    slug: "intelligence",
    title: "Intelligence",
    plane: "intel",
    statement: "Context assembly, a governed AI gateway and Jarvis — an executive orchestrator with an enumerated mandate.",
    narrative: [
      "Before any model sees data, Sherivs resolves identity, authorization, classification, purpose, minimization and redaction. All model calls route through one gateway that owns provider abstraction, cost, safety, logging and fallback.",
      "Jarvis is an executive orchestrator, mission coordinator, escalation layer and observability interface — not an unrestricted agent. Every capability Jarvis may exercise is enumerated; every proposal carries a tenant reference, a justification and an approval requirement, and every must-not is an enforced deny code.",
    ],
    properties: [
      { title: "AI gateway", detail: "Provider-neutral routing with cost attribution, output-trust checks and runtime defenses." },
      { title: "Reasoning provenance", detail: "Model outputs carry provenance and are untrusted until validated and approved." },
      { title: "Jarvis mandate", detail: "Observe, inspect, coordinate, initiate governed missions, request approval, escalate, summarize, recommend — nothing else." },
      { title: "Context assembly", detail: "Minimized, redacted, purpose-checked context with a drop ledger of what was excluded." },
    ],
    backedBy: ["frontend/src/lib/ai-gateway", "frontend/src/lib/jarvis/jarvis-contract.ts", "frontend/src/lib/jarvis/briefing.ts", "frontend/src/lib/context"],
  },
  {
    slug: "governance",
    title: "Governance",
    plane: "evidence",
    statement: "Security, authority, evidence, verification and audit — enforced by the platform, not by any one application.",
    narrative: [
      "Authorization resolves identity, tenant, role, relationship, resource, action, policy, context and risk into one decision: allow, deny, redact, escalate or require approval. Row-level security is mandatory for tenant-sensitive data; application code is never the only security layer.",
      "Evidence carries an explicit class and its epistemic weight. Generated, simulated, predicted and derived evidence is quarantined from direct observation and can never be laundered into a canonical-truth claim.",
    ],
    properties: [
      { title: "Layered authorization", detail: "RBAC, ABAC, PBAC, ReBAC, RLS and contextual policy with five decision outcomes." },
      { title: "Approval chains", detail: "Critical actions follow proposal → validation → policy check → approval → execution → audit." },
      { title: "Evidence classes", detail: "direct_observation vs generated | simulated | predicted | derived | attested — class laundering is rejected." },
      { title: "Retention schedule", detail: "Personal-data-bearing families carry retention policy identifiers." },
    ],
    backedBy: ["frontend/src/lib/authorization.ts", "frontend/src/lib/governance/approval-chains.ts", "frontend/src/lib/evidence/capture.ts", "frontend/src/lib/governance/retention-policy-schedule.ts"],
  },
  {
    slug: "integrations",
    title: "Integrations",
    plane: "reality",
    statement: "Provider-agnostic adapters for identity, messaging, payments, storage and AI — governed credentials included.",
    narrative: [
      "Sherivs stays provider-agnostic by design. External systems enter through adapters with declared health, credential references and failure policies, so a vendor can be replaced without touching domain logic.",
      "Credentials are brokered server-side and classified by exposure; delivery produces append-only evidence rather than optimistic success.",
    ],
    properties: [
      { title: "Adapter catalogue", detail: "Email, SMS, WhatsApp, voice and push providers declared with health state and credential references." },
      { title: "Credential broker", detail: "Server-only secrets with a machine-readable exposure classification." },
      { title: "Delivery evidence", detail: "Each governed send appends an evidence row with a redacted recipient and outcome." },
      { title: "Payments", detail: "Server-side signature verification is authoritative; the client never asserts payment state." },
    ],
    backedBy: ["frontend/src/lib/integration-adapters.ts", "frontend/src/lib/communication-providers.ts", "frontend/src/lib/security/credential-broker.ts", "frontend/src/lib/payments"],
  },
];

export function pillarBySlug(slug: string): PlatformPillar | undefined {
  return PLATFORM_PILLARS.find((pillar) => pillar.slug === slug);
}

/* ── Solutions (/solutions/$segment) ──────────────────────────────── */

export interface SolutionSegment {
  slug: string;
  title: string;
  audience: string;
  summary: string;
  narrative: readonly string[];
  /** Pillar slugs this segment leans on most. */
  pillars: readonly string[];
  /** Honest scope statement. */
  scope: string;
  backedBy: readonly string[];
}

export const SOLUTION_SEGMENTS: readonly SolutionSegment[] = [
  {
    slug: "organizations",
    title: "Organizations",
    audience: "Any organization that needs one governed operational layer",
    summary: "Provision a tenant, compose a role model, attach policies and project a workspace for every person — without adopting a vertical application.",
    narrative: [
      "An organization is onboarded through a domain-free pipeline: legal identity, type, country and currency; a role model expressed as data; security policies attached as governed objects. The workspace each person sees is projected from their authorized capabilities, not from a fixed menu.",
      "Supported organization classes in the onboarding pipeline include companies and enterprises, government agencies, community institutions, non-profits and networks, alongside educational institutions.",
    ],
    pillars: ["reality", "governance", "memory"],
    scope: "Generic organization capability is provided by the platform kernel; vertical depth comes from installed runtimes.",
    backedBy: ["frontend/src/lib/onboarding/onboarding-flow.ts", "frontend/src/lib/workspace-engine/navigation.ts", "frontend/src/lib/security-policy.ts"],
  },
  {
    slug: "enterprise",
    title: "Enterprise",
    audience: "Groups, multi-branch operations and regulated environments",
    summary: "Tenant isolation at the database, a separate control plane, append-only audit and a commercial tier with dedicated infrastructure options.",
    narrative: [
      "The Sherivs control plane manages configuration, security, AI operations, billing, compliance and provisioning — and it is not a tenant. Tenant data is isolated by row-level security; the Enterprise tier adds dedicated database and the full API and webhook surface.",
    ],
    pillars: ["governance", "integrations", "reality"],
    scope: "Enterprise tier entitlements are enforced by the platform's feature-access contracts after activation, never by a web page.",
    backedBy: ["frontend/src/lib/subscription-tiers.ts", "frontend/src/lib/tenancy", "frontend/src/lib/control-plane"],
  },
  {
    slug: "education",
    title: "Education",
    audience: "Schools and school networks",
    summary: "The first installed runtime brings the education domain onto the governed core: identity, workspaces, communication, scheduling, finance and AI assistance.",
    narrative: [
      "The education runtime is an application installed on Sherivs. It consumes platform primitives — identity, tenancy, security, workspaces, AI — and contributes only its own domain: learner and guardian workspaces, educator tools, finance operations, timetables, attendance, assessment and school-network HQ views.",
      "Remove the runtime and the platform stays fully valid; that is the proof of the kernel's neutrality.",
    ],
    pillars: ["reality", "intelligence", "missions"],
    scope: "Runtime-001. Education-specific surfaces load only when the runtime is active for the organization.",
    backedBy: ["frontend/src/lib/runtime/installed-runtimes.ts", "frontend/src/lib/runtime/scholar-nav-catalog.ts", "frontend/src/lib/scholar"],
  },
  {
    slug: "ai-workforce",
    title: "AI Workforce",
    audience: "Teams that want AI to do governed work, not just answer questions",
    summary: "Define workers, delegate bounded authority, assign missions, and receive evidence you can verify.",
    narrative: [
      "Workers operate through missions. Each mission carries its owner, gates, success criteria and evidence requirements; each worker action carries provenance and lands in an audit trail. Approval is a step in the chain, not an afterthought.",
    ],
    pillars: ["ai-workforce", "missions", "governance"],
    scope: "Worker launch and execution are server-authorized; the public site describes the contract, it does not run it.",
    backedBy: ["frontend/src/lib/workforce", "frontend/src/lib/missions", "frontend/src/lib/governance/approval-chains.ts"],
  },
];

export function segmentBySlug(slug: string): SolutionSegment | undefined {
  return SOLUTION_SEGMENTS.find((segment) => segment.slug === slug);
}

/* ── Security guarantees (/security) ──────────────────────────────── */

export interface GovernanceGuarantee {
  id: string;
  title: string;
  description: string;
}

export const SECURITY_GUARANTEES: readonly GovernanceGuarantee[] = [
  {
    id: "tenant-isolation",
    title: "Tenant isolation by database, not by UI",
    description:
      "Row Level Security is mandatory for tenant-sensitive data. Application code is never the only security layer: the database enforces tenant boundaries even when application logic fails.",
  },
  {
    id: "layered-authorization",
    title: "Layered authorization",
    description:
      "Identity, tenant, role, relationship, resource, policy, context and risk resolve to a decision on every request. Server functions authenticate, resolve tenancy, authorize, validate, execute and audit — in that order.",
  },
  {
    id: "canonical-truth",
    title: "Canonical truth protection",
    description:
      "Reality (verified records) and intelligence (predictions, AI interpretations) are separated by law. AI inference must never overwrite canonical truth without validation.",
  },
  {
    id: "ai-output-trust",
    title: "AI output is untrusted by default",
    description:
      "AI proposals pass validation, policy check and human approval before execution — and every step is audited. No agent can silently increase its own permissions or deploy itself.",
  },
  {
    id: "immutable-audit",
    title: "Immutable audit records",
    description:
      "Every important action leaves an audit trail: who did what, when, under which policy. Logs never carry secrets or unnecessary private data.",
  },
  {
    id: "agent-governance",
    title: "Agent lifecycle governance",
    description:
      "Agents move through proposed, reviewed, approved, deployed, monitored, suspended and retired states. Security is continuous: observe, evaluate, decide, enforce, audit, re-evaluate.",
  },
];

/* ── Installed runtime proof (platform-neutral narration) ─────────── */

export interface RuntimeProof {
  manifestId: string;
  name: string;
  description: string;
  proof: string;
}

export const INSTALLED_RUNTIME_PROOFS: readonly RuntimeProof[] = [
  {
    manifestId: "runtime:scholar",
    name: "Scholar",
    description: "Education runtime",
    proof:
      "Runtime-001. The first installed runtime demonstrates the kernel's neutrality: an educational institution inherits the platform's governed core — identity, tenancy, security, workspaces, AI — and brings only its own domain. Remove that runtime and the kernel stays fully valid.",
  },
];

/* ── Pricing (/pricing) ───────────────────────────────────────────── */

export interface MarketingTier {
  id: string;
  name: string;
  /** Monthly price in ₦; null when quoted as a custom contract. */
  monthlyPrice: number | null;
  annualPrice: number | null;
  summary: string;
  featured: boolean;
  highlights: readonly string[];
  ctaLabel: string;
}

const NAIRA = "₦";

export function formatTierPrice(price: number | null): string {
  if (price === null) return "Custom";
  return `${NAIRA}${price.toLocaleString("en-US")}`;
}

/** Mirrors the platform's commercial tier catalog (frontend/src/lib/subscription-tiers.ts). */
export const MARKETING_TIERS: readonly MarketingTier[] = [
  {
    id: "trial",
    name: "Trial",
    monthlyPrice: 0,
    annualPrice: 0,
    summary: "Evaluate the full platform core free for 30 days.",
    featured: false,
    highlights: ["30-day evaluation", "Up to 50 members", "One workspace", "Core profiles and calendar"],
    ctaLabel: "Start free",
  },
  {
    id: "starter",
    name: "Starter",
    monthlyPrice: 15_000,
    annualPrice: 150_000,
    summary: "Everything a small organization needs to run on Sherivs.",
    featured: false,
    highlights: ["Up to 200 members", "Five role workspaces", "Payments and receipts", "Email notifications"],
    ctaLabel: "Choose Starter",
  },
  {
    id: "growth",
    name: "Growth",
    monthlyPrice: 35_000,
    annualPrice: 350_000,
    summary: "Advanced intelligence for organizations that are scaling.",
    featured: true,
    highlights: ["Up to 500 members", "AI scheduling and insights", "SMS and WhatsApp notifications", "Advanced analytics"],
    ctaLabel: "Choose Growth",
  },
  {
    id: "professional",
    name: "Professional",
    monthlyPrice: 75_000,
    annualPrice: 750_000,
    summary: "Full governed autonomy: AI workforce, twins and API access.",
    featured: false,
    highlights: ["Up to 1,000 members", "AI workforce and Digital Twin", "White-label and custom domain", "Priority support"],
    ctaLabel: "Choose Professional",
  },
  {
    id: "enterprise",
    name: "Enterprise",
    monthlyPrice: null,
    annualPrice: null,
    summary: "Unlimited scale for groups of institutions and multi-branch operations.",
    featured: false,
    highlights: ["Unlimited members", "Dedicated database", "Full API and webhook surface", "Fleet and branch management"],
    ctaLabel: "Talk to sales",
  },
];

/* ── Homepage narrative (12 chapters) ─────────────────────────────── */

export interface HomeChapter {
  index: number;
  id: string;
  eyebrow: string;
  title: string;
  lead: string;
}

export const HOME_CHAPTERS: readonly HomeChapter[] = [
  { index: 1, id: "brand", eyebrow: "Sherivs", title: "Institutional Intelligence Infrastructure.", lead: "One governed layer that represents an organization's reality and lets people and a governed AI workforce act on it — with evidence." },
  { index: 2, id: "category", eyebrow: "Why a new layer", title: "Organizations run on systems that do not know each other.", lead: "Records live in one place, decisions in another, and the knowledge of how things actually work lives in people. Sherivs is the layer that holds reality, intelligence, action and evidence together — under one authority model." },
  { index: 3, id: "reality", eyebrow: "Organizational reality", title: "People, systems, knowledge, events, state, relationships, operations, decisions.", lead: "A bi-temporal, envelope-stamped model of what is true — kept strictly apart from what is inferred." },
  { index: 4, id: "intelligence", eyebrow: "Intelligence layer", title: "Context. Memory. Knowledge. AI.", lead: "Scoped memory with an access ledger, minimized and redacted context, and a single governed gateway to every model." },
  { index: 5, id: "workforce", eyebrow: "AI workforce", title: "Governed workers operating alongside people.", lead: "Persistent definitions, delegated authority, ephemeral runtimes. No worker can claim more than it was given." },
  { index: 6, id: "missions", eyebrow: "Mission system", title: "Mission → Workforce → Execution → Evidence → Verification → Outcome.", lead: "Work is a first-class object with an owner, gates and success criteria. Nothing completes without evidence." },
  { index: 7, id: "experiences", eyebrow: "Adaptive experiences", title: "Experiences generated around organizational reality.", lead: "Navigation, workspaces and pages are projected from installed runtimes and authorized capabilities — never from a fixed menu." },
  { index: 8, id: "runtimes", eyebrow: "Domain runtimes", title: "Runtimes extend the platform. They are never its identity.", lead: "A runtime is an application installed on the kernel. The first one brings education; the platform stays valid without it." },
  { index: 9, id: "governance", eyebrow: "Governance", title: "Security. Authority. Evidence. Verification. Audit.", lead: "Row-level isolation, layered authorization with five outcomes, quarantined evidence classes and append-only audit." },
  { index: 10, id: "architecture", eyebrow: "Enterprise architecture", title: "Domain → Application → Policy → Infrastructure → Provider.", lead: "A kernel with registries, events, policies and evidence; a separate control plane; provider-agnostic adapters; a runtime registry." },
  { index: 11, id: "vision", eyebrow: "The category", title: "Infrastructure for institutions that intend to be understood by their own systems.", lead: "Not a dashboard, not an AI wrapper, not a vertical app — a governed intelligence layer organizations install once and extend." },
  { index: 12, id: "cta", eyebrow: "Begin", title: "Explore the platform, or create an account.", lead: "Accounts are real: an administrator links your identity to your organization and the workspace is projected from your authorization." },
];

/** Reality model vocabulary rendered in chapter 03. */
export const REALITY_FACETS = [
  "People",
  "Systems",
  "Knowledge",
  "Events",
  "State",
  "Relationships",
  "Operations",
  "Decisions",
] as const;

/** Mission chain rendered in chapter 06. */
export const MISSION_CHAIN = [
  { step: "Mission", plane: "action" as PlaneOfMeaning, detail: "Objective, owner, scope, gates, criteria." },
  { step: "Workforce", plane: "action" as PlaneOfMeaning, detail: "Delegated workers with bounded authority." },
  { step: "Execution", plane: "action" as PlaneOfMeaning, detail: "Lease-bounded runtime under admission gates." },
  { step: "Evidence", plane: "evidence" as PlaneOfMeaning, detail: "Classed, provenance-stamped records." },
  { step: "Verification", plane: "evidence" as PlaneOfMeaning, detail: "Validation, policy check, approval." },
  { step: "Outcome", plane: "reality" as PlaneOfMeaning, detail: "A verified change to organizational reality." },
] as const;

/** Architecture layers rendered in chapter 10 (no internals exposed). */
export const ARCHITECTURE_LAYERS = [
  { name: "Experience", detail: "Public, organization, workspace, mobile and AI surfaces projected from governed contracts." },
  { name: "Experience services", detail: "Identity, context, search, calendar, notifications, missions, workforce, evidence." },
  { name: "Kernel", detail: "Registries, reality model, events, policies, evidence, authorization." },
  { name: "Control plane", detail: "Configuration, security, AI operations, billing, compliance, provisioning — not a tenant." },
  { name: "Providers", detail: "Database, AI, messaging, payments and storage behind adapters." },
] as const;

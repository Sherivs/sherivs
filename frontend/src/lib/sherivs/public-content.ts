/**
 * Sherivs public content — reviewed, typed, evidence-linked.
 *
 * Every capability claim on the public site carries `evidence`: repository paths
 * of the modules that implement it. tests/unit/sherivs-content.test.ts fails if
 * an evidence path does not exist, so marketing cannot drift ahead of the code.
 *
 * Boundary (AGENTS §45): only V1 organizational capabilities are described.
 * Device/IoT (V2), reality-intelligence/physical twins (V3) and civilization-scale
 * capabilities are frozen and deliberately absent.
 *
 * No metrics, customers, logos, testimonials or live-activity claims appear here.
 */

export type CapabilityId =
  | "reality"
  | "memory"
  | "intelligence"
  | "ai-workforce"
  | "missions"
  | "governance"
  | "integrations";

export interface CapabilityFact {
  readonly label: string;
  readonly text: string;
}

export interface CapabilityContent {
  readonly id: CapabilityId;
  readonly title: string;
  /** One-line positioning. */
  readonly lead: string;
  /** Plain-language explanation. */
  readonly body: readonly string[];
  /** What it guarantees — each line is a property of the implementation, not an aspiration. */
  readonly guarantees: readonly CapabilityFact[];
  /** Repo paths (relative to the repository root) that implement the claims. */
  readonly evidence: readonly string[];
  /** What this is NOT — keeps the page honest. */
  readonly boundary: string;
  readonly related: readonly CapabilityId[];
}

export const CAPABILITIES: readonly CapabilityContent[] = [
  {
    id: "reality",
    title: "Organizational reality",
    lead: "One canonical record of who and what an organization is, and what has happened.",
    body: [
      "Sherivs separates verified truth from derived understanding. People, structure, records, transactions and events live in a reality model; predictions and AI interpretations are kept apart from it and never overwrite it without validation.",
      "Because the model is domain-neutral, a school, a company or an agency is configured onto the same substrate rather than hard-coded into it. The domain brings vocabulary; the platform brings identity, tenancy, state and history.",
    ],
    guarantees: [
      { label: "Typed objects", text: "Object types are registered, not improvised, so every record has a declared shape and owner." },
      { label: "Events as history", text: "State changes are expressed as events with semantics, security and routing rules." },
      { label: "Time is a primitive", text: "A single time authority resolves instants, so history is ordered and comparable." },
    ],
    evidence: [
      "frontend/src/lib/kernel/reality.ts",
      "frontend/src/lib/kernel/object-type-registry.ts",
      "frontend/src/lib/kernel/event-semantics.ts",
      "frontend/src/lib/kernel/time-authority.ts",
    ],
    boundary:
      "This is the organization's operational record. It is not a model of physical environments or devices; those capabilities are not part of Sherivs today.",
    related: ["memory", "governance"],
  },
  {
    id: "memory",
    title: "Memory and knowledge",
    lead: "Scoped memory that remembers what it is allowed to — and knows when it is out of date.",
    body: [
      "Memory is a governed tier, not a pile of embeddings. Every record is written under an authorized scope, retrieval is audited, and knowledge carries a freshness contract so stale facts are marked stale instead of quietly presented as current.",
      "Context for a model or a worker is assembled from what the requester is authorized to see — context can inform a decision but can never grant authority.",
    ],
    guarantees: [
      { label: "Scope-bounded", text: "Writes and reads are checked against identity, tenant and declared scope." },
      { label: "Freshness", text: "Knowledge records declare a fresh-until instant; past it, they are returned as stale, never as current." },
      { label: "Invalidation is explicit", text: "Invalidated knowledge is retained and marked, not deleted, with who and why." },
    ],
    evidence: [
      "frontend/src/lib/memory/memory-store.ts",
      "frontend/src/lib/memory/knowledge-currency.ts",
      "frontend/src/lib/context/memory-scope-enforcement.ts",
      "frontend/src/lib/context-assembly.ts",
    ],
    boundary: "Memory is practical organizational memory. It does not claim open-ended autonomous learning.",
    related: ["intelligence", "reality"],
  },
  {
    id: "intelligence",
    title: "Intelligence",
    lead: "Models are used through one governed gateway, and their output is never trusted by default.",
    body: [
      "All model access goes through a central gateway that handles routing, cost attribution, safety defenses and logging, so no feature reaches a provider directly. Inputs are minimized and redacted to what the requester is authorized to send.",
      "Model output is an untrusted proposal. Anything consequential passes validation, policy and approval before it can act, and the reasoning behind a result is recorded with its provenance.",
    ],
    guarantees: [
      { label: "One gateway", text: "Provider choice is a registry entry behind a contract, not code scattered through features." },
      { label: "Output trust", text: "A trust pipeline stands between a model's answer and any action." },
      { label: "Provenance", text: "Reasoning records say what was used, by whom, and under which model." },
    ],
    evidence: [
      "frontend/src/lib/ai-gateway/model-registry.ts",
      "frontend/src/lib/ai-gateway/output-trust-pipeline.ts",
      "frontend/src/lib/ai-gateway/runtime-defenses.ts",
      "frontend/src/lib/ai-gateway/reasoning-provenance.ts",
    ],
    boundary: "Sherivs does not present model output as fact, and does not imply a model is reasoning when no request is in flight.",
    related: ["ai-workforce", "governance"],
  },
  {
    id: "ai-workforce",
    title: "AI workforce",
    lead: "Workers are governed identities with a defined scope — not autonomous characters.",
    body: [
      "A worker is defined by an owner, a purpose, a capability set, permitted tools and a lease. Definitions persist; running instances are ephemeral and end when their mission ends.",
      "Jarvis is the executive orchestrator: it coordinates, escalates and summarizes. It cannot bypass authorization, reveal secrets or approve its own work, and a worker's own claim of success is never counted as verification.",
    ],
    guarantees: [
      { label: "Identity and scope", text: "Every worker has a declared definition, tools and tenant scope." },
      { label: "Ephemeral runtime", text: "Instances exist for a mission and then end; no standing agent fleet." },
      { label: "Separation of roles", text: "The model, the worker, the authority and the verifier are distinct things." },
    ],
    evidence: [
      "frontend/src/lib/workforce/worker-definition.ts",
      "frontend/src/lib/workforce/worker-registry.ts",
      "frontend/src/lib/agent-runtime/ephemeral-lifecycle.ts",
      "frontend/src/lib/jarvis/jarvis-contract.ts",
    ],
    boundary: "Workers act only inside granted authority. They cannot expand their own permissions or deploy themselves.",
    related: ["missions", "governance"],
  },
  {
    id: "missions",
    title: "Missions",
    lead: "Work expressed as an object with an owner, authority, evidence and a verifiable outcome.",
    body: [
      "A mission carries its objective, who owns it, what authority it runs under, what evidence it must produce and how completion is verified. It moves from proposal to execution to verification, and every step leaves an auditable trail.",
      "Execution is idempotent and reversible where the action allows it, so a retry does not repeat a side effect and a rollback is a recorded act.",
    ],
    guarantees: [
      { label: "Authority-bound", text: "Actions execute only through authorized, gated steps." },
      { label: "Evidence required", text: "Outcomes are supported by captured evidence, not by assertion." },
      { label: "Independent verification", text: "Verification is independent of the actor that did the work." },
    ],
    evidence: [
      "frontend/src/lib/mission/mission-contract.ts",
      "frontend/src/lib/missions/mission-execution.ts",
      "frontend/src/lib/evidence/capture.ts",
      "frontend/src/lib/assurance/verification-independence.ts",
    ],
    boundary: "A mission does not imply autonomy. It is a governed unit of work that humans can inspect and stop.",
    related: ["ai-workforce", "governance"],
  },
  {
    id: "governance",
    title: "Governance",
    lead: "Every decision resolves through identity, tenant, role, relationship, resource, policy and risk.",
    body: [
      "Authorization is layered — role, attribute, policy and relationship — and returns more than yes or no: allow, deny, redact, escalate or require approval. The same rules apply to people and to workers.",
      "Tenant isolation is enforced by the database through row-level security, not left to application code, and important actions leave immutable audit records.",
    ],
    guarantees: [
      { label: "Layered decisions", text: "Authorization is computed from identity, tenant, role, resource, action, policy and context." },
      { label: "Approval chains", text: "Consequential actions can require recorded human approval." },
      { label: "Audit", text: "Who did what, when and under which policy is recorded." },
    ],
    evidence: [
      "frontend/src/lib/authorization.ts",
      "frontend/src/lib/approval/chains.ts",
      "frontend/src/lib/audit.ts",
      "frontend/src/lib/tenant-isolation.ts",
    ],
    boundary: "The interface is never the security boundary: hidden buttons and routes are cosmetic; enforcement is server-side.",
    related: ["missions", "reality"],
  },
  {
    id: "integrations",
    title: "Integrations",
    lead: "External services sit behind Sherivs contracts, so no provider becomes the architecture.",
    body: [
      "Payments, messaging, storage and model providers connect through adapters. Credentials are held by a broker and leased to a caller for a purpose; they are never embedded in features or logged.",
      "Replacing a provider is a registry and adapter change. The domain logic that depends on a capability does not change with it.",
    ],
    guarantees: [
      { label: "Adapters, not vendors", text: "Domain code depends on a contract, not on a provider SDK." },
      { label: "Credential leasing", text: "Secrets are brokered and scoped; raw values do not travel through application code." },
      { label: "Transform and reconcile", text: "Mappings and reconciliation between systems are explicit and checked." },
    ],
    evidence: [
      "frontend/src/lib/providers/provider-credentials.ts",
      "frontend/src/lib/security/credential-broker.ts",
      "frontend/src/lib/integration-core.ts",
      "frontend/src/lib/integration-transform.ts",
    ],
    boundary: "Sherivs does not claim a catalogue of third-party connectors beyond those installed and verified for a deployment.",
    related: ["governance", "intelligence"],
  },
];

export const capabilityById = (id: string): CapabilityContent | undefined =>
  CAPABILITIES.find((c) => c.id === id);

/* ───────────── homepage narrative ───────────── */

export interface NarrativeStage {
  readonly id: string;
  readonly index: string;
  readonly eyebrow: string;
  readonly title: string;
  readonly body: string;
}

/** The ordered homepage story. Sections 01–12 from the experience brief, as editorial prose. */
export const HOME_NARRATIVE = {
  category: {
    index: "02",
    eyebrow: "The category",
    title: "Organizations run on software that remembers nothing it can prove.",
    body: "Records live in one system, decisions in another, knowledge in someone's head, and AI in a tab nobody governs. Sherivs is a different layer: infrastructure that holds an organization's reality, lets intelligence act on it, and keeps the evidence.",
  },
  reality: {
    index: "03",
    eyebrow: "Organizational reality",
    title: "A single model of the organization — verified, scoped, historical.",
    body: "People, structure, knowledge, events and state are represented once, with provenance. What is verified stays separate from what is inferred.",
    facets: ["People", "Structure", "Knowledge", "Events", "State", "Relationships", "Operations", "Decisions"],
  },
  planes: [
    { plane: "reality", title: "Reality", text: "What is verifiably true: records, transactions, state, history." },
    { plane: "intelligence", title: "Intelligence", text: "What can be inferred and recommended, from context the requester is authorized to see." },
    { plane: "action", title: "Action", text: "What is done — only through authorized, gated steps." },
    { plane: "evidence", title: "Evidence", text: "What proves it: captured, attributed, independently verified." },
  ],
  workforce: {
    index: "05",
    eyebrow: "AI workforce",
    title: "Workers with scope, tools and a lease — alongside people.",
    body: "Governed AI workers do defined work under defined authority, and their results are checked by something other than themselves.",
  },
  mission: {
    index: "06",
    eyebrow: "Missions",
    title: "From intent to verified outcome.",
    body: "Work is a first-class object. It has an owner, an authority, a trail of evidence and an independent verdict.",
    steps: ["Mission", "Workforce", "Execution", "Evidence", "Verification", "Outcome"],
  },
  adaptive: {
    index: "07",
    eyebrow: "Adaptive experience",
    title: "The interface is composed from reality, not hard-coded.",
    body: "What a person sees is resolved from their organization's runtime, their role and their authorized capabilities. Navigation that someone cannot use is not shown to them — and the server still enforces it.",
  },
  runtime: {
    index: "08",
    eyebrow: "Domain runtimes",
    title: "Scholar is the first runtime — not the boundary.",
    body: "A runtime is an application installed on the platform. Sherivs Scholar brings the education domain; the platform stays valid without it, and the next runtime inherits the same governed core.",
  },
  governance: {
    index: "09",
    eyebrow: "Governance",
    title: "Security, authority, evidence, verification, audit.",
    body: "Isolation is enforced by the database. Authorization is layered and explainable. Every important action leaves an audit record.",
    pillars: ["Security", "Authority", "Evidence", "Verification", "Audit"],
  },
  architecture: {
    index: "10",
    eyebrow: "Architecture",
    title: "A kernel, registries and contracts — with runtimes on top.",
    body: "Identity, tenancy, events, policy and memory form the kernel. Providers are adapters. The details that matter for security stay inside the platform; what matters for your decision is published.",
  },
  vision: {
    index: "11",
    eyebrow: "Direction",
    title: "A new category: infrastructure for institutional intelligence.",
    body: "Sherivs is built so that as organizations adopt AI, authority and evidence scale with it — instead of being retrofitted afterwards.",
  },
} as const;

export const SECURITY_PRINCIPLES: readonly { id: string; title: string; text: string; evidence: readonly string[] }[] = [
  { id: "isolation", title: "Isolation enforced by the database", text: "Row-level security protects tenant data even when application code is wrong. One tenant cannot read another's rows.", evidence: ["frontend/src/lib/tenant-isolation.ts", "scripts/verify-rls-isolation-battery.mjs"] },
  { id: "authorization", title: "Layered, explainable authorization", text: "Role, attribute, policy and relationship combine into allow, deny, redact, escalate or require-approval.", evidence: ["frontend/src/lib/authorization.ts"] },
  { id: "ai-trust", title: "AI output is untrusted by default", text: "Proposals are validated, policy-checked and approved before they act. Workers cannot raise their own permissions.", evidence: ["frontend/src/lib/ai-gateway/output-trust-pipeline.ts", "frontend/src/lib/workforce/worker-definition.ts"] },
  { id: "secrets", title: "Credentials are brokered", text: "Secrets are leased for a purpose and kept out of application code and logs.", evidence: ["frontend/src/lib/security/credential-broker.ts"] },
  { id: "audit", title: "Immutable audit", text: "Important actions record who, what, when and under which policy.", evidence: ["frontend/src/lib/audit.ts"] },
  { id: "ui", title: "The interface is not the boundary", text: "Hidden controls are cosmetic. Every server function authenticates, resolves tenant, authorizes, validates and audits.", evidence: ["frontend/src/lib/auth-helpers.ts"] },
];

/**
 * Sherivs public content — typed, reviewable copy for the public experience.
 *
 * Every statement here describes a property the platform's architecture
 * commits to (CONSTITUTION, V1 runtime laws). Nothing here is a customer
 * claim, a metric, a testimonial or a logo: there are none to show, and the
 * public site never invents them. Scope is the V1 organizational capability
 * envelope only (AGENTS.md §45); frozen device/IoT and reality-intelligence
 * capabilities are intentionally not described.
 */
import type { SherivsPlane } from "./design-tokens";

export interface PlatformPrinciple {
  readonly title: string;
  readonly body: string;
}

export interface PlatformPageContent {
  readonly slug:
    | "reality"
    | "memory"
    | "intelligence"
    | "ai-workforce"
    | "missions"
    | "governance"
    | "integrations";
  readonly title: string;
  readonly plane: SherivsPlane;
  readonly summary: string;
  readonly lead: string;
  readonly principles: readonly PlatformPrinciple[];
  /** What this part of the platform deliberately will NOT do. */
  readonly boundaries: readonly string[];
  readonly related: ReadonlyArray<PlatformPageContent["slug"]>;
}

export const PLATFORM_PAGES: readonly PlatformPageContent[] = [
  {
    slug: "reality",
    title: "Reality",
    plane: "reality",
    summary: "A canonical model of what your organization is.",
    lead: "Every organization already has a reality: its people, systems, knowledge, events, state, relationships, operations and decisions. Sherivs represents that reality as verified records with owners, history and provenance — and keeps it strictly separate from anything merely inferred about it.",
    principles: [
      {
        title: "Verified truth is not interpretation",
        body: "Records, transactions and state are canonical. Predictions, summaries and AI interpretations are derived understanding and are stored as such. Inference never overwrites canonical truth without validation.",
      },
      {
        title: "Everything has an owner and a tenant",
        body: "Each entity belongs to exactly one organization. Tenant context is resolved on the server for every request and enforced by the database, not by the interface.",
      },
      {
        title: "History is part of the record",
        body: "State changes are events with an actor and a time. You can ask what was true then, who changed it, and under which authority.",
      },
      {
        title: "Relationships carry provenance",
        body: "A link between two things records where it came from, who created it, whether it was verified and whether AI produced it — so confidence is visible instead of assumed.",
      },
    ],
    boundaries: [
      "Reality is not a permission bypass: holding information in the model does not make it visible to everyone.",
      "AI interpretations are never promoted to verified truth automatically.",
    ],
    related: ["memory", "governance"],
  },
  {
    slug: "memory",
    title: "Memory",
    plane: "intelligence",
    summary: "Organizational memory with scope and provenance.",
    lead: "Institutions forget: decisions live in inboxes, reasons live in people's heads. Sherivs gives an organization practical memory — what was decided, by whom, on what evidence — and bounds who and what may read it.",
    principles: [
      {
        title: "Memory has a scope",
        body: "Memory is attached to an organization, a mission or a worker, and enforcement happens at read time. A worker cannot widen its own memory scope.",
      },
      {
        title: "Memory keeps its sources",
        body: "Each remembered item records where it came from and when, so a recalled fact can be traced back rather than trusted blindly.",
      },
      {
        title: "Context is assembled, not accumulated",
        body: "For each task the platform assembles only the context that task is authorized to see. Context supports a decision; it can never grant authority.",
      },
      {
        title: "Switching context is safe",
        body: "Moving between organizations or workspaces resets what is in scope, so information from one tenant cannot leak into another session.",
      },
    ],
    boundaries: [
      "Memory is never shared across tenants.",
      "Remembered content cannot be used to bypass authorization.",
    ],
    related: ["intelligence", "reality"],
  },
  {
    slug: "intelligence",
    title: "Intelligence",
    plane: "intelligence",
    summary: "Context, knowledge and one governed gateway for AI.",
    lead: "Intelligence in Sherivs is not a chat box attached to your data. It is a layer: context is assembled under authorization, knowledge keeps provenance, and every model call goes through one gateway that decides what may be sent and what may come back.",
    principles: [
      {
        title: "One gateway for every model call",
        body: "Provider routing, egress allow-lists, cost tracking, safety checks and logging live in a single place instead of being scattered through the product.",
      },
      {
        title: "Models receive only what is authorized",
        body: "Before anything reaches a model it is authorized, classified, minimized and redacted for the stated purpose.",
      },
      {
        title: "AI output is untrusted by default",
        body: "A model's answer is a proposal. It passes validation and policy checks, and consequential actions require approval before execution.",
      },
      {
        title: "Responses show their reasoning status",
        body: "The interface distinguishes what was observed, what was inferred, what is recommended, what was done and what has been verified — with evidence and confidence attached.",
      },
    ],
    boundaries: [
      "The interface never implies a model is working unless the backend is actually processing.",
      "Providers are replaceable behind adapters; no workflow depends on one vendor.",
    ],
    related: ["ai-workforce", "memory"],
  },
  {
    slug: "ai-workforce",
    title: "AI workforce",
    plane: "action",
    summary: "Governed AI workers that operate alongside people.",
    lead: "Sherivs AI Workforce is a set of workers that are first-class, governed identities. A worker has an owner, a purpose, a capability set, tools, permissions, a tenant scope and a lifecycle. It does work through missions, under authority it was granted — and it can be suspended.",
    principles: [
      {
        title: "A model is not a worker",
        body: "The model is an engine. The worker is a governed identity that uses it. Neither the model nor the worker is the authority, the mission, or the verifier.",
      },
      {
        title: "Workers are ephemeral at runtime",
        body: "Definitions persist; runtime does not. A worker is instantiated for a mission and its leases expire, so there is no resident fleet acting unobserved.",
      },
      {
        title: "Permissions never grow silently",
        body: "A worker cannot raise its own permissions, modify policy, expand memory access or deploy itself. Any such change is a reviewed, audited decision.",
      },
      {
        title: "Jarvis coordinates; it does not rule",
        body: "Jarvis is the executive orchestrator: it summarizes, routes and escalates. It cannot bypass authorization, reveal secrets or authorize its own actions.",
      },
    ],
    boundaries: [
      "Workers are untrusted by default and portrayed as governed systems, not autonomous characters.",
      "A worker's own claim of success is never verification.",
    ],
    related: ["missions", "governance"],
  },
  {
    slug: "missions",
    title: "Missions",
    plane: "action",
    summary: "Work as a first-class, evidenced organizational object.",
    lead: "A mission states an objective, an owner, a scope and what counts as done. Workers are assigned, execution is observed, and the outcome is accepted only after evidence has been independently verified. Every step leaves an audit trail.",
    principles: [
      {
        title: "Mission → workforce → execution → evidence → verification → outcome",
        body: "The path from intent to result is explicit, so you can see where a piece of work is and what it still needs.",
      },
      {
        title: "Authority is stated up front",
        body: "A mission names who may approve it and which actions it may take. Execution outside that authority is refused, not warned about.",
      },
      {
        title: "Execution is idempotent and reversible",
        body: "Replays do not duplicate effects, and governed actions can be rolled back with a recorded reason.",
      },
      {
        title: "Verification is independent",
        body: "The party that verifies an outcome is not the party that produced it. Evidence, not assertion, closes a mission.",
      },
    ],
    boundaries: [
      "A mission cannot grant itself authority.",
      "Cost, risk and authority are recorded with the mission, not reconstructed later.",
    ],
    related: ["ai-workforce", "governance"],
  },
  {
    slug: "governance",
    title: "Governance",
    plane: "evidence",
    summary: "Authority, policy, evidence, verification and audit.",
    lead: "Governance in Sherivs is not a settings page. Authorization is layered — identity, tenant, role, relationship, resource, policy, context and risk — and every important action ends in an immutable audit record that says who did what, when and under which policy.",
    principles: [
      {
        title: "Decisions are explicit",
        body: "A request resolves to allow, deny, redact, escalate or require approval — never to an implicit default.",
      },
      {
        title: "The database is a security layer",
        body: "Tenant isolation is enforced by row-level security, so a defect in application code cannot expose another organization's data.",
      },
      {
        title: "Trust is visible",
        body: "Evidence, source, confidence, verification, approval, actor, model and outcome are shown wherever a claim is made.",
      },
      {
        title: "Audit is append-only",
        body: "Records of consequential actions are not edited after the fact, and never contain secrets or unnecessary personal data.",
      },
    ],
    boundaries: [
      "The interface is never the security boundary: hiding a control is not authorization.",
      "Command and search surfaces only offer actions the viewer is authorized to take.",
    ],
    related: ["reality", "missions"],
  },
  {
    slug: "integrations",
    title: "Integrations",
    plane: "reality",
    summary: "Providers behind adapters, not woven into the product.",
    lead: "Organizations already depend on payment, messaging, storage and AI providers. Sherivs connects to them through adapters that sit behind Sherivs contracts, so the platform stays provider-agnostic and a vendor can change without rewriting workflows.",
    principles: [
      {
        title: "Adapters, not vendors",
        body: "Domain logic never imports a vendor SDK. Each provider category has a contract; the adapter translates.",
      },
      {
        title: "Credentials are brokered",
        body: "Secrets are held server-side and leased for a purpose; they are never sent to a browser or written to logs.",
      },
      {
        title: "Inbound events are verified",
        body: "Payment and messaging callbacks require signature validation, idempotency and replay protection before they change state.",
      },
      {
        title: "Failure is a designed state",
        body: "Provider outages degrade visibly with a retry policy and an evidence trail, rather than failing silently.",
      },
    ],
    boundaries: [
      "A provider's reported state is evidence to be reconciled, not canonical truth.",
    ],
    related: ["governance", "intelligence"],
  },
];

export function platformPage(slug: string): PlatformPageContent | undefined {
  return PLATFORM_PAGES.find((p) => p.slug === slug);
}

/* ── Home narrative ───────────────────────────────────────────────────── */

export interface RealityFacet {
  readonly key: string;
  readonly title: string;
  readonly body: string;
}

export const REALITY_FACETS: readonly RealityFacet[] = [
  { key: "people", title: "People", body: "Members, roles and the relationships between them." },
  { key: "systems", title: "Systems", body: "The tools and providers the organization depends on." },
  { key: "knowledge", title: "Knowledge", body: "Documents and facts with their sources." },
  { key: "events", title: "Events", body: "What happened, when, and who was involved." },
  { key: "state", title: "State", body: "The current, verified condition of things." },
  { key: "relationships", title: "Relationships", body: "How entities connect, with provenance." },
  { key: "operations", title: "Operations", body: "Workflows and the work moving through them." },
  { key: "decisions", title: "Decisions", body: "What was decided, by whom, on what evidence." },
];

export interface IntelligenceLayer {
  readonly key: string;
  readonly title: string;
  readonly body: string;
  readonly bound: string;
}

export const INTELLIGENCE_LAYERS: readonly IntelligenceLayer[] = [
  {
    key: "context",
    title: "Context",
    body: "Assembled for each task from what that task may see.",
    bound: "Context informs; it never grants authority.",
  },
  {
    key: "memory",
    title: "Memory",
    body: "What the organization has decided and learned, with sources.",
    bound: "Scoped to an organization, mission or worker.",
  },
  {
    key: "knowledge",
    title: "Knowledge",
    body: "Facts and relationships that keep their provenance.",
    bound: "Every relationship records who created it and whether it was verified.",
  },
  {
    key: "ai",
    title: "AI",
    body: "Models reached through a single governed gateway.",
    bound: "Output is a proposal until validated and, where needed, approved.",
  },
];

export interface MissionStage {
  readonly key: string;
  readonly title: string;
  readonly plane: SherivsPlane;
  readonly body: string;
}

export const MISSION_STAGES: readonly MissionStage[] = [
  {
    key: "mission",
    title: "Mission",
    plane: "reality",
    body: "An objective with an owner, scope, authority and a definition of done.",
  },
  {
    key: "workforce",
    title: "Workforce",
    plane: "intelligence",
    body: "Capable, authorized workers are matched to the mission and given time-limited leases.",
  },
  {
    key: "execution",
    title: "Execution",
    plane: "action",
    body: "Work happens inside the granted authority. Replays are idempotent; actions can be rolled back.",
  },
  {
    key: "evidence",
    title: "Evidence",
    plane: "evidence",
    body: "Each action leaves evidence: source, actor, worker, model, time and outcome.",
  },
  {
    key: "verification",
    title: "Verification",
    plane: "evidence",
    body: "A party independent of the producer checks the evidence against the definition of done.",
  },
  {
    key: "outcome",
    title: "Outcome",
    plane: "evidence",
    body: "The result is accepted, escalated or rolled back — and the whole trail stays auditable.",
  },
];

export interface GovernanceFacet {
  readonly key: string;
  readonly title: string;
  readonly body: string;
}

export const GOVERNANCE_FACETS: readonly GovernanceFacet[] = [
  { key: "security", title: "Security", body: "Tenant isolation is enforced in the database; the interface is never the boundary." },
  { key: "authority", title: "Authority", body: "Who may do what, under which policy, in which context — decided on every request." },
  { key: "evidence", title: "Evidence", body: "Claims carry sources, actors and confidence." },
  { key: "verification", title: "Verification", body: "Outcomes are checked independently of whoever produced them." },
  { key: "audit", title: "Audit", body: "Consequential actions end in an append-only record." },
];

export interface ArchitectureLayer {
  readonly key: string;
  readonly title: string;
  readonly body: string;
}

/** Customer-safe architecture layers (no internal table, service or host names). */
export const ARCHITECTURE_LAYERS: readonly ArchitectureLayer[] = [
  { key: "experience", title: "Experience", body: "Public sites, workspaces and mobile surfaces generated from governed contracts." },
  { key: "application", title: "Application", body: "Missions, workflows and workers operating on the organization's reality." },
  { key: "policy", title: "Policy", body: "Authorization, approval chains and risk controls evaluated on each request." },
  { key: "infrastructure", title: "Infrastructure", body: "Tenant-isolated data, audit, observability and recovery." },
  { key: "providers", title: "Providers", body: "Payments, messaging, storage and AI reached through replaceable adapters." },
];

export interface ComparisonRow {
  readonly without: string;
  readonly withSherivs: string;
}

export const CATEGORY_COMPARISON: readonly ComparisonRow[] = [
  {
    without: "Records scattered across tools, each with its own idea of the truth.",
    withSherivs: "One reality model with owners, history and provenance.",
  },
  {
    without: "AI added as a chat box beside the data, with no authority model.",
    withSherivs: "Governed workers with identity, scope and a lifecycle.",
  },
  {
    without: "Outcomes reported by whoever did the work.",
    withSherivs: "Outcomes accepted after independent verification of evidence.",
  },
  {
    without: "Access decided in each application's own code.",
    withSherivs: "Layered authorization with the database as a second line.",
  },
];

export interface ExperienceInput {
  readonly key: string;
  readonly label: string;
}

export const EXPERIENCE_INPUTS: readonly ExperienceInput[] = [
  { key: "reality", label: "Organization reality" },
  { key: "runtime", label: "Runtime" },
  { key: "capabilities", label: "Capabilities" },
  { key: "role", label: "Role" },
  { key: "permissions", label: "Permissions" },
  { key: "context", label: "Context" },
  { key: "theme", label: "Theme" },
  { key: "content", label: "Content" },
];

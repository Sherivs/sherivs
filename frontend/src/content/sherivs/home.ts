/**
 * Sherivs public content — homepage narrative.
 *
 * Twelve movements, in order. Copy states what the platform is and does; it contains
 * no customer names, logos, metrics, testimonials or live activity, because none of
 * those can be verified from this repository.
 */
export interface NarrativeMovement {
  id: string;
  index: string;
  label: string;
  title: string;
  lead: string;
}

export const HOME_MOVEMENTS = {
  introduction: {
    id: "introduction",
    index: "01",
    label: "Sherivs",
    title: "The operating layer for institutions that have to be right.",
    lead: "Sherivs is institutional intelligence infrastructure. It holds a governed model of your organization's reality, keeps intelligence separate from truth, and lets people and accountable AI workers act on it — with evidence for everything they do.",
  },
  category: {
    id: "category",
    index: "02",
    label: "Why a new layer",
    title: "Institutions run on systems that cannot explain themselves.",
    lead: "Records live in one tool, decisions in another, knowledge in people's heads, and AI is bolted on with whatever access it was given. Nothing can answer who did what, under which policy, based on which facts. That gap is not a missing feature. It is a missing layer.",
  },
  reality: {
    id: "reality",
    index: "03",
    label: "Organizational reality",
    title: "One canonical model of what is true.",
    lead: "Sherivs represents the organization itself — not a module of it. Every entity has an owner, a tenant, a history and relationships, and every change is an event.",
  },
  intelligence: {
    id: "intelligence",
    index: "04",
    label: "Intelligence layer",
    title: "Context, memory, knowledge and AI — derived, never canonical.",
    lead: "Intelligence sits above reality, not inside it. It reads what the asker is authorized to see, carries its sources, and cannot overwrite a verified record without validation.",
  },
  workforce: {
    id: "workforce",
    index: "05",
    label: "AI workforce",
    title: "AI workers with an owner, a scope and a record.",
    lead: "A Sherivs worker is an identity, not a feature. It is proposed, reviewed and approved before it acts; it works under leased, time-bounded authority; and it cannot widen its own permissions.",
  },
  missions: {
    id: "missions",
    index: "06",
    label: "Mission system",
    title: "Work that ends in evidence, not in a checkbox.",
    lead: "A mission declares its objective, owner and acceptance criteria before anyone starts. It is executed through policy gates and is only complete when its evidence has been verified.",
  },
  experiences: {
    id: "experiences",
    index: "07",
    label: "Adaptive experiences",
    title: "Every workspace is composed from reality and permission.",
    lead: "Sherivs does not ship one dashboard for everyone. Each person's workspace is projected from their organization, roles and authorized capabilities — so nobody sees what they cannot use, and nothing is forced on anyone.",
  },
  runtimes: {
    id: "runtimes",
    index: "08",
    label: "Domain runtimes",
    title: "Sectors add vocabulary. They never replace the core.",
    lead: "A domain runtime brings the language and workflows of one sector and consumes the platform's governed primitives. Removing a runtime leaves the platform fully valid.",
  },
  governance: {
    id: "governance",
    index: "09",
    label: "Governance",
    title: "Every decision resolves to an answer — and a record.",
    lead: "Identity, tenant, role, relationship, resource, action, policy, context and risk combine into one of five outcomes. The database enforces tenant boundaries beneath the application, and every important action is audited.",
  },
  architecture: {
    id: "architecture",
    index: "10",
    label: "Enterprise architecture",
    title: "Built so that no single layer is trusted alone.",
    lead: "Domain logic never depends on a vendor. Providers sit behind adapters. The control plane that operates the platform is not a tenant, and no tenant can reach it.",
  },
  vision: {
    id: "vision",
    index: "11",
    label: "The category",
    title: "Institutional intelligence is infrastructure, not an app.",
    lead: "Institutions will increasingly be run by people working alongside AI. That only works if the intelligence is governed, the truth is protected and every action can be explained. Sherivs is built to be that layer.",
  },
  cta: {
    id: "begin",
    index: "12",
    label: "Begin",
    title: "Put your institution on governed ground.",
    lead: "Create an account and your workspace is resolved from your actual membership — your organization, your roles, your permissions.",
  },
} as const satisfies Record<string, NarrativeMovement>;

/** What Sherivs represents (movement 03). */
export const REALITY_ENTITIES: readonly { name: string; detail: string }[] = [
  { name: "People", detail: "Members, roles and the relationships between them." },
  { name: "Systems", detail: "The tools and providers the organization depends on." },
  { name: "Knowledge", detail: "Policies, guidance and memory with provenance." },
  { name: "Events", detail: "Every change, as an ordered, attributable record." },
  { name: "State", detail: "The current, verified condition of every entity." },
  { name: "Relationships", detail: "Who belongs to what, reports to whom, acts for whom." },
  { name: "Operations", detail: "The recurring work that keeps the institution running." },
  { name: "Decisions", detail: "What was decided, by whom, under which policy." },
];

/** Intelligence components (movement 04). */
export const INTELLIGENCE_COMPONENTS: readonly { name: string; detail: string }[] = [
  { name: "Context", detail: "Assembled per request from what the asker may see — minimized and redacted before any model sees it." },
  { name: "Memory", detail: "Scoped to tenant and purpose, dated, attributed, and labelled when AI-generated." },
  { name: "Knowledge", detail: "Relationships carry provenance, ownership, authorization and confidence." },
  { name: "AI", detail: "Every model call routes through one gateway for authentication, cost, safety, rate limits and logs." },
];

/** Experience composition inputs (movement 07). */
export const EXPERIENCE_INPUTS: readonly string[] = [
  "Organization reality",
  "Installed runtime",
  "Capabilities",
  "Role",
  "Permissions",
  "Context",
  "Theme",
  "Content",
];

/** Architecture principles (movement 10). */
export const ARCHITECTURE_PRINCIPLES: readonly { title: string; detail: string }[] = [
  {
    title: "Domain → Application → Policy → Infrastructure → Provider",
    detail: "Dependencies point one way. Business rules never import a vendor SDK.",
  },
  {
    title: "Control plane is not a tenant",
    detail: "Platform operations are separated from every customer organization by design.",
  },
  {
    title: "Provider-agnostic by adapter",
    detail: "Database, AI, payments, messaging and storage are replaceable behind declared contracts.",
  },
  {
    title: "Server functions are APIs",
    detail: "Each one authenticates, resolves tenancy, authorizes, validates, executes and audits — in that order.",
  },
];

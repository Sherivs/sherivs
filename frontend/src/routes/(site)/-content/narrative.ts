/**
 * Sherivs public homepage narrative — typed view-models.
 *
 * Honest product copy only. No fake metrics, customers, logos, or live
 * activity. Installed runtime proofs are imported from site-content.ts so
 * a runtime's name stays in one catalog.
 */
export interface NarrativeBeat {
  readonly id: string;
  readonly index: string;
  readonly eyebrow: string;
  readonly title: string;
  readonly body: string;
  readonly points?: readonly string[];
}

export const HOME_NARRATIVE: readonly NarrativeBeat[] = [
  {
    id: "brand",
    index: "01",
    eyebrow: "Sherivs",
    title: "Institutional Intelligence Infrastructure.",
    body: "Sherivs is the governed operating layer for organizations: a single environment in which people, systems, knowledge, events, state, relationships, operations and decisions are represented, authorized and auditable.",
  },
  {
    id: "category",
    index: "02",
    eyebrow: "Category",
    title: "Organizations outgrew applications.",
    body: "Most institutions run on disconnected tools: an admin console here, a website there, a chatbot beside them. None of those is an operational layer. Sherivs exists because identity, tenancy, work, memory and intelligence have to be one governed system — or every later decision is untrustworthy.",
  },
  {
    id: "reality",
    index: "03",
    eyebrow: "Organizational reality",
    title: "Reality is represented before it is interpreted.",
    body: "Sherivs holds verified organizational truth separately from derived intelligence. People, systems, knowledge, events, state, relationships, operations and decisions are first-class — not fields on a dashboard card.",
    points: [
      "People and membership",
      "Systems and integrations",
      "Knowledge and documents",
      "Events and calendar",
      "State and history",
      "Relationships",
      "Operations",
      "Decisions",
    ],
  },
  {
    id: "intelligence",
    index: "04",
    eyebrow: "Intelligence layer",
    title: "Context, memory, knowledge, then AI.",
    body: "Intelligence is layered on authorized context. Models do not see raw databases. They receive minimized, purpose-checked, redacted context through the AI gateway — and their output remains untrusted until validation, policy and approval say otherwise.",
    points: ["Context", "Memory", "Knowledge", "AI"],
  },
  {
    id: "workforce",
    index: "05",
    eyebrow: "AI workforce",
    title: "Governed workers, not magical characters.",
    body: "Sherivs AI Workforce members are first-class identities: owner, purpose, model, tools, permissions, tenant scope and lifecycle. They operate alongside humans under policy. They cannot expand their own authority.",
  },
  {
    id: "missions",
    index: "06",
    eyebrow: "Missions",
    title: "Work leaves evidence.",
    body: "A mission is a first-class organizational object. It is not a ticket and it is not a prompt. The path is Mission → Workforce → Execution → Evidence → Verification → Outcome — with authority, cost, risk and audit attached.",
    points: ["Mission", "Workforce", "Execution", "Evidence", "Verification", "Outcome"],
  },
  {
    id: "experiences",
    index: "07",
    eyebrow: "Adaptive experiences",
    title: "The interface is projected from reality.",
    body: "Workspaces, public sites and navigation are composed from organization reality, installed runtime, capabilities, role, permissions, context and theme. Arbitrary data does not become UI. Contracts do.",
  },
  {
    id: "runtimes",
    index: "08",
    eyebrow: "Domain runtimes",
    title: "Runtimes extend the platform. They never own it.",
    body: "A domain runtime installs on Sherivs and brings only its own domain. Remove any one runtime and the kernel remains valid. Education is the first installed runtime — proof of neutrality, not the product category.",
  },
  {
    id: "governance",
    index: "09",
    eyebrow: "Governance",
    title: "Security, authority, evidence, verification, audit.",
    body: "Every request authenticates, resolves tenancy, authorizes, validates, executes and audits. Row Level Security is mandatory for tenant-sensitive data. Application chrome is never the only security layer.",
  },
  {
    id: "enterprise",
    index: "10",
    eyebrow: "Enterprise architecture",
    title: "A platform, described without a threat model gift.",
    body: "Sherivs is identity, tenancy, policy, workspaces, missions, an AI workforce, evidence and observability. Internal control-plane details that would aid an attacker are not published on this site.",
  },
  {
    id: "future",
    index: "11",
    eyebrow: "Category",
    title: "A new operational layer — not another application.",
    body: "Sherivs is built so institutions can represent reality, apply governed intelligence, execute work, and prove what happened. That is a different category from school software, admin dashboards, or an AI wrapper.",
  },
  {
    id: "cta",
    index: "12",
    eyebrow: "Begin",
    title: "Request a demo, or inspect the platform.",
    body: "Create an account on the real authentication surface, or read the platform capabilities that are actually installed. We do not collect demo leads into a fake form.",
  },
];

export const SPATIAL_PLANES = [
  { id: "reality", label: "Reality", description: "Verified organizational truth" },
  { id: "intelligence", label: "Intelligence", description: "Context, memory, knowledge, AI" },
  { id: "action", label: "Action", description: "Missions, workforce, execution" },
  { id: "evidence", label: "Evidence", description: "Provenance, verification, audit" },
] as const;

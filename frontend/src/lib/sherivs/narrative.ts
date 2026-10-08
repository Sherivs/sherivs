/**
 * Homepage narrative. Twelve sections, in order.
 * No invented customers, metrics, testimonials, or live activity.
 */

export interface NarrativeSection {
  id: string;
  index: string;
  title: string;
  paragraphs: readonly string[];
  /** Optional ordered sequence rendered as a process, not as cards. */
  sequence?: readonly { label: string; text: string }[];
  /** Optional structural list rendered as a definition column. */
  terms?: readonly { label: string; text: string }[];
}

export const HOME_NARRATIVE: readonly NarrativeSection[] = [
  {
    id: "brand",
    index: "01",
    title: "Sherivs",
    paragraphs: [
      "Institutional intelligence infrastructure.",
      "Sherivs is the operating layer an organization uses to hold reality, reason about it, act through people and governed AI workers, and keep the evidence of what happened.",
    ],
  },
  {
    id: "category",
    index: "02",
    title: "A layer organizations do not already have",
    paragraphs: [
      "Institutions already own systems of record. Those systems store transactions, people, and documents. They do not, by themselves, keep verified state separate from interpretation, or bind an action to the authority and evidence that justified it.",
      "Sherivs is that layer. It is not a dashboard laid over someone else's database, and it is not a chat window with a model behind it.",
    ],
  },
  {
    id: "reality",
    index: "03",
    title: "Organizational reality",
    paragraphs: [
      "The platform represents an organization as structure, not as a pile of screens. Each of the following is a first-class concern, with provenance: where it came from, who created it, when, and whether it was verified.",
    ],
    terms: [
      {
        label: "People",
        text: "Identities, memberships, and the roles an organization actually defines.",
      },
      { label: "Systems", text: "The records and services the organization already runs." },
      { label: "Knowledge", text: "Documents and decisions that can be cited." },
      { label: "Events", text: "What happened, in order, without rewriting history." },
      { label: "State", text: "The current verified condition of the organization." },
      {
        label: "Relationships",
        text: "How people, teams, and records connect, with ownership attached.",
      },
      { label: "Operations", text: "The work the organization performs." },
      { label: "Decisions", text: "Choices that must remain explainable after the moment passes." },
    ],
  },
  {
    id: "intelligence",
    index: "04",
    title: "Intelligence stays derived",
    paragraphs: [
      "Context, memory, knowledge, and AI sit above verified records. They may inform a person. They may not silently replace the record.",
      "An interpretation is labeled as an interpretation. A recommendation is not an action. An action requires authority. Evidence is kept with the action.",
    ],
    terms: [
      { label: "Context", text: "The tenant, actor, purpose, and resource a request is about." },
      { label: "Memory", text: "What the platform is allowed to retain, under a retention rule." },
      { label: "Knowledge", text: "Material that can be cited back to a source." },
      { label: "AI", text: "Untrusted output until it is validated, authorized, and audited." },
    ],
  },
  {
    id: "workforce",
    index: "05",
    title: "An AI workforce with authority limits",
    paragraphs: [
      "AI workers are governed entities. Each has an owner, a purpose, a scope, tools it may use, and a lifecycle: proposed, reviewed, approved, deployed, monitored, suspended, retired.",
      "They do not expand their own permissions. Jarvis is the name of the executive intelligence contracts inside the platform. There is no public Jarvis chat on this site, and the product does not present a worker as an autonomous character.",
    ],
  },
  {
    id: "missions",
    index: "06",
    title: "Work is a mission",
    paragraphs: [
      "A mission is a first-class organizational object: an objective, an owner, the workers assigned to it, and the evidence required before anyone may call it done.",
      "Operator launch of a worker mission is restricted to platform administration. A universal mission workspace for every customer organization is not fully shipped. The model below is the operating contract, not a claim that every screen already exists.",
    ],
    sequence: [
      { label: "Mission", text: "A named objective with an owner and a definition of done." },
      { label: "Workforce", text: "The people and AI workers authorized to carry it." },
      { label: "Execution", text: "Work performed inside the permissions that were granted." },
      { label: "Evidence", text: "What was observed, by whom, and from which source." },
      { label: "Verification", text: "A check that the evidence meets the mission's rule." },
      { label: "Outcome", text: "The result, kept with its history." },
    ],
  },
  {
    id: "experiences",
    index: "07",
    title: "Experiences follow reality",
    paragraphs: [
      "Sherivs does not hand every organization the same navigation. An experience is composed from the organization's reality, the runtime it has installed, the capabilities it holds, the actor's permissions, and the content it is allowed to publish.",
      "The education runtime already generates a public site and an internal workspace from that organization's own records. Sections with nothing behind them are omitted. Empty states stay empty.",
    ],
  },
  {
    id: "runtimes",
    index: "08",
    title: "Domain runtimes",
    paragraphs: [
      "A runtime is an application installed on Sherivs. It brings a domain. It does not become the platform.",
      "The installed education runtime is named Scholar. It covers the education-specific work an institution turns on — and only that work. Remove it and the platform's identity, tenancy, policy, and audit remain valid. Signing in resolves the workspace a membership actually grants. It does not assume an education workspace.",
    ],
  },
  {
    id: "governance",
    index: "09",
    title: "Governance is visible",
    paragraphs: [
      "Every significant request is decided from identity, tenant, role, relationship, resource, action, policy, context, and risk. The outcomes are allow, deny, redact, escalate, or require approval.",
      "Tenant isolation is enforced in the database, not only in the interface. AI output is untrusted until it passes validation and policy. Audit records are append-only and must not contain secrets.",
    ],
    terms: [
      {
        label: "Security",
        text: "Authentication, authorization, and tenant isolation on every server function.",
      },
      {
        label: "Authority",
        text: "What an actor or worker is allowed to do, and under which policy.",
      },
      { label: "Evidence", text: "The record that supports a claim." },
      { label: "Verification", text: "The check that the evidence is sufficient." },
      { label: "Audit", text: "Who did what, when, and why it was permitted." },
    ],
  },
  {
    id: "architecture",
    index: "10",
    title: "Enterprise architecture, without the internals",
    paragraphs: [
      "Sherivs separates domain rules from policy, policy from infrastructure, and infrastructure from any single vendor. Payments, messaging, storage, and models are reached through adapters.",
      "The public kernel registry lists the capabilities the platform actually owns. This page does not publish exploit detail, credentials, or tenant data.",
    ],
  },
  {
    id: "vision",
    index: "11",
    title: "The category",
    paragraphs: [
      "Institutional intelligence infrastructure is the category: one governed environment in which an organization can see its reality, reason with it, assign work to people and AI workers, and prove what was done.",
      "Device fleets and a broader reality-intelligence product are not part of the current release. They are not shown here as features.",
    ],
  },
  {
    id: "cta",
    index: "12",
    title: "Begin with an account",
    paragraphs: [
      "Create an account on the real sign-in surface. An authorized operator provisions the organization and links your identity to it. There is no unmonitored demo form on this site, and there is no public social profile to follow.",
    ],
  },
];

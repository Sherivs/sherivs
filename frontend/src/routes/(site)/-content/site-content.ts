/**
 * CoreGrid platform public site — marketing content view-models.
 *
 * Presentation-only copy for the (site) public route group. Every string here
 * is static marketing presentation: no backend call, no form, no fake state.
 * The platform is narrated neutrally — a runtime's name belongs to the runtime
 * layer, and the platform speaks about an INSTALLED runtime, never about
 * itself as one (platform-neutrality LAW 3/LAW 5).
 */

export interface SiteCapability {
  /** Stable anchor-safe identifier. */
  id: string;
  title: string;
  description: string;
}

export interface GovernanceGuarantee {
  id: string;
  title: string;
  description: string;
}

export interface RuntimeProof {
  /** Manifest identifier from the runtime layer, e.g. runtime:scholar. */
  manifestId: string;
  name: string;
  description: string;
  /** What this installation proves about the platform kernel. */
  proof: string;
}

/** The six platform capabilities surfaced on the public site. */
export const SITE_CAPABILITIES: readonly SiteCapability[] = [
  {
    id: "reality-model",
    title: "Reality model",
    description:
      "A canonical reality model holds verified system truth — records, transactions, state and history — and keeps it separate from derived intelligence. Predictions and AI interpretations never overwrite verified truth without validation.",
  },
  {
    id: "missions",
    title: "Missions",
    description:
      "Work is expressed as governed missions with owners, evidence requirements and completion criteria — not as untracked tasks. Every mission leaves an auditable trail from proposal to verified outcome.",
  },
  {
    id: "ai-workforce",
    title: "AI workforce",
    description:
      "Autonomous intelligence systems participate as governed agents: first-class identities with owners, scopes, permissions and lifecycle states. Agents are untrusted by default and cannot expand their own permissions.",
  },
  {
    id: "evidence",
    title: "Evidence",
    description:
      "Claims require evidence. The platform enforces verification contracts on itself — capability ownership, dependency law, conformance checks — so progress can be audited, not just asserted.",
  },
  {
    id: "governance",
    title: "Governance",
    description:
      "Layered authorization (RBAC, ABAC, ReBAC, policy and context) resolves every decision through identity, tenant, role, relationship, resource, purpose and risk — with ALLOW, DENY, REDACT and ESCALATE outcomes.",
  },
  {
    id: "workspace",
    title: "Workspace",
    description:
      "Every person gets a workspace projected from the roles and policies their organization defines. Nothing is forced on anyone: the organization composes the surfaces it actually uses.",
  },
];

/** Security and governance guarantees surfaced on the public site. */
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

/**
 * Domain runtimes installed on the kernel, as the public site presents them.
 * A runtime is an application installed on CoreGrid — a consumer of the
 * platform, never its identity.
 */
export const INSTALLED_RUNTIME_PROOFS: readonly RuntimeProof[] = [
  {
    manifestId: "runtime:scholar",
    name: "Scholar",
    description: "African Education Runtime",
    proof:
      "Runtime-001. The first installed runtime demonstrates the kernel's neutrality: a school inherits the platform's governed core — identity, tenancy, security, workspaces, AI — and brings only its own education domain. Remove that runtime and the kernel stays fully valid.",
  },
];
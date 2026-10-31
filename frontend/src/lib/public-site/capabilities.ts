/**
 * Honest capability registry for the public website.
 *
 * available     — implemented enough to describe as usable today
 * in_development — code or UI exists, not a finished customer product
 * planned       — roadmap / architecture, not a shipping claim
 * long_term     — vision only
 */
export type CapabilityStatus = "available" | "in_development" | "planned" | "long_term";

export interface ArchitectureLayer {
  id: string;
  title: string;
  summary: string;
  status: CapabilityStatus;
  evidence: string;
}

export interface ProductFamily {
  id: string;
  name: string;
  href: string;
  summary: string;
  status: CapabilityStatus;
}

export const STATUS_LABEL: Record<CapabilityStatus, string> = {
  available: "Available today",
  in_development: "In development",
  planned: "Planned",
  long_term: "Long-term architecture",
};

export const ARCHITECTURE_LAYERS: readonly ArchitectureLayer[] = [
  {
    id: "identity",
    title: "Identity and governance",
    summary:
      "People, organizations, and agents are first-class identities. Access is resolved from identity, membership, role, and policy — not from the interface alone.",
    status: "available",
    evidence: "Supabase auth, organization memberships, role-gated workspaces, RLS.",
  },
  {
    id: "institutional-computing",
    title: "Institutional computing",
    summary:
      "A shared operating environment where an organization's people, records, and workflows live together instead of in disconnected tools.",
    status: "available",
    evidence: "Organization onboarding, Scholar runtime workspaces, tenant public sites.",
  },
  {
    id: "agent-orchestration",
    title: "Agent orchestration",
    summary:
      "AI workers can be given bounded tasks inside permissions and human oversight. They are not unrestricted administrators and cannot expand their own access.",
    status: "in_development",
    evidence:
      "AI gateway and worker-mission surfaces exist; live execution depends on configured model credentials.",
  },
  {
    id: "digital-twin-runtime",
    title: "Digital-twin runtime",
    summary:
      "Twins are intended to hold identity, state, relationships, and events, then compute on change or schedule. A complete twin runtime is not a finished public product.",
    status: "in_development",
    evidence: "Admin digital-twin UI exists; hardware/IoT twin scope is frozen for V1.",
  },
  {
    id: "intelligence-routing",
    title: "Intelligence and model routing",
    summary:
      "Model access is designed to go through a governed AI gateway so prompts, cost, and safety are not scattered through the product.",
    status: "in_development",
    evidence: "Internal AI gateway; not a public model marketplace.",
  },
  {
    id: "execution",
    title: "Execution and event processing",
    summary:
      "Work should move as observable events and missions, not as untracked side effects. Event processing is present in parts of the platform and still deepening.",
    status: "in_development",
    evidence:
      "Missions and event paths in platform code; not a standalone customer workflow product.",
  },
  {
    id: "data-memory",
    title: "Data and memory infrastructure",
    summary:
      "Canonical records stay separate from derived intelligence. Predictions must not silently overwrite verified state.",
    status: "in_development",
    evidence:
      "Tenant databases and audit trails; long-term memory fabric is not a published product.",
  },
  {
    id: "observability",
    title: "Observability and assurance",
    summary:
      "Operators need health, audit, and verification. A public status page reports machine health without leaking internals.",
    status: "available",
    evidence: "/status and /health.json; in-product audit records.",
  },
];

export const PRODUCT_FAMILIES: readonly ProductFamily[] = [
  {
    id: "scholar",
    name: "Sherivs Scholar",
    href: "/solutions/education",
    summary:
      "The school product from Sherivs. Organization records and a shared workspace are in the product. Separate role applications, campus screens, and AI assistants are in development.",
    status: "available",
  },
  {
    id: "enterprise",
    name: "Sherivs Enterprise",
    href: "/solutions/enterprise",
    summary:
      "The same institutional platform for organizations beyond education. Additional industry runtimes are not selectable at onboarding yet.",
    status: "in_development",
  },
  {
    id: "intelligence",
    name: "Sherivs Intelligence",
    href: "/product/intelligence",
    summary:
      "Grounded institutional intelligence and model routing. Internal gateway work exists; it is not a standalone certified intelligence product.",
    status: "in_development",
  },
  {
    id: "twins",
    name: "Sherivs Digital Twins",
    href: "/product/digital-twins",
    summary:
      "Persistent digital models of people, places, and systems. Directional capability; not a hardware or IoT product announcement.",
    status: "in_development",
  },
  {
    id: "developers",
    name: "Sherivs Developer Platform",
    href: "/developers",
    summary:
      "A public API catalog, explorer, and SDK are planned. They are not published as customer products today.",
    status: "planned",
  },
];

export const HOW_IT_WORKS = [
  {
    step: "01",
    title: "Connect authorized systems and data",
    body: "Bring the people, records, and systems your organization is allowed to use into one governed environment. Connection is permissioned — not a scrape of everything you can reach.",
  },
  {
    step: "02",
    title: "Define the objective and permissions",
    body: "State what should happen and who may do it. Agents and people operate inside those bounds. Permissions are not inferred from a prompt.",
  },
  {
    step: "03",
    title: "Coordinate execution",
    body: "People and AI workers share the same operating picture. Work is coordinated as bounded tasks, not as unattended autonomy.",
  },
  {
    step: "04",
    title: "Observe and verify outcomes",
    body: "Results are checked against what was authorized. Intelligence may recommend; verified records remain the source of truth until a human or policy accepts a change.",
  },
] as const;

export const APPROACH_PILLARS = [
  {
    id: "connect",
    title: "Connect",
    body: "People, organizations, agents, and digital twins share identity and relationship rather than living in separate tools. Connection is the substrate; it is not the same as unrestricted data sharing.",
  },
  {
    id: "coordinate",
    title: "Coordinate",
    body: "Work is coordinated across humans and AI workers with owners, permissions, and completion criteria. Coordination replaces the pile of chat threads, spreadsheets, and one-off automations.",
  },
  {
    id: "intelligence",
    title: "Intelligence",
    body: "Models operate on authorized context and return proposals that can be inspected. Intelligence is a layer on top of institutional reality — it does not replace governance.",
  },
] as const;

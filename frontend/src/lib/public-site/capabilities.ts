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
    status: "in_development",
    evidence:
      "Shared workspace and school setup interview exist. The tenant website builder is not reachable yet.",
  },
  {
    id: "agent-orchestration",
    title: "Agent orchestration",
    summary:
      "AI workers are planned to take bounded tasks inside permissions and human oversight. Today they exist only as definitions limited to suggesting work. They cannot expand their own access.",
    status: "in_development",
    evidence:
      "Agent definitions exist. There is no agent runtime or scheduler, so nothing runs them.",
  },
  {
    id: "digital-twin-runtime",
    title: "Twin runtime",
    summary:
      "Personal twins exist only as stored data and a short brief panel. They do not act on their own. A twin runtime is not built.",
    status: "planned",
    evidence:
      "Personal twin data and a brief panel only; hardware/IoT twin scope is frozen for V1.",
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
      "The school product from Sherivs. A shared workspace, school setup, roles, and student records are in the product. Role-specific screens, campus management, and AI assistants are in development.",
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
    name: "Sherivs Twins",
    href: "/product/digital-twins",
    summary:
      "Personal twins exist only as stored data and a short brief panel. They do not act on their own. Not a hardware or IoT product.",
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
    body: "State what should happen and who may do it. People, and later AI agents, work inside those bounds. Permissions are not inferred from a prompt.",
  },
  {
    step: "03",
    title: "Coordinate execution",
    body: "Planned: people and AI workers will share the same operating picture, with work split into bounded tasks, not unattended autonomy.",
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
    body: "People and organizations, and later AI agents and personal twins, share identity and relationship rather than living in separate tools. Connection is the substrate; it is not the same as unrestricted data sharing.",
  },
  {
    id: "coordinate",
    title: "Coordinate",
    body: "Work is meant to be coordinated across people and, later, AI workers, with owners, permissions, and completion criteria. Coordination replaces the pile of chat threads, spreadsheets, and one-off automations.",
  },
  {
    id: "intelligence",
    title: "Intelligence",
    body: "Planned: models will work on authorized context and return proposals that can be inspected. Intelligence is a layer on top of institutional reality — it does not replace governance.",
  },
] as const;

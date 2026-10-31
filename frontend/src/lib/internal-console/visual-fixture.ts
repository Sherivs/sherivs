/**
 * Local visual-verification fixture for the Internal Console.
 *
 * Triple-gated: Vite DEV, VITE_CONSOLE_VISUAL_FIXTURE=1, and localhost.
 * Production builds never activate this path. It is not an authentication
 * bypass and must not be used against customer data.
 */
import { viewerCapabilities, presentationRoleFor, presentationRoleLabel } from "./roles";
import { workspacesForViewer } from "./workspaces";
import { REGISTERED_RUNTIMES } from "./runtime-contract";
import { CONSOLE_PATHS } from "./paths";
import { overallFromCards } from "./status";
import type {
  ConsoleActivityItem,
  ConsoleAttentionItem,
  ConsoleMetric,
  ConsoleOverview,
} from "./overview";
import { formatRatio } from "./metrics";
import {
  isOrganizationLifecycleState,
  summarizeOrganizationStates,
  type OrganizationAssignmentRecord,
  type OrganizationLifecycleState,
} from "./organization-lifecycle";

export const CONSOLE_FIXTURE_STORAGE_KEY = "sherivs:console-visual-fixture";
export const CONSOLE_FIXTURE_ROLE_KEY = "sherivs:console-visual-fixture-role";
export const CONSOLE_FIXTURE_ORGS_KEY = "sherivs:console-visual-fixture-orgs";
export const CONSOLE_FIXTURE_OPS_KEY = "sherivs:console-visual-fixture-ops";

export type ConsoleFixturePersona = {
  key: string;
  id: string;
  email: string;
  name: string;
  isSuperAdmin: boolean;
  roles: readonly string[];
  jobTitle: string;
};

/**
 * One local persona per V1 Internal Console role-workspace mapping.
 * Production builds never activate these identities.
 */
export const CONSOLE_FIXTURE_PERSONAS: readonly ConsoleFixturePersona[] = [
  {
    key: "platform_owner",
    id: "00000000-0000-4000-8000-000000000001",
    email: "owner.fixture@localhost",
    name: "Amina Okonkwo",
    isSuperAdmin: true,
    roles: [],
    jobTitle: "Platform Owner",
  },
  {
    key: "platform_admin",
    id: "00000000-0000-4000-8000-000000000002",
    email: "admin.fixture@localhost",
    name: "Chidi Nwosu",
    isSuperAdmin: false,
    roles: ["platform_admin"],
    jobTitle: "Platform Administrator",
  },
  {
    key: "operations",
    id: "00000000-0000-4000-8000-000000000003",
    email: "operations.fixture@localhost",
    name: "Fatima Bello",
    isSuperAdmin: false,
    roles: ["operations"],
    jobTitle: "Operations Administrator",
  },
  {
    key: "engineering",
    id: "00000000-0000-4000-8000-000000000004",
    email: "engineering.fixture@localhost",
    name: "Ifeanyi Eze",
    isSuperAdmin: false,
    roles: ["engineering"],
    jobTitle: "Engineer",
  },
  {
    key: "support",
    id: "00000000-0000-4000-8000-000000000005",
    email: "support.fixture@localhost",
    name: "Ngozi Adeyemi",
    isSuperAdmin: false,
    roles: ["support"],
    jobTitle: "Support Specialist",
  },
  {
    key: "security",
    id: "00000000-0000-4000-8000-000000000006",
    email: "security.fixture@localhost",
    name: "Tunde Bakare",
    isSuperAdmin: false,
    roles: ["security"],
    jobTitle: "Security",
  },
  {
    key: "finance",
    id: "00000000-0000-4000-8000-000000000007",
    email: "finance.fixture@localhost",
    name: "Kemi Oladipo",
    isSuperAdmin: false,
    roles: ["finance"],
    jobTitle: "Finance",
  },
  {
    key: "sales",
    id: "00000000-0000-4000-8000-000000000008",
    email: "sales.fixture@localhost",
    name: "Yusuf Ibrahim",
    isSuperAdmin: false,
    roles: ["sales"],
    jobTitle: "Sales",
  },
];

const DEFAULT_FIXTURE_PERSONA = CONSOLE_FIXTURE_PERSONAS[0];

/** Compatibility actor used by fixture organization / operations stores. */
export const CONSOLE_FIXTURE_OPERATOR = {
  id: DEFAULT_FIXTURE_PERSONA.id,
  email: DEFAULT_FIXTURE_PERSONA.email,
  name: DEFAULT_FIXTURE_PERSONA.name,
  roles: DEFAULT_FIXTURE_PERSONA.roles,
};

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost"]);

export function consoleVisualFixtureConfigured(input: {
  dev: boolean;
  flag: string | undefined;
  hostname: string | null;
}): boolean {
  if (!input.dev) return false;
  if (input.flag !== "1") return false;
  if (!input.hostname || !LOCAL_HOSTS.has(input.hostname)) return false;
  return true;
}

export function consoleVisualFixtureEnabled(): boolean {
  return consoleVisualFixtureConfigured({
    dev: import.meta.env.DEV === true,
    flag: import.meta.env.VITE_CONSOLE_VISUAL_FIXTURE as string | undefined,
    hostname: typeof window === "undefined" ? null : window.location.hostname,
  });
}

export function consoleVisualFixtureActive(): boolean {
  if (!consoleVisualFixtureEnabled()) return false;
  try {
    return window.sessionStorage.getItem(CONSOLE_FIXTURE_STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

export function fixturePersonaByKey(key: string | null | undefined): ConsoleFixturePersona {
  return CONSOLE_FIXTURE_PERSONAS.find((persona) => persona.key === key) ?? DEFAULT_FIXTURE_PERSONA;
}

export function readSelectedFixturePersona(): ConsoleFixturePersona {
  if (typeof window === "undefined") return DEFAULT_FIXTURE_PERSONA;
  try {
    return fixturePersonaByKey(window.sessionStorage.getItem(CONSOLE_FIXTURE_ROLE_KEY));
  } catch {
    return DEFAULT_FIXTURE_PERSONA;
  }
}

export function selectConsoleVisualFixturePersona(key: string): ConsoleFixturePersona {
  const persona = fixturePersonaByKey(key);
  if (typeof window !== "undefined") {
    window.sessionStorage.setItem(CONSOLE_FIXTURE_ROLE_KEY, persona.key);
  }
  return persona;
}

export function activateConsoleVisualFixture(personaKey?: string): void {
  if (!consoleVisualFixtureEnabled()) return;
  window.sessionStorage.setItem(CONSOLE_FIXTURE_STORAGE_KEY, "1");
  selectConsoleVisualFixturePersona(personaKey ?? DEFAULT_FIXTURE_PERSONA.key);
  seedConsoleVisualFixtureDemo();
}

export function deactivateConsoleVisualFixture(): void {
  try {
    window.sessionStorage.removeItem(CONSOLE_FIXTURE_STORAGE_KEY);
    window.sessionStorage.removeItem(CONSOLE_FIXTURE_ROLE_KEY);
  } catch {
    /* ignore */
  }
}

function seedConsoleVisualFixtureDemo(): void {
  if (typeof window === "undefined") return;
  try {
    if (!window.sessionStorage.getItem(CONSOLE_FIXTURE_ORGS_KEY)) {
      window.sessionStorage.setItem(
        CONSOLE_FIXTURE_ORGS_KEY,
        JSON.stringify({ organizations: fixtureDemoOrganizations() }),
      );
    }
    if (!window.sessionStorage.getItem(CONSOLE_FIXTURE_OPS_KEY)) {
      window.sessionStorage.setItem(CONSOLE_FIXTURE_OPS_KEY, JSON.stringify(fixtureDemoOps()));
    }
  } catch {
    /* ignore */
  }
}

function fixtureDemoOrganizations() {
  const actor = CONSOLE_FIXTURE_OPERATOR;
  const at = "2026-10-27T12:00:00.000Z";
  return [
    {
      id: "fixture-org-active",
      displayName: "Riverside School",
      orgType: "school",
      lifecycleState: "active",
      country: "NG",
      region: "Lagos",
      city: "Lagos",
      intendedRuntime: "scholar",
      enabledRuntime: "scholar",
      schoolId: "fixture-school-riverside",
      slug: "riverside-school",
      createdAt: "2026-10-20T00:00:00.000Z",
      updatedAt: at,
      submittedAt: "2026-10-21T00:00:00.000Z",
      provisionedAt: "2026-10-22T00:00:00.000Z",
      activatedAt: at,
      onboardingOwnerName: actor.name,
      assignmentCount: 1,
      legalName: "Riverside School Ltd",
      questionnaire: { displayName: "Riverside School", country: "NG" },
      questionnaireStep: "review",
      provisioningError: null,
      outstandingRequirements: [],
      createdBy: actor.id,
      submittedBy: actor.id,
      reviewedBy: actor.id,
      activatedBy: actor.id,
      contact: {
        name: "Ada Obasi",
        email: "ada@example.invalid",
        phone: null,
        title: "Administrator",
        method: "email",
      },
      assignments: [
        {
          id: "fixture-asg-riverside",
          organizationId: "fixture-org-active",
          staffId: actor.id,
          staffName: actor.name,
          assignmentType: "onboarding_owner",
          status: "active",
          assignedBy: actor.id,
          assignedAt: "2026-10-21T00:00:00.000Z",
          releasedAt: null,
        },
      ],
      transitions: [
        {
          id: "fixture-tr-riverside",
          fromState: "ready_for_activation",
          toState: "active",
          actorId: actor.id,
          reason: "activated",
          at,
        },
      ],
      accessEffects: null,
    },
    {
      id: "fixture-org-submitted",
      displayName: "Harbour Academy",
      orgType: "school",
      lifecycleState: "submitted",
      country: "NG",
      region: "Rivers",
      city: "Port Harcourt",
      intendedRuntime: "scholar",
      enabledRuntime: null,
      schoolId: null,
      slug: "harbour-academy",
      createdAt: "2026-10-26T00:00:00.000Z",
      updatedAt: "2026-10-27T00:30:00.000Z",
      submittedAt: "2026-10-27T00:30:00.000Z",
      provisionedAt: null,
      activatedAt: null,
      onboardingOwnerName: actor.name,
      assignmentCount: 1,
      legalName: "Harbour Academy",
      questionnaire: { displayName: "Harbour Academy", country: "NG" },
      questionnaireStep: "review",
      provisioningError: null,
      outstandingRequirements: [],
      createdBy: actor.id,
      submittedBy: actor.id,
      reviewedBy: null,
      activatedBy: null,
      contact: {
        name: "Emeka Okoro",
        email: "emeka@example.invalid",
        phone: null,
        title: "Principal",
        method: "email",
      },
      assignments: [
        {
          id: "fixture-asg-harbour",
          organizationId: "fixture-org-submitted",
          staffId: actor.id,
          staffName: actor.name,
          assignmentType: "onboarding_owner",
          status: "active",
          assignedBy: actor.id,
          assignedAt: "2026-10-26T00:00:00.000Z",
          releasedAt: null,
        },
      ],
      transitions: [
        {
          id: "fixture-tr-harbour",
          fromState: "draft",
          toState: "submitted",
          actorId: actor.id,
          reason: "submitted",
          at: "2026-10-27T00:30:00.000Z",
        },
      ],
      accessEffects: null,
    },
    {
      id: "fixture-org-failed",
      displayName: "Sahel College",
      orgType: "school",
      lifecycleState: "provisioning_failed",
      country: "NG",
      region: "Kano",
      city: "Kano",
      intendedRuntime: "scholar",
      enabledRuntime: null,
      schoolId: null,
      slug: "sahel-college",
      createdAt: "2026-10-24T00:00:00.000Z",
      updatedAt: "2026-10-25T00:00:00.000Z",
      submittedAt: "2026-10-24T12:00:00.000Z",
      provisionedAt: null,
      activatedAt: null,
      onboardingOwnerName: null,
      assignmentCount: 0,
      legalName: "Sahel College",
      questionnaire: { displayName: "Sahel College", country: "NG" },
      questionnaireStep: "review",
      provisioningError: "Provisioning failed in the local fixture.",
      outstandingRequirements: ["retry_provisioning"],
      createdBy: actor.id,
      submittedBy: actor.id,
      reviewedBy: actor.id,
      activatedBy: null,
      contact: {
        name: "Hauwa Sani",
        email: "hauwa@example.invalid",
        phone: null,
        title: "Registrar",
        method: "email",
      },
      assignments: [],
      transitions: [
        {
          id: "fixture-tr-sahel",
          fromState: "under_review",
          toState: "provisioning_failed",
          actorId: actor.id,
          reason: "provisioning_failed",
          at: "2026-10-25T00:00:00.000Z",
        },
      ],
      accessEffects: null,
    },
  ];
}

function fixtureDemoOps() {
  const actor = CONSOLE_FIXTURE_OPERATOR;
  const at = "2026-10-27T12:00:00.000Z";
  return {
    tickets: [
      {
        id: "fixture-ticket-1",
        organizationId: "fixture-org-active",
        organizationName: "Riverside School",
        subject: "Administrator cannot open Scholar",
        body: "Local fixture ticket. No live tenant session is opened.",
        status: "open",
        priority: "normal",
        openedBy: actor.name,
        assignedTo: null,
        createdAt: at,
        updatedAt: at,
        resolvedAt: null,
      },
    ],
    incidents: [
      {
        id: "fixture-incident-1",
        organizationId: null,
        organizationName: null,
        title: "Fixture process check",
        details: "Local fixture incident. This is not a production event.",
        severity: "low",
        status: "open",
        openedBy: actor.name,
        createdAt: at,
        updatedAt: at,
        resolvedAt: null,
      },
    ],
  };
}

type FixtureOrganizationRow = {
  id: string;
  displayName: string;
  lifecycleState: string;
  country?: string | null;
  region?: string | null;
  city?: string | null;
  enabledRuntime?: "scholar" | null;
  schoolId?: string | null;
  slug?: string | null;
  createdAt?: string;
  updatedAt?: string;
  submittedAt?: string | null;
  provisionedAt?: string | null;
  activatedAt?: string | null;
  onboardingOwnerName?: string | null;
  assignmentCount?: number;
  assignments?: OrganizationAssignmentRecord[];
  transitions?: Array<{
    id: string;
    fromState: OrganizationLifecycleState | null;
    toState: OrganizationLifecycleState;
    actorId: string | null;
    reason: string | null;
    at: string;
  }>;
};

function emptyOrganizationMetrics() {
  return {
    available: true as const,
    source: "local visual fixture organization store",
    total: 0,
    active: 0,
    onboarding: 0,
    suspended: 0,
    failedProvisioning: 0,
    submitted: 0,
    conversionRate: null as number | null,
    medianOnboardingHours: null as number | null,
  };
}

export function readFixtureOrganizationSnapshot(raw: string | null): {
  metrics: ReturnType<typeof emptyOrganizationMetrics>;
  organizations: ConsoleOverview["organizations"];
  assignments: OrganizationAssignmentRecord[];
  activity: ConsoleActivityItem[];
} {
  const empty = {
    metrics: emptyOrganizationMetrics(),
    organizations: [] as ConsoleOverview["organizations"],
    assignments: [] as OrganizationAssignmentRecord[],
    activity: [] as ConsoleActivityItem[],
  };
  if (!raw) return empty;
  try {
    const parsed = JSON.parse(raw) as { organizations?: FixtureOrganizationRow[] };
    const rows = Array.isArray(parsed.organizations) ? parsed.organizations : [];
    const states = rows.map((row) => row.lifecycleState).filter(isOrganizationLifecycleState);
    const assignments = rows.flatMap((row) =>
      (row.assignments ?? []).filter((item) => item.status === "active"),
    );
    const activity = rows
      .flatMap((row) =>
        (row.transitions ?? []).map((item) => ({
          id: item.id,
          description: `${row.displayName}: ${item.fromState ?? "none"} → ${item.toState}`,
          actor:
            item.actorId === CONSOLE_FIXTURE_OPERATOR.id
              ? CONSOLE_FIXTURE_OPERATOR.name
              : item.actorId,
          target: row.displayName,
          at: item.at,
          outcome: "recorded",
          action: item.reason ?? item.toState,
        })),
      )
      .sort((left, right) => (left.at < right.at ? 1 : -1))
      .slice(0, 12);
    return {
      metrics: {
        ...empty.metrics,
        ...summarizeOrganizationStates(states),
      },
      organizations: rows.map((row) => {
        const lifecycleState = isOrganizationLifecycleState(row.lifecycleState)
          ? row.lifecycleState
          : ("draft" as const);
        const activeAssignments = (row.assignments ?? []).filter(
          (item) => item.status === "active",
        );
        return {
          id: row.id,
          displayName: row.displayName,
          orgType: "school" as const,
          lifecycleState,
          country: row.country ?? null,
          region: row.region ?? null,
          city: row.city ?? null,
          intendedRuntime: "scholar" as const,
          enabledRuntime: row.enabledRuntime ?? null,
          schoolId: row.schoolId ?? null,
          slug: row.slug ?? null,
          createdAt: row.createdAt ?? "2026-10-27T00:00:00.000Z",
          updatedAt: row.updatedAt ?? "2026-10-27T00:00:00.000Z",
          submittedAt: row.submittedAt ?? null,
          provisionedAt: row.provisionedAt ?? null,
          activatedAt: row.activatedAt ?? null,
          onboardingOwnerName:
            row.onboardingOwnerName ??
            activeAssignments.find((item) => item.assignmentType === "onboarding_owner")
              ?.staffName ??
            null,
          assignmentCount: row.assignmentCount ?? activeAssignments.length,
        };
      }),
      assignments,
      activity,
    };
  } catch {
    return empty;
  }
}

function fixtureOrganizationSnapshot() {
  if (typeof window === "undefined") return readFixtureOrganizationSnapshot(null);
  try {
    return readFixtureOrganizationSnapshot(window.sessionStorage.getItem(CONSOLE_FIXTURE_ORGS_KEY));
  } catch {
    return readFixtureOrganizationSnapshot(null);
  }
}

function fixtureOrganizationMetricsCards(
  snapshot: ReturnType<typeof readFixtureOrganizationSnapshot>,
): ConsoleMetric[] {
  const source = snapshot.metrics.source;
  const cards: ConsoleMetric[] = [
    {
      key: "control-plane-organizations",
      name: "Control-plane organizations",
      value: String(snapshot.metrics.total),
      unit: "organizations",
      window: "current",
      source,
      updatedAt: null,
      available: true,
      definition: "Organization lifecycle cases recorded in the local visual fixture store.",
    },
    {
      key: "active-organizations",
      name: "Active organizations",
      value: String(snapshot.metrics.active),
      unit: "organizations",
      window: "current",
      source,
      updatedAt: null,
      available: true,
      definition: "Fixture cases in state active.",
    },
    {
      key: "onboarding-organizations",
      name: "Organizations onboarding",
      value: String(snapshot.metrics.onboarding),
      unit: "organizations",
      window: "current",
      source,
      updatedAt: null,
      available: true,
      definition:
        "Fixture cases that have started and are not yet active, suspended, or deactivated.",
    },
    {
      key: "suspended-organizations",
      name: "Suspended organizations",
      value: String(snapshot.metrics.suspended),
      unit: "organizations",
      window: "current",
      source,
      updatedAt: null,
      available: true,
      definition: "Fixture cases in state suspended. Records are retained.",
    },
    {
      key: "active-staff",
      name: "Active Internal Staff",
      value: null,
      unit: "people",
      window: "current active memberships",
      source: "not queried",
      updatedAt: null,
      available: false,
      definition: "Not collected in the local visual fixture.",
    },
  ];
  if (snapshot.metrics.conversionRate !== null) {
    cards.splice(4, 0, {
      key: "onboarding-conversion",
      name: "Onboarding completion rate",
      value: formatRatio(snapshot.metrics.conversionRate),
      unit: "%",
      window: "all recorded cases",
      source,
      updatedAt: null,
      available: true,
      definition: "Active fixture cases divided by cases that have left draft.",
    });
  }
  return cards;
}

function fixtureAttention(
  snapshot: ReturnType<typeof readFixtureOrganizationSnapshot>,
): ConsoleAttentionItem[] {
  const items: ConsoleAttentionItem[] = [
    {
      id: "fixture-store",
      severity: "medium",
      title: "Persistent workspace storage is not connected",
      description:
        "This local fixture uses compatibility workspaces from role membership. Custom members cannot be stored.",
      detectedAt: "2026-10-27T00:00:00.000Z",
      resource: "Workspaces",
      owner: null,
      nextAction: "Review workspace directory",
      href: CONSOLE_PATHS.workspaces,
    },
  ];
  if (snapshot.metrics.failedProvisioning > 0) {
    items.unshift({
      id: "provisioning-failed",
      severity: "high",
      title: `${snapshot.metrics.failedProvisioning} provisioning failure${snapshot.metrics.failedProvisioning === 1 ? "" : "s"}`,
      description: "Provisioning failed for one or more fixture organization cases.",
      detectedAt: "2026-10-27T00:00:00.000Z",
      resource: "Organizations",
      owner: null,
      nextAction: "Open organization directory",
      href: CONSOLE_PATHS.organizations,
    });
  }
  if (snapshot.metrics.onboarding > 0) {
    items.unshift({
      id: "onboarding-pipeline",
      severity: "medium",
      title: `${snapshot.metrics.onboarding} organization${snapshot.metrics.onboarding === 1 ? "" : "s"} in the onboarding pipeline`,
      description: "These fixture cases are not yet active.",
      detectedAt: "2026-10-27T00:00:00.000Z",
      resource: "Organizations",
      owner: null,
      nextAction: "Review onboarding",
      href: CONSOLE_PATHS.organizations,
    });
  }
  return items;
}

export function buildConsoleVisualFixtureOverview(
  persona: ConsoleFixturePersona = readSelectedFixturePersona(),
): ConsoleOverview {
  const roles = [...persona.roles];
  const capabilities = [...viewerCapabilities(roles, persona.isSuperAdmin)];
  const workspaces = workspacesForViewer({
    displayName: persona.name,
    isSuperAdmin: persona.isSuperAdmin,
    roles,
  });
  const snapshot = fixtureOrganizationSnapshot();
  const canReadOrgs = persona.isSuperAdmin || capabilities.includes("platform.tenants.read");
  const canAudit = persona.isSuperAdmin || capabilities.includes("platform.audit.read");
  const unauthorizedOrgMetrics = {
    available: false,
    source: "not authorized",
    total: null,
    active: null,
    onboarding: null,
    suspended: null,
    failedProvisioning: null,
    submitted: null,
    conversionRate: null,
    medianOnboardingHours: null,
  };
  const healthCards = [
    {
      key: "platform",
      name: "Platform process",
      status: "unknown" as const,
      detail: "Process health is not queried in the local visual fixture.",
      lastCheck: null,
      href: CONSOLE_PATHS.activityMetrics,
      source: "local visual fixture",
    },
    {
      key: "scholar",
      name: "Sherivs Scholar",
      status: "unknown" as const,
      detail: "Runtime health is not queried in the local visual fixture.",
      lastCheck: null,
      href: CONSOLE_PATHS.scholar,
      source: "local visual fixture",
    },
    {
      key: "database",
      name: "Database",
      status: "unknown" as const,
      detail: "Persistent Internal Console storage is not connected in this fixture.",
      lastCheck: null,
      href: CONSOLE_PATHS.workspaces,
      source: "local visual fixture",
    },
    {
      key: "auth",
      name: "Authentication",
      status: "unknown" as const,
      detail: "This session is a local fixture operator, not a production identity.",
      lastCheck: null,
      href: CONSOLE_PATHS.account,
      source: "local visual fixture",
    },
  ];
  return {
    viewer: {
      id: persona.id,
      name: persona.name,
      email: persona.email,
      isSuperAdmin: persona.isSuperAdmin,
      roles,
      presentationRole: presentationRoleFor({ isSuperAdmin: persona.isSuperAdmin, roles }),
      presentationLabel: presentationRoleLabel({ isSuperAdmin: persona.isSuperAdmin, roles }),
      capabilities,
    },
    context: {
      organization: "Sherivs Internal",
      workspace:
        workspaces.find((workspace) => workspace.type === "role")?.name ??
        workspaces[0]?.name ??
        "My Workspace",
      environment: "Development",
      environmentSource: "local visual fixture",
      host: "127.0.0.1",
      version: null,
    },
    health: {
      overall: overallFromCards(healthCards.map((card) => card.status)),
      cards: healthCards,
      caveat: "These statuses describe the local visual fixture, not a live environment.",
    },
    metrics: canReadOrgs
      ? fixtureOrganizationMetricsCards(snapshot)
      : fixtureOrganizationMetricsCards(snapshot).filter(
          (metric) =>
            !metric.key.includes("organization") && metric.key !== "onboarding-conversion",
        ),
    attention: fixtureAttention(snapshot).filter((item) => {
      if (
        item.href === CONSOLE_PATHS.organizations ||
        item.href.startsWith(`${CONSOLE_PATHS.organizations}/`)
      ) {
        return canReadOrgs;
      }
      return true;
    }),
    activity: canAudit ? snapshot.activity : [],
    workspaces,
    workspaceStore: "derived-fallback",
    runtimes: [...REGISTERED_RUNTIMES],
    recent: [],
    staff: [],
    staffAvailable: true,
    pendingInvitations: 0,
    expiredInvitations: 0,
    activeStaff: 0,
    usageDefinition:
      "Fixture directory is empty. No synthetic staff rows are shown as if they were live records.",
    organizations: canReadOrgs ? snapshot.organizations : [],
    organizationStore: canReadOrgs ? "fixture" : "unavailable",
    organizationMetrics: canReadOrgs ? snapshot.metrics : unauthorizedOrgMetrics,
    assignments: canReadOrgs
      ? snapshot.assignments.filter((item) => item.staffId === persona.id)
      : [],
    scholarTenants: null,
    registeredUsers: null,
    activeUsers30d: null,
  };
}

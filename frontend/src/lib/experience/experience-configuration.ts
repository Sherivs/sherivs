/**
 * Experience configuration.
 *
 * Organization reality, installed runtime, capabilities, role context and
 * theme resolve to the chrome a person is allowed to see. This function
 * does not authorize. It withholds navigation the caller has not been given.
 * Server authorization remains the boundary.
 */

export type ExperiencePlane =
  | "public"
  | "organization-public"
  | "application-shell"
  | "organization-workspace"
  | "internal-workspace"
  | "runtime"
  | "account"
  | "mobile";

export interface ExperienceNavItem {
  readonly id: string;
  readonly label: string;
  /** Null when the item is universal public chrome. */
  readonly requiredCapability: string | null;
  /** Null when the item is platform-universal. Set to a runtime id to gate it. */
  readonly runtimeId: string | null;
  readonly href: string;
}

export interface ExperienceConfigurationInput {
  readonly plane: ExperiencePlane;
  readonly installedRuntimeIds: readonly string[];
  readonly capabilities: ReadonlySet<string>;
  readonly authenticated: boolean;
}

export interface ExperienceConfiguration {
  readonly plane: ExperiencePlane;
  readonly visible: readonly ExperienceNavItem[];
  readonly withheld: readonly ExperienceNavItem[];
}

export const ORGANIZATION_WORKSPACE_NAV: readonly ExperienceNavItem[] = [
  { id: "overview", label: "Overview", requiredCapability: null, runtimeId: null, href: "/runtime" },
  { id: "people", label: "People", requiredCapability: "workspace.people", runtimeId: null, href: "/runtime" },
  { id: "work", label: "Work", requiredCapability: "workspace.work", runtimeId: null, href: "/runtime" },
  { id: "missions", label: "Missions", requiredCapability: "workspace.missions", runtimeId: null, href: "/runtime" },
  { id: "memory", label: "Memory", requiredCapability: "workspace.memory", runtimeId: null, href: "/runtime" },
  { id: "calendar", label: "Calendar", requiredCapability: "workspace.calendar", runtimeId: null, href: "/runtime" },
  { id: "workforce", label: "AI Workforce", requiredCapability: "workspace.workforce", runtimeId: null, href: "/runtime" },
  { id: "governance", label: "Governance", requiredCapability: "workspace.governance", runtimeId: null, href: "/runtime" },
  { id: "settings", label: "Settings", requiredCapability: null, runtimeId: null, href: "/settings" },
];

/** Education sections appear only when that runtime is installed. */
export const ORGANIZATION_PUBLIC_SECTIONS: readonly ExperienceNavItem[] = [
  { id: "identity", label: "Identity", requiredCapability: null, runtimeId: null, href: "/" },
  { id: "about", label: "About", requiredCapability: null, runtimeId: null, href: "/" },
  { id: "contact", label: "Contact", requiredCapability: null, runtimeId: null, href: "/" },
  { id: "programs", label: "Programs", requiredCapability: null, runtimeId: "runtime:scholar", href: "/" },
  { id: "admissions", label: "Admissions", requiredCapability: null, runtimeId: "runtime:scholar", href: "/admissions" },
];

export const INTERNAL_WORKSPACE_NAV: readonly ExperienceNavItem[] = [
  { id: "executive", label: "Executive", requiredCapability: "internal.executive", runtimeId: null, href: "/super-admin/dashboard" },
  { id: "missions", label: "Missions", requiredCapability: "internal.missions", runtimeId: null, href: "/super-admin/worker-missions" },
  { id: "security", label: "Security", requiredCapability: "internal.security", runtimeId: null, href: "/super-admin/trust-fabric" },
  { id: "operations", label: "Operations", requiredCapability: "internal.operations", runtimeId: null, href: "/command-centre" },
];

const NAV_BY_PLANE: Record<ExperiencePlane, readonly ExperienceNavItem[]> = {
  public: [],
  "organization-public": ORGANIZATION_PUBLIC_SECTIONS,
  "application-shell": ORGANIZATION_WORKSPACE_NAV,
  "organization-workspace": ORGANIZATION_WORKSPACE_NAV,
  "internal-workspace": INTERNAL_WORKSPACE_NAV,
  runtime: ORGANIZATION_WORKSPACE_NAV,
  account: [
    { id: "settings", label: "Settings", requiredCapability: null, runtimeId: null, href: "/settings" },
  ],
  mobile: ORGANIZATION_WORKSPACE_NAV,
};

export function resolveExperienceConfiguration(
  input: ExperienceConfigurationInput,
): ExperienceConfiguration {
  const source = NAV_BY_PLANE[input.plane];
  const visible: ExperienceNavItem[] = [];
  const withheld: ExperienceNavItem[] = [];

  for (const item of source) {
    if (item.runtimeId !== null && !input.installedRuntimeIds.includes(item.runtimeId)) {
      withheld.push(item);
      continue;
    }
    if (item.requiredCapability !== null && !input.capabilities.has(item.requiredCapability)) {
      withheld.push(item);
      continue;
    }
    if (input.plane !== "public" && input.plane !== "organization-public" && !input.authenticated && item.requiredCapability !== null) {
      withheld.push(item);
      continue;
    }
    visible.push(item);
  }

  return { plane: input.plane, visible, withheld };
}

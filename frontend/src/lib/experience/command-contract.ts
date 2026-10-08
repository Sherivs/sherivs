/**
 * Command admission.
 *
 * The command surface may only offer actions the caller is allowed to see.
 * Missing a capability is a denial. The UI still does not grant the action;
 * the server re-checks on execution.
 */

export interface CommandAction {
  readonly id: string;
  readonly label: string;
  readonly href: string;
  /** Null means any signed-in person may see it. */
  readonly requiredCapability: string | null;
  readonly requiresAuthentication: boolean;
}

export interface CommandAdmission {
  readonly admitted: readonly CommandAction[];
  readonly denied: readonly CommandAction[];
}

export const PLATFORM_COMMANDS: readonly CommandAction[] = [
  {
    id: "search",
    label: "Search",
    href: "/runtime",
    requiredCapability: null,
    requiresAuthentication: true,
  },
  {
    id: "open-settings",
    label: "Open settings",
    href: "/settings",
    requiredCapability: null,
    requiresAuthentication: true,
  },
  {
    id: "open-notifications",
    label: "View notifications",
    href: "/notifications",
    requiredCapability: null,
    requiresAuthentication: true,
  },
  {
    id: "create-mission",
    label: "Create mission",
    href: "/super-admin/worker-missions",
    requiredCapability: "mission.create",
    requiresAuthentication: true,
  },
  {
    id: "invite-member",
    label: "Invite member",
    href: "/admin/staff-accounts",
    requiredCapability: "member.invite",
    requiresAuthentication: true,
  },
  {
    id: "open-internal",
    label: "Open internal workspace",
    href: "/command-centre",
    requiredCapability: "internal.operations",
    requiresAuthentication: true,
  },
];

export function admitCommands(
  actions: readonly CommandAction[],
  input: { authenticated: boolean; capabilities: ReadonlySet<string> },
): CommandAdmission {
  const admitted: CommandAction[] = [];
  const denied: CommandAction[] = [];

  for (const action of actions) {
    if (action.requiresAuthentication && !input.authenticated) {
      denied.push(action);
      continue;
    }
    if (action.requiredCapability !== null && !input.capabilities.has(action.requiredCapability)) {
      denied.push(action);
      continue;
    }
    admitted.push(action);
  }

  return { admitted, denied };
}

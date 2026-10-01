/**
 * CoreGrid — platform shell profile menu contract (ADR-003, GAP-008).
 *
 * The profile menu is platform chrome: its identity block and destinations
 * are derived here from server-resolved session data, with platform-owned
 * neutral paths only. Menu rendering never grants — every destination is
 * independently backend-enforced (AGENTS §34).
 */

/** Platform-owned destinations the profile menu offers. */
export interface ShellProfileDestination {
  readonly key: string;
  readonly label: string;
  readonly url: string;
}

export interface ShellProfileIdentity {
  readonly displayName: string;
  readonly roleTitle: string;
  /** Workspace the session resolution established, when one is in scope. */
  readonly workspaceName: string | null;
}

export interface ShellProfileMenu {
  readonly identity: ShellProfileIdentity;
  readonly destinations: readonly ShellProfileDestination[];
}

/**
 * Build the profile menu read model. Destinations are fixed, platform-owned,
 * neutral paths — the menu invents nothing per-domain.
 */
export function buildProfileMenu(identity: ShellProfileIdentity): ShellProfileMenu {
  return {
    identity,
    destinations: [
      { key: "settings", label: "Settings", url: "/settings" },
      { key: "notifications", label: "Notifications", url: "/notifications" },
    ],
  };
}

/** Initials block used by the menu trigger (falls back honestly, never fakes a name). */
export function profileInitials(displayName: string): string {
  const trimmed = displayName.trim();
  if (trimmed === "") return "?";
  const parts = trimmed.split(/\s+/u).slice(0, 2);
  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("");
}

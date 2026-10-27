/**
 * Plane C application shell paths.
 *
 * Catalog routes such as `/admin/students` stay as provenance on nav items.
 * The shell never restores the deleted `_authenticated` tree; it opens every
 * section through `/home`.
 */

export const APP_SHELL_HOME = "/home";
export const APP_SHELL_AI = "/home/ai";
export const APP_SHELL_PROFILE = "/home/profile";
export const APP_SHELL_SETTINGS = "/home/settings";
export const APP_SHELL_SECURITY = "/home/security";
export const APP_SHELL_HELP = "/home/help";
export const APP_SHELL_NOTIFICATIONS = "/home/notifications";

export function appShellSectionPath(key: string): string {
  return `${APP_SHELL_HOME}/s/${encodeURIComponent(key)}`;
}

export function parseAppShellSectionKey(raw: string | undefined): string | null {
  if (!raw) return null;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

export const APP_SHELL_ACCOUNT_PATHS = [
  APP_SHELL_PROFILE,
  APP_SHELL_SETTINGS,
  APP_SHELL_SECURITY,
  APP_SHELL_HELP,
  APP_SHELL_NOTIFICATIONS,
  APP_SHELL_AI,
] as const;

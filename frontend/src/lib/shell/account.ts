import {
  APP_SHELL_HELP,
  APP_SHELL_PROFILE,
  APP_SHELL_SECURITY,
  APP_SHELL_SETTINGS,
} from "./paths";

/** Account stack shown directly under the drawer portrait. */
export const SHELL_ACCOUNT_NAV = [
  { key: "account.profile", label: "Profile", icon: "user", href: APP_SHELL_PROFILE },
  { key: "account.settings", label: "Settings", icon: "settings", href: APP_SHELL_SETTINGS },
  {
    key: "account.security",
    label: "Biometric and authentication",
    icon: "fingerprint",
    href: APP_SHELL_SECURITY,
  },
  { key: "account.help", label: "Help and support", icon: "help", href: APP_SHELL_HELP },
] as const;

export type ShellAccountKey = (typeof SHELL_ACCOUNT_NAV)[number]["key"];

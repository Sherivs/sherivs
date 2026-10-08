/**
 * Account surface inventory.
 *
 * Only `available` rows have a working control. Unavailable rows are named so
 * the product does not imply MFA, sessions, or deletion exist.
 */

export type AccountSurfaceStatus = "available" | "unavailable";

export interface AccountSurface {
  id: string;
  label: string;
  status: AccountSurfaceStatus;
  note: string;
}

export const ACCOUNT_SURFACES: readonly AccountSurface[] = [
  {
    id: "profile",
    label: "Profile",
    status: "available",
    note: "Name, phone, address, avatar, and emergency contact.",
  },
  {
    id: "password",
    label: "Password",
    status: "available",
    note: "Changed through the signed-in identity session.",
  },
  {
    id: "privacy",
    label: "Privacy",
    status: "available",
    note: "Opt out of digital-twin references to your data.",
  },
  {
    id: "appearance",
    label: "Appearance",
    status: "available",
    note: "Light, dark, and system theme from the workspace chrome.",
  },
  {
    id: "mfa",
    label: "Multi-factor authentication",
    status: "unavailable",
    note: "No enrollment surface is offered.",
  },
  {
    id: "passkey",
    label: "Passkey",
    status: "unavailable",
    note: "Not offered.",
  },
  {
    id: "sessions",
    label: "Sessions and devices",
    status: "unavailable",
    note: "Sign-out ends the current session. A device inventory is not offered.",
  },
  {
    id: "export",
    label: "Data export",
    status: "unavailable",
    note: "Not offered from this account surface.",
  },
  {
    id: "deletion",
    label: "Account deletion",
    status: "unavailable",
    note: "Not offered from this account surface.",
  },
];

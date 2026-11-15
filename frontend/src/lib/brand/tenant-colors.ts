import { parseHexColor } from "./tenant-contrast";

/**
 * schools.primary_color / secondary_color default to the legacy teal/amber pair
 * at the database level, so almost every school row carries those values even
 * though nobody chose them. Treat that untouched legacy default as "no custom
 * colour" so the Sherivs brand (CSS defaults in styles.css) applies; any colour
 * an admin actually picked is still honoured.
 */
export const LEGACY_DEFAULT_PRIMARY = "#0d9488";
export const LEGACY_DEFAULT_SECONDARY = "#f59e0b";
export const SHERIVS_PRIMARY = "#184efd";
export const SHERIVS_SECONDARY = "#a872fc";

const norm = (c: string | null | undefined) => (c ?? "").trim().toLowerCase();

export function customTenantColors(
  primary: string | null | undefined,
  secondary: string | null | undefined,
): { primary: string | null; secondary: string | null } {
  const p = norm(primary);
  const s = norm(secondary);
  const legacyPair = p === LEGACY_DEFAULT_PRIMARY && (s === "" || s === LEGACY_DEFAULT_SECONDARY);
  // A value that is not a hex colour would be written into a CSS variable and break every
  // button that uses it, so it counts as "no custom colour".
  return {
    primary: !p || legacyPair || !parseHexColor(p) ? null : primary!.trim(),
    secondary: !s || legacyPair || !parseHexColor(s) ? null : secondary!.trim(),
  };
}

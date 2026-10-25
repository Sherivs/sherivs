/** Group console (SHERIVS-B06): console.<label>.sherivs.com for proprietors with several schools. All checks are server-side. */
import { rpc } from "@/lib/scholar/rpc";

export const GROUP_ROOT = "sherivs.com";
const LABEL = /^[a-z][a-z0-9-]{1,30}[a-z0-9]$/;
export const RESERVED_GROUP_LABELS = ["www", "console", "api", "admin", "app", "gov", "mail", "status", "auth", "login"] as const;

/** console.<label>.sherivs.com -> label; anything else -> null. */
export function groupLabelFromHost(host: string | null | undefined): string | null {
  const h = (host ?? "").toLowerCase().replace(/:\d+$/, "").replace(/\.$/, "");
  const m = /^console\.([^.]+)\.sherivs\.com$/.exec(h);
  return m && validGroupLabel(m[1]) ? m[1] : null;
}
export const validGroupLabel = (l: string) => LABEL.test(l) && !(RESERVED_GROUP_LABELS as readonly string[]).includes(l);
export const groupConsoleHost = (label: string) => `console.${label}.${GROUP_ROOT}`;

export type GroupSession = { status: "ok" | "mfa_required" | "no_access" | "unknown"; group_id?: string; group?: string; role?: "owner" | "admin" | "viewer" };
export type GroupSchool = { school_id: string; school: string; suppressed: boolean; enrolled: number | null; teachers: number | null; ptr: number | null; attendance_pct: number | null; pass_rate_pct: number | null };
export type GroupOverview = { schools: number; suppressed: boolean; enrolled: number | null; teachers: number | null; attendance_pct_30d: number | null; pass_rate_pct: number | null; per_school: GroupSchool[] };

export const groupSession = (label: string) => rpc<GroupSession>("group_console_session", { p_label: label });
export const groupOverview = (g: string) => rpc<GroupOverview>("group_overview", { p_group: g });
export const canManage = (role: GroupSession["role"] | undefined) => role === "owner" || role === "admin";

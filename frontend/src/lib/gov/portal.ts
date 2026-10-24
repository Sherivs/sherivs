/**
 * Government portal (SHERIVS-027): its own workspace type, separate from school roles.
 * Officers sign in with a normal account; access comes only from gov_viewers rows that
 * Sherivs staff grant. All numbers are server-side aggregates; any group built on fewer
 * than 10 students arrives as null with suppressed=true and is shown as "<10".
 */
import { rpc } from "@/lib/scholar/rpc";

export type GovJurisdiction = { id: string; name: string; state: string; lga: string | null };
export type GovGroup = { schools: number; suppressed: boolean; enrolled: number | null; attendance_pct: number | null };
export type GovOverview = {
  schools: number; suppressed: boolean; enrolled: number | null; girls_pct: number | null;
  attendance_pct_30d: number | null; pass_rate_pct: number | null;
  per_school: { school: string; lga: string; ownership: string; suppressed: boolean; enrolled: number | null; girls_pct: number | null; attendance_pct: number | null; pass_rate_pct: number | null }[];
  by_ownership: (GovGroup & { ownership: string })[];
  by_lga: (GovGroup & { lga: string })[];
};
export type GovTrendWeek = { week: string; suppressed: boolean; attendance_pct: number | null };

export const GOV_NAV = [
  { to: "/gov", label: "Overview" },
  { to: "/gov/schools", label: "Schools" },
  { to: "/gov/attendance", label: "Attendance trend" },
  { to: "/gov/inspections", label: "Inspections" },
  { to: "/gov/circulars", label: "Circulars" },
  { to: "/gov/about", label: "About this data" },
] as const;

export const SMALL_GROUP = 10;
export const cell = (v: number | null | undefined, suppressed?: boolean, suffix = "") =>
  suppressed ? `<${SMALL_GROUP}` : v == null ? "—" : `${v.toLocaleString("en-NG")}${suffix}`;

export const govMyJurisdictions = () => rpc<GovJurisdiction[]>("gov_my_jurisdictions");
export const govOverview = (j: string, year?: string) => rpc<GovOverview>("gov_overview", { p_jurisdiction: j, p_year: year || null });
export const govTrend = (j: string, weeks = 12) => rpc<GovTrendWeek[]>("gov_attendance_trend", { p_jurisdiction: j, p_weeks: weeks });

const KEY = "sherivs.gov.jurisdiction";
export const loadJurisdiction = () => (typeof window === "undefined" ? "" : window.localStorage.getItem(KEY) ?? "");
export const saveJurisdiction = (id: string) => { if (typeof window !== "undefined") window.localStorage.setItem(KEY, id); };

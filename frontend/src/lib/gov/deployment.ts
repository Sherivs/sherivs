/** Gov console (SHERIVS-B05): teacher deployment and CSV exports. All checks are server-side. */
import { rpc } from "@/lib/scholar/rpc";

export type StaffingRow = { school_id: string; school: string; lga: string | null; ownership: string | null; learners: number | null; teachers: number | null; ptr: number | null; understaffed: boolean | null; suppressed: boolean };
export type Posting = {
  id: string; teacher_name: string; teacher_ref: string; subject: string | null; from_school: string | null; to_school: string; effective_date: string;
  reason: string; status: "proposed" | "approved" | "rejected" | "cancelled"; decision_note: string | null; released: boolean; received: boolean; mine?: boolean;
  direction?: "incoming" | "outgoing"; other_school?: string | null; authority?: string;
};
export const EXPORT_KINDS = ["schools", "staffing", "inspections", "circulars", "postings"] as const;
export type ExportKind = (typeof EXPORT_KINDS)[number];

export const DEPLOY_ROLES = {
  propose: ["planning_officer", "director", "commissioner", "permanent_secretary", "board_chair"],
  decide: ["director", "commissioner", "permanent_secretary", "board_chair"],
  export: ["data_officer", "planning_officer", "director", "commissioner", "permanent_secretary", "board_chair"],
} as const;
export const canDeploy = (role: string | null | undefined, what: keyof typeof DEPLOY_ROLES) => !!role && (DEPLOY_ROLES[what] as readonly string[]).includes(role);

/** Mirrors the DB check on teacher_ref: 3-40 chars, letters, digits, dash, slash. */
export const validTeacherRef = (s: string) => /^[A-Za-z0-9/-]{3,40}$/.test(s.trim());

/** Pupil-teacher ratio band used for colouring; null when suppressed. */
export function ptrBand(r: Pick<StaffingRow, "ptr" | "suppressed">, threshold = 40): "ok" | "high" | "critical" | null {
  if (r.suppressed || r.ptr === null) return null;
  return r.ptr > threshold * 1.5 ? "critical" : r.ptr > threshold ? "high" : "ok";
}

/** What a school may do next on an approved posting (release first, then receive). */
export function nextSchoolStep(p: Pick<Posting, "status" | "released" | "received" | "direction" | "from_school">): "release" | "receive" | "wait" | null {
  if (p.status !== "approved" || p.received) return null;
  if (p.direction === "outgoing") return p.released ? null : "release";
  return p.released || !p.from_school ? "receive" : "wait";
}

export const govStaffing = (j: string) => rpc<StaffingRow[]>("gov_staffing", { p_jurisdiction: j });
export const govPostings = (j: string) => rpc<Posting[]>("gov_postings_list", { p_jurisdiction: j });
export const govExport = (j: string, kind: ExportKind) => rpc<{ filename: string; rows: number; csv: string }>("gov_export", { p_jurisdiction: j, p_kind: kind });

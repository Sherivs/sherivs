/** Gov console modules (SHERIVS-B03): inspections and circulars. All checks are server-side. */
import { rpc } from "@/lib/scholar/rpc";

export const INSPECTION_DOMAINS = [
  ["leadership", "Leadership & management"], ["teaching", "Teaching quality"], ["learning_environment", "Learning environment"],
  ["safety_welfare", "Safety & welfare"], ["records", "Records"], ["community", "Community & parents"],
] as const;
export type InspectionDomain = (typeof INSPECTION_DOMAINS)[number][0];

export type Inspection = {
  id: string; school?: string; school_id?: string; authority?: string; kind: string; scheduled_for: string;
  status: "scheduled" | "completed" | "cancelled"; scores: Partial<Record<InspectionDomain, number>> | null;
  summary: string | null; recommendations: string | null; follow_up_due: string | null; school_response: string | null; mine?: boolean;
};
export type Circular = {
  id: string; ref_no: string | null; title: string; body: string; published_at: string; requires_ack: boolean;
  lgas?: string[] | null; withdrawn?: boolean; recipients?: number; acked?: number; authority?: string; acked_at?: string | null;
};

/** Valid score map: at least three known domains, each 1..5. Mirrors gov_inspection_record. */
export function validScores(s: Record<string, number | undefined>): boolean {
  const known = new Set<string>(INSPECTION_DOMAINS.map(([k]) => k));
  const set = Object.entries(s).filter(([, v]) => v !== undefined);
  return set.length >= 3 && set.every(([k, v]) => known.has(k) && Number.isInteger(v) && (v as number) >= 1 && (v as number) <= 5);
}

export function averageScore(s: Inspection["scores"]): number | null {
  const v = Object.values(s ?? {}).filter((x): x is number => typeof x === "number");
  return v.length ? Math.round((v.reduce((a, b) => a + b, 0) / v.length) * 10) / 10 : null;
}

export const WRITE_ROLES = {
  inspect: ["inspector", "director", "commissioner", "permanent_secretary", "board_chair"],
  publish: ["director", "commissioner", "permanent_secretary", "board_chair"],
} as const;
export const canDo = (role: string | null | undefined, what: keyof typeof WRITE_ROLES) => !!role && (WRITE_ROLES[what] as readonly string[]).includes(role);

export const govInspections = (j: string) => rpc<Inspection[]>("gov_inspections_list", { p_jurisdiction: j });
export const govCirculars = (j: string) => rpc<Circular[]>("gov_circulars_list", { p_jurisdiction: j });

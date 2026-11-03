import { z } from "zod";

export const MobilityAdvisoryEvidenceSchema = z.object({
  eligible: z.boolean(),
  unmet: z.array(z.string().max(180)).max(20),
  warnings: z.array(z.string().max(180)).max(20),
  average_pct: z.number().min(0).max(100).nullable(),
  attendance_pct: z.number().min(0).max(100).nullable(),
  outstanding_balance: z.number().min(0),
  occupied_seats: z.number().int().min(0).nullable(),
  target_capacity: z.number().int().min(0).nullable(),
  required_approvals: z.number().int().min(1).max(3),
  fee_clearance: z.enum(["block", "warn", "allow"]),
});

export const MobilityAdvisorySchema = z.object({
  headline: z.string().trim().min(3).max(100),
  recommendation: z.string().trim().min(3).max(300),
  rationale: z.string().trim().min(3).max(500),
  evidence: z.array(z.string().trim().min(1).max(180)).min(1).max(6),
  limitations: z.string().trim().min(3).max(300),
});

export type MobilityAdvisory = z.infer<typeof MobilityAdvisorySchema>;
export type MobilityAdvisoryResult = MobilityAdvisory & {
  aiProvenance: {
    generated: true;
    trust: string;
    model: string;
    notice: string;
  };
};
export type MobilityAdvisoryEvidence = z.infer<typeof MobilityAdvisoryEvidenceSchema>;

export function mobilityAdvisoryEvidence(value: unknown): MobilityAdvisoryEvidence {
  const parsed = MobilityAdvisoryEvidenceSchema.parse(value);
  return {
    eligible: parsed.eligible,
    unmet: parsed.unmet,
    warnings: parsed.warnings,
    average_pct: parsed.average_pct,
    attendance_pct: parsed.attendance_pct,
    outstanding_balance: parsed.outstanding_balance,
    occupied_seats: parsed.occupied_seats,
    target_capacity: parsed.target_capacity,
    required_approvals: parsed.required_approvals,
    fee_clearance: parsed.fee_clearance,
  };
}

export function mobilityAdvisoryEvidenceReferences(evidence: MobilityAdvisoryEvidence): string[] {
  return [
    `Eligibility: ${evidence.eligible}`,
    ...evidence.unmet.map((item) => `Unmet check: ${item}`),
    ...evidence.warnings.map((item) => `Warning: ${item}`),
    `Average score: ${evidence.average_pct === null ? "unavailable" : `${evidence.average_pct}%`}`,
    `Attendance: ${evidence.attendance_pct === null ? "unavailable" : `${evidence.attendance_pct}%`}`,
    `Outstanding balance: ${evidence.outstanding_balance}`,
    `Occupied seats: ${evidence.occupied_seats ?? "unavailable"}`,
    `Target capacity: ${evidence.target_capacity ?? "unavailable"}`,
    `Required approvals: ${evidence.required_approvals}`,
    `Fee clearance: ${evidence.fee_clearance}`,
  ];
}

export function validateMobilityAdvisoryCitations(
  advisory: MobilityAdvisory,
  evidence: MobilityAdvisoryEvidence,
): MobilityAdvisory {
  const allowedReferences = new Set(mobilityAdvisoryEvidenceReferences(evidence));
  if (!advisory.evidence.every((reference) => allowedReferences.has(reference))) {
    throw new Error("The mobility advisory cited evidence outside the verified preview.");
  }
  return advisory;
}

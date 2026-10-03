/**
 * CoreGrid Mobile — mission execution read contracts.
 *
 * Row shapes mirror the web application's foundation-loop persistence
 * contract (`FoundationExecutionRow` / `FoundationVerificationRow` /
 * `FoundationEvidenceRow` in frontend/src/lib/control-plane/foundation-loop.ts)
 * column-for-column, and every response is Zod-validated before a screen
 * renders it (§26: responses are untrusted; a row that fails validation is
 * reported as a contract error, never repaired or fabricated).
 *
 * Reported follow-up: these row contracts exist only as TypeScript
 * interfaces inside frontend/ — extract them to a shared package (§23).
 */
import { z } from "zod";
import {
  EVIDENCE_LIFECYCLES,
  EXECUTION_STATUSES,
  EXTERNAL_EFFECTS,
  VERIFICATION_DECISIONS,
} from "./vocabulary";

const timestamp = z.string().trim().min(1);

/** `cg_execution_record` row (columns per planFoundationLoop). */
export const missionExecutionRowSchema = z.object({
  id: z.string().uuid(),
  idempotency_key: z.string().trim().min(1),
  mission_id: z.string().trim().min(1),
  mission_version: z.string().trim().min(1),
  tenant_id: z.string().uuid(),
  actor_id: z.string().uuid(),
  action: z.string().trim().min(1),
  reality_ref: z.string().uuid(),
  requested_at: timestamp,
  attempt_id: z.string().uuid(),
  started_at: timestamp,
  status: z.enum(EXECUTION_STATUSES),
  reason: z.string().nullable(),
  external_effect: z.enum(EXTERNAL_EFFECTS),
});

export type MissionExecutionRow = z.infer<typeof missionExecutionRowSchema>;

/** `cg_verification_result` row (columns per FoundationVerificationRow). */
export const verificationRowSchema = z.object({
  verification_id: z.string().uuid(),
  execution_id: z.string().uuid(),
  evidence_ids: z.array(z.string().uuid()),
  decision: z.enum(VERIFICATION_DECISIONS),
  reason: z.string().trim().min(1),
});

export type VerificationRow = z.infer<typeof verificationRowSchema>;

/** `cg_foundation_evidence` row (columns per FoundationEvidenceRow). */
export const evidenceRowSchema = z.object({
  evidence_id: z.string().uuid(),
  producer: z.string().trim().min(1),
  actor_id: z.string().uuid(),
  tenant_id: z.string().uuid(),
  observed_at: timestamp,
  recorded_at: timestamp,
  provenance: z.string().trim().min(1),
  integrity: z.string().trim().min(1),
  lifecycle: z.enum(EVIDENCE_LIFECYCLES),
  lineage: z.array(z.string().uuid()),
});

export type EvidenceRow = z.infer<typeof evidenceRowSchema>;

/** Client projection of a mission execution + its verification state. */
export interface MissionExecutionStatusView {
  readonly execution: MissionExecutionRow;
  readonly verification: VerificationRow | null;
}
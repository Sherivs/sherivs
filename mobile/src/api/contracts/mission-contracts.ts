/**
 * CoreGrid Mobile — mission execution read contracts.
 *
 * Row shapes are the SINGLE-SOURCE contracts from `@coregrid/contracts`
 * (formerly mirrored by hand from the web's foundation-loop module — that
 * mirror class is retired: both surfaces now consume one physical source,
 * Constitution §23). Every response is Zod-validated before a screen renders
 * it (§26: responses are untrusted; a row that fails validation is reported
 * as a contract error, never repaired or fabricated).
 */
import { z } from "zod";
import type {
  FoundationEvidenceRow,
  FoundationExecutionRow,
  FoundationVerificationRow,
} from "@coregrid/contracts";
import {
  EVIDENCE_LIFECYCLES,
  EXECUTION_STATUSES,
  EXTERNAL_EFFECTS,
  VERIFICATION_DECISIONS,
} from "@coregrid/contracts";

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

/* ── Compile-time pinning to the shared row contracts ────────────────────────
 * The Zod schemas above are derived validation of the SAME row shapes the web
 * persists (§23). These mutual-assignability assertions fail mobile's
 * typecheck if a schema and its shared contract ever diverge. */

type Identical<A, B> = A extends B ? (B extends A ? true : false) : false;

type ExecutionRowParity = Identical<MissionExecutionRow, FoundationExecutionRow>;
type VerificationRowParity = Identical<VerificationRow, FoundationVerificationRow>;
type EvidenceRowParity = Identical<EvidenceRow, FoundationEvidenceRow>;

const rowParityChecks: readonly [true, true, true] = [
  undefined as unknown as ExecutionRowParity,
  undefined as unknown as VerificationRowParity,
  undefined as unknown as EvidenceRowParity,
];
void rowParityChecks;

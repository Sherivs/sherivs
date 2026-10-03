/**
 * CoreGrid — foundation-loop persistence row contracts (Constitution §23).
 *
 * Single typed source for the `cg_*` kernel row shapes the web's foundation
 * loop persists (`frontend/src/lib/control-plane/foundation-loop.ts`) and the
 * mobile app reads back (RLS-scoped) and Zod-validates
 * (`mobile/src/api/contracts/mission-contracts.ts`). The row interfaces were
 * moved here verbatim from the web module; the web module re-exports them so
 * existing web imports are unchanged.
 */
import type { EvidenceLifecycle, ExecutionStatus, ExternalEffect, VerificationDecision } from "./vocabulary";

/** `cg_execution_record` row (columns per planFoundationLoop). */
export interface FoundationExecutionRow {
  id: string;
  idempotency_key: string;
  mission_id: string;
  mission_version: string;
  tenant_id: string;
  actor_id: string;
  action: string;
  reality_ref: string;
  requested_at: string;
  attempt_id: string;
  started_at: string;
  status: ExecutionStatus;
  reason: string | null;
  external_effect: ExternalEffect;
}

/** `cg_verification_result` row. */
export interface FoundationVerificationRow {
  verification_id: string;
  execution_id: string;
  evidence_ids: string[];
  decision: VerificationDecision;
  reason: string;
}

/** `cg_foundation_evidence` row. */
export interface FoundationEvidenceRow {
  evidence_id: string;
  producer: string;
  actor_id: string;
  tenant_id: string;
  observed_at: string;
  recorded_at: string;
  provenance: string;
  integrity: string;
  lifecycle: EvidenceLifecycle;
  lineage: string[];
}

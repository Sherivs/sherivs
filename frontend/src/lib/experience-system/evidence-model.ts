/**
 * Evidence & verification presentation model.
 *
 * AI and system statements are visually distinguished by what KIND of claim
 * they are, so trust is visible rather than implied:
 *
 *   observation     something the system read from canonical records
 *   inference       derived understanding (never canonical truth)
 *   recommendation  a proposed course of action (untrusted until approved)
 *   action          something that was done (or is being done)
 *   evidence        material that supports a claim
 *   verification    an independent check of a claim
 *
 * This module is presentation logic only. It performs no authorization and
 * never fabricates values: confidence is shown only when supplied.
 */
import type { SherivsPlane } from "./design-tokens";

export const STATEMENT_KINDS = [
  "observation",
  "inference",
  "recommendation",
  "action",
  "evidence",
  "verification",
] as const;
export type StatementKind = (typeof STATEMENT_KINDS)[number];

export interface StatementKindMeta {
  readonly label: string;
  readonly plane: SherivsPlane;
  /** Plain-language trust note, announced to assistive technology. */
  readonly trust: string;
}

export const STATEMENT_KIND_META: Readonly<Record<StatementKind, StatementKindMeta>> = {
  observation: { label: "Observation", plane: "reality", trust: "Read from canonical records" },
  inference: { label: "Inference", plane: "intelligence", trust: "Derived; not canonical truth" },
  recommendation: { label: "Recommendation", plane: "intelligence", trust: "Proposal; not yet approved" },
  action: { label: "Action", plane: "action", trust: "Performed under granted authority" },
  evidence: { label: "Evidence", plane: "evidence", trust: "Supports a claim; has a source" },
  verification: { label: "Verification", plane: "evidence", trust: "Checked independently" },
};

export const VERIFICATION_STATES = [
  "unverified",
  "pending",
  "verified",
  "failed",
  "stale",
] as const;
export type VerificationStateName = (typeof VERIFICATION_STATES)[number];

export const VERIFICATION_STATE_META: Readonly<
  Record<VerificationStateName, { label: string; state: "info" | "success" | "danger" | "warning" | "neutral"; live: boolean }>
> = {
  unverified: { label: "Not verified", state: "neutral", live: false },
  pending: { label: "Verification in progress", state: "info", live: true },
  verified: { label: "Verified", state: "success", live: false },
  failed: { label: "Verification failed", state: "danger", live: false },
  stale: { label: "Verification out of date", state: "warning", live: false },
};

export type ConfidenceBand = "low" | "moderate" | "high";

/** Confidence is a 0..1 value supplied by the producing system; invalid input yields null. */
export function confidenceBand(score: number | null | undefined): ConfidenceBand | null {
  if (typeof score !== "number" || !Number.isFinite(score) || score < 0 || score > 1) return null;
  if (score >= 0.8) return "high";
  if (score >= 0.5) return "moderate";
  return "low";
}

export function confidencePercent(score: number): string {
  return `${Math.round(Math.min(1, Math.max(0, score)) * 100)}%`;
}

export interface ProvenanceStep {
  readonly label: string;
  readonly detail?: string;
  readonly plane?: SherivsPlane;
  /** ISO timestamp, rendered in the viewer's timezone by the component. */
  readonly at?: string;
}

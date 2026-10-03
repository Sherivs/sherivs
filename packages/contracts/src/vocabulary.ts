/**
 * CoreGrid — canonical cross-surface contract vocabularies (Constitution §23).
 *
 * This module is the SINGLE SOURCE OF TRUTH for the closed value sets shared
 * by the web application (frontend/) and the mobile application (mobile/).
 * Both surfaces import these declarations from `@coregrid/contracts`; there
 * is no second declaration to drift against, so contract drift is impossible
 * by construction (replacing the former two-directional mirror pins).
 *
 * Zero runtime dependencies, zero I/O — pure literal tuples and their derived
 * union types. Any vocabulary change lands HERE and propagates to every
 * consumer's typecheck at once.
 */

/* ── Foundation-loop execution vocabulary ─────────────────────────────────── */

export const EXECUTION_STATUSES = ["admitted", "denied", "rolled_back"] as const;
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export const EXTERNAL_EFFECTS = ["none", "recorded_intent", "compensation_required"] as const;
export type ExternalEffect = (typeof EXTERNAL_EFFECTS)[number];

export const EVIDENCE_LIFECYCLES = ["active", "superseded", "revoked"] as const;
export type EvidenceLifecycle = (typeof EVIDENCE_LIFECYCLES)[number];

export const VERIFICATION_DECISIONS = ["verified", "failed", "inconclusive"] as const;
export type VerificationDecision = (typeof VERIFICATION_DECISIONS)[number];

/* ── Identity registry vocabulary (cg_identity CHECK clauses) ─────────────── */

export const IDENTITY_KINDS = [
  "human",
  "organization",
  "agent",
  "service",
  "device",
  "runtime",
] as const;
export type IdentityKind = (typeof IDENTITY_KINDS)[number];

export const IDENTITY_STATES = [
  "provisioned",
  "active",
  "suspended",
  "archived",
  "deleted",
] as const;
export type IdentityState = (typeof IDENTITY_STATES)[number];

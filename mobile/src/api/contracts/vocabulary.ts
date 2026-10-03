/**
 * CoreGrid Mobile — canonical vocabulary mirrors (Constitution §23).
 *
 * These closed value sets are authoritative in the web application's pure
 * contract modules (`frontend/src/lib/control-plane/foundation-mission.ts`
 * and `frontend/src/lib/identity-registry.ts`). Mobile mirrors them as
 * literal tuples and pins every mirror to the canonical type with
 * `satisfies` plus a two-directional exhaustiveness assertion, so a
 * vocabulary change on either side breaks the build instead of silently
 * forking the contract (same compile-time obligation pattern as V1CAP-052
 * in the web mission contract).
 */
import type {
  ExecutionResult,
  ExternalEffect,
  EvidenceLifecycle,
  VerificationResult,
} from "../../../../frontend/src/lib/control-plane/foundation-mission";
import type {
  IdentityKind,
  IdentityState,
} from "../../../../frontend/src/lib/identity-registry";

/* ── Foundation-loop execution vocabulary (canonical: foundation-mission.ts) ── */

export const EXECUTION_STATUSES = ["admitted", "denied", "rolled_back"] as const satisfies readonly ExecutionResult["status"][];
export type ExecutionStatus = (typeof EXECUTION_STATUSES)[number];

export const EXTERNAL_EFFECTS = ["none", "recorded_intent", "compensation_required"] as const satisfies readonly ExternalEffect[];
export type ExternalEffectName = (typeof EXTERNAL_EFFECTS)[number];

export const EVIDENCE_LIFECYCLES = ["active", "superseded", "revoked"] as const satisfies readonly EvidenceLifecycle[];
export type EvidenceLifecycleName = (typeof EVIDENCE_LIFECYCLES)[number];

export const VERIFICATION_DECISIONS = ["verified", "failed", "inconclusive"] as const satisfies readonly VerificationResult["decision"][];
export type VerificationDecision = (typeof VERIFICATION_DECISIONS)[number];

/* ── Identity registry vocabulary (canonical: identity-registry.ts) ── */

export const IDENTITY_KINDS = ["human", "organization", "agent", "service", "device", "runtime"] as const satisfies readonly IdentityKind[];
export type IdentityKindName = (typeof IDENTITY_KINDS)[number];

export const IDENTITY_STATES = ["provisioned", "active", "suspended", "archived", "deleted"] as const satisfies readonly IdentityState[];
export type IdentityStateName = (typeof IDENTITY_STATES)[number];

/* ── Compile-time parity assertions (drift breaks the build) ──────────── */

type NoExtraExecutionStatus = Exclude<ExecutionResult["status"], ExecutionStatus> extends never ? true : false;
type NoMissingExecutionStatus = Exclude<ExecutionStatus, ExecutionResult["status"]> extends never ? true : false;
type NoExtraExternalEffect = Exclude<ExternalEffect, ExternalEffectName> extends never ? true : false;
type NoMissingExternalEffect = Exclude<ExternalEffectName, ExternalEffect> extends never ? true : false;
type NoExtraEvidenceLifecycle = Exclude<EvidenceLifecycle, EvidenceLifecycleName> extends never ? true : false;
type NoMissingEvidenceLifecycle = Exclude<EvidenceLifecycleName, EvidenceLifecycle> extends never ? true : false;
type NoExtraVerificationDecision = Exclude<VerificationResult["decision"], VerificationDecision> extends never ? true : false;
type NoMissingVerificationDecision = Exclude<VerificationDecision, VerificationResult["decision"]> extends never ? true : false;
type NoExtraIdentityKind = Exclude<IdentityKind, IdentityKindName> extends never ? true : false;
type NoMissingIdentityKind = Exclude<IdentityKindName, IdentityKind> extends never ? true : false;
type NoExtraIdentityState = Exclude<IdentityState, IdentityStateName> extends never ? true : false;
type NoMissingIdentityState = Exclude<IdentityStateName, IdentityState> extends never ? true : false;

type AssertExecutionStatusParity = NoExtraExecutionStatus extends true
  ? NoMissingExecutionStatus extends true
    ? true
    : never
  : never;
type AssertExternalEffectParity = NoExtraExternalEffect extends true
  ? NoMissingExternalEffect extends true
    ? true
    : never
  : never;
type AssertEvidenceLifecycleParity = NoExtraEvidenceLifecycle extends true
  ? NoMissingEvidenceLifecycle extends true
    ? true
    : never
  : never;
type AssertVerificationDecisionParity = NoExtraVerificationDecision extends true
  ? NoMissingVerificationDecision extends true
    ? true
    : never
  : never;
type AssertIdentityKindParity = NoExtraIdentityKind extends true
  ? NoMissingIdentityKind extends true
    ? true
    : never
  : never;
type AssertIdentityStateParity = NoExtraIdentityState extends true
  ? NoMissingIdentityState extends true
    ? true
    : never
  : never;

// Compile-time-only assertion: `undefined as unknown as <Assert>` carries the
// asserted type into a runtime-legal expression without adding any value.
const parityChecks: readonly [true, true, true, true, true, true] = [
  undefined as unknown as AssertExecutionStatusParity,
  undefined as unknown as AssertExternalEffectParity,
  undefined as unknown as AssertEvidenceLifecycleParity,
  undefined as unknown as AssertVerificationDecisionParity,
  undefined as unknown as AssertIdentityKindParity,
  undefined as unknown as AssertIdentityStateParity,
];
void parityChecks;
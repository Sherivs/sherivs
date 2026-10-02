/**
 * CoreGrid — Organization onboarding & reality discovery finalization
 * (MISSION-R-43 / V1CAP-090/091, wave 3; tenant-isolation context V1CAP-012).
 *
 * The governed path from an EMPTY tenant to a DISCOVERED OPERATIONAL REALITY,
 * composed additively from owned primitives (reuse, never rebuild):
 *
 * - Tenant structure is created ONLY through the universal org-model
 *   primitives (`org-model.ts`) — there is no parallel org creation path.
 * - Discovery declarations are kernel objects: stamped through the canonical
 *   CoreObject envelope (`kernel/reality.ts`, V1CAP-002) with bi-temporal
 *   validity (V1CAP-004) via the kernel entity write path (`entityDraft`).
 * - Verification composes the evidence-class capture discipline
 *   (`evidence/capture.ts`, J-034/V1CAP-059): only active direct_observation
 *   evidence verifies a declaration; quarantine-class evidence is recorded but
 *   NEVER verifies.
 * - Finalization composes evidence capture for the act itself: the
 *   finalization record is evidence-bearing and is what downstream systems
 *   gate on.
 *
 * Phase discipline (fail closed, never jumped):
 *   tenant_bootstrap -> identity_establishment -> discovery_declaration ->
 *   discovery_verification -> finalized
 *
 * Invariants (Constitution-aligned, fail closed):
 * - AI agents CANNOT bootstrap a tenant: beginning discovery, applying
 *   bootstrap org operations and establishing the initial admin identity
 *   require a human actor (AGENTS §5 — agents are untrusted by default).
 * - Explicit acceptance of an unverified declaration and finalization are
 *   human governance acts (Constitution §21 — AI output is untrusted and
 *   never approves itself).
 * - An unverified discovery NEVER claims verified state: quarantine evidence
 *   and silence both leave a declaration explicitly `unverified`, and
 *   finalization refuses while blocking declarations exist.
 * - Partial onboarding is a FIRST-CLASS state: every pre-finalization record
 *   is explicitly `mid_onboarding` and the downstream finalization gate is
 *   closed — a tenant mid-onboarding is never silently treated as complete.
 * - Finalization is append-only: the record is frozen, produced once, and no
 *   API mutates or removes it.
 * - Cross-tenant isolation: discovery objects never leak across tenants —
 *   every declaration and evidence record is tenant-checked against the
 *   discovery tenant, and the kernel envelope's own provenance tenant law
 *   applies beneath this module.
 *
 * Boundary: pure data + pure functions. No persistence, no I/O, no vendor, no
 * wall-clock sampling (every instant is a supplied parameter).
 */

import {
  addMembership,
  createOrgUnit,
  declareTenantRole,
  emptyOrgModelState,
  orgMembershipRef,
  orgUnitRef,
  principalRef,
  roleRef,
  type OrgDecision,
  type OrgModelState,
  type OrgUnitKind,
  type OrgUnitProfile,
} from "../org-model";
import {
  entityDraft,
  isEnvelopeRef,
  stampKernelDraft,
  type KernelBiTemporalInput,
  type KernelObjectEnvelope,
  type KernelObjectEnvelopeInput,
} from "../kernel/reality";
import { canonicalKernelObjectTypes } from "../kernel/object-type-registry";
import {
  captureEvidence,
  supportsCanonicalTruth,
  DEFAULT_EVIDENCE_RETENTION_POLICY_ID,
  EVIDENCE_OBJECT_TYPE,
  type CapturedEvidence,
  type EvidenceCaptureInput,
} from "../evidence/capture";
import { WORKER_CLASSIFICATIONS, type WorkerClassification } from "../workforce/worker-definition";
import type { TenantId } from "../tenant-core";

/* ─────────────────────────────────────────────────────────────
 * Vocabularies
 * ────────────────────────────────────────────────────────────*/

/**
 * Discovery phases, in the ONLY legal order. Phase-specific operations deny
 * with `phase_order_violation` outside their phase; `advanceDiscoveryPhase`
 * moves exactly one step and never skips or rewinds.
 */
export const DISCOVERY_PHASES = [
  "tenant_bootstrap",
  "identity_establishment",
  "discovery_declaration",
  "discovery_verification",
  "finalized",
] as const;

export type DiscoveryPhase = (typeof DISCOVERY_PHASES)[number];

/**
 * Partial onboarding is first-class: a tenant is explicitly `mid_onboarding`
 * from the moment discovery begins until the finalization act exists.
 */
export type DiscoveryStatus = "mid_onboarding" | "finalized";

/** Whether the acting principal is a human operator or an AI agent. */
export interface DiscoveryActor {
  readonly identityRef: string;
  readonly classification: WorkerClassification;
}

/**
 * Neutral discovery object kinds (domain-neutral reality vocabulary — no
 * school/company/agency terms): what the tenant declares to EXIST.
 */
export const DISCOVERY_OBJECT_KINDS = ["building", "environment", "device", "person"] as const;

export type DiscoveryObjectKind = (typeof DISCOVERY_OBJECT_KINDS)[number];

/** Canonical kernel object type every discovery declaration is stamped as. */
export const DISCOVERY_ENTITY_OBJECT_TYPE = "core.entity";

/**
 * The object-type allowlist injected into composed evidence capture (the
 * MISSION-R-11 registry gate): discovery evidence records are `core.evidence`.
 */
export const DISCOVERY_EVIDENCE_OBJECT_TYPES: readonly string[] = [EVIDENCE_OBJECT_TYPE];

/** Verification states of a declaration. Never collapses the three cases. */
export type DeclarationVerification = "unverified" | "verified" | "accepted_unverified";

/** Recorded human acceptance that a declaration is knowingly unverified. */
export interface UnverifiedAcceptance {
  readonly acceptedBy: string;
  readonly reason: string;
  readonly acceptedAt: string;
}

/* ─────────────────────────────────────────────────────────────
 * Records
 * ────────────────────────────────────────────────────────────*/

/**
 * Stamped kernel entity row backing one declaration: the kernel entity draft
 * guaranteed to carry the canonical CoreObject envelope columns plus the
 * bi-temporal validity columns (V1CAP-002 / V1CAP-004).
 */
export type DiscoveryKernelRow = ReturnType<typeof entityDraft> & KernelObjectEnvelope;

export interface DiscoveryDeclaration {
  readonly declarationId: string;
  readonly tenantRef: TenantId;
  readonly kind: DiscoveryObjectKind;
  readonly label: string;
  readonly verification: DeclarationVerification;
  readonly kernelRow: DiscoveryKernelRow;
  /** Evidence ids captured for this declaration (verified or quarantine). */
  readonly evidenceRefs: readonly string[];
  /** Set only when the declaration was explicitly accepted as unverified. */
  readonly acceptance: UnverifiedAcceptance | null;
}

/**
 * The finalization act: declares the discovery phase complete. Append-only
 * (frozen, produced once), evidence-bearing (the act is captured as
 * `core.evidence`), and the record downstream systems gate on.
 */
export interface DiscoveryFinalization {
  readonly finalizationId: string;
  readonly discoveryId: string;
  readonly tenantRef: TenantId;
  readonly finalizedBy: string;
  readonly finalizedAt: string;
  readonly verifiedDeclarationIds: readonly string[];
  readonly acceptedUnverified: readonly {
    readonly declarationId: string;
    readonly acceptedBy: string;
    readonly reason: string;
    readonly acceptedAt: string;
  }[];
  /** All evidence ids on the discovery at finalization, including the act. */
  readonly evidenceRefs: readonly string[];
  readonly actEvidenceId: string;
  readonly note: string | null;
}

/** Append-only in-memory discovery record for ONE tenant. */
export interface RealityDiscovery {
  readonly discoveryId: string;
  readonly tenantRef: TenantId;
  readonly phase: DiscoveryPhase;
  readonly status: DiscoveryStatus;
  /** Tenant structure — produced exclusively by org-model primitives. */
  readonly orgState: OrgModelState;
  readonly adminIdentityRef: string | null;
  readonly adminEstablishedAt: string | null;
  readonly declarations: ReadonlyMap<string, DiscoveryDeclaration>;
  readonly evidence: ReadonlyMap<string, CapturedEvidence>;
  readonly finalization: DiscoveryFinalization | null;
  readonly startedAt: string;
}

/* ─────────────────────────────────────────────────────────────
 * Fail-closed decision envelope (org-model / capability-gate style)
 * ────────────────────────────────────────────────────────────*/

export type DiscoveryDenyCode =
  | "malformed_input"
  | "phase_order_violation"
  | "phase_exit_requirements_unmet"
  | "finalization_act_required"
  | "ai_bootstrap_rejected"
  | "ai_governance_act_rejected"
  | "org_primitive_denied"
  | "cross_tenant"
  | "duplicate_declaration"
  | "duplicate_evidence"
  | "unknown_declaration"
  | "admin_already_established"
  | "declaration_already_processed"
  | "kernel_object_rejected"
  | "evidence_capture_rejected"
  | "blocking_declarations_outstanding"
  | "already_finalized";

export type DiscoveryDecision<T> =
  | { ok: true; value: T }
  | { ok: false; code: DiscoveryDenyCode; reason: string };

function deny<T>(code: DiscoveryDenyCode, reason: string): DiscoveryDecision<T> {
  return { ok: false, code, reason };
}

function ok<T>(value: T): DiscoveryDecision<T> {
  return { ok: true, value };
}

function isWorkerClassification(value: unknown): value is WorkerClassification {
  return (
    typeof value === "string" && (WORKER_CLASSIFICATIONS as readonly string[]).includes(value)
  );
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

/**
 * Resolve an actor against a human-required act. AI actors are REJECTED (never
 * downgraded) with the caller's deny code — bootstrapping a tenant and
 * governance acts over the discovered reality are human-only.
 */
function resolveHumanActor(
  actor: DiscoveryActor,
  aiCode: DiscoveryDenyCode,
  aiReason: string,
): DiscoveryDecision<DiscoveryActor> {
  if (
    actor == null ||
    !isEnvelopeRef(actor.identityRef, 160) ||
    !isWorkerClassification(actor.classification)
  ) {
    return deny(
      "malformed_input",
      "actor requires an identityRef (1–160 characters) and a 'human'|'ai' classification",
    );
  }
  if (actor.classification === "ai") {
    return deny(aiCode, `${aiReason} (actor "${actor.identityRef.trim()}")`);
  }
  return ok({ identityRef: actor.identityRef.trim(), classification: actor.classification });
}

/* ─────────────────────────────────────────────────────────────
 * Phase 1 — tenant bootstrap (org-model primitives ONLY)
 * ────────────────────────────────────────────────────────────*/

export interface BeginDiscoveryInput {
  readonly discoveryId: string;
  readonly tenantRef: TenantId;
  readonly actor: DiscoveryActor;
  readonly startedAt: string;
}

/**
 * Begin reality discovery for a tenant. The record is born explicitly
 * `mid_onboarding` in the `tenant_bootstrap` phase. AI agents cannot bootstrap
 * a tenant: an AI actor is rejected here, before any structure exists.
 */
export function beginRealityDiscovery(
  input: BeginDiscoveryInput,
): DiscoveryDecision<RealityDiscovery> {
  if (!isEnvelopeRef(input.discoveryId, 160) || !isEnvelopeRef(input.tenantRef, 128)) {
    return deny(
      "malformed_input",
      "discovery requires a discoveryId (1–160 characters) and a tenantRef (1–128 characters)",
    );
  }
  if (!isIsoTimestamp(input.startedAt)) {
    return deny("malformed_input", "startedAt must be a valid ISO-8601 timestamp");
  }
  const actor = resolveHumanActor(
    input.actor,
    "ai_bootstrap_rejected",
    "AI agents cannot bootstrap a tenant — beginning reality discovery is a human governance act",
  );
  if (!actor.ok) return actor;

  return ok({
    discoveryId: input.discoveryId.trim(),
    tenantRef: input.tenantRef,
    phase: "tenant_bootstrap",
    status: "mid_onboarding",
    orgState: emptyOrgModelState(),
    adminIdentityRef: null,
    adminEstablishedAt: null,
    declarations: new Map(),
    evidence: new Map(),
    finalization: null,
    startedAt: input.startedAt,
  });
}

/**
 * Bootstrap operations applied through the org-model primitives, in order.
 * There is deliberately no "direct" org structure vocabulary here: every
 * tenant unit, role and membership is created BY the org model.
 */
export type OrgBootstrapOp =
  | { readonly op: "declare_role"; readonly roleRef: string }
  | {
      readonly op: "create_unit";
      readonly id: string;
      readonly kind: OrgUnitKind;
      readonly parentRef: string | null;
      readonly profile: OrgUnitProfile;
    }
  | {
      readonly op: "add_membership";
      readonly id: string;
      readonly orgUnitRef: string;
      readonly principalRef: string;
      readonly roleRef: string;
    };

/**
 * Apply bootstrap operations through the org-model primitives. Any org-model
 * deny (malformed input, cycles, cross-tenant parents, undeclared roles, …)
 * propagates as `org_primitive_denied` — bootstrap never bypasses or loosens
 * the org model's fail-closed rules. AI actors are rejected.
 */
export function bootstrapTenantOrg(
  state: RealityDiscovery,
  ops: readonly OrgBootstrapOp[],
  actor: DiscoveryActor,
): DiscoveryDecision<RealityDiscovery> {
  if (state.phase !== "tenant_bootstrap") {
    return deny(
      "phase_order_violation",
      `tenant bootstrap operations apply only during tenant_bootstrap (current phase: ${state.phase})`,
    );
  }
  const resolved = resolveHumanActor(
    actor,
    "ai_bootstrap_rejected",
    "AI agents cannot bootstrap a tenant — tenant structure creation is a human act",
  );
  if (!resolved.ok) return resolved;
  if (!Array.isArray(ops)) {
    return deny("malformed_input", "bootstrap operations must be an array");
  }

  let orgState = state.orgState;
  for (let index = 0; index < ops.length; index++) {
    const op = ops[index];
    let decision: OrgDecision<OrgModelState>;
    switch (op.op) {
      case "declare_role":
        decision = declareTenantRole(orgState, state.tenantRef, roleRef(op.roleRef));
        break;
      case "create_unit":
        decision = createOrgUnit(orgState, {
          id: orgUnitRef(op.id),
          tenantRef: state.tenantRef,
          kind: op.kind,
          parentRef: op.parentRef === null ? null : orgUnitRef(op.parentRef),
          profile: op.profile,
        });
        break;
      case "add_membership":
        decision = addMembership(orgState, {
          id: orgMembershipRef(op.id),
          orgUnitRef: orgUnitRef(op.orgUnitRef),
          principalRef: principalRef(op.principalRef),
          roleRef: roleRef(op.roleRef),
        });
        break;
      default:
        decision = {
          outcome: "deny",
          code: "malformed_input",
          reason: `unknown bootstrap operation at #${index}`,
        };
    }
    if (decision.outcome === "deny") {
      return deny(
        "org_primitive_denied",
        `bootstrap operation #${index} denied by the org model (${decision.code}): ${decision.reason}`,
      );
    }
    orgState = decision.value;
  }

  return ok({ ...state, orgState });
}

/* ─────────────────────────────────────────────────────────────
 * Phase advancement (one step, requirements per phase)
 * ────────────────────────────────────────────────────────────*/

/**
 * Advance the discovery EXACTLY one phase. Exit requirements fail closed:
 * - tenant_bootstrap requires a root org unit created through org-model
 *   primitives;
 * - identity_establishment requires the initial human admin identity;
 * - discovery_verification has no phase advance: leaving it is the
 *   FINALIZATION ACT, and any attempt to advance is refused.
 * Finalized discoveries never advance again.
 */
export function advanceDiscoveryPhase(
  state: RealityDiscovery,
): DiscoveryDecision<RealityDiscovery> {
  switch (state.phase) {
    case "finalized":
      return deny(
        "phase_order_violation",
        "discovery is finalized — the phase sequence is append-only and never advances again",
      );
    case "discovery_verification":
      return deny(
        "finalization_act_required",
        "leaving discovery_verification requires the finalization act, not a phase advance",
      );
    case "tenant_bootstrap": {
      let hasRoot = false;
      for (const unit of state.orgState.units.values()) {
        if (unit.tenantRef === state.tenantRef && unit.parentRef === null) {
          hasRoot = true;
          break;
        }
      }
      if (!hasRoot) {
        return deny(
          "phase_exit_requirements_unmet",
          "tenant bootstrap requires a root org unit created through org-model primitives before the phase may close",
        );
      }
      return ok({ ...state, phase: "identity_establishment" });
    }
    case "identity_establishment":
      if (state.adminIdentityRef === null) {
        return deny(
          "phase_exit_requirements_unmet",
          "identity establishment requires the initial human admin identity before the phase may close",
        );
      }
      return ok({ ...state, phase: "discovery_declaration" });
    case "discovery_declaration":
      return ok({ ...state, phase: "discovery_verification" });
  }
}

/* ─────────────────────────────────────────────────────────────
 * Phase 2 — identity establishment (initial human admin)
 * ────────────────────────────────────────────────────────────*/

export interface EstablishAdminIdentityInput {
  readonly identityRef: string;
  readonly classification: WorkerClassification;
  readonly establishedAt: string;
}

/**
 * Establish the initial admin identity. The admin MUST be human: an AI agent
 * cannot bootstrap a tenant, and an AI identity can never be the tenant's
 * initial authority. One-time — re-establishment is rejected.
 */
export function establishAdminIdentity(
  state: RealityDiscovery,
  input: EstablishAdminIdentityInput,
): DiscoveryDecision<RealityDiscovery> {
  if (state.phase !== "identity_establishment") {
    return deny(
      "phase_order_violation",
      `the admin identity is established only during identity_establishment (current phase: ${state.phase})`,
    );
  }
  if (!isEnvelopeRef(input.identityRef, 160)) {
    return deny("malformed_input", "admin identityRef must be 1–160 characters");
  }
  if (!isWorkerClassification(input.classification)) {
    return deny("malformed_input", "admin classification must be 'human' or 'ai'");
  }
  if (!isIsoTimestamp(input.establishedAt)) {
    return deny("malformed_input", "establishedAt must be a valid ISO-8601 timestamp");
  }
  if (input.classification !== "human") {
    return deny(
      "ai_bootstrap_rejected",
      `AI agents cannot bootstrap a tenant: the initial admin identity must be human (received classification "${input.classification}")`,
    );
  }
  if (state.adminIdentityRef !== null) {
    return deny(
      "admin_already_established",
      `admin identity "${state.adminIdentityRef}" was already established at ${state.adminEstablishedAt}`,
    );
  }
  return ok({
    ...state,
    adminIdentityRef: input.identityRef.trim(),
    adminEstablishedAt: input.establishedAt,
  });
}

/* ─────────────────────────────────────────────────────────────
 * Phase 3 — discovery declarations (kernel objects)
 * ────────────────────────────────────────────────────────────*/

export interface DeclareDiscoveryObjectInput {
  readonly declarationId: string;
  readonly tenantRef: TenantId;
  readonly kind: DiscoveryObjectKind;
  readonly label: string;
  readonly attributes?: Record<string, unknown>;
  /** Bi-temporal validity of the declared fact (V1CAP-004): explicit, never assumed. */
  readonly biTemporal: KernelBiTemporalInput;
  /** Canonical CoreObject envelope; object_type must be `core.entity`. */
  readonly envelope: KernelObjectEnvelopeInput;
  readonly actor: DiscoveryActor;
  /** Declaration (record-time) instant — supplied, never sampled. */
  readonly declaredAt: string;
}

/**
 * Declare one discovery object as a kernel entity. The declaration is stamped
 * through the kernel write path (`entityDraft`): canonical CoreObject envelope
 * (no anonymous object, explicit causation root, provenance tenant law) and
 * explicit bi-temporal validity. Declarations are born `unverified` — a
 * declaration is never born verified. Cross-tenant declarations are denied.
 */
export function declareDiscoveryObject(
  state: RealityDiscovery,
  input: DeclareDiscoveryObjectInput,
): DiscoveryDecision<RealityDiscovery> {
  if (state.phase !== "discovery_declaration") {
    return deny(
      "phase_order_violation",
      `declarations are accepted only during discovery_declaration (current phase: ${state.phase})`,
    );
  }
  const actor = resolveHumanActor(
    input.actor,
    "ai_governance_act_rejected",
    "discovery declarations are declared by the tenant's human administrator during onboarding",
  );
  if (!actor.ok) return actor;
  if (!isEnvelopeRef(input.declarationId, 160)) {
    return deny("malformed_input", "declarationId must be 1–160 characters");
  }
  if (input.tenantRef !== state.tenantRef) {
    return deny(
      "cross_tenant",
      `declaration tenant "${input.tenantRef}" does not match discovery tenant "${state.tenantRef}" — discovery objects never leak across tenants`,
    );
  }
  if (!(DISCOVERY_OBJECT_KINDS as readonly string[]).includes(input.kind)) {
    return deny(
      "malformed_input",
      `discovery object kind "${String(input.kind)}" is not a registered discovery kind`,
    );
  }
  if (
    typeof input.label !== "string" ||
    input.label.trim().length < 1 ||
    input.label.trim().length > 200
  ) {
    return deny("malformed_input", "declaration label must be 1–200 characters");
  }
  if (!isIsoTimestamp(input.declaredAt)) {
    return deny("malformed_input", "declaredAt must be a valid ISO-8601 timestamp");
  }
  if (state.declarations.has(input.declarationId)) {
    return deny(
      "duplicate_declaration",
      `declaration "${input.declarationId}" already exists in this discovery`,
    );
  }
  if (input.envelope.objectType !== DISCOVERY_ENTITY_OBJECT_TYPE) {
    return deny(
      "kernel_object_rejected",
      `discovery declarations are kernel entities stamped as "${DISCOVERY_ENTITY_OBJECT_TYPE}", received "${input.envelope.objectType}"`,
    );
  }
  const originTenant = input.envelope.provenance?.originTenantId?.trim() ?? null;
  if (originTenant !== null && originTenant !== input.tenantRef) {
    return deny(
      "cross_tenant",
      `declaration envelope provenance is cross-tenant: origin "${originTenant}" does not match declaration tenant "${input.tenantRef}"`,
    );
  }

  let row: DiscoveryKernelRow;
  try {
    const draft = entityDraft(
      {
        entityType: input.kind,
        tenantId: input.tenantRef,
        state: "declared",
        attributes: { ...(input.attributes ?? {}), label: input.label.trim() },
        biTemporal: input.biTemporal,
      },
      input.declaredAt,
    );
    row = stampKernelDraft(draft, input.envelope, canonicalKernelObjectTypes());
  } catch (error: unknown) {
    return deny(
      "kernel_object_rejected",
      error instanceof Error ? error.message : "kernel entity stamping failed",
    );
  }

  const declaration: DiscoveryDeclaration = {
    declarationId: input.declarationId.trim(),
    tenantRef: input.tenantRef,
    kind: input.kind,
    label: input.label.trim(),
    verification: "unverified",
    kernelRow: row,
    evidenceRefs: [],
    acceptance: null,
  };
  const declarations = new Map(state.declarations);
  declarations.set(declaration.declarationId, declaration);
  return ok({ ...state, declarations });
}

/* ─────────────────────────────────────────────────────────────
 * Phase 4 — discovery verification (evidence or explicit acceptance)
 * ────────────────────────────────────────────────────────────*/

export interface RecordDeclarationEvidenceInput {
  readonly declarationId: string;
  /** Evidence input composed through the canonical capture API (J-034). */
  readonly evidence: EvidenceCaptureInput;
}

/**
 * Record evidence for a declaration by composing the canonical evidence-class
 * capture API. ONLY active direct_observation evidence verifies a declaration
 * (Constitution §9): quarantine-class evidence is recorded and retained but
 * the declaration stays explicitly `unverified` — an unverified discovery
 * never claims verified state. Cross-tenant evidence is denied; the capture
 * API's own fail-closed gates (class, laundering, envelope, retention)
 * propagate as `evidence_capture_rejected`.
 */
export function recordDeclarationEvidence(
  state: RealityDiscovery,
  input: RecordDeclarationEvidenceInput,
): DiscoveryDecision<RealityDiscovery> {
  if (state.phase !== "discovery_verification") {
    return deny(
      "phase_order_violation",
      `declaration evidence is recorded during discovery_verification (current phase: ${state.phase})`,
    );
  }
  const declaration = state.declarations.get(input.declarationId);
  if (declaration === undefined) {
    return deny(
      "unknown_declaration",
      `declaration "${input.declarationId}" does not exist in this discovery`,
    );
  }
  if (input.evidence.tenantId.trim() !== state.tenantRef) {
    return deny(
      "cross_tenant",
      `evidence tenant "${input.evidence.tenantId}" does not match discovery tenant "${state.tenantRef}" — discovery evidence never leaks across tenants`,
    );
  }
  if (state.evidence.has(input.evidence.evidenceId.trim())) {
    return deny(
      "duplicate_evidence",
      `evidence "${input.evidence.evidenceId}" is already recorded in this discovery`,
    );
  }

  let captured: CapturedEvidence;
  try {
    captured = captureEvidence(input.evidence, DISCOVERY_EVIDENCE_OBJECT_TYPES);
  } catch (error: unknown) {
    return deny(
      "evidence_capture_rejected",
      error instanceof Error ? error.message : "evidence capture failed",
    );
  }

  const verification: DeclarationVerification = supportsCanonicalTruth(captured)
    ? "verified"
    : declaration.verification;
  const updated: DiscoveryDeclaration = {
    ...declaration,
    verification,
    evidenceRefs: [...declaration.evidenceRefs, captured.evidence_id],
  };
  const declarations = new Map(state.declarations);
  declarations.set(updated.declarationId, updated);
  const evidence = new Map(state.evidence);
  evidence.set(captured.evidence_id, captured);
  return ok({ ...state, declarations, evidence });
}

export interface AcceptUnverifiedInput {
  readonly declarationId: string;
  readonly acceptedBy: string;
  readonly classification: WorkerClassification;
  /** Why the tenant proceeds without verification (1–1000 characters). */
  readonly reason: string;
  readonly acceptedAt: string;
}

/**
 * EXPLICITLY accept a declaration as unverified. This is a human governance
 * act (Constitution §21) with a recorded reason — the alternative to
 * evidence-based verification, never a silent default. A verified
 * declaration cannot be "un-verified" through acceptance.
 */
export function acceptDeclarationAsUnverified(
  state: RealityDiscovery,
  input: AcceptUnverifiedInput,
): DiscoveryDecision<RealityDiscovery> {
  if (state.phase !== "discovery_verification") {
    return deny(
      "phase_order_violation",
      `unverified acceptance is recorded during discovery_verification (current phase: ${state.phase})`,
    );
  }
  if (!isWorkerClassification(input.classification) || input.classification !== "human") {
    return deny(
      "ai_governance_act_rejected",
      `explicitly accepting a declaration as unverified is a human governance act (Constitution §21) — actor classification "${String(input.classification)}" is rejected`,
    );
  }
  if (!isEnvelopeRef(input.acceptedBy, 160)) {
    return deny("malformed_input", "acceptedBy must be 1–160 characters");
  }
  if (typeof input.reason !== "string" || input.reason.trim().length < 1 || input.reason.trim().length > 1000) {
    return deny("malformed_input", "acceptance reason must be 1–1000 characters");
  }
  if (!isIsoTimestamp(input.acceptedAt)) {
    return deny("malformed_input", "acceptedAt must be a valid ISO-8601 timestamp");
  }
  const declaration = state.declarations.get(input.declarationId);
  if (declaration === undefined) {
    return deny(
      "unknown_declaration",
      `declaration "${input.declarationId}" does not exist in this discovery`,
    );
  }
  if (declaration.verification !== "unverified") {
    return deny(
      "declaration_already_processed",
      `declaration "${input.declarationId}" is already ${declaration.verification}; acceptance applies only to unverified declarations`,
    );
  }
  const acceptance: UnverifiedAcceptance = {
    acceptedBy: input.acceptedBy.trim(),
    reason: input.reason.trim(),
    acceptedAt: input.acceptedAt,
  };
  const updated: DiscoveryDeclaration = {
    ...declaration,
    verification: "accepted_unverified",
    acceptance,
  };
  const declarations = new Map(state.declarations);
  declarations.set(updated.declarationId, updated);
  return ok({ ...state, declarations });
}

/* ─────────────────────────────────────────────────────────────
 * Finalization — the gated, append-only, evidence-bearing act
 * ────────────────────────────────────────────────────────────*/

/** Declarations that block finalization: neither verified nor accepted-unverified. */
export function blockingDeclarationIds(state: RealityDiscovery): readonly string[] {
  return [...state.declarations.values()]
    .filter((declaration) => declaration.verification === "unverified")
    .map((declaration) => declaration.declarationId)
    .sort();
}

export interface FinalizeDiscoveryInput {
  readonly finalizationId: string;
  readonly finalizedBy: string;
  readonly classification: WorkerClassification;
  readonly finalizedAt: string;
  readonly note?: string | null;
}

/**
 * The FINALIZATION ACT. Declares the discovery phase complete and is what
 * downstream systems gate on. Gated:
 * - requires the `discovery_verification` phase (phase discipline);
 * - requires a HUMAN finalizer (Constitution §21);
 * - requires EVERY declaration to be verified or explicitly accepted as
 *   unverified — blocking declarations deny finalization with their ids.
 *
 * The act is evidence-bearing: it composes the canonical capture API to record
 * an attested `core.evidence` record of the finalization itself. The record is
 * append-only (frozen, produced exactly once; re-finalization is rejected and
 * no API mutates or removes it) and the discovery becomes explicitly
 * `finalized` — before the act the tenant stays explicitly `mid_onboarding`.
 */
export function finalizeDiscovery(
  state: RealityDiscovery,
  input: FinalizeDiscoveryInput,
): DiscoveryDecision<RealityDiscovery> {
  if (state.finalization !== null) {
    return deny(
      "already_finalized",
      `discovery "${state.discoveryId}" was finalized at ${state.finalization.finalizedAt} — the finalization record is append-only`,
    );
  }
  if (state.phase !== "discovery_verification") {
    return deny(
      "phase_order_violation",
      `finalization requires the discovery_verification phase (current phase: ${state.phase})`,
    );
  }
  if (!isWorkerClassification(input.classification) || input.classification !== "human") {
    return deny(
      "ai_governance_act_rejected",
      `finalization of a discovered reality is a human governance act (Constitution §21) — actor classification "${String(input.classification)}" is rejected`,
    );
  }
  if (!isEnvelopeRef(input.finalizationId, 160) || !isEnvelopeRef(input.finalizedBy, 160)) {
    return deny(
      "malformed_input",
      "finalization requires a finalizationId and finalizedBy (1–160 characters each)",
    );
  }
  if (!isIsoTimestamp(input.finalizedAt)) {
    return deny("malformed_input", "finalizedAt must be a valid ISO-8601 timestamp");
  }
  if (input.note != null && (typeof input.note !== "string" || input.note.trim().length > 500)) {
    return deny("malformed_input", "finalization note must be at most 500 characters");
  }

  const blocking = blockingDeclarationIds(state);
  if (blocking.length > 0) {
    return deny(
      "blocking_declarations_outstanding",
      `finalization blocked: ${blocking.length} declaration(s) are neither evidence-verified nor explicitly accepted as unverified: ${blocking.join(", ")}`,
    );
  }

  const finalizationId = input.finalizationId.trim();
  const finalizedBy = input.finalizedBy.trim();
  const verifiedDeclarationIds = [...state.declarations.values()]
    .filter((declaration) => declaration.verification === "verified")
    .map((declaration) => declaration.declarationId)
    .sort();
  const acceptedUnverified = [...state.declarations.values()]
    .filter((declaration) => declaration.verification === "accepted_unverified")
    .map((declaration) => ({
      declarationId: declaration.declarationId,
      acceptedBy: declaration.acceptance?.acceptedBy ?? "",
      reason: declaration.acceptance?.reason ?? "",
      acceptedAt: declaration.acceptance?.acceptedAt ?? "",
    }))
    .sort((a, b) => (a.declarationId < b.declarationId ? -1 : a.declarationId > b.declarationId ? 1 : 0));

  const actEvidenceId = `${finalizationId}:act`;
  const actInput: EvidenceCaptureInput = {
    evidenceId: actEvidenceId,
    evidenceType: "discovery_finalization",
    tenantId: state.tenantRef,
    evidenceClass: "attested",
    claim: {
      finalization: {
        discovery_id: state.discoveryId,
        tenant_id: state.tenantRef,
        verified_declaration_ids: verifiedDeclarationIds,
        accepted_unverified: acceptedUnverified.map((entry) => entry.declarationId),
        blocking_declarations: 0,
      },
    },
    retentionPolicyId: DEFAULT_EVIDENCE_RETENTION_POLICY_ID,
    observedAt: input.finalizedAt,
    capturedBy: finalizedBy,
    capturedAt: input.finalizedAt,
    sourceRef: state.discoveryId,
    envelope: {
      objectType: EVIDENCE_OBJECT_TYPE,
      schemaVersion: "1.0",
      status: "active",
      createdBy: finalizedBy,
      updatedBy: finalizedBy,
      provenance: {
        source: "onboarding:reality-discovery:finalization",
        sourceRef: state.discoveryId,
        recordedBy: finalizedBy,
        originTenantId: state.tenantRef,
        generatedByAi: false,
        verified: true,
      },
      policyContext: {
        onboarding_reality_discovery: {
          discovery_id: state.discoveryId,
          finalization_id: finalizationId,
          verified_declarations: verifiedDeclarationIds.length,
          accepted_unverified: acceptedUnverified.length,
        },
      },
      traceId: `discovery:${state.discoveryId}`,
      correlationId: actEvidenceId,
      causationId: state.discoveryId,
    },
  };

  let act: CapturedEvidence;
  try {
    act = captureEvidence(actInput, DISCOVERY_EVIDENCE_OBJECT_TYPES);
  } catch (error: unknown) {
    return deny(
      "evidence_capture_rejected",
      error instanceof Error ? error.message : "finalization evidence capture failed",
    );
  }

  const finalization: DiscoveryFinalization = Object.freeze({
    finalizationId,
    discoveryId: state.discoveryId,
    tenantRef: state.tenantRef,
    finalizedBy,
    finalizedAt: input.finalizedAt,
    verifiedDeclarationIds,
    acceptedUnverified,
    evidenceRefs: [...state.evidence.keys(), act.evidence_id].sort(),
    actEvidenceId: act.evidence_id,
    note: input.note?.trim() || null,
  });

  const evidence = new Map(state.evidence);
  evidence.set(act.evidence_id, act);
  return ok({
    ...state,
    phase: "finalized",
    status: "finalized",
    finalization,
    evidence,
  });
}

/* ─────────────────────────────────────────────────────────────
 * Partial-state explicitness + downstream gate
 * ────────────────────────────────────────────────────────────*/

/**
 * The explicit lifecycle status. A tenant mid-onboarding is EXPLICITLY
 * `mid_onboarding` — never silently treated as complete.
 */
export function discoveryLifecycleStatus(state: RealityDiscovery): DiscoveryStatus {
  return state.finalization !== null ? "finalized" : "mid_onboarding";
}

export type DiscoveryFinalizationGate =
  | { readonly gate: "open"; readonly finalization: DiscoveryFinalization }
  | {
      readonly gate: "closed";
      readonly phase: DiscoveryPhase;
      readonly status: DiscoveryStatus;
      readonly reason: string;
    };

/**
 * The downstream gate over the discovered reality. OPEN only when the
 * append-only finalization record exists; CLOSED (with an explicit, auditable
 * reason naming the partial state) otherwise. Downstream systems gate on the
 * finalization record — never on phase heuristics.
 */
export function discoveryFinalizationGate(state: RealityDiscovery): DiscoveryFinalizationGate {
  if (state.finalization !== null) {
    return { gate: "open", finalization: state.finalization };
  }
  return {
    gate: "closed",
    phase: state.phase,
    status: state.status,
    reason: `tenant is explicitly ${state.status} (phase "${state.phase}"): no finalization record exists, so downstream systems remain gated on the finalization act`,
  };
}
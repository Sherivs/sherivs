/**
 * CoreGrid — Phase 43 Universal Interface & Connectivity Intelligence
 * substrate contracts (H3 wave Squad G, mission G-063; Constitution §7, §9,
 * §12, §15, §16, §21, §34; architecture/phase-43-universal-interface-
 * connectivity-intelligence.md).
 *
 * WHAT: the typed contract surface of the universal connectivity substrate —
 * the phase owns the connector kernel (identity, type, capabilities, data
 * schema, communication method, security rules, trust level, health state,
 * version, owner, lifecycle state), environment discovery, continuous
 * zero-trust verification, protocol translation and reality-data
 * normalization, the interface event fabric, offline queues and
 * synchronization, the universal action gateway, and connector self-healing.
 * It owns NO identity issuance, NO authorization decisions, NO canonical
 * truth, NO vendor protocol implementations, NO model-provider access.
 *
 * Laws of this module:
 * - Interface contracts never carry authorization semantics (AGENTS §34):
 *   this module never computes or emits an ALLOW/DENY-style decision. It
 *   declares security *requirements* (identity, authentication, encryption,
 *   monitoring, audit), checks the *completeness of presented evidence*, and
 *   refuses to proceed without a recorded decision from the platform
 *   authorization engine. Every posture this module returns is an input to
 *   the authorization engine, never a decision.
 * - Zero-trust by construction (phase doc §19): nothing is trusted by
 *   default. A connector has no stored trust level — trust exists only as a
 *   fresh, evidence-bound verification granted by a verification authority.
 *   Expired, mismatched, or absent verification degrades to UNTRUSTED.
 * - Discovered is not trusted (phase doc §8): a discovery candidate is born
 *   labelled UNTRUSTED. There is no schema path to a trusted-looking
 *   candidate, and registration without complete security evidence is
 *   BLOCKED — never silently permitted.
 * - Translation never drops (phase doc §12/§13): protocol translation into
 *   the canonical signal envelope surfaces unmapped fields, missing required
 *   fields and incoercible values as typed failures. A partial translation
 *   is a failed translation.
 * - Canonical truth is not overwritable (AGENTS §9, phase doc §16): a
 *   synchronization conflict between an offline-queued local state and the
 *   canonical state is escalated, never silently resolved in either
 *   direction.
 * - AI output is untrusted (AGENTS §21, phase doc §23): an action proposal
 *   entering the universal action gateway is a proposal only. It becomes
 *   executable only when the platform authorization engine has recorded an
 *   ALLOW decision for it; anything else — including missing evidence — is
 *   BLOCKED.
 * - Perception connectors are observation-only (phase doc §6K/§6L/§6M/§6S):
 *   connector kinds whose role is exclusively perceiving reality can never
 *   declare write, execute or configure actions.
 * - Fail-closed parsing: an untrusted input that violates any invariant
 *   yields a typed failure with structured issues. A failed parse never
 *   yields a partial artifact.
 * - Bounded artifacts: every array, queue, scan and registry carries a hard
 *   ceiling. No unbounded artifacts exist on this surface.
 *
 * Composition: platform composition is read-only — the recorded-decision
 * vocabulary is the authorization engine's §16 vocabulary, imported as a
 * type from the identity module and compile-time checked against it. No
 * sibling wave modules, no vendor imports, no I/O, no persistence, no
 * wall-clock reads — every instant is a supplied parameter — no secrets.
 *
 * Neutral vocabulary only (J-037 shrink-only): this is platform substrate.
 * A "connector" is any bridge between the platform and an external entity
 * (software, hardware, device, human channel, file, environment feed); no
 * domain vocabulary appears here.
 */

import { z } from "zod";
import type { AuthorizationDecision } from "../identity";

/* ─────────────────────────────────────────────────────────────
 * Version and bounds (no unbounded artifacts)
 * ────────────────────────────────────────────────────────────*/

export const UNIVERSAL_INTERFACE_CONTRACT_SCHEMA_VERSION = "1.0";

/** Hard ceiling on declared capabilities per connector record. */
export const MAX_CAPABILITIES = 64;

/** Hard ceiling on declared action kinds per connector record. */
export const MAX_ACTION_KINDS = 8;

/** Hard ceiling on fields in one raw signal sample. */
export const MAX_SIGNAL_FIELDS = 256;

/** Hard ceiling on field mappings in one translation contract. */
export const MAX_MAPPINGS = 512;

/** Hard ceiling on candidates discovered in one environment scan. */
export const MAX_SCAN_CANDIDATES = 4096;

/** Hard ceiling on connectors in one tenant registry. */
export const MAX_REGISTRY_CONNECTORS = 1024;

/** Hard ceiling on queued items in one offline window. */
export const MAX_OFFLINE_QUEUE_ITEMS = 2048;

/** Hard ceiling on presented guard-evidence entries per connection. */
export const MAX_GUARD_EVIDENCE = 16;

/* ─────────────────────────────────────────────────────────────
 * Vocabulary (phase doc §5, §6, §18, §19, §23, §25)
 * ────────────────────────────────────────────────────────────*/

/** Connector kinds (phase doc §6 A–S, rendered as platform-neutral kinds). */
export const CONNECTOR_TYPES = [
  "api",
  "mcp",
  "database",
  "file",
  "local_runtime_bridge",
  "device",
  "serial_device",
  "barcode",
  "qr",
  "rfid_nfc",
  "biometric",
  "camera_vision",
  "sensor",
  "human_interface",
  "browser_automation",
  "email",
  "communication_fabric",
  "web3",
  "external_reality",
] as const;
export type ConnectorType = (typeof CONNECTOR_TYPES)[number];

/** Connector lifecycle states (Constitution §6 lifecycle vocabulary). */
export const CONNECTOR_LIFECYCLE_STATES = [
  "PROPOSED",
  "APPROVED",
  "ACTIVE",
  "DEGRADED",
  "SUSPENDED",
  "RETIRED",
] as const;
export type ConnectorLifecycleState = (typeof CONNECTOR_LIFECYCLE_STATES)[number];

/** Connector pipeline stages (phase doc §4). */
export const CONNECTOR_PIPELINE_STAGES = [
  "discovery",
  "identification",
  "authentication",
  "understanding",
  "mapping",
  "synchronization",
  "monitoring",
  "reasoning",
  "action",
] as const;
export type ConnectorPipelineStage = (typeof CONNECTOR_PIPELINE_STAGES)[number];

/** Trust levels. UNTRUSTED is the default; it is derived, never stored. */
export const TRUST_LEVELS = ["UNTRUSTED", "PROVISIONAL", "VERIFIED", "HARDENED"] as const;
export type TrustLevel = (typeof TRUST_LEVELS)[number];

/** Connector health states. UNKNOWN is the fail-closed default. */
export const HEALTH_STATES = ["HEALTHY", "DEGRADED", "FAILING", "UNKNOWN"] as const;
export type HealthState = (typeof HEALTH_STATES)[number];

/** Action kinds the universal action gateway routes (phase doc §23). */
export const ACTION_KINDS = ["observe", "notify", "write", "execute", "configure"] as const;
export type ActionKind = (typeof ACTION_KINDS)[number];

/** Impact tiers for action proposals (risk-classified routing). */
export const IMPACT_TIERS = ["low", "medium", "high", "critical"] as const;
export type ImpactTier = (typeof IMPACT_TIERS)[number];

/**
 * Security guard kinds every connection must present evidence for
 * (phase doc §18). Authorization is deliberately NOT a guard here: per
 * AGENTS §34 interface contracts never carry authorization semantics —
 * authorization belongs to the platform authorization engine.
 */
export const CONNECTION_GUARD_KINDS = [
  "identity",
  "authentication",
  "encryption",
  "monitoring",
  "audit",
] as const;
export type ConnectionGuardKind = (typeof CONNECTION_GUARD_KINDS)[number];

/** Environment scan scopes for the discovery engine (phase doc §8/§27). */
export const DISCOVERY_SCOPES = ["network", "filesystem", "registry", "manual"] as const;
export type DiscoveryScope = (typeof DISCOVERY_SCOPES)[number];

/** Canonical interface event kinds (phase doc §14). */
export const INTERFACE_EVENT_KINDS = [
  "connection_established",
  "connection_lost",
  "health_degraded",
  "health_recovered",
  "observation_received",
  "translation_failed",
  "sync_conflict",
  "action_proposed",
  "action_executed",
  "verification_expired",
] as const;
export type InterfaceEventKind = (typeof INTERFACE_EVENT_KINDS)[number];

/** Field transforms supported by protocol translation (phase doc §13). */
export const FIELD_TRANSFORMS = ["identity", "trim", "number", "boolean"] as const;
export type FieldTransform = (typeof FIELD_TRANSFORMS)[number];

/** Connector self-healing stages (phase doc §25). */
export const HEALING_STAGES = [
  "detected",
  "diagnosed",
  "repair_proposed",
  "repair_validated",
  "restored",
  "escalated",
] as const;
export type HealingStage = (typeof HEALING_STAGES)[number];

/** Provenance sources (AGENTS §12) for records on this surface. */
export const PROVENANCE_SOURCES = ["connector_observation", "operator_declaration", "derived"] as const;
export type ProvenanceSource = (typeof PROVENANCE_SOURCES)[number];

/* ─────────────────────────────────────────────────────────────
 * Platform decision vocabulary (read-only composition)
 * ────────────────────────────────────────────────────────────*/

/**
 * The platform authorization engine's §16 decision vocabulary. This module
 * never computes a decision (AGENTS §34): the tuple is compile-time checked
 * against the identity module's type so the vocabulary cannot drift, and is
 * used ONLY to recognize a decision that the authorization engine has
 * already recorded elsewhere.
 */
export const PLATFORM_DECISIONS = [
  "ALLOW",
  "DENY",
  "REDACT",
  "ESCALATE",
  "REQUIRE_APPROVAL",
] as const;
export type PlatformDecision = (typeof PLATFORM_DECISIONS)[number];

// Compile-time composition check: this literal tuple must remain a subset of
// the authorization engine's decision type. Drift is a type error, not a
// runtime surprise.
const PLATFORM_DECISION_SPACE_CHECK: readonly AuthorizationDecision[] = PLATFORM_DECISIONS;
void PLATFORM_DECISION_SPACE_CHECK;

export const platformDecisionSchema = z.enum(PLATFORM_DECISIONS);

/* ─────────────────────────────────────────────────────────────
 * Scalar schemas (identifiers, digests, timestamps, provenance)
 * ────────────────────────────────────────────────────────────*/

export const identifierSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9._-]{0,127}$/, "expected bounded lowercase identifier");
export type Identifier = z.infer<typeof identifierSchema>;

/**
 * Universal connectivity identity (phase doc §7): the platform-assigned
 * universal identifier for every connected entity. Uppercase, dash-delimited,
 * platform-issued — never client-invented mid-flight as an authorization
 * claim; here it is context, and ownership/authorization are resolved by the
 * platform.
 */
export const universalIdSchema = z
  .string()
  .regex(/^[A-Z0-9][A-Z0-9-]{2,127}$/, "expected platform-issued universal identity");
export type UniversalId = z.infer<typeof universalIdSchema>;

export const tenantRefSchema = identifierSchema;

export const digestSchema = z
  .string()
  .regex(/^[0-9a-f]{64}$/, "expected sha-256-shaped lowercase hex digest");
export type Digest = z.infer<typeof digestSchema>;

export const timestampSchema = z.string().datetime();

export const versionSchema = z.string().regex(/^\d+\.\d+\.\d+$/, "expected semver triple");

export const nonEmptyString = (label: string) =>
  z.string().min(1, `${label} must be non-empty`).max(1024, `${label} exceeds 1024 chars`);

export const provenanceSchema = z.strictObject({
  recordedBy: identifierSchema,
  recordedAt: timestampSchema,
  source: z.enum(PROVENANCE_SOURCES),
  note: z.string().max(1024).optional(),
});
export type Provenance = z.infer<typeof provenanceSchema>;

/* ─────────────────────────────────────────────────────────────
 * Connector kernel (phase doc §5)
 * ────────────────────────────────────────────────────────────*/

export const connectorRecordSchema = z.strictObject({
  connectorId: identifierSchema,
  universalId: universalIdSchema,
  tenantId: tenantRefSchema,
  kind: z.enum(CONNECTOR_TYPES),
  displayName: z.string().min(1).max(256),
  version: versionSchema,
  owner: identifierSchema,
  lifecycleState: z.enum(CONNECTOR_LIFECYCLE_STATES),
  actionKinds: z.array(z.enum(ACTION_KINDS)).max(MAX_ACTION_KINDS),
  capabilities: z.array(identifierSchema).max(MAX_CAPABILITIES),
  /** Content fingerprint binding verification evidence to this record. */
  fingerprint: digestSchema,
  registeredAt: timestampSchema,
  updatedAt: timestampSchema,
  provenance: provenanceSchema,
});
export type ConnectorRecord = z.infer<typeof connectorRecordSchema>;

/**
 * Observation-only connector kinds (phase doc §6K, §6L, §6M, §6S): kinds
 * whose role is exclusively perceiving reality. The platform does not own
 * what they perceive — it consumes observed signals — so they may never
 * carry write, execute or configure actions.
 */
export const OBSERVATION_ONLY_CONNECTOR_KINDS: readonly ConnectorType[] = [
  "biometric",
  "camera_vision",
  "sensor",
  "external_reality",
];

export function isObservationOnlyConnectorKind(kind: ConnectorType): boolean {
  return OBSERVATION_ONLY_CONNECTOR_KINDS.includes(kind);
}

/** Well-formed lifecycle edges. Governance performs the transitions; this
 * module only rejects edges that are structurally meaningless. */
const LIFECYCLE_EDGES: Readonly<Record<ConnectorLifecycleState, readonly ConnectorLifecycleState[]>> = {
  PROPOSED: ["APPROVED", "RETIRED"],
  APPROVED: ["ACTIVE", "RETIRED"],
  ACTIVE: ["DEGRADED", "SUSPENDED", "RETIRED"],
  DEGRADED: ["ACTIVE", "SUSPENDED", "RETIRED"],
  SUSPENDED: ["ACTIVE", "RETIRED"],
  RETIRED: [],
};

export type LifecycleTransitionVerdict =
  | { readonly ok: true; readonly from: ConnectorLifecycleState; readonly to: ConnectorLifecycleState }
  | { readonly ok: false; readonly from: ConnectorLifecycleState; readonly to: ConnectorLifecycleState; readonly reason: string };

export function lifecycleTransition(
  from: ConnectorLifecycleState,
  to: ConnectorLifecycleState,
): LifecycleTransitionVerdict {
  const allowed = LIFECYCLE_EDGES[from];
  if (allowed.includes(to)) {
    return { ok: true, from, to };
  }
  return {
    ok: false,
    from,
    to,
    reason: `lifecycle edge ${from} -> ${to} is not a well-formed connector transition`,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Continuous zero-trust verification (phase doc §18/§19)
 * ────────────────────────────────────────────────────────────*/

export const connectionVerificationSchema = z
  .strictObject({
    connectorId: identifierSchema,
    verifiedAt: timestampSchema,
    verifiedUntil: timestampSchema,
    grantedTrustLevel: z.enum(TRUST_LEVELS),
    method: identifierSchema,
    /** Digest of the verified connector fingerprint (evidence binding). */
    evidenceDigest: digestSchema,
  })
  .refine((verification) => verification.verifiedUntil > verification.verifiedAt, {
    message: "verification window must end strictly after it starts",
  })
  .refine((verification) => verification.grantedTrustLevel !== "UNTRUSTED", {
    message: "a verification authority cannot grant UNTRUSTED — absence of verification is already UNTRUSTED",
  });
export type ConnectionVerification = z.infer<typeof connectionVerificationSchema>;

/**
 * Effective trust level of a connector at instant `now`. Fail-closed by
 * construction: absent, mismatched, evidence-unbound, or expired
 * verification degrades to UNTRUSTED. Trust is derived here, never stored on
 * the connector record — there is no schema path to a trusted-looking
 * connector.
 */
export function effectiveTrustLevel(
  connector: ConnectorRecord,
  verification: ConnectionVerification | undefined,
  now: string,
): TrustLevel {
  if (verification === undefined) return "UNTRUSTED";
  if (verification.connectorId !== connector.connectorId) return "UNTRUSTED";
  if (verification.evidenceDigest !== connector.fingerprint) return "UNTRUSTED";
  if (now >= verification.verifiedUntil) return "UNTRUSTED";
  if (now < verification.verifiedAt) return "UNTRUSTED";
  return verification.grantedTrustLevel;
}

/* ─────────────────────────────────────────────────────────────
 * Connection security guard posture (phase doc §18; AGENTS §34)
 * ────────────────────────────────────────────────────────────*/

export const guardEvidenceEntrySchema = z.strictObject({
  kind: z.enum(CONNECTION_GUARD_KINDS),
  reference: identifierSchema,
});
export type GuardEvidenceEntry = z.infer<typeof guardEvidenceEntrySchema>;

export const guardEvidenceSchema = z.strictObject({
  guards: z.array(guardEvidenceEntrySchema).max(MAX_GUARD_EVIDENCE),
});
export type GuardEvidence = z.infer<typeof guardEvidenceSchema>;

export type ConnectionGuardPosture =
  | { readonly status: "SATISFIED"; readonly guards: readonly ConnectionGuardKind[] }
  | {
      readonly status: "UNSATISFIED";
      readonly missing: readonly ConnectionGuardKind[];
      readonly detail: string;
    };

/**
 * Evidence-completeness check for a connection (phase doc §18). This is NOT
 * an authorization decision (AGENTS §34): a SATISFIED posture only means the
 * presented evidence covers every mandated guard — identity, authentication,
 * encryption, monitoring, audit — and remains an input to the platform
 * authorization engine. Duplicate guard entries do not inflate coverage.
 */
export function connectionGuardPosture(
  connector: ConnectorRecord,
  evidence: GuardEvidence,
): ConnectionGuardPosture {
  const presented = new Set<ConnectionGuardKind>();
  for (const entry of evidence.guards) {
    presented.add(entry.kind);
  }
  const missing = CONNECTION_GUARD_KINDS.filter((kind) => !presented.has(kind));
  if (missing.length > 0) {
    return {
      status: "UNSATISFIED",
      missing,
      detail: `fail-closed: connection evidence for ${connector.connectorId} is incomplete — missing guards: ${missing.join(", ")}; the platform authorization engine must not proceed on incomplete evidence`,
    };
  }
  return { status: "SATISFIED", guards: [...CONNECTION_GUARD_KINDS] };
}

/* ─────────────────────────────────────────────────────────────
 * Discovery engine (phase doc §8, §27) — discovered is not trusted
 * ────────────────────────────────────────────────────────────*/

export const discoveryCandidateSchema = z.strictObject({
  candidateId: identifierSchema,
  connectorKind: z.enum(CONNECTOR_TYPES),
  fingerprint: digestSchema,
  observedProtocols: z.array(identifierSchema).max(16),
  discoveredAt: timestampSchema,
  /** Literal labelling: a discovery candidate is always UNTRUSTED (§8). */
  trustLevel: z.literal("UNTRUSTED"),
});
export type DiscoveryCandidate = z.infer<typeof discoveryCandidateSchema>;

export const discoveryScanSchema = z.strictObject({
  scanId: identifierSchema,
  tenantId: tenantRefSchema,
  scope: z.enum(DISCOVERY_SCOPES),
  requestedBy: identifierSchema,
  requestedAt: timestampSchema,
  candidates: z.array(discoveryCandidateSchema).max(MAX_SCAN_CANDIDATES),
  provenance: provenanceSchema,
});
export type DiscoveryScan = z.infer<typeof discoveryScanSchema>;

export const registrationInputSchema = z.strictObject({
  connectorId: identifierSchema,
  grantedUniversalId: universalIdSchema.optional(),
  displayName: z.string().min(1).max(256),
  version: versionSchema,
  owner: identifierSchema,
  actionKinds: z.array(z.enum(ACTION_KINDS)).max(MAX_ACTION_KINDS),
  capabilities: z.array(identifierSchema).max(MAX_CAPABILITIES),
  guardEvidence: guardEvidenceSchema,
});
export type RegistrationInput = z.infer<typeof registrationInputSchema>;

export type RegistrationVerdict =
  | {
      readonly status: "REGISTERED";
      readonly connector: ConnectorRecord;
    }
  | {
      readonly status: "BLOCKED";
      readonly candidateId: Identifier;
      readonly reason:
        | "unknown_candidate"
        | "candidate_not_untrusted"
        | "missing_universal_identity"
        | "guards_unsatisfied"
        | "observation_only_elevation";
      readonly detail: string;
    };

/**
 * Register a discovered candidate as a connector record. Fail-closed:
 * unknown candidate, a candidate that is not labelled UNTRUSTED, a missing
 * platform-issued universal identity, or incomplete guard evidence is
 * BLOCKED — never silently permitted. A registered connector starts in the
 * PROPOSED lifecycle state; activation is a governance act performed
 * elsewhere, and trust is never stored on the record.
 */
export function registerCandidate(
  scan: DiscoveryScan,
  candidateId: Identifier,
  input: RegistrationInput,
): RegistrationVerdict {
  const candidate = scan.candidates.find((entry) => entry.candidateId === candidateId);
  if (candidate === undefined) {
    return {
      status: "BLOCKED",
      candidateId,
      reason: "unknown_candidate",
      detail: "fail-closed: no such candidate in the scan — discovered state cannot be invented",
    };
  }
  if (candidate.trustLevel !== "UNTRUSTED") {
    return {
      status: "BLOCKED",
      candidateId,
      reason: "candidate_not_untrusted",
      detail: "fail-closed: a discovered candidate must be labelled UNTRUSTED until registered and verified",
    };
  }
  if (input.grantedUniversalId === undefined) {
    return {
      status: "BLOCKED",
      candidateId,
      reason: "missing_universal_identity",
      detail: "fail-closed: registration requires a platform-issued universal identity — self-issued identity is not accepted",
    };
  }
  const posture = connectionGuardPosture(
    {
      connectorId: input.connectorId,
      universalId: input.grantedUniversalId,
      tenantId: scan.tenantId,
      kind: candidate.connectorKind,
      displayName: input.displayName,
      version: input.version,
      owner: input.owner,
      lifecycleState: "PROPOSED",
      actionKinds: input.actionKinds,
      capabilities: input.capabilities,
      fingerprint: candidate.fingerprint,
      registeredAt: scan.requestedAt,
      updatedAt: scan.requestedAt,
      provenance: scan.provenance,
    },
    input.guardEvidence,
  );
  if (posture.status === "UNSATISFIED") {
    return {
      status: "BLOCKED",
      candidateId,
      reason: "guards_unsatisfied",
      detail: posture.detail,
    };
  }
  const observationOnly = isObservationOnlyConnectorKind(candidate.connectorKind);
  const elevated = input.actionKinds.filter((kind) => kind !== "observe");
  if (observationOnly && elevated.length > 0) {
    return {
      status: "BLOCKED",
      candidateId,
      reason: "observation_only_elevation",
      detail: `fail-closed: observation-only connector kind ${candidate.connectorKind} cannot declare non-observation action kinds (${elevated.join(", ")})`,
    };
  }
  const record: ConnectorRecord = {
    connectorId: input.connectorId,
    universalId: input.grantedUniversalId,
    tenantId: scan.tenantId,
    kind: candidate.connectorKind,
    displayName: input.displayName,
    version: input.version,
    owner: input.owner,
    lifecycleState: "PROPOSED",
    actionKinds: input.actionKinds,
    capabilities: input.capabilities,
    fingerprint: candidate.fingerprint,
    registeredAt: scan.requestedAt,
    updatedAt: scan.requestedAt,
    provenance: scan.provenance,
  };
  return { status: "REGISTERED", connector: record };
}

/* ─────────────────────────────────────────────────────────────
 * Tenant connector registry (multi-tenancy law, AGENTS §13)
 * ────────────────────────────────────────────────────────────*/

export const universalInterfaceRegistrySchema = z.strictObject({
  registryId: identifierSchema,
  tenantId: tenantRefSchema,
  connectors: z.array(connectorRecordSchema).max(MAX_REGISTRY_CONNECTORS),
  updatedAt: timestampSchema,
  provenance: provenanceSchema,
});
export type UniversalInterfaceRegistry = z.infer<typeof universalInterfaceRegistrySchema>;

export type ContractIssue = { readonly path: string; readonly message: string };

export type RegistryParseResult =
  | { readonly ok: true; readonly registry: UniversalInterfaceRegistry }
  | {
      readonly ok: false;
      readonly reason: "invalid_shape" | "cross_record_invariant";
      readonly issues: readonly ContractIssue[];
    };


/**
 * Parse a tenant connector registry. Fail-closed: shape failures never yield
 * partial registries, and cross-record invariants (duplicate identifiers,
 * tenant-context coherence, observation-only action bounds, updatedAt
 * ordering) are enforced at the registry boundary, not left to callers.
 */
export function parseUniversalInterfaceRegistry(
  input: unknown,
): RegistryParseResult {
  const parsed = universalInterfaceRegistrySchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "invalid_shape",
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.map((segment) => String(segment)).join("."),
        message: issue.message,
      })),
    };
  }
  const registry = parsed.data;
  const issues: ContractIssue[] = [];

  const seenConnectors = new Set<string>();
  const seenUniversal = new Set<string>();
  for (const connector of registry.connectors) {
    if (seenConnectors.has(connector.connectorId)) {
      issues.push({
        path: `connectors[connectorId=${connector.connectorId}]`,
        message: "duplicate connectorId — one connector identity binds once per registry",
      });
    }
    seenConnectors.add(connector.connectorId);
    if (seenUniversal.has(connector.universalId)) {
      issues.push({
        path: `connectors[universalId=${connector.universalId}]`,
        message: "duplicate universalId — one universal identity binds once per registry",
      });
    }
    seenUniversal.add(connector.universalId);
    if (connector.tenantId !== registry.tenantId) {
      issues.push({
        path: `connectors[connectorId=${connector.connectorId}].tenantId`,
        message: "connector tenant context diverges from the registry tenant context",
      });
    }
    if (connector.updatedAt < connector.registeredAt) {
      issues.push({
        path: `connectors[connectorId=${connector.connectorId}].updatedAt`,
        message: "updatedAt precedes registeredAt — records never move backwards in time",
      });
    }
    if (isObservationOnlyConnectorKind(connector.kind)) {
      const elevated = connector.actionKinds.filter((kind) => kind !== "observe");
      if (elevated.length > 0) {
        issues.push({
          path: `connectors[connectorId=${connector.connectorId}].actionKinds`,
          message: `observation-only connector kind ${connector.kind} cannot declare action kinds beyond "observe" (declared: ${elevated.join(", ")})`,
        });
      }
    }
  }

  if (issues.length > 0) {
    return { ok: false, reason: "cross_record_invariant", issues };
  }
  return { ok: true, registry };
}

/* ─────────────────────────────────────────────────────────────
 * Signals, protocol translation and normalization (phase doc §12/§13)
 * ────────────────────────────────────────────────────────────*/

export const signalFieldSchema = z.strictObject({
  key: z.string().min(1).max(128),
  value: z.union([z.string().max(4096), z.number().finite(), z.boolean(), z.null()]),
});
export type SignalField = z.infer<typeof signalFieldSchema>;

export const signalSampleSchema = z.strictObject({
  sampleId: identifierSchema,
  connectorId: identifierSchema,
  capturedAt: timestampSchema,
  /** Content digest binding the sample to its provenance and envelopes. */
  contentDigest: digestSchema,
  fields: z.array(signalFieldSchema).max(MAX_SIGNAL_FIELDS),
});
export type SignalSample = z.infer<typeof signalSampleSchema>;

export const fieldMappingSchema = z.strictObject({
  rawKey: z.string().min(1).max(128),
  canonicalKey: identifierSchema,
  transform: z.enum(FIELD_TRANSFORMS),
  required: z.boolean(),
});
export type FieldMapping = z.infer<typeof fieldMappingSchema>;

export const translationContractSchema = z
  .strictObject({
    translationId: identifierSchema,
    connectorId: identifierSchema,
    mappings: z.array(fieldMappingSchema).max(MAX_MAPPINGS),
    provenance: provenanceSchema,
  })
  .refine((contract) => new Set(contract.mappings.map((m) => m.rawKey)).size === contract.mappings.length, {
    message: "each raw key may appear in at most one mapping — ambiguous translation fails closed",
  });
export type TranslationContract = z.infer<typeof translationContractSchema>;

export const canonicalEnvelopeSchema = z.strictObject({
  envelopeId: identifierSchema,
  connectorId: identifierSchema,
  capturedAt: timestampSchema,
  sourceContentDigest: digestSchema,
  fields: z.array(signalFieldSchema).max(MAX_SIGNAL_FIELDS),
  provenance: provenanceSchema,
});
export type CanonicalEnvelope = z.infer<typeof canonicalEnvelopeSchema>;

export type TranslationIssueCode =
  | "invalid_contract"
  | "unmapped_field"
  | "missing_required"
  | "incoercible";

export type TranslationIssue = {
  readonly code: TranslationIssueCode;
  readonly field?: string;
  readonly detail: string;
};

export type TranslationResult =
  | { readonly ok: true; readonly envelope: CanonicalEnvelope }
  | { readonly ok: false; readonly issues: readonly TranslationIssue[] };

/**
 * Translate one raw signal sample into the canonical signal envelope
 * (phase doc §12/§13). Fail-closed: every raw field must be mapped, every
 * required canonical field must be present and non-null, and every transform
 * must be coercible — otherwise the translation fails with typed issues and
 * NO envelope is produced. A partial translation is a failed translation;
 * raw fields are never silently dropped.
 */
export function translateSample(
  sample: SignalSample,
  contract: TranslationContract,
): TranslationResult {
  const contractParsed = translationContractSchema.safeParse(contract);
  if (!contractParsed.success) {
    return {
      ok: false,
      issues: contractParsed.error.issues.map((issue) => ({
        code: "invalid_contract" as const,
        field: issue.path.map((segment) => String(segment)).join("."),
        detail: issue.message,
      })),
    };
  }
  const parsedContract = contractParsed.data;
  const byRawKey = new Map<string, FieldMapping>();
  for (const mapping of parsedContract.mappings) {
    byRawKey.set(mapping.rawKey, mapping);
  }

  const issues: TranslationIssue[] = [];
  const mappedFields: SignalField[] = [];
  const consumedRawKeys = new Set<string>();

  for (const field of sample.fields) {
    const mapping = byRawKey.get(field.key);
    if (mapping === undefined) {
      issues.push({
        code: "unmapped_field",
        field: field.key,
        detail: `raw field "${field.key}" has no mapping — unmapped reality is surfaced, never dropped`,
      });
      continue;
    }
    consumedRawKeys.add(field.key);
    if (field.value === null) {
      if (mapping.required) {
        issues.push({
          code: "missing_required",
          field: mapping.canonicalKey,
          detail: `required canonical field "${mapping.canonicalKey}" is null in the raw sample`,
        });
        continue;
      }
      mappedFields.push({ key: mapping.canonicalKey, value: null });
      continue;
    }
    const coerced = coerce(field.value, mapping.transform);
    if (coerced === undefined) {
      issues.push({
        code: "incoercible",
        field: mapping.canonicalKey,
        detail: `raw field "${field.key}" cannot be coerced by transform "${mapping.transform}"`,
      });
      continue;
    }
    mappedFields.push({ key: mapping.canonicalKey, value: coerced });
  }

  for (const mapping of parsedContract.mappings) {
    if (mapping.required && !consumedRawKeys.has(mapping.rawKey)) {
      issues.push({
        code: "missing_required",
        field: mapping.canonicalKey,
        detail: `required raw field "${mapping.rawKey}" is absent from the sample`,
      });
    }
  }

  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return {
    ok: true,
    envelope: {
      envelopeId: `env_${sample.sampleId}`,
      connectorId: sample.connectorId,
      capturedAt: sample.capturedAt,
      sourceContentDigest: sample.contentDigest,
      fields: mappedFields,
      provenance: {
        recordedBy: `connector_${sample.connectorId}`,
        recordedAt: sample.capturedAt,
        source: "connector_observation",
        note: `translated from sample ${sample.sampleId}`,
      },
    },
  };
}

function coerce(
  value: Exclude<SignalField["value"], null>,
  transform: FieldTransform,
): Exclude<SignalField["value"], null> | undefined {
  switch (transform) {
    case "identity":
      return value;
    case "trim":
      return typeof value === "string" ? value.trim() : undefined;
    case "number":
      if (typeof value === "number") return value;
      if (typeof value === "string" && value.trim() !== "") {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : undefined;
      }
      return undefined;
    case "boolean":
      if (typeof value === "boolean") return value;
      if (value === "true") return true;
      if (value === "false") return false;
      return undefined;
  }
}

/* ─────────────────────────────────────────────────────────────
 * Interface event fabric (phase doc §14/§15)
 * ────────────────────────────────────────────────────────────*/

export const interfaceEventSchema = z.strictObject({
  eventId: identifierSchema,
  connectorId: identifierSchema,
  tenantId: tenantRefSchema,
  kind: z.enum(INTERFACE_EVENT_KINDS),
  occurredAt: timestampSchema,
  contentDigest: digestSchema,
  provenance: provenanceSchema,
});
export type InterfaceEvent = z.infer<typeof interfaceEventSchema>;

/* ─────────────────────────────────────────────────────────────
 * Offline connectivity and synchronization (phase doc §16; AGENTS §9)
 * ────────────────────────────────────────────────────────────*/

export const offlineQueueItemSchema = z.strictObject({
  itemId: identifierSchema,
  capturedAt: timestampSchema,
  sample: signalSampleSchema,
});
export type OfflineQueueItem = z.infer<typeof offlineQueueItemSchema>;

export const offlineQueueSchema = z
  .strictObject({
    queueId: identifierSchema,
    connectorId: identifierSchema,
    tenantId: tenantRefSchema,
    windowStart: timestampSchema,
    windowEnd: timestampSchema,
    items: z.array(offlineQueueItemSchema).max(MAX_OFFLINE_QUEUE_ITEMS),
  })
  .refine((queue) => queue.windowEnd >= queue.windowStart, {
    message: "offline window must not end before it starts",
  });
export type OfflineQueue = z.infer<typeof offlineQueueSchema>;

export const syncItemSchema = z.strictObject({
  itemId: identifierSchema,
  localDigest: digestSchema,
  canonicalDigest: digestSchema,
});
export type SyncItem = z.infer<typeof syncItemSchema>;

export type SyncOutcome =
  | { readonly status: "APPLIED"; readonly applied: readonly Identifier[]; readonly conflicts: readonly Identifier[] }
  | {
      readonly status: "CONFLICT";
      readonly applied: readonly Identifier[];
      readonly conflicts: readonly Identifier[];
      readonly detail: string;
    };

/**
 * Resolve a synchronization plan. Fail-closed (AGENTS §9, phase doc §16):
 * any item whose locally-queued state digest diverges from the canonical
 * state digest is a CONFLICT for the whole plan — conflicts escalate and are
 * never silently resolved in either direction. Only agreeing items apply.
 */
export function syncOutcome(items: readonly SyncItem[]): SyncOutcome {
  const applied = items
    .filter((item) => item.localDigest === item.canonicalDigest)
    .map((item) => item.itemId);
  const conflicts = items
    .filter((item) => item.localDigest !== item.canonicalDigest)
    .map((item) => item.itemId);
  if (conflicts.length > 0) {
    return {
      status: "CONFLICT",
      applied,
      conflicts,
      detail:
        "fail-closed: offline state diverges from canonical state — conflicts escalate to resolution governance; canonical truth is never silently overwritten",
    };
  }
  return { status: "APPLIED", applied, conflicts };
}

/* ─────────────────────────────────────────────────────────────
 * Universal action gateway (phase doc §23; AGENTS §21, §34)
 * ────────────────────────────────────────────────────────────*/

export const actionProposalSchema = z.strictObject({
  proposalId: identifierSchema,
  connectorId: identifierSchema,
  kind: z.enum(ACTION_KINDS),
  impactTier: z.enum(IMPACT_TIERS),
  payloadDigest: digestSchema,
  proposedAt: timestampSchema,
  proposedBy: identifierSchema,
  rationale: z.string().min(1).max(1024),
  provenance: provenanceSchema,
});
export type ActionProposal = z.infer<typeof actionProposalSchema>;

/**
 * A recorded decision of the platform authorization engine. This module
 * never computes one (AGENTS §34) — it only requires that a decision exists
 * and recognizes it using the engine's vocabulary.
 */
export const authorizationEvidenceSchema = z.strictObject({
  decidedBy: identifierSchema,
  decidedAt: timestampSchema,
  decision: platformDecisionSchema,
});
export type AuthorizationEvidence = z.infer<typeof authorizationEvidenceSchema>;

export type ActionGateBlockedReason =
  | "connector_not_active"
  | "action_kind_not_declared"
  | "observation_only_connector"
  | "authorization_evidence_missing"
  | "authorization_not_granted";

export type ActionGateResult =
  | {
      readonly status: "EXECUTABLE";
      readonly proposalId: Identifier;
      readonly note: string;
    }
  | {
      readonly status: "BLOCKED";
      readonly proposalId: Identifier;
      readonly reasons: readonly ActionGateBlockedReason[];
      readonly detail: string;
    };

/**
 * Gate an action proposal for the universal action gateway (phase doc §23).
 * Fail-closed: the connector must be lifecycle-ACTIVE, the action kind must
 * be declared by the connector, observation-only kinds cannot act beyond
 * observing, and a recorded ALLOW decision from the platform authorization
 * engine must be presented. Anything less is BLOCKED — a proposal is a
 * proposal, never an act (AGENTS §21). EXECUTABLE means "structurally
 * admissible and carrying the engine's recorded ALLOW" — it is not, and
 * cannot be, an authorization issued by this module.
 */
export function actionGate(
  proposal: ActionProposal,
  connector: ConnectorRecord,
  evidence: AuthorizationEvidence | undefined,
): ActionGateResult {
  const reasons: ActionGateBlockedReason[] = [];
  if (connector.lifecycleState !== "ACTIVE") {
    reasons.push("connector_not_active");
  }
  if (!connector.actionKinds.includes(proposal.kind)) {
    reasons.push("action_kind_not_declared");
  }
  if (isObservationOnlyConnectorKind(connector.kind) && proposal.kind !== "observe") {
    reasons.push("observation_only_connector");
  }
  if (evidence === undefined) {
    reasons.push("authorization_evidence_missing");
  } else if (evidence.decision !== "ALLOW") {
    reasons.push("authorization_not_granted");
  }
  if (reasons.length > 0) {
    return {
      status: "BLOCKED",
      proposalId: proposal.proposalId,
      reasons,
      detail:
        "fail-closed: an action proposal is a proposal only — execution requires an ACTIVE connector with declared action kinds and a recorded ALLOW decision from the platform authorization engine (AGENTS §21, §34)",
    };
  }
  return {
    status: "EXECUTABLE",
    proposalId: proposal.proposalId,
    note: "structurally admissible and carrying the platform authorization engine's recorded ALLOW decision; authorization itself was issued by the engine, not by this interface contract",
  };
}

export const actionExecutionSchema = z
  .strictObject({
    executionId: identifierSchema,
    proposalId: identifierSchema,
    connectorId: identifierSchema,
    kind: z.enum(ACTION_KINDS),
    executedAt: timestampSchema,
    executedBy: identifierSchema,
    payloadDigest: digestSchema,
    outcome: z.enum(["SUCCEEDED", "FAILED", "PARTIAL"]),
    authorization: authorizationEvidenceSchema,
    provenance: provenanceSchema,
  })
  .refine((execution) => execution.authorization.decision === "ALLOW", {
    message:
      "an execution audit record may only carry a recorded ALLOW decision from the platform authorization engine — denials and escalations live in the engine's own audit",
  });
export type ActionExecution = z.infer<typeof actionExecutionSchema>;

/* ─────────────────────────────────────────────────────────────
 * Health and self-healing (phase doc §25)
 * ────────────────────────────────────────────────────────────*/

export const healthReportSchema = z.strictObject({
  connectorId: identifierSchema,
  reportedAt: timestampSchema,
  healthState: z.enum(HEALTH_STATES),
  detail: z.string().max(1024).optional(),
  provenance: provenanceSchema,
});
export type HealthReport = z.infer<typeof healthReportSchema>;

/**
 * Effective health state of a connector. Fail-closed default: a connector
 * with no report is UNKNOWN — never silently assumed healthy.
 */
export function effectiveHealthState(report: HealthReport | undefined): HealthState {
  return report?.healthState ?? "UNKNOWN";
}

export const healingCycleSchema = z.strictObject({
  cycleId: identifierSchema,
  connectorId: identifierSchema,
  stage: z.enum(HEALING_STAGES),
  openedAt: timestampSchema,
  updatedAt: timestampSchema,
  findingRef: identifierSchema.optional(),
  repairProposalRef: identifierSchema.optional(),
  detail: z.string().max(1024).optional(),
  provenance: provenanceSchema,
});
export type HealingCycle = z.infer<typeof healingCycleSchema>;

const HEALING_ORDER: readonly HealingStage[] = [
  "detected",
  "diagnosed",
  "repair_proposed",
  "repair_validated",
  "restored",
];

export type HealingAdvanceVerdict =
  | { readonly ok: true; readonly cycle: HealingCycle }
  | { readonly ok: false; readonly reason: string };

/**
 * Advance a self-healing cycle (phase doc §25). Fail-closed: stages move
 * forward one step at a time along the detect → diagnose → repair-proposal →
 * repair-validation → restore path; `restored` requires a validated repair
 * proposal reference; `escalated` is reachable from any stage (a failed or
 * ambiguous repair escalates to governance) but is terminal. Nothing heals
 * silently.
 */
export function advanceHealingCycle(
  cycle: HealingCycle,
  next: HealingStage,
): HealingAdvanceVerdict {
  if (cycle.stage === "escalated") {
    return { ok: false, reason: "an escalated healing cycle is terminal — open a new cycle" };
  }
  if (next === "escalated") {
    if (cycle.detail === undefined || cycle.detail.trim() === "") {
      return { ok: false, reason: "escalation requires a stated detail — nothing escalates silently" };
    }
    return {
      ok: true,
      cycle: { ...cycle, stage: next, updatedAt: cycle.updatedAt },
    };
  }
  const currentIdx = HEALING_ORDER.indexOf(cycle.stage);
  const nextIdx = HEALING_ORDER.indexOf(next);
  if (currentIdx === -1 || nextIdx !== currentIdx + 1) {
    return {
      ok: false,
      reason: `healing stage ${cycle.stage} -> ${next} skips the mandated sequence; stages advance one step at a time`,
    };
  }
  if (next === "restored" && cycle.repairProposalRef === undefined) {
    return {
      ok: false,
      reason: "restored requires a validated repair proposal reference — nothing restores without a recorded repair",
    };
  }
  if (next === "diagnosed" && cycle.findingRef === undefined) {
    return {
      ok: false,
      reason: "diagnosed requires a finding reference — diagnosis without a finding is unexplained",
    };
  }
  if (next === "repair_validated" && cycle.repairProposalRef === undefined) {
    return {
      ok: false,
      reason: "repair validation requires a repair proposal reference",
    };
  }
  return {
    ok: true,
    cycle: { ...cycle, stage: next, updatedAt: cycle.updatedAt },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Parse helper for standalone records (fail-closed, structured issues)
 * ────────────────────────────────────────────────────────────*/

export type RecordParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly reason: "invalid_shape";
      readonly issues: readonly ContractIssue[];
    };

export function parseConnectorRecord(input: unknown): RecordParseResult<ConnectorRecord> {
  return parseWith(connectorRecordSchema, input);
}

export function parseActionProposal(input: unknown): RecordParseResult<ActionProposal> {
  return parseWith(actionProposalSchema, input);
}

export function parseInterfaceEvent(input: unknown): RecordParseResult<InterfaceEvent> {
  return parseWith(interfaceEventSchema, input);
}

function parseWith<S extends z.ZodType>(
  schema: S,
  input: unknown,
): RecordParseResult<z.output<S>> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "invalid_shape",
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.map((segment) => String(segment)).join("."),
        message: issue.message,
      })),
    };
  }
  return { ok: true, value: parsed.data };
}
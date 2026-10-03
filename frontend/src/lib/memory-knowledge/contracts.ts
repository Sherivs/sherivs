/**
 * CoreGrid — phase 36 Universal Memory & Knowledge Engine substrate contracts
 * (H3 wave, Squad G, mission G-056 — Contract Architect).
 *
 * WHAT: the typed, Zod-validated contract surface for the phase-36 memory and
 * knowledge substrate — memory scopes, memory records, provenance, confidence
 * and validation, knowledge revision (version control), the recall
 * authorization gate, the AI disclosure pipeline, lifecycle transitions and
 * governed forgetting.
 *
 * ARCHITECTURAL POSTURE (non-negotiable, encoded below and proven in tests):
 * - MEMORY IS AUTHORIZATION-GATED (AGENTS §19; L-T-015 deny posture): recall
 *   and record reads NEVER succeed without a presented, valid authorization
 *   gate. Remembering a reference grants nothing; only an ALLOW (or a REDACT
 *   decision with non-empty directives) issued by a server-side authorization
 *   layer opens a view, and every view is bounded by the gate's tenant, scope,
 *   principal, purpose and sensitivity ceiling. There is no bypass path: every
 *   exported read surface demands a gate, and every absent/invalid/expired
 *   gate fails CLOSED to a typed denial.
 * - DENY BY DEFAULT: the default decision of this substrate is DENY. Missing
 *   gates, malformed records, unknown lifecycle transitions, missing approval
 *   and expired retention all fail closed with a typed reason — never clamped,
 *   never partially satisfied.
 * - AI RECEIVES ONLY AUTHORIZED, MINIMIZED, REDACTED CONTEXT (AGENTS §19):
 *   disclosure to an intelligence model requires a complete pipeline
 *   (identity, authorization, classification, purpose, minimization,
 *   redaction) layered ON TOP of a valid gate, and the disclosed payload is a
 *   metadata view by construction — the contract never hands raw record
 *   content to the model surface.
 * - FORGETTING IS GENUINE AND GOVERNED: an expunged record structurally
 *   CANNOT carry content, and the only path to expungement is an explicit act
 *   carrying an approval reference (phase contract `requiresApprovalFor`:
 *   forgetting-execution). What is forgotten is unreachable through this
 *   contract.
 * - PROVENANCE AND CONFIDENCE ARE MANDATORY (AGENTS §12, phase §7/§8/§46):
 *   every record carries origin, creator and validation state; validated
 *   knowledge must cite evidence; retracted knowledge must carry a reason and
 *   is never readable or disclosable.
 *
 * PURITY: this is a typed CONTRACT module — no I/O, no persistence, no vendor
 * imports, no network, no wall-clock sampling. Time is always injected as an
 * ISO-8601 instant. Inputs are never mutated; every transition returns a fresh
 * record. It grants no authority of its own: it bounds reads that a
 * server-side authorization layer has already authenticated (Constitution
 * §15/§17 — one layer, never the only one).
 *
 * Composition (read-only): the module binds to the phase-36 kernel contract
 * (`../kernel/phase-contracts/phase-36-memory-knowledge`) and reuses the
 * platform sensitivity vocabulary from `../context-assembly` — it redefines
 * neither. No sibling H3 module is imported.
 */

import { z } from "zod";
import type { ContextSensitivity } from "../context-assembly";
import { PHASE_36_MEMORY_KNOWLEDGE } from "../kernel/phase-contracts/phase-36-memory-knowledge";

/* ─────────────────────────────────────────────────────────────
 * Module posture (composed from the kernel phase contract)
 * ────────────────────────────────────────────────────────────*/

export const MEMORY_KNOWLEDGE_MODULE_ID = "phase-36/memory-knowledge/h3-056";

/** Fail-closed posture of this substrate, composed from the kernel contract. */
export const MEMORY_KNOWLEDGE_CONTRACT_POSTURE = {
  moduleId: MEMORY_KNOWLEDGE_MODULE_ID,
  phaseId: PHASE_36_MEMORY_KNOWLEDGE.id,
  phaseName: PHASE_36_MEMORY_KNOWLEDGE.name,
  phaseCapability: PHASE_36_MEMORY_KNOWLEDGE.capabilities.owns[0] ?? "",
  boundary: PHASE_36_MEMORY_KNOWLEDGE.boundary.statement,
  defaultDecision: "deny" as const,
  recallPolicy: "authorization-gated" as const,
  aiDisclosurePolicy: "minimized-and-redacted-metadata-only" as const,
  forgettingPolicy: "approval-gated-and-unreachable" as const,
  approvalRequiredFor: PHASE_36_MEMORY_KNOWLEDGE.asi.autonomy.requiresApprovalFor,
} as const;

/* ─────────────────────────────────────────────────────────────
 * Vocabulary
 * ────────────────────────────────────────────────────────────*/

/** Where a memory is held (phase §3 — neutral scope kinds). */
export const MEMORY_SCOPE_KINDS = [
  "personal",
  "organizational",
  "institutional",
  "agent",
  "domain",
  "civilization",
  "reality",
] as const;
export type MemoryScopeKind = (typeof MEMORY_SCOPE_KINDS)[number];

/** What kind of material a record preserves (phase §17–§21). */
export const MEMORY_RECORD_KINDS = [
  "short_term",
  "long_term",
  "episodic",
  "semantic",
  "procedural",
] as const;
export type MemoryRecordKind = (typeof MEMORY_RECORD_KINDS)[number];

/** The knowledge abstraction ladder (phase §5), lowest to highest. */
export const KNOWLEDGE_ABSTRACTION_LEVELS = [
  "data",
  "information",
  "knowledge",
  "understanding",
  "wisdom",
  "intelligence",
] as const;
export type KnowledgeAbstractionLevel = (typeof KNOWLEDGE_ABSTRACTION_LEVELS)[number];

const ABSTRACTION_RANK: Record<KnowledgeAbstractionLevel, 0 | 1 | 2 | 3 | 4 | 5> = {
  data: 0,
  information: 1,
  knowledge: 2,
  understanding: 3,
  wisdom: 4,
  intelligence: 5,
};

/** Validation states of a knowledge object (phase §7). */
export const KNOWLEDGE_VALIDATION_STATES = [
  "unvalidated",
  "validated",
  "disputed",
  "retracted",
] as const;
export type KnowledgeValidationState = (typeof KNOWLEDGE_VALIDATION_STATES)[number];

/** Evidence levels (phase §46/§168) — `none` never validates. */
export const KNOWLEDGE_EVIDENCE_LEVELS = [
  "none",
  "asserted",
  "corroborated",
  "verified",
] as const;
export type KnowledgeEvidenceLevel = (typeof KNOWLEDGE_EVIDENCE_LEVELS)[number];

/** Record lifecycle (phase §16/§152). Strict forward chain; `expunged` is terminal. */
export const MEMORY_LIFECYCLE_STATES = [
  "created",
  "processed",
  "validated",
  "stored",
  "active",
  "superseded",
  "archived",
  "expunged",
] as const;
export type MemoryLifecycleState = (typeof MEMORY_LIFECYCLE_STATES)[number];

/** Authorization decisions (Constitution §16), lowercase contract form. */
export const AUTHORIZATION_DECISIONS = [
  "allow",
  "deny",
  "redact",
  "escalate",
  "require_approval",
] as const;
export type AuthorizationDecision = (typeof AUTHORIZATION_DECISIONS)[number];

/** Origin kinds for provenance (AGENTS §12 — AI-generated is always declared). */
export const KNOWLEDGE_ORIGIN_KINDS = ["human", "agent", "system", "external"] as const;
export type KnowledgeOriginKind = (typeof KNOWLEDGE_ORIGIN_KINDS)[number];

/** Sensitivity vocabulary — reused from context-assembly, never redefined. */
export type MemorySensitivity = ContextSensitivity;

export const MEMORY_SENSITIVITIES: readonly MemorySensitivity[] = [
  "public",
  "internal",
  "restricted",
] as const;

const SENSITIVITY_RANK: Record<MemorySensitivity, 0 | 1 | 2> = {
  public: 0,
  internal: 1,
  restricted: 2,
};

/** Legal lifecycle transitions (phase §16). Anything else is denied. */
export const MEMORY_LIFECYCLE_TRANSITIONS: Readonly<
  Record<MemoryLifecycleState, readonly MemoryLifecycleState[]>
> = {
  created: ["processed"],
  processed: ["validated"],
  validated: ["stored"],
  stored: ["active"],
  active: ["superseded", "archived"],
  superseded: ["archived"],
  archived: ["expunged"],
  expunged: [],
};

/** Lifecycle states from which an authorized read may return content. */
const READABLE_LIFECYCLE_STATES: readonly MemoryLifecycleState[] = [
  "stored",
  "active",
  "superseded",
  "archived",
];

/* ─────────────────────────────────────────────────────────────
 * Primitive schemas
 * ────────────────────────────────────────────────────────────*/

const IDENTIFIER_PATTERN = /^[a-z][a-z0-9_-]{0,63}$/;
const REF_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9_:.\-/]{0,199}$/;

function boundedText(label: string, max: number) {
  return z
    .string()
    .min(1, `${label} must be a non-empty string`)
    .max(max, `${label} must be at most ${max} characters`)
    .refine((value) => value.trim().length > 0, `${label} must not be blank`);
}

function refField(label: string, max = 200) {
  return z
    .string()
    .regex(
      REF_PATTERN,
      `${label} must be a bounded reference identifier (at most ${max} characters)`,
    );
}

export const memoryScopeKeySchema = z
  .string()
  .regex(
    IDENTIFIER_PATTERN,
    "scopeKey must be a lowercase identifier (letters, digits, underscore, hyphen; starts with a letter; at most 64 characters)",
  );

export const memoryInstantSchema = z.string().datetime();

/** Retention (phase §28/§152): bounded by default; unbounded requires approval. */
export const memoryRetentionPolicySchema = z
  .strictObject({
    rule: z.enum(["bounded", "unbounded"]),
    /** Mandatory when `rule` is `bounded`; forbidden otherwise. */
    expiresAt: memoryInstantSchema.optional(),
    /** Approval reference (AGENTS §16 REQUIRE_APPROVAL) — mandatory when unbounded. */
    approvalRef: refField("retention.approvalRef").optional(),
  })
  .superRefine((policy, ctx) => {
    if (policy.rule === "bounded" && policy.expiresAt === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "bounded retention must carry expiresAt (fail-closed: no implicit forever)",
      });
    }
    if (policy.rule === "unbounded") {
      if (policy.expiresAt !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "unbounded retention must not carry expiresAt",
        });
      }
      if (policy.approvalRef === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message:
            "unbounded retention requires an approvalRef (retention-policy-change is approval-gated)",
        });
      }
    }
  });

export type MemoryRetentionPolicy = z.infer<typeof memoryRetentionPolicySchema>;

/* ─────────────────────────────────────────────────────────────
 * Provenance (phase §8/§156; AGENTS §12)
 * ────────────────────────────────────────────────────────────*/

export const knowledgeProvenanceSchema = z.strictObject({
  createdBy: boundedText("provenance.createdBy", 160),
  originKind: z.enum(KNOWLEDGE_ORIGIN_KINDS),
  originRef: refField("provenance.originRef"),
  createdAt: memoryInstantSchema,
  /** Declared, never inferred: AI-generated material must say so. */
  aiGenerated: z.boolean(),
  /** Ordered transformation history references (at most 32). */
  transformationRefs: z.array(refField("provenance.transformationRef")).max(32),
  /** Ordered validation history references (at most 32). */
  validationRefs: z.array(refField("provenance.validationRef")).max(32),
});

export type KnowledgeProvenance = z.infer<typeof knowledgeProvenanceSchema>;

/* ─────────────────────────────────────────────────────────────
 * Confidence and validation (phase §7/§46)
 * ────────────────────────────────────────────────────────────*/

export const knowledgeValidationSchema = z
  .strictObject({
    state: z.enum(KNOWLEDGE_VALIDATION_STATES),
    confidence: z.number().min(0).max(1),
    evidenceLevel: z.enum(KNOWLEDGE_EVIDENCE_LEVELS),
    evidenceRefs: z.array(refField("validation.evidenceRef")).max(16),
    /** Mandatory when `state` is `retracted`; forbidden otherwise. */
    retractionReason: boundedText("validation.retractionReason", 400).optional(),
  })
  .superRefine((validation, ctx) => {
    if (validation.state === "validated") {
      if (validation.evidenceLevel === "none" || validation.evidenceRefs.length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "validated knowledge must cite evidence (level other than none, at least one ref)",
        });
      }
      if (validation.confidence < 0.5) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "validated knowledge must carry confidence of at least 0.5",
        });
      }
    }
    if (validation.state === "retracted") {
      if (validation.retractionReason === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "retracted knowledge must carry a retractionReason",
        });
      }
    } else if (validation.retractionReason !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "retractionReason is only permitted on retracted knowledge",
      });
    }
  });

export type KnowledgeValidation = z.infer<typeof knowledgeValidationSchema>;

/* ─────────────────────────────────────────────────────────────
 * Memory record (phase §10/§152)
 * ────────────────────────────────────────────────────────────*/

export const memoryContentSchema = z.strictObject({
  summary: boundedText("content.summary", 2000),
  /** References to payloads held by owning substrates — never inline payloads. */
  payloadRefs: z.array(refField("content.payloadRef")).max(16),
});

export type MemoryContent = z.infer<typeof memoryContentSchema>;

export const memoryRecordSchema = z
  .strictObject({
    recordId: memoryScopeKeySchema,
    tenantRef: refField("record.tenantRef"),
    scopeKey: memoryScopeKeySchema,
    kind: z.enum(MEMORY_RECORD_KINDS),
    sensitivity: z.enum(MEMORY_SENSITIVITIES as [MemorySensitivity, ...MemorySensitivity[]]),
    abstractionLevel: z.enum(KNOWLEDGE_ABSTRACTION_LEVELS),
    content: memoryContentSchema.optional(),
    validation: knowledgeValidationSchema,
    provenance: knowledgeProvenanceSchema,
    retention: memoryRetentionPolicySchema,
    lifecycle: z.enum(MEMORY_LIFECYCLE_STATES),
    createdAt: memoryInstantSchema,
    updatedAt: memoryInstantSchema,
    /** Mandatory when `lifecycle` is `expunged`; forbidden otherwise. */
    expungedAt: memoryInstantSchema.optional(),
  })
  .superRefine((record, ctx) => {
    if (record.lifecycle === "expunged") {
      if (record.content !== undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "an expunged record must not carry content (forgetting is genuine)",
        });
      }
      if (record.expungedAt === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "an expunged record must carry expungedAt",
        });
      }
    } else if (record.expungedAt !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "expungedAt is only permitted on an expunged record",
      });
    }
    if (record.retention.rule === "bounded" && record.retention.expiresAt !== undefined) {
      if (!isBefore(record.createdAt, record.retention.expiresAt)) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: "bounded retention must expire after createdAt",
        });
      }
    }
  });

export type MemoryRecord = z.infer<typeof memoryRecordSchema>;

/* ─────────────────────────────────────────────────────────────
 * Recall authorization gate (L-T-015 posture; AGENTS §16/§19)
 * ────────────────────────────────────────────────────────────*/

export const memoryAuthorizationGateSchema = z
  .strictObject({
    gateId: refField("gate.gateId"),
    decision: z.enum(AUTHORIZATION_DECISIONS),
    principalRef: refField("gate.principalRef"),
    tenantRef: refField("gate.tenantRef"),
    scopeKey: memoryScopeKeySchema,
    purposeRef: refField("gate.purposeRef"),
    /** Upper bound of sensitivity this gate may open. */
    sensitivityCeiling: z.enum(MEMORY_SENSITIVITIES as [MemorySensitivity, ...MemorySensitivity[]]),
    /** Directives describing WHAT is redacted — mandatory when decision is `redact`. */
    redactionDirectives: z.array(boundedText("gate.redactionDirective", 160)).max(16),
    decidedAt: memoryInstantSchema,
    expiresAt: memoryInstantSchema,
    authorityRef: refField("gate.authorityRef"),
    traceId: refField("gate.traceId"),
  })
  .superRefine((gate, ctx) => {
    if (!isBefore(gate.decidedAt, gate.expiresAt)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "gate expiresAt must be after decidedAt (fail-closed: no eternal gate)",
      });
    }
    if (gate.decision === "redact" && gate.redactionDirectives.length === 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "a redact decision must carry at least one redaction directive",
      });
    }
    if (gate.decision !== "redact" && gate.redactionDirectives.length > 0) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "redactionDirectives are only permitted on a redact decision",
      });
    }
  });

export type MemoryAuthorizationGate = z.infer<typeof memoryAuthorizationGateSchema>;

/** A recall request — a reference, NEVER a credential or a secret. */
export const memoryRecallRequestSchema = z.strictObject({
  scopeKey: memoryScopeKeySchema,
  tenantRef: refField("recall.tenantRef"),
  principalRef: refField("recall.principalRef"),
  purposeRef: refField("recall.purposeRef"),
});

export type MemoryRecallRequest = z.infer<typeof memoryRecallRequestSchema>;

/**
 * The presenting caller's declared identity and purpose at record-read time.
 * Record reads bind the GATE to the CALLER — a gate presented by a different
 * principal, or for a different purpose, opens nothing.
 */
export const memoryCallerContextSchema = z.strictObject({
  principalRef: refField("caller.principalRef"),
  purposeRef: refField("caller.purposeRef"),
});

export type MemoryCallerContext = z.infer<typeof memoryCallerContextSchema>;

/* ─────────────────────────────────────────────────────────────
 * AI disclosure pipeline (AGENTS §19 — ordered, complete, fail-closed)
 * ────────────────────────────────────────────────────────────*/

export const aiDisclosurePipelineSchema = z.strictObject({
  identityRef: refField("pipeline.identityRef"),
  authorizationRef: refField("pipeline.authorizationRef"),
  /** Declared classification of what will be sent — must cover the record. */
  classification: z.enum(MEMORY_SENSITIVITIES as [MemorySensitivity, ...MemorySensitivity[]]),
  purposeRef: refField("pipeline.purposeRef"),
  purposeAllowed: z.boolean(),
  minimized: z.boolean(),
  redacted: z.boolean(),
  aiContextRef: refField("pipeline.aiContextRef"),
});

export type AiDisclosurePipeline = z.infer<typeof aiDisclosurePipelineSchema>;

/* ─────────────────────────────────────────────────────────────
 * Knowledge revision (version control — phase §15)
 * ────────────────────────────────────────────────────────────*/

export const knowledgeRevisionSchema = z
  .strictObject({
    revisionId: refField("revision.revisionId"),
    recordId: memoryScopeKeySchema,
    reason: boundedText("revision.reason", 400),
    contributorRef: refField("revision.contributorRef"),
    appliedAt: memoryInstantSchema,
    previousLifecycle: z.enum(MEMORY_LIFECYCLE_STATES),
    newLifecycle: z.enum(MEMORY_LIFECYCLE_STATES),
    /** Approval reference — mandatory when the revision drives expungement. */
    approvalRef: refField("revision.approvalRef").optional(),
  })
  .superRefine((revision, ctx) => {
    if (revision.newLifecycle === "expunged" && revision.approvalRef === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "a revision that expunges must carry an approvalRef",
      });
    }
  });

export type KnowledgeRevision = z.infer<typeof knowledgeRevisionSchema>;

/* ─────────────────────────────────────────────────────────────
 * Forgetting act (phase §29/§123/§152 — governed, approval-carrying)
 * ────────────────────────────────────────────────────────────*/

export const forgettingActSchema = z.strictObject({
  actId: refField("forgetting.actId"),
  recordId: memoryScopeKeySchema,
  mode: z.enum(["expunge"]),
  /**
   * Shape-level: a bounded string; emptiness is a SEMANTIC denial
   * (`missing_approval`), checked by the execution path, never the parser.
   */
  approvalRef: z.string().max(200),
  executedByRef: refField("forgetting.executedByRef"),
  executedAt: memoryInstantSchema,
});

export type ForgettingAct = z.infer<typeof forgettingActSchema>;

export const forgettingTombstoneSchema = z.strictObject({
  tombstoneId: refField("forgetting.tombstoneId"),
  recordId: memoryScopeKeySchema,
  expungedAt: memoryInstantSchema,
  approvalRef: refField("forgetting.approvalRef"),
  executedByRef: refField("forgetting.executedByRef"),
  /** The tombstone itself never carries content — only the fact of removal. */
  contentRemoved: z.literal(true),
});

export type ForgettingTombstone = z.infer<typeof forgettingTombstoneSchema>;

/* ─────────────────────────────────────────────────────────────
 * Typed results
 * ────────────────────────────────────────────────────────────*/

export type ContractOk<T> = { readonly ok: true; readonly value: T };
export type ContractErr<E> = { readonly ok: false; readonly error: E };
export type ContractResult<T, E> = ContractOk<T> | ContractErr<E>;

export type ParseFailure =
  | "malformed_scope"
  | "malformed_record"
  | "malformed_gate"
  | "malformed_request"
  | "malformed_pipeline"
  | "malformed_revision"
  | "malformed_act";

/* ─────────────────────────────────────────────────────────────
 * Recall denial reasons (typed, exhaustive)
 * ────────────────────────────────────────────────────────────*/

export type RecallDenialReason =
  | "request_malformed"
  | "no_gate_presented"
  | "gate_malformed"
  | "gate_expired"
  | "decision_not_permitted"
  | "tenant_mismatch"
  | "scope_mismatch"
  | "principal_mismatch"
  | "purpose_mismatch";

export type RecallVerdict =
  | { readonly outcome: "denied"; readonly reason: RecallDenialReason }
  | {
      readonly outcome: "allowed";
      readonly gateId: string;
      readonly traceId: string;
      readonly boundedScope: {
        readonly scopeKey: string;
        readonly tenantRef: string;
        readonly principalRef: string;
        readonly purposeRef: string;
      };
    }
  | {
      readonly outcome: "redacted";
      readonly gateId: string;
      readonly traceId: string;
      readonly redactionDirectives: readonly string[];
    };

export type ViewDenialReason =
  | "record_malformed"
  | "caller_malformed"
  | "record_not_stored"
  | "record_expunged"
  | "record_retracted"
  | "no_gate_presented"
  | "gate_malformed"
  | "gate_expired"
  | "decision_not_permitted"
  | "tenant_mismatch"
  | "scope_mismatch"
  | "sensitivity_exceeds_clearance";

export type AuthorizedMemoryView =
  | { readonly outcome: "denied"; readonly reason: ViewDenialReason }
  | {
      readonly outcome: "allowed";
      readonly gateId: string;
      readonly traceId: string;
      readonly recordId: string;
      readonly sensitivity: MemorySensitivity;
      readonly abstractionLevel: KnowledgeAbstractionLevel;
      readonly validationState: KnowledgeValidationState;
      readonly content: MemoryContent;
    };

export type AiDisclosureVerdict =
  | { readonly outcome: "blocked"; readonly reason: AiDisclosureBlockReason }
  | {
      readonly outcome: "disclosed";
      /** Metadata view only — the contract never returns raw content to a model surface. */
      readonly aiContextRef: string;
      readonly recordId: string;
      readonly abstractionLevel: KnowledgeAbstractionLevel;
      readonly validationState: KnowledgeValidationState;
      readonly redacted: true;
    };

export type AiDisclosureBlockReason =
  | "record_malformed"
  | "pipeline_malformed"
  | "pipeline_incomplete"
  | "no_gate_presented"
  | "gate_malformed"
  | "gate_expired"
  | "decision_not_permitted"
  | "tenant_mismatch"
  | "scope_mismatch"
  | "classification_exceeds_clearance"
  | "record_sensitivity_exceeds_classification"
  | "record_expunged"
  | "record_retracted";

export type LifecycleDenialReason =
  | "record_malformed"
  | "revision_malformed"
  | "record_id_mismatch"
  | "target_equals_current"
  | "unknown_transition"
  | "revision_previous_state_mismatch"
  | "revision_target_mismatch";

export type ForgettingDenialReason =
  | "act_malformed"
  | "record_malformed"
  | "record_id_mismatch"
  | "already_expunged"
  | "missing_approval";

/* ─────────────────────────────────────────────────────────────
 * Internals
 * ────────────────────────────────────────────────────────────*/

function isBefore(a: string, b: string): boolean {
  const ta = Date.parse(a);
  const tb = Date.parse(b);
  return Number.isFinite(ta) && Number.isFinite(tb) && ta < tb;
}

/* ─────────────────────────────────────────────────────────────
 * Parse helpers — fail closed, never throw on hostile input
 * ────────────────────────────────────────────────────────────*/

export function parseMemoryScopeKey(input: unknown): ContractResult<string, ParseFailure> {
  const parsed = memoryScopeKeySchema.safeParse(input);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: "malformed_scope" };
}

export function parseMemoryRecord(input: unknown): ContractResult<MemoryRecord, ParseFailure> {
  const parsed = memoryRecordSchema.safeParse(input);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: "malformed_record" };
}

export function parseAuthorizationGate(
  input: unknown,
): ContractResult<MemoryAuthorizationGate, ParseFailure> {
  const parsed = memoryAuthorizationGateSchema.safeParse(input);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: "malformed_gate" };
}

export function parseRecallRequest(
  input: unknown,
): ContractResult<MemoryRecallRequest, ParseFailure> {
  const parsed = memoryRecallRequestSchema.safeParse(input);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: "malformed_request" };
}

export function parseAiDisclosurePipeline(
  input: unknown,
): ContractResult<AiDisclosurePipeline, ParseFailure> {
  const parsed = aiDisclosurePipelineSchema.safeParse(input);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: "malformed_pipeline" };
}

export function parseKnowledgeRevision(
  input: unknown,
): ContractResult<KnowledgeRevision, ParseFailure> {
  const parsed = knowledgeRevisionSchema.safeParse(input);
  return parsed.success
    ? { ok: true, value: parsed.data }
    : { ok: false, error: "malformed_revision" };
}

export function parseForgettingAct(input: unknown): ContractResult<ForgettingAct, ParseFailure> {
  const parsed = forgettingActSchema.safeParse(input);
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false, error: "malformed_act" };
}

/* ─────────────────────────────────────────────────────────────
 * Shared gate checks — the single deny path for every surface
 * ────────────────────────────────────────────────────────────*/

type GateFailure = { kind: "gate"; reason: RecallDenialReason };

function checkGate(
  request: MemoryRecallRequest,
  gate: MemoryAuthorizationGate | undefined,
  now: string,
): GateFailure | undefined {
  if (gate === undefined) {
    return { kind: "gate", reason: "no_gate_presented" };
  }
  if (!memoryAuthorizationGateSchema.safeParse(gate).success) {
    return { kind: "gate", reason: "gate_malformed" };
  }
  if (!isBefore(now, gate.expiresAt)) {
    return { kind: "gate", reason: "gate_expired" };
  }
  if (gate.decision !== "allow" && gate.decision !== "redact") {
    return { kind: "gate", reason: "decision_not_permitted" };
  }
  if (request.tenantRef !== gate.tenantRef) {
    return { kind: "gate", reason: "tenant_mismatch" };
  }
  if (request.scopeKey !== gate.scopeKey) {
    return { kind: "gate", reason: "scope_mismatch" };
  }
  if (request.principalRef !== gate.principalRef) {
    return { kind: "gate", reason: "principal_mismatch" };
  }
  if (request.purposeRef !== gate.purposeRef) {
    return { kind: "gate", reason: "purpose_mismatch" };
  }
  return undefined;
}

/* ─────────────────────────────────────────────────────────────
 * Recall evaluation — authorization-gated, deny-by-default (L-T-015)
 * ────────────────────────────────────────────────────────────*/

export function evaluateRecallRequest(
  request: MemoryRecallRequest,
  gate: MemoryAuthorizationGate | undefined,
  now: string,
): RecallVerdict {
  if (!memoryRecallRequestSchema.safeParse(request).success) {
    return { outcome: "denied", reason: "request_malformed" };
  }
  const failure = checkGate(request, gate, now);
  if (failure !== undefined) {
    return { outcome: "denied", reason: failure.reason };
  }
  const validGate = gate as MemoryAuthorizationGate;
  if (validGate.decision === "redact") {
    return {
      outcome: "redacted",
      gateId: validGate.gateId,
      traceId: validGate.traceId,
      redactionDirectives: [...validGate.redactionDirectives],
    };
  }
  return {
    outcome: "allowed",
    gateId: validGate.gateId,
    traceId: validGate.traceId,
    boundedScope: {
      scopeKey: validGate.scopeKey,
      tenantRef: validGate.tenantRef,
      principalRef: validGate.principalRef,
      purposeRef: validGate.purposeRef,
    },
  };
}

/* ─────────────────────────────────────────────────────────────
 * Authorized record view — the ONLY content-opening read surface
 * ────────────────────────────────────────────────────────────*/

export function authorizedMemoryView(
  record: MemoryRecord,
  gate: MemoryAuthorizationGate | undefined,
  now: string,
  caller: MemoryCallerContext,
): AuthorizedMemoryView {
  if (!memoryRecordSchema.safeParse(record).success) {
    return { outcome: "denied", reason: "record_malformed" };
  }
  if (!memoryCallerContextSchema.safeParse(caller).success) {
    return { outcome: "denied", reason: "caller_malformed" };
  }
  if (record.lifecycle === "expunged") {
    return { outcome: "denied", reason: "record_expunged" };
  }
  if (record.validation.state === "retracted") {
    return { outcome: "denied", reason: "record_retracted" };
  }
  if (record.content === undefined) {
    return { outcome: "denied", reason: "record_not_stored" };
  }
  if (!READABLE_LIFECYCLE_STATES.includes(record.lifecycle)) {
    return { outcome: "denied", reason: "record_not_stored" };
  }
  const request: MemoryRecallRequest = {
    scopeKey: record.scopeKey,
    tenantRef: record.tenantRef,
    principalRef: caller.principalRef,
    purposeRef: caller.purposeRef,
  };
  const failure = checkGate(request, gate, now);
  if (failure !== undefined) {
    return {
      outcome: "denied",
      reason: failure.reason as ViewDenialReason,
    };
  }
  const validGate = gate as MemoryAuthorizationGate;
  if (validGate.decision === "redact") {
    return { outcome: "denied", reason: "decision_not_permitted" };
  }
  if (SENSITIVITY_RANK[record.sensitivity] > SENSITIVITY_RANK[validGate.sensitivityCeiling]) {
    return { outcome: "denied", reason: "sensitivity_exceeds_clearance" };
  }
  return {
    outcome: "allowed",
    gateId: validGate.gateId,
    traceId: validGate.traceId,
    recordId: record.recordId,
    sensitivity: record.sensitivity,
    abstractionLevel: record.abstractionLevel,
    validationState: record.validation.state,
    content: { ...record.content },
  };
}

/* ─────────────────────────────────────────────────────────────
 * AI disclosure — minimized, redacted metadata only (AGENTS §19)
 * ────────────────────────────────────────────────────────────*/

export function evaluateAiDisclosure(
  record: MemoryRecord,
  gate: MemoryAuthorizationGate | undefined,
  pipeline: AiDisclosurePipeline,
  now: string,
): AiDisclosureVerdict {
  if (!memoryRecordSchema.safeParse(record).success) {
    return { outcome: "blocked", reason: "record_malformed" };
  }
  if (!aiDisclosurePipelineSchema.safeParse(pipeline).success) {
    return { outcome: "blocked", reason: "pipeline_malformed" };
  }
  if (record.lifecycle === "expunged") {
    return { outcome: "blocked", reason: "record_expunged" };
  }
  if (record.validation.state === "retracted") {
    return { outcome: "blocked", reason: "record_retracted" };
  }
  if (
    !pipeline.purposeAllowed ||
    !pipeline.minimized ||
    !pipeline.redacted
  ) {
    return { outcome: "blocked", reason: "pipeline_incomplete" };
  }
  const request: MemoryRecallRequest = {
    scopeKey: record.scopeKey,
    tenantRef: record.tenantRef,
    principalRef: gate?.principalRef ?? "",
    purposeRef: pipeline.purposeRef,
  };
  const failure = checkGate(request, gate, now);
  if (failure !== undefined) {
    return { outcome: "blocked", reason: failure.reason as AiDisclosureBlockReason };
  }
  const validGate = gate as MemoryAuthorizationGate;
  if (
    SENSITIVITY_RANK[pipeline.classification] > SENSITIVITY_RANK[validGate.sensitivityCeiling]
  ) {
    return { outcome: "blocked", reason: "classification_exceeds_clearance" };
  }
  if (SENSITIVITY_RANK[record.sensitivity] > SENSITIVITY_RANK[pipeline.classification]) {
    return { outcome: "blocked", reason: "record_sensitivity_exceeds_classification" };
  }
  return {
    outcome: "disclosed",
    aiContextRef: pipeline.aiContextRef,
    recordId: record.recordId,
    abstractionLevel: record.abstractionLevel,
    validationState: record.validation.state,
    redacted: true,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Lifecycle transitions (phase §16) — explicit, revision-carrying
 * ────────────────────────────────────────────────────────────*/

export function applyLifecycleTransition(
  record: MemoryRecord,
  target: MemoryLifecycleState,
  revision: KnowledgeRevision,
): ContractResult<MemoryRecord, LifecycleDenialReason> {
  if (!memoryRecordSchema.safeParse(record).success) {
    return { ok: false, error: "record_malformed" };
  }
  if (!knowledgeRevisionSchema.safeParse(revision).success) {
    return { ok: false, error: "revision_malformed" };
  }
  if (revision.recordId !== record.recordId) {
    return { ok: false, error: "record_id_mismatch" };
  }
  if (target === record.lifecycle) {
    return { ok: false, error: "target_equals_current" };
  }
  const allowed = MEMORY_LIFECYCLE_TRANSITIONS[record.lifecycle];
  if (!allowed.includes(target)) {
    return { ok: false, error: "unknown_transition" };
  }
  if (revision.previousLifecycle !== record.lifecycle) {
    return { ok: false, error: "revision_previous_state_mismatch" };
  }
  if (revision.newLifecycle !== target) {
    return { ok: false, error: "revision_target_mismatch" };
  }
  const next: MemoryRecord = {
    ...record,
    lifecycle: target,
    updatedAt: revision.appliedAt,
  };
  return { ok: true, value: next };
}

/* ─────────────────────────────────────────────────────────────
 * Governed forgetting (phase §29/§152) — approval-gated, genuine
 * ────────────────────────────────────────────────────────────*/

export function executeForgettingAct(
  record: MemoryRecord,
  act: ForgettingAct,
): ContractResult<{ record: MemoryRecord; tombstone: ForgettingTombstone }, ForgettingDenialReason> {
  if (!forgettingActSchema.safeParse(act).success) {
    return { ok: false, error: "act_malformed" };
  }
  if (!memoryRecordSchema.safeParse(record).success) {
    return { ok: false, error: "record_malformed" };
  }
  if (act.recordId !== record.recordId) {
    return { ok: false, error: "record_id_mismatch" };
  }
  if (record.lifecycle === "expunged") {
    return { ok: false, error: "already_expunged" };
  }
  if (act.approvalRef.trim().length === 0) {
    return { ok: false, error: "missing_approval" };
  }
  const { content: _stripped, ...surviving } = record;
  const expunged: MemoryRecord = {
    ...surviving,
    lifecycle: "expunged",
    expungedAt: act.executedAt,
    updatedAt: act.executedAt,
  };
  const tombstone: ForgettingTombstone = {
    tombstoneId: act.actId,
    recordId: record.recordId,
    expungedAt: act.executedAt,
    approvalRef: act.approvalRef,
    executedByRef: act.executedByRef,
    contentRemoved: true,
  };
  return { ok: true, value: { record: expunged, tombstone } };
}
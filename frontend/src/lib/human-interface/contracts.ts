/**
 * CoreGrid — Phase 50 Human Civilization Interface Layer substrate contracts
 * (H3 wave Squad G, mission G-070; Constitution §7, §9, §12, §16, §21, §34;
 * architecture/phase-50-human-civilization-interface-layer.md).
 *
 * WHAT: the typed contract surface of the human loop-closure substrate —
 * interaction sessions, the human closure view over the governed loop,
 * approval surfaces, observation surfaces, explanation surfaces, human
 * control submissions, consent surfaces and feedback submissions. It owns
 * presentation semantics ONLY: NO identity, NO authorization, NO canonical
 * truth, NO persistence, NO vendor access.
 *
 * Law of this module (AGENTS §34 — the UI is not security): an interface is
 * a rendering of decisions the server has already made and recorded. Every
 * surface here is a typed VIEW of a server-attested fact and can be parsed
 * only when it carries that attestation (server reference, tenant, content
 * digest, recorded instant). There is no schema path for a surface that:
 * - claims authority on its own (client-authorized / locally-approved /
 *   self-granted-shaped keys fail closed with a typed reason);
 * - resolves, records, or enforces anything client-side — human responses,
 *   control requests, consent decisions and feedback are typed SUBMISSIONS
 *   whose only possible outcome is "handed to the server for adjudication /
 *   enforcement / recording". The interface can never return an outcome.
 * - fabricates loop closure — a human-loop stage is closed only when a
 *   server attestation says so; an unattested, out-of-order or failed stage
 *   fails parsing or leaves the loop OPEN, never silently closed.
 *
 * Fail-closed parsing: an untrusted input that violates any invariant
 * yields a typed failure with structured issues. A failed parse never
 * yields a partial surface.
 *
 * Composition: the decision vocabulary echoed into approval views is the
 * authorization engine's §16 vocabulary, imported read-only as a type from
 * the identity module. No sibling wave modules, no vendor imports, no I/O,
 * no persistence, no wall-clock reads — every instant is a supplied
 * parameter — no secrets.
 *
 * Neutral vocabulary only (J-037 shrink-only): this is platform substrate.
 * A "surface" is any human-facing rendering of a governed interaction; no
 * domain vocabulary appears here.
 */

import { z } from "zod";
import type { AuthorizationDecision } from "../identity";

/* ─────────────────────────────────────────────────────────────
 * Version and bounds (no unbounded surfaces)
 * ────────────────────────────────────────────────────────────*/

export const HUMAN_INTERFACE_CONTRACT_SCHEMA_VERSION = "1.0";

/** Hard ceiling on loop-stage entries in one loop-closure view. */
export const MAX_LOOP_STAGES = 9;

/** Hard ceiling on evidence citations in one explanation view. */
export const MAX_EXPLANATION_CITATIONS = 64;

/** Hard ceiling on alternatives listed in one explanation view. */
export const MAX_ALTERNATIVES = 32;

/* ─────────────────────────────────────────────────────────────
 * Vocabulary (phase doc: interaction model, loop, domains 23/34/35/40)
 * ────────────────────────────────────────────────────────────*/

/** Presentation channels a human may interact through (phase doc §05–§08). */
export const INTERACTION_CHANNELS = [
  "text",
  "voice",
  "visual",
  "document",
  "gesture",
  "spatial",
  "programmatic",
] as const;
export type InteractionChannel = (typeof INTERACTION_CHANNELS)[number];

/** Session presentation states, all reported by the server (phase doc §01). */
export const INTERACTION_SESSION_STATES = [
  "OPEN",
  "AWAITING_INPUT",
  "PROCESSING",
  "AWAITING_HUMAN_REVIEW",
  "CLOSED",
  "BLOCKED",
  "FAILED",
] as const;
export type InteractionSessionState = (typeof INTERACTION_SESSION_STATES)[number];

/**
 * The governed loop the human closes (phase doc "PHASE 50 HUMAN-CIVILIZATION
 * LOOP"): intent → understanding → knowledge_access → reasoning →
 * simulation → decision → action → feedback → evolution.
 */
export const LOOP_STAGES = [
  "intent",
  "understanding",
  "knowledge_access",
  "reasoning",
  "simulation",
  "decision",
  "action",
  "feedback",
  "evolution",
] as const;
export type LoopStage = (typeof LOOP_STAGES)[number];

/** Per-stage entry states as reported by the server — never by the client. */
export const LOOP_STAGE_ENTRY_STATES = [
  "attested",
  "pending",
  "failed",
  "blocked",
] as const;
export type LoopStageEntryState = (typeof LOOP_STAGE_ENTRY_STATES)[number];

/** Terminal stages for human loop closure: a closed loop reaches feedback. */
export const LOOP_CLOSURE_REQUIRED_STAGES: readonly LoopStage[] = ["intent", "action", "feedback"];

/** Display states an approval view may echo from the server (phase doc §34). */
export const APPROVAL_DISPLAY_STATES = [
  "pending",
  "granted",
  "denied",
  "redacted",
  "expired",
  "revoked",
] as const;
export type ApprovalDisplayState = (typeof APPROVAL_DISPLAY_STATES)[number];

/** Impact tiers carried by approval surfaces for presentation emphasis. */
export const SURFACE_IMPACT_TIERS = ["low", "medium", "high", "critical"] as const;
export type SurfaceImpactTier = (typeof SURFACE_IMPACT_TIERS)[number];

/** Human control request kinds (phase doc §35 — override, pause, control). */
export const CONTROL_REQUEST_KINDS = [
  "override",
  "pause",
  "resume",
  "terminate",
] as const;
export type ControlRequestKind = (typeof CONTROL_REQUEST_KINDS)[number];

/** Consent decisions a human may submit (phase doc: consent records). */
export const CONSENT_DECISIONS = ["grant", "withhold", "revoke"] as const;
export type ConsentDecision = (typeof CONSENT_DECISIONS)[number];

/** Human feedback kinds (phase doc §40 — the feedback loop). */
export const FEEDBACK_KINDS = ["affirm", "correct", "reject", "clarify"] as const;
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number];

/** Structural derivation label every view in this module carries. */
export const VIEW_DERIVATION_LABEL = "view";

/* ─────────────────────────────────────────────────────────────
 * Primitives (AGENTS §12 provenance; §9 canonical truth)
 * ────────────────────────────────────────────────────────────*/

const nonEmptyString = (label: string) =>
  z
    .string()
    .min(1, `${label} must be a non-empty string`)
    .refine((value) => value.trim().length > 0, `${label} must not be blank`);

export const identifierSchema = z
  .string()
  .regex(
    /^[a-zA-Z0-9][a-zA-Z0-9_:.-]{0,127}$/,
    "identifier must be 1-128 characters of letters, digits, underscore, colon, dot or hyphen, starting alphanumeric",
  );
export type Identifier = z.infer<typeof identifierSchema>;

/** Content digest binding a view to the server-side bytes it renders. */
export const digestSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/, "digest must be a lowercase 64-character hex content digest");

export const tenantRefSchema = identifierSchema;

/**
 * Server attestation (AGENTS §12): every surface answers where its content
 * came from — which server produced it, in which tenant, when, and over
 * which content digest. There are no unattested surfaces.
 */
export const serverAttestationSchema = z.strictObject({
  serverRef: identifierSchema,
  tenantId: tenantRefSchema,
  payloadDigest: digestSchema,
  recordedAt: z.string().datetime(),
});
export type ServerAttestation = z.infer<typeof serverAttestationSchema>;

/* ─────────────────────────────────────────────────────────────
 * Parse plumbing (fail-closed, typed, never partial)
 * ────────────────────────────────────────────────────────────*/

export type SurfaceParseFailureReason =
  | "invalid_shape"
  | "client_authority_claim"
  | "cross_record_invariant"
  | "invalid_responder_kind";

export interface SurfaceParseIssue {
  readonly path: string;
  readonly message: string;
}

export type SurfaceParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
      readonly ok: false;
      readonly reason: SurfaceParseFailureReason;
      readonly issues: readonly SurfaceParseIssue[];
    };

function issuePath(path: readonly (string | number | symbol)[]): string {
  if (path.length === 0) return "(root)";
  return path.map((segment) => String(segment)).join(".");
}

function shapeFailure(error: z.ZodError): SurfaceParseResult<never> {
  return {
    ok: false,
    reason: "invalid_shape",
    issues: error.issues.map((issue) => ({
      path: issuePath(issue.path),
      message: issue.message,
    })),
  };
}

/* ─────────────────────────────────────────────────────────────
 * Interaction session (phase doc §01 — the human interaction model)
 * ────────────────────────────────────────────────────────────*/

export const interactionSessionSchema = z.strictObject({
  sessionId: identifierSchema,
  tenantId: tenantRefSchema,
  channel: z.enum(INTERACTION_CHANNELS),
  /** Locale tag for presentation only — localization is a view concern. */
  localeTag: nonEmptyString("session.localeTag"),
  /** Optional presentation accommodations (phase doc §36), never security. */
  presentationPreferences: z
    .strictObject({
      reducedMotion: z.boolean().optional(),
      highContrast: z.boolean().optional(),
      assistiveCaptions: z.boolean().optional(),
    })
    .optional(),
  state: z.enum(INTERACTION_SESSION_STATES),
  openedAt: z.string().datetime(),
  closedAt: z.string().datetime().nullable(),
  attestation: serverAttestationSchema,
});
export type InteractionSession = z.infer<typeof interactionSessionSchema>;

const CLOSED_SESSION_STATES: readonly InteractionSessionState[] = [
  "CLOSED",
  "BLOCKED",
  "FAILED",
];

/**
 * Parse an untrusted interaction session. Fails closed on shape violations
 * and on the lifecycle invariant that only closed sessions (CLOSED, BLOCKED,
 * FAILED) may carry a close time — an open session never does.
 */
export function parseInteractionSession(input: unknown): SurfaceParseResult<InteractionSession> {
  const parsed = interactionSessionSchema.safeParse(input);
  if (!parsed.success) return shapeFailure(parsed.error);

  const session = parsed.data;
  const closed = CLOSED_SESSION_STATES.includes(session.state);
  if (session.closedAt !== null && !closed) {
    return {
      ok: false,
      reason: "cross_record_invariant",
      issues: [
        {
          path: "closedAt",
          message: `session in non-closed state ${session.state} must not carry a close time`,
        },
      ],
    };
  }
  if (session.closedAt === null && closed) {
    return {
      ok: false,
      reason: "cross_record_invariant",
      issues: [
        {
          path: "closedAt",
          message: `session in closed state ${session.state} must carry a close time`,
        },
      ],
    };
  }
  return { ok: true, value: session };
}

/* ─────────────────────────────────────────────────────────────
 * Human loop-closure view (phase doc loop; §9 canonical truth)
 * ────────────────────────────────────────────────────────────*/

/**
 * One loop-stage entry: a server-reported state for one stage of the
 * governed loop, with the attestation that makes it renderable. The client
 * cannot produce stage truth — it can only render entries the server sent.
 */
export const loopStageEntrySchema = z.strictObject({
  stage: z.enum(LOOP_STAGES),
  state: z.enum(LOOP_STAGE_ENTRY_STATES),
  summary: nonEmptyString("stage.summary"),
  enteredAt: z.string().datetime(),
  attestation: serverAttestationSchema,
});
export type LoopStageEntry = z.infer<typeof loopStageEntrySchema>;

export const loopClosureViewSchema = z.strictObject({
  viewId: identifierSchema,
  sessionId: identifierSchema,
  tenantId: tenantRefSchema,
  derivation: z.literal(VIEW_DERIVATION_LABEL),
  stages: z.array(loopStageEntrySchema).min(1).max(MAX_LOOP_STAGES),
  evaluatedAt: z.string().datetime(),
  attestation: serverAttestationSchema,
});
export type LoopClosureView = z.infer<typeof loopClosureViewSchema>;

/**
 * Parse an untrusted loop-closure view. Fails closed on shape violations
 * and on the ordering invariant: stage entries must appear in canonical
 * loop order without repeats. The loop is a governed forward walk — a view
 * that walks it backwards, skips stages and re-enters them, or presents
 * stages out of order is not a renderable loop view.
 */
export function parseLoopClosureView(input: unknown): SurfaceParseResult<LoopClosureView> {
  const parsed = loopClosureViewSchema.safeParse(input);
  if (!parsed.success) return shapeFailure(parsed.error);

  const view = parsed.data;
  const positions = view.stages.map((entry) => LOOP_STAGES.indexOf(entry.stage));
  const strictlyIncreasing = positions.every(
    (position, index) => index === 0 || position > positions[index - 1],
  );
  if (!strictlyIncreasing) {
    return {
      ok: false,
      reason: "cross_record_invariant",
      issues: [
        {
          path: "stages",
          message:
            "loop-stage entries must appear in canonical loop order without repeats — a view that walks the loop out of order is not renderable",
        },
      ],
    };
  }
  return { ok: true, value: view };
}

export type LoopClosureVerdict =
  | { readonly status: "closed"; readonly attestedStages: number }
  | { readonly status: "open"; readonly reason: string };

/**
 * Human loop-closure verdict (phase doc loop; fail-closed). The loop is
 * closed only when every entry is server-attested and the walk spans from
 * `intent` through `action` to `feedback`. Any pending, failed or blocked
 * stage, or a walk that does not reach feedback, leaves the loop OPEN —
 * closure is never presumed from partial or unattested progress.
 */
export function humanLoopClosureVerdict(view: LoopClosureView): LoopClosureVerdict {
  if (view.stages.length === 0) {
    return { status: "open", reason: "fail-closed: no stage entries — closure cannot be presumed" };
  }
  const firstStage = view.stages[0].stage;
  if (firstStage !== "intent") {
    return {
      status: "open",
      reason: `fail-closed: a closed loop begins at "intent" — this walk begins at "${firstStage}"`,
    };
  }
  const unattested = view.stages.filter((entry) => entry.state !== "attested");
  if (unattested.length > 0) {
    const named = unattested.map((entry) => `${entry.stage}:${entry.state}`).join(", ");
    return {
      status: "open",
      reason: `fail-closed: loop closure requires every stage to be server-attested — unattested stages: ${named}`,
    };
  }
  const reached = new Set(view.stages.map((entry) => entry.stage));
  const missing = LOOP_CLOSURE_REQUIRED_STAGES.filter((stage) => !reached.has(stage));
  if (missing.length > 0) {
    return {
      status: "open",
      reason: `fail-closed: closure requires the walk to reach ${LOOP_CLOSURE_REQUIRED_STAGES.join(" → ")} — missing: ${missing.join(", ")}`,
    };
  }
  return { status: "closed", attestedStages: view.stages.length };
}

/* ─────────────────────────────────────────────────────────────
 * Approval surface (phase doc §34) — a VIEW of a server decision
 * ────────────────────────────────────────────────────────────*/

/**
 * Key-shape markers of client-side authority claims. Any untrusted input
 * carrying these keys fails closed — the interface renders server decisions,
 * it never grants, approves or authorizes (AGENTS §34).
 */
const CLIENT_AUTHORITY_KEY_PATTERN =
  /client[-_ ]?(authoriz|approved|granted)|locally[-_ ]?(approved|granted)|self[-_ ]?(approved|granted)|ui[-_ ]?(approved|granted|authoriz)/i;

function findClientAuthorityKeys(value: unknown, path: string): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => findClientAuthorityKeys(item, `${path}[${index}]`));
  }
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>);
    return entries.flatMap(([key, child]) => {
      const childPath = `${path}.${key}`;
      if (CLIENT_AUTHORITY_KEY_PATTERN.test(key)) return [childPath];
      return findClientAuthorityKeys(child, childPath);
    });
  }
  return [];
}

export const approvalViewSchema = z.strictObject({
  approvalId: identifierSchema,
  sessionId: identifierSchema,
  tenantId: tenantRefSchema,
  derivation: z.literal(VIEW_DERIVATION_LABEL),
  /** Digest of the subject under decision — never the payload itself. */
  subjectDigest: digestSchema,
  impactTier: z.enum(SURFACE_IMPACT_TIERS),
  /** The server decision state this view renders. */
  displayState: z.enum(APPROVAL_DISPLAY_STATES),
  /** Reference to the server decision record the display state echoes. */
  decisionRef: identifierSchema,
  /** Null while the server decision is pending; set once it resolves. */
  resolvedAt: z.string().datetime().nullable(),
  presentedAt: z.string().datetime(),
  expiresAt: z.string().datetime().nullable(),
  attestation: serverAttestationSchema,
});
export type ApprovalView = z.infer<typeof approvalViewSchema>;

/**
 * Parse an untrusted approval view. Fails closed on shape violations, on
 * any client-authority-shaped key anywhere in the input, and on the
 * lifecycle invariant that only a resolved display state (granted, denied,
 * redacted, expired, revoked) may carry a resolution instant — a pending
 * view never does.
 */
export function parseApprovalView(input: unknown): SurfaceParseResult<ApprovalView> {
  const claimed = findClientAuthorityKeys(input, "$");
  if (claimed.length > 0) {
    return {
      ok: false,
      reason: "client_authority_claim",
      issues: claimed.map((path) => ({
        path,
        message:
          "client-authority-shaped key is not permitted on an approval surface — the interface renders server decisions, it never grants them (AGENTS §34)",
      })),
    };
  }

  const parsed = approvalViewSchema.safeParse(input);
  if (!parsed.success) return shapeFailure(parsed.error);

  const view = parsed.data;
  const resolved = view.displayState !== "pending";
  if (view.resolvedAt !== null && !resolved) {
    return {
      ok: false,
      reason: "cross_record_invariant",
      issues: [
        {
          path: "resolvedAt",
          message: `approval display state ${view.displayState} must not carry a resolution instant`,
        },
      ],
    };
  }
  if (view.resolvedAt === null && resolved) {
    return {
      ok: false,
      reason: "cross_record_invariant",
      issues: [
        {
          path: "resolvedAt",
          message: `approval display state ${view.displayState} must carry a resolution instant`,
        },
      ],
    };
  }
  return { ok: true, value: view };
}

/**
 * The single sanctioned echo path from the authorization engine's §16
 * vocabulary into a presentation state. The view vocabulary cannot name a
 * server decision except through this total function — the interface has no
 * other way to put a decision on screen.
 */
export function displayStateForServerDecision(
  decision: AuthorizationDecision,
): ApprovalDisplayState {
  switch (decision) {
    case "ALLOW":
      return "granted";
    case "DENY":
      return "denied";
    case "REDACT":
      return "redacted";
    case "ESCALATE":
    case "REQUIRE_APPROVAL":
      return "pending";
  }
}

/* ─────────────────────────────────────────────────────────────
 * Human response submission (phase doc §34) — proposal, never resolution
 * ────────────────────────────────────────────────────────────*/

export const approvalResponseSubmissionSchema = z.strictObject({
  submissionId: identifierSchema,
  approvalId: identifierSchema,
  tenantId: tenantRefSchema,
  /** Only a human may respond — an AI identity can never occupy this seat. */
  responderKind: z.literal("human"),
  responderId: identifierSchema,
  response: z.enum(["endorse", "decline", "escalate"]),
  rationale: nonEmptyString("submission.rationale"),
  submittedAt: z.string().datetime(),
});
export type ApprovalResponseSubmission = z.infer<typeof approvalResponseSubmissionSchema>;

export type ApprovalSubmissionReceipt = {
  readonly status: "submitted_for_server_adjudication";
  readonly submissionId: Identifier;
  readonly approvalId: Identifier;
  /** Structural: an interface receipt can never claim resolution. */
  readonly resolutionClaimed: false;
};

/**
 * Parse an untrusted human response submission. Fails closed on shape
 * violations and when the responder is not a human identity — the interface
 * cannot transmit an agent's response as a human resolution (AGENTS §7/§21).
 */
export function parseApprovalResponseSubmission(
  input: unknown,
): SurfaceParseResult<ApprovalResponseSubmission> {
  const parsed = approvalResponseSubmissionSchema.safeParse(input);
  if (!parsed.success) return shapeFailure(parsed.error);
  return { ok: true, value: parsed.data };
}

/**
 * Hand a parsed human response to the server. The ONLY possible outcome is
 * a submission receipt: the interface cannot resolve an approval, record a
 * resolution, or report one — resolution is server adjudication (AGENTS §34).
 */
export function submitApprovalResponse(
  submission: ApprovalResponseSubmission,
): ApprovalSubmissionReceipt {
  return {
    status: "submitted_for_server_adjudication",
    submissionId: submission.submissionId,
    approvalId: submission.approvalId,
    resolutionClaimed: false,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Observation surface (phase doc §26/§27) — a VIEW of server-recorded state
 * ────────────────────────────────────────────────────────────*/

export const observationViewSchema = z.strictObject({
  observationId: identifierSchema,
  sessionId: identifierSchema,
  tenantId: tenantRefSchema,
  derivation: z.literal(VIEW_DERIVATION_LABEL),
  statement: nonEmptyString("observation.statement"),
  /** Digest of the server-recorded subject the statement renders. */
  subjectDigest: digestSchema,
  presentedAt: z.string().datetime(),
  attestation: serverAttestationSchema,
});
export type ObservationView = z.infer<typeof observationViewSchema>;

/** Parse an untrusted observation view. Fail-closed on shape violations. */
export function parseObservationView(input: unknown): SurfaceParseResult<ObservationView> {
  const parsed = observationViewSchema.safeParse(input);
  if (!parsed.success) return shapeFailure(parsed.error);
  return { ok: true, value: parsed.data };
}

/* ─────────────────────────────────────────────────────────────
 * Explanation surface (phase doc §23 — why, evidence, confidence,
 * alternatives) — a VIEW, with explained confidence only
 * ────────────────────────────────────────────────────────────*/

export const explanationCitationSchema = z.strictObject({
  evidenceRef: identifierSchema,
  digest: digestSchema,
});
export type ExplanationCitation = z.infer<typeof explanationCitationSchema>;

export const explanationViewSchema = z.strictObject({
  explanationId: identifierSchema,
  /** Reference to the server decision or record being explained. */
  subjectRef: identifierSchema,
  tenantId: tenantRefSchema,
  derivation: z.literal(VIEW_DERIVATION_LABEL),
  whyStatement: nonEmptyString("explanation.whyStatement"),
  citations: z.array(explanationCitationSchema).min(1).max(MAX_EXPLANATION_CITATIONS),
  /** Confidence is never a bare number — it names its deriving factors. */
  confidence: z.strictObject({
    value: z.number().min(0).max(1),
    derivedFrom: z.array(z.string()).min(1),
    method: nonEmptyString("explanation.confidence.method"),
  }),
  alternatives: z.array(identifierSchema).max(MAX_ALTERNATIVES),
  producedAt: z.string().datetime(),
  attestation: serverAttestationSchema,
});
export type ExplanationView = z.infer<typeof explanationViewSchema>;

/**
 * Parse an untrusted explanation view. Fails closed on shape violations;
 * an explanation with no evidence citations is not renderable — an
 * unexplained surface is not an explanation (phase doc §23).
 */
export function parseExplanationView(input: unknown): SurfaceParseResult<ExplanationView> {
  const parsed = explanationViewSchema.safeParse(input);
  if (!parsed.success) return shapeFailure(parsed.error);
  return { ok: true, value: parsed.data };
}

/* ─────────────────────────────────────────────────────────────
 * Human control submission (phase doc §35) — queued, never enforced
 * ────────────────────────────────────────────────────────────*/

export const controlRequestSubmissionSchema = z.strictObject({
  requestId: identifierSchema,
  sessionId: identifierSchema,
  tenantId: tenantRefSchema,
  kind: z.enum(CONTROL_REQUEST_KINDS),
  /** Digest of the scope the control request targets — never the payload. */
  scopeDigest: digestSchema,
  rationale: nonEmptyString("control.rationale"),
  requestedAt: z.string().datetime(),
});
export type ControlRequestSubmission = z.infer<typeof controlRequestSubmissionSchema>;

export type ControlRequestReceipt = {
  readonly status: "queued_for_server_enforcement";
  readonly requestId: Identifier;
  readonly kind: ControlRequestKind;
  /** Structural: an interface receipt can never claim enforcement. */
  readonly effectClaimed: false;
};

/**
 * Parse an untrusted control request. Fail-closed on shape violations.
 */
export function parseControlRequestSubmission(
  input: unknown,
): SurfaceParseResult<ControlRequestSubmission> {
  const parsed = controlRequestSubmissionSchema.safeParse(input);
  if (!parsed.success) return shapeFailure(parsed.error);
  return { ok: true, value: parsed.data };
}

/**
 * Hand a parsed control request to the server. The ONLY possible outcome is
 * a queue receipt: the interface cannot enforce, pause, resume or terminate
 * anything — enforcement is server-side (AGENTS §34).
 */
export function submitControlRequest(
  submission: ControlRequestSubmission,
): ControlRequestReceipt {
  return {
    status: "queued_for_server_enforcement",
    requestId: submission.requestId,
    kind: submission.kind,
    effectClaimed: false,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Consent surface (phase doc: consent records are canonical truth owned
 * server-side) — prompt view + decision submission
 * ────────────────────────────────────────────────────────────*/

export const consentPromptViewSchema = z.strictObject({
  consentId: identifierSchema,
  tenantId: tenantRefSchema,
  derivation: z.literal(VIEW_DERIVATION_LABEL),
  /** Digest of the scope consent is requested for — never the payload. */
  scopeDigest: digestSchema,
  statement: nonEmptyString("consent.statement"),
  presentedAt: z.string().datetime(),
  attestation: serverAttestationSchema,
});
export type ConsentPromptView = z.infer<typeof consentPromptViewSchema>;

export const consentSubmissionSchema = z.strictObject({
  submissionId: identifierSchema,
  consentId: identifierSchema,
  tenantId: tenantRefSchema,
  subjectId: identifierSchema,
  decision: z.enum(CONSENT_DECISIONS),
  submittedAt: z.string().datetime(),
});
export type ConsentSubmission = z.infer<typeof consentSubmissionSchema>;

export type ConsentSubmissionReceipt = {
  readonly status: "submitted_for_server_recording";
  readonly submissionId: Identifier;
  readonly consentId: Identifier;
  /** Structural: an interface receipt can never claim a recorded consent. */
  readonly consentRecorded: false;
};

/**
 * Parse an untrusted consent prompt view. Fail-closed on shape violations.
 */
export function parseConsentPromptView(input: unknown): SurfaceParseResult<ConsentPromptView> {
  const parsed = consentPromptViewSchema.safeParse(input);
  if (!parsed.success) return shapeFailure(parsed.error);
  return { ok: true, value: parsed.data };
}

/**
 * Parse an untrusted consent decision submission. Fail-closed on shape
 * violations. A parsed submission handed to the server yields only a
 * submission receipt — the interface cannot record consent; consent records
 * are canonical truth the server owns (AGENTS §9).
 */
export function parseConsentSubmission(input: unknown): SurfaceParseResult<ConsentSubmission> {
  const parsed = consentSubmissionSchema.safeParse(input);
  if (!parsed.success) return shapeFailure(parsed.error);
  return { ok: true, value: parsed.data };
}

export function submitConsentDecision(submission: ConsentSubmission): ConsentSubmissionReceipt {
  return {
    status: "submitted_for_server_recording",
    submissionId: submission.submissionId,
    consentId: submission.consentId,
    consentRecorded: false,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Feedback submission (phase doc §40) — proposal into the loop
 * ────────────────────────────────────────────────────────────*/

export const feedbackSubmissionSchema = z.strictObject({
  feedbackId: identifierSchema,
  /** Reference to the interaction the feedback is about. */
  interactionRef: identifierSchema,
  tenantId: tenantRefSchema,
  kind: z.enum(FEEDBACK_KINDS),
  rationale: nonEmptyString("feedback.rationale"),
  submittedAt: z.string().datetime(),
});
export type FeedbackSubmission = z.infer<typeof feedbackSubmissionSchema>;

export type FeedbackSubmissionReceipt = {
  readonly status: "submitted_for_server_processing";
  readonly feedbackId: Identifier;
  readonly interactionRef: Identifier;
  /** Structural: an interface receipt can never claim a learning outcome. */
  readonly learningClaimed: false;
};

/**
 * Parse an untrusted feedback submission. Fail-closed on shape violations.
 */
export function parseFeedbackSubmission(input: unknown): SurfaceParseResult<FeedbackSubmission> {
  const parsed = feedbackSubmissionSchema.safeParse(input);
  if (!parsed.success) return shapeFailure(parsed.error);
  return { ok: true, value: parsed.data };
}

export function submitFeedback(submission: FeedbackSubmission): FeedbackSubmissionReceipt {
  return {
    status: "submitted_for_server_processing",
    feedbackId: submission.feedbackId,
    interactionRef: submission.interactionRef,
    learningClaimed: false,
  };
}
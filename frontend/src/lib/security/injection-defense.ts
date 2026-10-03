/**
 * CoreGrid — prompt-injection & malicious-artifact defense contracts
 * (J-036, mission B-022; Constitution §12, §19, §20, §21, §29).
 *
 * Posture: AI output and any content that did not originate from the
 * system definition is UNTRUSTED BY DEFAULT (§21). This module encodes that
 * posture as typed, pure, fail-closed contracts at the gateway boundary:
 *
 * 1. Screening — a bounded, typed rule catalog detects instruction-override,
 *    prompt-extraction, credential-exfiltration, action-forcing,
 *    tool-call-forgery and delimiter-manipulation patterns in any content.
 *    Matches record rule id, category, severity and position — never the
 *    matched attacker text, so hostile strings cannot be laundered into
 *    results, audits or logs (§29).
 * 2. Untrusted marking — untrusted content may only cross a trust boundary
 *    inside a provenance-marked envelope fenced by machine-generated,
 *    nonce-delimited markers. Content that already contains fence syntax or
 *    the nonce collides and is refused (it cannot be safely delimited).
 *    Markings expire: a stale envelope is unusable (fail-closed).
 * 3. Quarantine — flagged or blocked content is held under an append-style
 *    record that never carries the original text. Release requires a fresh
 *    screening pass of the SAME content (digest-matched) returning
 *    `allowed`; a `blocked` verdict is terminal — it can never be released.
 * 4. Context assembly — the only sanctioned way untrusted content enters a
 *    model context is a screened, fresh, digest-verified envelope. Flagged
 *    segments are excluded and quarantined; a single blocked segment fails
 *    the whole assembly (fail-closed, no silent sanitization). A "trusted"
 *    segment may only claim trust from the system definition and is itself
 *    re-screened — trust spoofing fails the assembly.
 * 5. Malicious artifacts — declared artifact classes are screened: the
 *    executable class is forbidden outright, unclassified artifacts are
 *    quarantined-class, oversize, size-mismatch and checksum-mismatch
 *    artifacts are blocked (§12 provenance integrity).
 * 6. §21 chain — AI proposals traverse Proposal → Validation → Policy
 *    Check → Human Approval → Execution → Audit. No input exists that lets
 *    an AI proposal reach execution without human closure; validation,
 *    policy check and an audit trail ref are fail-closed preconditions.
 *    Screening can only downgrade trust, never elevate it: there is no
 *    path in this module from model output to trusted context.
 *
 * Boundary: pure data + pure functions. No I/O, no vendor calls, no wall
 * clock — every instant is a supplied parameter; no logging of any kind.
 * Persistence, provider transport and the gateway integration are out of
 * scope: callers wire these contracts at the AI gateway (§20).
 */

import { z } from "zod";
import { digestContent } from "../ai-gateway/reasoning-provenance";

/* ─────────────────────────────────────────────────────────────
 * Vocabulary
 * ────────────────────────────────────────────────────────────*/

export const INJECTION_DEFENSE_SCHEMA_VERSION = "1.0";

export const UntrustedContentKindSchema = z.enum([
  "retrieved_text",
  "tool_output",
  "model_output",
  "artifact_payload",
  "external_message",
]);
export type UntrustedContentKind = z.infer<typeof UntrustedContentKindSchema>;
export const UNTRUSTED_CONTENT_KINDS = UntrustedContentKindSchema.options;

export const ScreenVerdictSchema = z.enum(["allowed", "flagged", "blocked"]);
export type ScreenVerdict = z.infer<typeof ScreenVerdictSchema>;
export const SCREEN_VERDICTS = ScreenVerdictSchema.options;

export const ScreeningCategorySchema = z.enum([
  "instruction_override",
  "prompt_extraction",
  "credential_exfiltration",
  "action_forcing",
  "tool_call_forgery",
  "delimiter_manipulation",
]);
export type ScreeningCategory = z.infer<typeof ScreeningCategorySchema>;
export const SCREENING_CATEGORIES = ScreeningCategorySchema.options;

export const ArtifactMimeClassSchema = z.enum([
  "document",
  "data",
  "media",
  "archive",
  "executable",
  "unknown",
]);
export type ArtifactMimeClass = z.infer<typeof ArtifactMimeClassSchema>;
export const ARTIFACT_MIME_CLASSES = ArtifactMimeClassSchema.options;

export const ProposalActionClassSchema = z.enum([
  "read_only",
  "state_mutating",
  "security_sensitive",
]);
export type ProposalActionClass = z.infer<typeof ProposalActionClassSchema>;
export const PROPOSAL_ACTION_CLASSES = ProposalActionClassSchema.options;

/** Severity at or above which a screening match blocks the content. */
export const BLOCKED_SEVERITY_THRESHOLD = 4;

/** A marking is usable for this long; past it the envelope is stale. */
export const ENVELOPE_FRESHNESS_MS = 15 * 60_000;

/** Hard ceiling on screened artifact size. */
export const MAX_ARTIFACT_BYTES = 5 * 1024 * 1024;

/**
 * The §21 posture constant: model output is untrusted by default. This is
 * the ONLY trust class this module ever assigns to model output.
 */
export const AI_OUTPUT_DEFAULT_TRUST = "untrusted" as const;
export type AiOutputTrust = typeof AI_OUTPUT_DEFAULT_TRUST;

/**
 * The set of paths by which model output becomes trusted context in this
 * module. Deliberately empty (§21): screening downgrades trust, it never
 * elevates it. A future elevation path requires an explicit reviewed
 * contract change, never a silent widening.
 */
export const AI_OUTPUT_TRUST_ELEVATION_PATHS: readonly string[] = [];

/* ─────────────────────────────────────────────────────────────
 * Typed rejection (fail-closed)
 * ────────────────────────────────────────────────────────────*/

export type InjectionDefenseErrorCode =
  | "invalid_input"
  | "invalid_timestamp"
  | "envelope_shape_invalid"
  | "content_digest_mismatch"
  | "stale_envelope"
  | "blocked_content_present"
  | "trust_boundary_violation";

export class InjectionDefenseError extends Error {
  readonly code: InjectionDefenseErrorCode;

  constructor(code: InjectionDefenseErrorCode, message: string) {
    super(message);
    this.name = "InjectionDefenseError";
    this.code = code;
  }
}

const timestampSchema = z
  .string()
  .refine((value) => !Number.isNaN(Date.parse(value)), {
    message: "must be a parseable RFC 3339 instant",
  });

function assertTimestamp(now: string, at: string): void {
  if (Number.isNaN(Date.parse(now))) {
    throw new InjectionDefenseError("invalid_timestamp", `${at} is not a parseable instant`);
  }
}

/* ─────────────────────────────────────────────────────────────
 * Rule catalog — bounded, typed instruction-override patterns
 * ────────────────────────────────────────────────────────────*/

export interface ScreeningRule {
  readonly id: string;
  readonly category: ScreeningCategory;
  /** 1 (informational) … 5 (blocking). */
  readonly severity: number;
  readonly pattern: RegExp;
}

export const INJECTION_RULE_CATALOG: readonly ScreeningRule[] = [
  {
    id: "idr-001",
    category: "instruction_override",
    severity: 5,
    pattern:
      /(?:ignore|disregard|forget|bypass|override)\s+(?:all\s+|any\s+|your\s+|the\s+)*(?:previous|prior|earlier|above|original|system)\s+(?:instructions?|prompts?|rules?|guardrails?|directives?|constraints?)/i,
  },
  {
    id: "idr-002",
    category: "instruction_override",
    severity: 5,
    pattern: /^\s*(?:system|developer|assistant)\s*:\s*/im,
  },
  {
    id: "idr-003",
    category: "instruction_override",
    severity: 5,
    pattern:
      /(?:you\s+are\s+now|(?:act|pretend)\s+as\s+if\s+you\s+were?)\s+(?:a|an|the)?\s*(?:unrestricted|jailbroken|unchained|free|unfiltered|unbound)/i,
  },
  {
    id: "idr-004",
    category: "instruction_override",
    severity: 4,
    pattern: /(?:do\s+anything\s+now|no\s+(?:rules|restrictions|limits|guardrails)\s+apply)/i,
  },
  {
    id: "pex-001",
    category: "prompt_extraction",
    severity: 3,
    pattern:
      /(?:repeat|print|reveal|output|show|paste|echo)\s+(?:back\s+|out\s+|me\s+)*(?:everything|all|your|the|its)?\s*(?:initial\s+|original\s+|system\s+|hidden\s+|secret\s+)*(?:instructions?|prompt|prompts?|directives?|rules?)/i,
  },
  {
    id: "cex-001",
    category: "credential_exfiltration",
    severity: 5,
    pattern:
      /(?:reveal|print|paste|send|leak|exfiltrate|export)\s+(?:the\s+|your\s+|all\s+|any\s+)*(?:api\s*keys?|api\s?tokens?|secrets?|passwords?|credentials?|private\s+keys?)/i,
  },
  {
    id: "cex-002",
    category: "credential_exfiltration",
    severity: 2,
    pattern: /(?:api[_-]?key|access[_-]?token|password|secret)\s*[:=]\s*\S+/i,
  },
  {
    id: "act-001",
    category: "action_forcing",
    severity: 4,
    pattern:
      /(?:execute|run|delete|overwrite|drop)\s+(?:the\s+|this\s+|these\s+)*(?:following\s+)?(?:command|script|code|query|statement|file)s?\b/i,
  },
  {
    id: "tcf-001",
    category: "tool_call_forgery",
    severity: 5,
    pattern: /\{\s*"(?:tool|tool_name|function|function_name)"\s*:/i,
  },
  {
    id: "tcf-002",
    category: "tool_call_forgery",
    severity: 5,
    pattern:
      /(?:call|invoke|use)\s+(?:the\s+)?(?:function|tool)\s+(?:named\s+|called\s+)?["'`]?[\w.-]+["'`]?\s+(?:immediately|now|right\s+now)/i,
  },
  {
    id: "dlx-001",
    category: "delimiter_manipulation",
    severity: 4,
    pattern: /<<\s*(?:\/|end[\s_-]*)?(?:untrusted|trusted|system|context)/i,
  },
  {
    id: "dlx-002",
    category: "delimiter_manipulation",
    severity: 4,
    pattern: /\[\s*(?:\/|end[\s_-]*)?(?:untrusted|system)/i,
  },
];

export interface ScreeningMatch {
  readonly ruleId: string;
  readonly category: ScreeningCategory;
  readonly severity: number;
  /** Byte-offset start of the match. Position only — never the matched text. */
  readonly index: number;
  readonly length: number;
}

export interface ScreeningResult {
  readonly verdict: ScreenVerdict;
  readonly matches: readonly ScreeningMatch[];
  readonly contentDigest: string;
  readonly contentLength: number;
  readonly screenedAt: string;
  readonly schemaVersion: string;
}

export const ScreeningInputSchema = z.strictObject({
  content: z.string(),
  now: timestampSchema,
});

function combineVerdict(matches: readonly ScreeningMatch[]): ScreenVerdict {
  if (matches.some((m) => m.severity >= BLOCKED_SEVERITY_THRESHOLD)) {
    return "blocked";
  }
  return matches.length > 0 ? "flagged" : "allowed";
}

/**
 * Screen content against the bounded rule catalog. Fail-closed: content
 * carrying NUL or other control characters (except tab/newline/carriage
 * return) is an obfuscation vector and is blocked outright. Results carry
 * match positions, never the matched text.
 */
export function screenContent(input: z.input<typeof ScreeningInputSchema>): ScreeningResult {
  const parsed = ScreeningInputSchema.parse(input);
  const { content, now } = parsed;

  const contentDigest = digestContent(content);
  const base = {
    contentDigest,
    contentLength: content.length,
    screenedAt: now,
    schemaVersion: INJECTION_DEFENSE_SCHEMA_VERSION,
  };

  // Fail-closed: forbidden control characters defeat pattern inspection.
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/.test(content)) {
    return { verdict: "blocked", matches: [], ...base };
  }

  const matches: ScreeningMatch[] = [];
  for (const rule of INJECTION_RULE_CATALOG) {
    const found = rule.pattern.exec(content);
    if (found !== null) {
      matches.push({
        ruleId: rule.id,
        category: rule.category,
        severity: rule.severity,
        index: found.index,
        length: found[0].length,
      });
    }
  }

  return { verdict: combineVerdict(matches), matches, ...base };
}

/* ─────────────────────────────────────────────────────────────
 * Untrusted marking — provenance envelopes with nonce fences
 * ────────────────────────────────────────────────────────────*/

export const FENCE_OPEN_PREFIX = "<<UNTRUSTED:";
export const FENCE_CLOSE_PREFIX = "<<END-UNTRUSTED:";

export const MarkUntrustedContentInputSchema = z.strictObject({
  kind: UntrustedContentKindSchema,
  content: z.string(),
  originRef: z.string().min(1).nullable().default(null),
  /** Delimiting nonce — a marker, not a secret. Must be non-empty. */
  nonce: z.string().min(1),
  now: timestampSchema,
});

export interface UntrustedContentEnvelope {
  readonly envelopeId: string;
  readonly kind: UntrustedContentKind;
  readonly originRef: string | null;
  readonly nonce: string;
  readonly content: string;
  readonly openingFence: string;
  readonly closingFence: string;
  readonly fencedText: string;
  readonly screen: ScreeningResult;
  readonly markedAt: string;
  readonly freshnessMs: number;
  readonly schemaVersion: string;
}

export type MarkUntrustedContentResult =
  | { readonly ok: true; readonly envelope: UntrustedContentEnvelope }
  | { readonly ok: false; readonly code: "delimiter_collision"; readonly reason: string };

/**
 * Mark untrusted content: screen it, then fence it inside machine-generated
 * provenance delimiters. Fails closed (delimiter_collision) when the content
 * already contains fence syntax or the nonce — such content cannot be
 * delimited safely and must be quarantined, never fenced.
 */
export function markUntrustedContent(
  input: z.input<typeof MarkUntrustedContentInputSchema>,
): MarkUntrustedContentResult {
  const parsed = MarkUntrustedContentInputSchema.parse(input);
  const { kind, content, originRef, nonce, now } = parsed;

  const collisionTokens = [FENCE_OPEN_PREFIX, FENCE_CLOSE_PREFIX, nonce];
  for (const token of collisionTokens) {
    if (content.includes(token)) {
      return {
        ok: false,
        code: "delimiter_collision",
        reason: `Content contains fence-collision material and cannot be delimited (token class: ${token === nonce ? "nonce" : "fence marker"})`,
      };
    }
  }

  const screen = screenContent({ content, now });
  const openingFence = `${FENCE_OPEN_PREFIX}${nonce}>>`;
  const closingFence = `${FENCE_CLOSE_PREFIX}${nonce}>>`;
  const provenanceLine =
    `provenance: untrusted; kind: ${kind}; origin: ${originRef ?? "unspecified"}; ` +
    `marked-at: ${now}; schema: ${INJECTION_DEFENSE_SCHEMA_VERSION}`;
  const fencedText = `${openingFence}\n${provenanceLine}\n${content}\n${closingFence}`;

  const envelope: UntrustedContentEnvelope = {
    envelopeId: digestContent({ kind, originRef, nonce, content }),
    kind,
    originRef,
    nonce,
    content,
    openingFence,
    closingFence,
    fencedText,
    screen,
    markedAt: now,
    freshnessMs: ENVELOPE_FRESHNESS_MS,
    schemaVersion: INJECTION_DEFENSE_SCHEMA_VERSION,
  };

  return { ok: true, envelope };
}

/**
 * Why the envelope cannot be consumed right now, or null when it can:
 * schema version matches, shape intact, screen not blocked, content not
 * tampered (digest still matches), and `now` inside the marking window.
 */
export function envelopeUnusableReason(
  envelope: UntrustedContentEnvelope,
  now: string,
): string | null {
  if (envelope.schemaVersion !== INJECTION_DEFENSE_SCHEMA_VERSION) {
    return `Envelope schema ${envelope.schemaVersion} does not match contract ${INJECTION_DEFENSE_SCHEMA_VERSION}`;
  }
  if (!UNTRUSTED_CONTENT_KINDS.includes(envelope.kind)) {
    return "Envelope carries an untrusted-content kind outside the bounded vocabulary";
  }
  if (envelope.screen.verdict === "blocked") {
    return "Envelope carries blocked content; it may never be consumed (fail-closed)";
  }
  if (digestContent(envelope.content) !== envelope.screen.contentDigest) {
    return "Envelope content does not match its recorded screening digest (tampered after marking)";
  }
  const nowMs = Date.parse(now);
  const markedMs = Date.parse(envelope.markedAt);
  if (Number.isNaN(nowMs) || Number.isNaN(markedMs)) {
    return "Envelope or evaluation carries an unparseable instant (fail-closed)";
  }
  if (nowMs < markedMs) {
    return "Evaluation instant precedes the marking instant (fail-closed)";
  }
  if (nowMs >= markedMs + envelope.freshnessMs) {
    return "Envelope is stale: the marking window has passed (fail-closed)";
  }
  return null;
}

export function isEnvelopeUsable(envelope: UntrustedContentEnvelope, now: string): boolean {
  return envelopeUnusableReason(envelope, now) === null;
}

/* ─────────────────────────────────────────────────────────────
 * Quarantine — hold records without hostile text, gated release
 * ────────────────────────────────────────────────────────────*/

export const QuarantineEvidenceSchema = z.strictObject({
  contentDigest: z.string().min(1).nullable(),
  contentLength: z.number().int().nonnegative().nullable(),
  verdict: ScreenVerdictSchema,
});

export const OpenQuarantineInputSchema = z.strictObject({
  evidence: QuarantineEvidenceSchema,
  envelopeId: z.string().min(1).nullable(),
  reason: z.string().min(1),
  now: timestampSchema,
});

export interface QuarantineRecord {
  readonly quarantineId: string;
  readonly evidence: z.infer<typeof QuarantineEvidenceSchema>;
  readonly envelopeId: string | null;
  readonly reason: string;
  readonly quarantinedAt: string;
  readonly releasedAt: string | null;
  readonly schemaVersion: string;
}

/**
 * Open a quarantine record. The record carries digests, lengths and the
 * verdict — never the original content — so hostile text cannot be
 * laundered back out through the quarantine surface.
 */
export function openQuarantine(input: z.input<typeof OpenQuarantineInputSchema>): QuarantineRecord {
  const parsed = OpenQuarantineInputSchema.parse(input);
  return {
    quarantineId: digestContent({ ...parsed, schemaVersion: INJECTION_DEFENSE_SCHEMA_VERSION }),
    evidence: parsed.evidence,
    envelopeId: parsed.envelopeId,
    reason: parsed.reason,
    quarantinedAt: parsed.now,
    releasedAt: null,
    schemaVersion: INJECTION_DEFENSE_SCHEMA_VERSION,
  };
}

export type QuarantineReleaseDecision = "release" | "hold_review" | "hold_permanent";

/**
 * Release decision for a quarantined item. Fail-closed:
 * - `blocked` verdicts are terminal — hold_permanent, regardless of any
 *   later screening result.
 * - otherwise release requires a FRESH screening pass of the SAME content
 *   (digest-matched, §12 provenance) that returns `allowed`.
 * - anything else stays held for review.
 */
export function quarantineReleaseDecision(
  record: QuarantineRecord,
  reScreen: ScreeningResult | null,
): QuarantineReleaseDecision {
  if (record.evidence.verdict === "blocked") {
    return "hold_permanent";
  }
  if (reScreen === null) {
    return "hold_review";
  }
  if (
    record.evidence.contentDigest === null ||
    reScreen.contentDigest !== record.evidence.contentDigest
  ) {
    return "hold_review";
  }
  return reScreen.verdict === "allowed" ? "release" : "hold_review";
}

/* ─────────────────────────────────────────────────────────────
 * Context assembly — the sanctioned path across the boundary
 * ────────────────────────────────────────────────────────────*/

export const TrustedInstructionSourceSchema = z.enum(["system_definition"]);
export type TrustedInstructionSource = z.infer<typeof TrustedInstructionSourceSchema>;

export interface TrustedInstructionSegment {
  readonly role: "trusted_instruction";
  readonly ref: string;
  readonly text: string;
  readonly instructionSource: TrustedInstructionSource;
}

export interface UntrustedContentSegment {
  readonly role: "untrusted_content";
  readonly envelope: UntrustedContentEnvelope;
}

export type AssemblySegment = TrustedInstructionSegment | UntrustedContentSegment;

export interface AssembledContext {
  readonly assemblyId: string;
  readonly fencedText: string;
  readonly includedDigests: readonly string[];
  readonly quarantined: readonly QuarantineRecord[];
  readonly assembledAt: string;
  readonly schemaVersion: string;
}

function renderTrustedSegment(segment: TrustedInstructionSegment): string {
  return `[[TRUSTED-INSTRUCTION ref=${segment.ref}]]\n${segment.text}\n[[/TRUSTED-INSTRUCTION]]`;
}

/**
 * Assemble a screened context. Laws:
 * - Only system-definition segments may claim trusted provenance; any other
 *   source is a trust-boundary violation (fail-closed).
 * - Trusted text is re-screened at assembly time; instruction-override or
 *   delimiter-manipulation patterns in "trusted" text are a trust spoofing
 *   attempt and fail the whole assembly.
 * - Untrusted segments enter ONLY as envelopes. Stale or tampered envelopes
 *   fail the assembly. Flagged segments are excluded and quarantined. A
 *   blocked segment fails the whole assembly — no silent sanitization.
 */
export function assembleScreenedContext(input: {
  segments: readonly AssemblySegment[];
  now: string;
}): AssembledContext {
  assertTimestamp(input.now, "assembly instant");

  const rendered: string[] = [];
  const includedDigests: string[] = [];
  const quarantined: QuarantineRecord[] = [];

  for (const segment of input.segments) {
    if (segment.role === "trusted_instruction") {
      if (segment.instructionSource !== "system_definition") {
        throw new InjectionDefenseError(
          "trust_boundary_violation",
          "Only system-definition provenance may claim trusted instruction standing",
        );
      }
      if (segment.ref.trim() === "") {
        throw new InjectionDefenseError("invalid_input", "Trusted segment requires a ref");
      }
      const screen = screenContent({ content: segment.text, now: input.now });
      const spoofed = screen.matches.some(
        (m) => m.category === "instruction_override" || m.category === "delimiter_manipulation",
      );
      if (spoofed) {
        throw new InjectionDefenseError(
          "trust_boundary_violation",
          "Trusted segment carries instruction-override or delimiter-manipulation patterns; trust spoofing fails the assembly",
        );
      }
      includedDigests.push(screen.contentDigest);
      rendered.push(renderTrustedSegment(segment));
      continue;
    }

    const envelope = segment.envelope;
    if (typeof envelope !== "object" || envelope === null) {
      throw new InjectionDefenseError(
        "envelope_shape_invalid",
        "Untrusted segment does not carry an envelope; raw untrusted content cannot cross the boundary",
      );
    }
    const shapeOk =
      typeof envelope.content === "string" &&
      typeof envelope.openingFence === "string" &&
      typeof envelope.closingFence === "string" &&
      typeof envelope.screen === "object" &&
      envelope.screen !== null;
    if (!shapeOk) {
      throw new InjectionDefenseError(
        "envelope_shape_invalid",
        "Untrusted envelope is missing required marking fields",
      );
    }
    if (digestContent(envelope.content) !== envelope.screen.contentDigest) {
      throw new InjectionDefenseError(
        "content_digest_mismatch",
        "Envelope content does not match its recorded screening digest",
      );
    }
    if (envelope.screen.verdict === "blocked") {
      throw new InjectionDefenseError(
        "blocked_content_present",
        "Assembly contains blocked untrusted content; fail-closed, no silent sanitization",
      );
    }
    const unusable = envelopeUnusableReason(envelope, input.now);
    if (unusable !== null) {
      throw new InjectionDefenseError("stale_envelope", unusable);
    }
    if (envelope.screen.verdict === "flagged") {
      quarantined.push(
        openQuarantine({
          evidence: {
            contentDigest: envelope.screen.contentDigest,
            contentLength: envelope.screen.contentLength,
            verdict: envelope.screen.verdict,
          },
          envelopeId: envelope.envelopeId,
          reason: "Flagged untrusted content excluded at context assembly",
          now: input.now,
        }),
      );
      continue;
    }
    includedDigests.push(envelope.screen.contentDigest);
    rendered.push(envelope.fencedText);
  }

  return {
    assemblyId: digestContent({
      schemaVersion: INJECTION_DEFENSE_SCHEMA_VERSION,
      includedDigests,
    }),
    fencedText: rendered.join("\n"),
    includedDigests,
    quarantined,
    assembledAt: input.now,
    schemaVersion: INJECTION_DEFENSE_SCHEMA_VERSION,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Malicious-artifact defense
 * ────────────────────────────────────────────────────────────*/

export const ArtifactDescriptorSchema = z.strictObject({
  artifactId: z.string().min(1),
  name: z.string().min(1),
  mimeClass: ArtifactMimeClassSchema,
  sizeBytes: z.number().int().nonnegative(),
  checksum: z.string().min(1).nullable().default(null),
});
export type ArtifactDescriptor = z.infer<typeof ArtifactDescriptorSchema>;

export type ArtifactScreeningCode =
  | "executable_artifact_forbidden"
  | "unclassified_artifact"
  | "archive_requires_inspection"
  | "size_limit_exceeded"
  | "size_mismatch"
  | "checksum_mismatch"
  | "checksum_required";

/** Reason codes that always block, independent of any screening result. */
const BLOCKING_ARTIFACT_CODES: readonly ArtifactScreeningCode[] = [
  "executable_artifact_forbidden",
  "size_limit_exceeded",
  "size_mismatch",
  "checksum_mismatch",
];

export interface ArtifactScreeningResult {
  readonly artifactId: string;
  readonly verdict: ScreenVerdict;
  readonly reasons: readonly ArtifactScreeningCode[];
  readonly screen: ScreeningResult | null;
  /** Digest of the screened payload, or of the descriptor when none was supplied. */
  readonly contentDigest: string;
  readonly screenedAt: string;
  readonly schemaVersion: string;
}

export interface ScreenArtifactInput {
  descriptor: ArtifactDescriptor;
  /** Text payload when one is available; null screens the declaration only. */
  content: string | null;
  now: string;
}

/**
 * Screen a declared artifact. Fail-closed: the executable class is forbidden
 * outright; unclassified artifacts never pass clean; oversize, declared-vs-
 * actual size mismatch and checksum mismatch are blocked (§12 integrity).
 * A supplied payload is itself injection-screened and the worst verdict wins.
 */
export function screenArtifact(input: ScreenArtifactInput): ArtifactScreeningResult {
  const descriptor = ArtifactDescriptorSchema.parse(input.descriptor);
  assertTimestamp(input.now, "screening instant");

  const reasons: ArtifactScreeningCode[] = [];

  if (descriptor.mimeClass === "executable") {
    reasons.push("executable_artifact_forbidden");
  }
  if (descriptor.mimeClass === "unknown") {
    reasons.push("unclassified_artifact");
  }
  if (descriptor.mimeClass === "archive") {
    reasons.push("archive_requires_inspection");
  }
  if (descriptor.sizeBytes > MAX_ARTIFACT_BYTES) {
    reasons.push("size_limit_exceeded");
  }

  let screen: ScreeningResult | null = null;
  let contentDigest: string;
  if (input.content !== null) {
    if (input.content.length !== descriptor.sizeBytes) {
      reasons.push("size_mismatch");
    }
    if (descriptor.checksum === null) {
      reasons.push("checksum_required");
    } else if (descriptor.checksum !== digestContent(input.content)) {
      reasons.push("checksum_mismatch");
    }
    screen = screenContent({ content: input.content, now: input.now });
    contentDigest = screen.contentDigest;
  } else {
    contentDigest = digestContent(descriptor);
  }

  const verdict: ScreenVerdict =
    reasons.some((code) => BLOCKING_ARTIFACT_CODES.includes(code)) || screen?.verdict === "blocked"
      ? "blocked"
      : reasons.length > 0 || screen?.verdict === "flagged"
        ? "flagged"
        : "allowed";

  return {
    artifactId: descriptor.artifactId,
    verdict,
    reasons,
    screen,
    contentDigest,
    screenedAt: input.now,
    schemaVersion: INJECTION_DEFENSE_SCHEMA_VERSION,
  };
}

/* ─────────────────────────────────────────────────────────────
 * §21 AI output posture — screening never elevates trust
 * ────────────────────────────────────────────────────────────*/

export interface ModelOutputScreeningResult {
  /** Always AI_OUTPUT_DEFAULT_TRUST ("untrusted"). See AI_OUTPUT_TRUST_ELEVATION_PATHS. */
  readonly trust: AiOutputTrust;
  readonly screen: ScreeningResult;
  readonly screenedAt: string;
  readonly schemaVersion: string;
}

/**
 * Screen model output. Model output is untrusted content of kind
 * `model_output` and is screened like any untrusted source (a model may echo
 * or generate injection payloads). A clean scan never elevates its trust:
 * the result's trust class is unconditionally `untrusted`.
 */
export function screenModelOutput(input: { content: string; now: string }): ModelOutputScreeningResult {
  const screen = screenContent(input);
  return {
    trust: AI_OUTPUT_DEFAULT_TRUST,
    screen,
    screenedAt: input.now,
    schemaVersion: INJECTION_DEFENSE_SCHEMA_VERSION,
  };
}

/* ─────────────────────────────────────────────────────────────
 * §21 proposal gate — Proposal → Validation → Policy Check →
 * Human Approval → Execution → Audit
 * ────────────────────────────────────────────────────────────*/

export type ProposalGateStep =
  | "validation"
  | "policy_check"
  | "human_approval"
  | "execution"
  | "audit";

export type ProposalGateBlockedCode =
  | "unvalidated_proposal"
  | "policy_check_missing"
  | "audit_record_required";

export interface AiProposalGateInput {
  readonly actionClass: ProposalActionClass;
  readonly validated: boolean;
  readonly policyChecked: boolean;
  readonly humanApproved: boolean;
  /** Reference of the audit record that will capture the action (§29). */
  readonly auditTrailRef: string | null;
}

export interface AiProposalGateOutcome {
  readonly outcome: "proceed" | "require_approval" | "blocked";
  readonly blockedCode: ProposalGateBlockedCode | null;
  readonly remainingSteps: readonly ProposalGateStep[];
  readonly humanApprovalRequired: boolean;
}

/**
 * Gate an AI proposal through the §21 chain. Fail-closed invariants:
 * - An unvalidated proposal never proceeds.
 * - A proposal that has not passed the policy check never proceeds.
 * - A proposal without an audit trail reference never proceeds.
 * - No input can produce `proceed` without human approval — there is no
 *   AI-side approval input in the contract at all; the requester can never
 *   close its own case.
 */
export function gateAiProposal(input: AiProposalGateInput): AiProposalGateOutcome {
  const actionClass = ProposalActionClassSchema.parse(input.actionClass);

  if (!input.validated) {
    return {
      outcome: "blocked",
      blockedCode: "unvalidated_proposal",
      remainingSteps: [],
      humanApprovalRequired: true,
    };
  }
  if (!input.policyChecked) {
    return {
      outcome: "blocked",
      blockedCode: "policy_check_missing",
      remainingSteps: [],
      humanApprovalRequired: true,
    };
  }
  if (input.auditTrailRef === null || input.auditTrailRef.trim() === "") {
    return {
      outcome: "blocked",
      blockedCode: "audit_record_required",
      remainingSteps: [],
      humanApprovalRequired: true,
    };
  }
  if (!input.humanApproved) {
    return {
      outcome: "require_approval",
      blockedCode: null,
      remainingSteps: ["human_approval", "execution", "audit"],
      humanApprovalRequired: true,
    };
  }
  return {
    outcome: "proceed",
    blockedCode: null,
    remainingSteps: ["execution", "audit"],
    humanApprovalRequired: false,
  };
}
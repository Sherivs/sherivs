/**
 * CoreGrid — AI-specific runtime defenses (J-036 / V1CAP-033, MISSION-R-84;
 * hardening L-H-014; Constitution §19 AI privacy, §20 AI gateway, §21 AI
 * output trust, §26 API governance, §29 observability).
 *
 * Three defensive families, all FIRST-CLASS runtime capabilities (E-062:
 * "first-class runtime capabilities, not add-ons"), all fail-closed and all
 * auditable. Every defense decision — allow, block, quarantine or redact —
 * produces a `DefenseAuditRecord`; nothing is dropped, withheld or modified
 * silently (§29: every important decision is observable and auditable).
 *
 * (a) PROMPT-INJECTION GUARDS (L-T-005)
 *   - Input analysis: every untrusted input carries a DECLARED content
 *     provenance (user / external / tool_output / memory) and is marked as
 *     untrusted data — structurally NEVER an instruction. Injection-shaped
 *     content is recorded as evidence (digests, never raw payloads).
 *   - Canary tokens: deterministic, session-scoped markers embedded in the
 *     trusted instruction block. A canary appearing in an AI output is
 *     injection evidence — the output is BLOCKED.
 *   - Instruction-source separation: the prompt is assembled structurally so
 *     that instructions can only originate from trusted sources (operator /
 *     system policy); an untrusted segment that CLAIMS instruction role is
 *     demoted to delimited data. Re-classification is structurally impossible.
 *
 * (b) MALICIOUS-ARTIFACT GUARDS (L-T-005)
 *   - Tool/file outputs entering AI context pass an artifact gate against a
 *     declared registry of artifact classes with size/type bounds and scan
 *     status. An unclassified, unmeasurable, out-of-bounds, type-mismatched,
 *     suspicious or unscannable artifact is QUARANTINED — it never silently
 *     enters context. Fail-closed: uncertainty always quarantines.
 *
 * (c) EXFILTRATION GUARDS (L-T-008)
 *   - Output screening against declared secret patterns: secret-shaped output
 *     material is BLOCKED, never redacted (redaction of secrets would still
 *     publish an artifact derived from the secret; blocking leaves no
 *     derivative). Evidence carries only the pattern id and a digest of the
 *     match — never the secret material itself.
 *   - Sensitivity ceilings: an output above the declared ceiling is REDACTED
 *     with a first-class redaction record (the memory-tier exclusion pattern:
 *     withheld material is recorded, nothing drops silently).
 *   - Cross-tenant content is an exfiltration event: foreign-tenant items in
 *     context and foreign-tenant markers in output are blocked, audited and
 *     evidence-bearing.
 *
 * Interlocks (composition, not forking):
 *   - `bindDefensesToSnapshot` validates the intelligence snapshot (J-015)
 *     fail-closed through `validateIntelligenceSnapshot` and binds defense
 *     records to it, rejecting cross-tenant record binding.
 *   - `defenseValidationForPipeline` converts a binding into the trust
 *     pipeline's (J-035) validation-stage input: a defense block fails the
 *     pipeline's `validated` stage — a blocked output can never advance.
 *
 * Design laws honored here (mirroring the sibling gateway modules):
 * - Purity: no I/O, no environment reads, no wall-clock sampling — every
 *   instant is a supplied parameter; canaries are deterministic (supplied
 *   nonce), never random.
 * - Immutability: every returned structure is deep-frozen.
 * - Determinism: record ids are canonical digests (reasoning-provenance).
 * - Fail-closed: unknown provenance, unknown sensitivity, unscannable and
 *   unclassified artifacts, unstated sensitivity against a declared ceiling —
 *   all reject or quarantine. There is no "allow on doubt" path.
 */

import {
  digestContent,
  validateIntelligenceSnapshot,
  type IntelligenceSnapshot,
} from "./reasoning-provenance";

/* ─────────────────────────────────────────────────────────────
 * Schema + vocabularies
 * ────────────────────────────────────────────────────────────*/

export const RUNTIME_DEFENSES_SCHEMA_VERSION = "1.0";

/** The three first-class defense families (J-036). */
export type DefenseFamily = "prompt_injection" | "malicious_artifact" | "exfiltration";

/** The decisions a defense can produce. */
export type DefenseDecision = "allow" | "block" | "quarantine" | "redact";

/**
 * DECLARED content provenance for untrusted data entering AI context
 * (L-T-005: customer messages, external documents, agent-retrieved artifacts,
 * memory). Anything outside this vocabulary is rejected — provenance is never
 * guessed.
 */
export type ContentProvenance = "user" | "external" | "tool_output" | "memory";

/**
 * The ONLY provenances allowed to carry instruction role in a separated
 * prompt. Untrusted content is structurally data, never instructions.
 */
export type InstructionProvenance = "operator" | "system_policy";

/** The full segment-provenance vocabulary of a separated prompt. */
export type SegmentProvenance = ContentProvenance | InstructionProvenance;

export const CONTENT_PROVENANCES: readonly ContentProvenance[] = [
  "user",
  "external",
  "tool_output",
  "memory",
] as const;

export const INSTRUCTION_PROVENANCES: readonly InstructionProvenance[] = [
  "operator",
  "system_policy",
] as const;

/**
 * Data sensitivity vocabulary REUSED from context-assembly (J-011) — one
 * sensitivity language across assembly and defenses. Comparison rank mirrors
 * context-assembly's order (public < internal < restricted).
 */
export type DefenseSensitivity = import("../context-assembly").ContextSensitivity;

const SENSITIVITY_RANK: Record<DefenseSensitivity, 0 | 1 | 2> = {
  public: 0,
  internal: 1,
  restricted: 2,
};

function isDefenseSensitivity(value: unknown): value is DefenseSensitivity {
  return value === "public" || value === "internal" || value === "restricted";
}

/* ─────────────────────────────────────────────────────────────
 * Typed rejection (fail-closed on malformed input)
 * ────────────────────────────────────────────────────────────*/

export type RuntimeDefenseErrorCode =
  | "invalid_input"
  | "unknown_provenance"
  | "unknown_sensitivity"
  | "canary_not_embedded"
  | "cross_tenant_binding";

export class RuntimeDefenseError extends Error {
  readonly code: RuntimeDefenseErrorCode;
  /** The defense family the rejection occurred in; null when family-agnostic. */
  readonly family: DefenseFamily | null;
  /** The input field that failed the fail-closed gate. */
  readonly field: string;

  constructor(
    code: RuntimeDefenseErrorCode,
    family: DefenseFamily | null,
    field: string,
    message: string,
  ) {
    super(message);
    this.name = "RuntimeDefenseError";
    this.code = code;
    this.family = family;
    this.field = field;
  }
}

function fail(
  code: RuntimeDefenseErrorCode,
  family: DefenseFamily | null,
  field: string,
  message: string,
): never {
  throw new RuntimeDefenseError(code, family, field, message);
}

function requireNonEmpty(field: string, value: unknown): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    fail("invalid_input", null, field, `${field} must be a non-empty string`);
  }
  return value;
}

function requireTimestamp(field: string, value: unknown): string {
  const at = requireNonEmpty(field, value);
  if (Number.isNaN(Date.parse(at))) {
    fail("invalid_input", null, field, `${field} must be a parseable ISO-8601 timestamp`);
  }
  return at;
}

function inProvenanceVocabulary(value: string): value is SegmentProvenance {
  return (
    (CONTENT_PROVENANCES as readonly string[]).includes(value) ||
    (INSTRUCTION_PROVENANCES as readonly string[]).includes(value)
  );
}

function requireProvenance(field: string, value: unknown): SegmentProvenance {
  if (typeof value !== "string" || !inProvenanceVocabulary(value)) {
    fail(
      "unknown_provenance",
      "prompt_injection",
      field,
      `${field} "${String(value)}" is outside the declared provenance vocabulary — provenance is never guessed (fail-closed)`,
    );
  }
  return value;
}

function isContentProvenance(value: string): value is ContentProvenance {
  return (CONTENT_PROVENANCES as readonly string[]).includes(value);
}

/**
 * Untrusted data provenance ONLY — trusted instruction provenances can never
 * masquerade as untrusted content sources.
 */
function requireContentProvenance(field: string, value: unknown): ContentProvenance {
  if (typeof value !== "string" || !isContentProvenance(value)) {
    fail(
      "unknown_provenance",
      "prompt_injection",
      field,
      `${field} "${String(value)}" is not a declared untrusted-content provenance — provenance is never guessed (fail-closed)`,
    );
  }
  return value;
}

/* ─────────────────────────────────────────────────────────────
 * The audit record — every defense decision produces one (§29)
 * ────────────────────────────────────────────────────────────*/

/**
 * One auditable defense decision. Evidence-bearing but payload-free: raw
 * untrusted content, secret material and foreign payloads NEVER enter the
 * record — only ids, pattern ids, tenants and deterministic digests.
 */
export interface DefenseAuditRecord {
  /** Deterministic content identity of the record body. */
  readonly recordId: string;
  readonly schemaVersion: typeof RUNTIME_DEFENSES_SCHEMA_VERSION;
  readonly family: DefenseFamily;
  readonly decision: DefenseDecision;
  readonly tenantRef: string;
  /** Why the decision was made — always stated, never empty. */
  readonly reason: string;
  /** Evidence ids/digests; never raw payloads. */
  readonly evidence: readonly string[];
  /** Bound intelligence snapshot id; null when not yet snapshot-bound. */
  readonly snapshotId: string | null;
  /** Audit instant — always a supplied parameter, never wall-clock sampled. */
  readonly recordedAt: string;
}

function buildRecord(
  record: Omit<DefenseAuditRecord, "recordId" | "schemaVersion" | "snapshotId"> & {
    snapshotId?: string | null;
  },
): DefenseAuditRecord {
  const body: Omit<DefenseAuditRecord, "recordId"> = {
    schemaVersion: RUNTIME_DEFENSES_SCHEMA_VERSION,
    family: record.family,
    decision: record.decision,
    tenantRef: record.tenantRef,
    reason: record.reason,
    evidence: record.evidence,
    snapshotId: record.snapshotId ?? null,
    recordedAt: record.recordedAt,
  };
  return deepFreeze({ ...body, recordId: digestContent(body) });
}

/* ─────────────────────────────────────────────────────────────
 * (a) Prompt-injection guards — input analysis
 * ────────────────────────────────────────────────────────────*/

/**
 * Deterministic injection heuristics. Matches are EVIDENCE, not verdicts:
 * untrusted content stays data regardless; findings raise the recorded risk
 * and feed output screening.
 */
const INJECTION_PATTERNS: readonly { patternId: string; pattern: RegExp }[] = [
  {
    patternId: "override_instructions",
    pattern: /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+instructions/i,
  },
  {
    patternId: "disregard_directives",
    pattern: /disregard\s+(all\s+)?(previous|prior|above)\s+(instructions|directives|rules)/i,
  },
  {
    patternId: "system_prompt_probe",
    pattern: /(reveal|show|print|repeat)\s+(your\s+)?(system\s+)?(prompt|instructions)/i,
  },
  { patternId: "role_hijack", pattern: /you\s+are\s+now\s+(a|an|the)\s+/i },
  { patternId: "role_tag_spoof", pattern: /^\s*(system|assistant|developer)\s*:/im },
  { patternId: "delimiter_escape", pattern: /<\/?(untrusted-data|system|instructions)\s*>/i },
];

export interface InjectionFinding {
  readonly patternId: string;
  /** Digest of the matched span — evidence without propagating the payload. */
  readonly matchDigest: string;
}

export interface UntrustedContentInput {
  readonly contentId: string;
  readonly tenantRef: string;
  readonly provenance: string;
  readonly content: string;
  readonly recordedAt: string;
}

export interface UntrustedContentAnalysis {
  readonly contentId: string;
  readonly tenantRef: string;
  readonly provenance: ContentProvenance;
  /** Untrusted content is ALWAYS data — the verdict has no other value. */
  readonly verdict: "untrusted_data";
  /** The content wrapped in enforced delimiters for downstream prompt assembly. */
  readonly delimited: string;
  readonly injectionFindings: readonly InjectionFinding[];
  readonly record: DefenseAuditRecord;
}

/**
 * Analyze one untrusted input. Fail-closed: provenance outside the declared
 * vocabulary is a typed rejection — untrusted content can never be admitted
 * as trusted by guessing, and unknown provenance can never pass as known.
 */
export function analyzeUntrustedContent(input: UntrustedContentInput): UntrustedContentAnalysis {
  const contentId = requireNonEmpty("contentId", input.contentId);
  const tenantRef = requireNonEmpty("tenantRef", input.tenantRef);
  const provenance = requireContentProvenance("provenance", input.provenance);
  if (typeof input.content !== "string") {
    fail("invalid_input", "prompt_injection", "content", "content must be a string");
  }
  const recordedAt = requireTimestamp("recordedAt", input.recordedAt);

  const injectionFindings: InjectionFinding[] = [];
  for (const { patternId, pattern } of INJECTION_PATTERNS) {
    const matcher = new RegExp(pattern.source, pattern.flags);
    const match = matcher.exec(input.content);
    if (match !== null) {
      injectionFindings.push({ patternId, matchDigest: digestContent(match[0]) });
    }
  }

  const delimited = `<untrusted-data provenance="${provenance}" id="${contentId}">\n${input.content}\n</untrusted-data>`;
  const record = buildRecord({
    family: "prompt_injection",
    decision: "allow",
    tenantRef,
    reason:
      injectionFindings.length > 0
        ? `untrusted ${provenance} content marked as data with ${injectionFindings.length} injection-shaped finding(s) recorded as evidence`
        : `untrusted ${provenance} content marked as data`,
    evidence: injectionFindings.map((finding) => `${finding.patternId}:${finding.matchDigest}`),
    recordedAt,
  });

  return deepFreeze({
    contentId,
    tenantRef,
    provenance,
    verdict: "untrusted_data",
    delimited,
    injectionFindings,
    record,
  });
}

/* ─────────────────────────────────────────────────────────────
 * (a) Prompt-injection guards — canary tokens
 * ────────────────────────────────────────────────────────────*/

export interface RuntimeCanaryInput {
  readonly tenantRef: string;
  readonly purpose: string;
  readonly sessionRef: string;
  /** Supplied nonce — purity: canaries are deterministic, never random. */
  readonly nonce: string;
}

export interface RuntimeCanary {
  readonly canaryId: string;
  readonly token: string;
}

/**
 * Mint one deterministic canary for an invocation. The token is embedded in
 * the trusted instruction block; the model has no legitimate reason to emit
 * it, so any occurrence in output is injection evidence.
 */
export function mintCanary(input: RuntimeCanaryInput): RuntimeCanary {
  const tenantRef = requireNonEmpty("tenantRef", input.tenantRef);
  const purpose = requireNonEmpty("purpose", input.purpose);
  const sessionRef = requireNonEmpty("sessionRef", input.sessionRef);
  const nonce = requireNonEmpty("nonce", input.nonce);
  const canaryId = digestContent({ tenantRef, purpose, sessionRef, nonce });
  return deepFreeze({ canaryId, token: `CG-CANARY-${canaryId}` });
}

export interface ProtectedInstructions {
  /** The instruction block WITH the canary embedded — ready for the prompt. */
  readonly text: string;
  readonly canary: RuntimeCanary;
}

/**
 * Embed the canary into the trusted instruction block. Fail-closed: the
 * built text must verifiably contain the token (a canary that is not present
 * cannot detect anything), enforced structurally here.
 */
export function buildProtectedInstructions(
  instructions: string,
  canary: RuntimeCanary,
): ProtectedInstructions {
  const text = requireNonEmpty("instructions", instructions);
  const built = `${text}\n[integrity-marker: ${canary.token}]`;
  if (!built.includes(canary.token)) {
    fail(
      "canary_not_embedded",
      "prompt_injection",
      "canary.token",
      "protected instruction block failed to embed the canary token",
    );
  }
  return deepFreeze({ text: built, canary });
}

/* ─────────────────────────────────────────────────────────────
 * (a) Prompt-injection guards — instruction-source separation
 * ────────────────────────────────────────────────────────────*/

export interface PromptSegment {
  /** The role the segment CLAIMS. Untrusted claims are demoted, not honored. */
  readonly role: "instruction" | "data";
  readonly provenance: string;
  readonly content: string;
}

export interface SeparatedInstruction {
  readonly provenance: InstructionProvenance;
  readonly content: string;
}

export interface SeparatedDataSegment {
  readonly provenance: SegmentProvenance;
  readonly content: string;
  readonly delimited: string;
  /** True when the segment claimed instruction role but was demoted to data. */
  readonly demotedFromInstruction: boolean;
}

export interface SeparatedPrompt {
  /** Instructions ONLY from trusted sources — structurally guaranteed. */
  readonly instructions: readonly SeparatedInstruction[];
  readonly dataSegments: readonly SeparatedDataSegment[];
  readonly records: readonly DefenseAuditRecord[];
}

/**
 * Structurally separate instructions from data. Laws:
 * - An instruction-role segment is honored ONLY when its provenance is a
 *   trusted instruction provenance. An untrusted segment claiming instruction
 *   role is DEMOTED to delimited data (treated as data, never as
 *   instructions) with an audit record of the demotion.
 * - Provenance outside the declared vocabulary is a typed rejection —
 *   fail-closed, never guessed.
 * - The returned prompt contains no untrusted content outside the delimited
 *   data segments; re-classification is structurally impossible.
 */
export function separateInstructions(input: {
  readonly tenantRef: string;
  readonly segments: readonly PromptSegment[];
  readonly recordedAt: string;
}): SeparatedPrompt {
  const tenantRef = requireNonEmpty("tenantRef", input.tenantRef);
  const recordedAt = requireTimestamp("recordedAt", input.recordedAt);
  if (!Array.isArray(input.segments)) {
    fail("invalid_input", "prompt_injection", "segments", "segments must be an array");
  }

  const instructions: SeparatedInstruction[] = [];
  const dataSegments: SeparatedDataSegment[] = [];
  const records: DefenseAuditRecord[] = [];

  input.segments.forEach((segment, index) => {
    if (typeof segment?.content !== "string" || segment.content.length === 0) {
      fail(
        "invalid_input",
        "prompt_injection",
        `segments[${index}].content`,
        "segment content must be a non-empty string",
      );
    }
    if (segment.role !== "instruction" && segment.role !== "data") {
      fail(
        "invalid_input",
        "prompt_injection",
        `segments[${index}].role`,
        'segment role must be "instruction" or "data"',
      );
    }
    const provenance = requireProvenance(`segments[${index}].provenance`, segment.provenance);
    const isTrustedInstruction =
      segment.role === "instruction" &&
      (INSTRUCTION_PROVENANCES as readonly string[]).includes(provenance);

    if (isTrustedInstruction) {
      instructions.push({
        provenance: provenance as InstructionProvenance,
        content: segment.content,
      });
      records.push(
        buildRecord({
          family: "prompt_injection",
          decision: "allow",
          tenantRef,
          reason: `instruction segment ${index} admitted from trusted source "${provenance}"`,
          evidence: [`segment:${index}`, `provenance:${provenance}`],
          recordedAt,
        }),
      );
      return;
    }

    const demotedFromInstruction = segment.role === "instruction";
    dataSegments.push({
      provenance,
      content: segment.content,
      delimited: `<untrusted-data provenance="${provenance}" id="segment-${index}">\n${segment.content}\n</untrusted-data>`,
      demotedFromInstruction,
    });
    records.push(
      buildRecord({
        family: "prompt_injection",
        decision: demotedFromInstruction ? "block" : "allow",
        tenantRef,
        reason: demotedFromInstruction
          ? `segment ${index} claimed instruction role from untrusted source "${provenance}" — demoted to delimited data (instructions from untrusted sources are data, never instructions)`
          : `data segment ${index} from "${provenance}" delimited as untrusted data`,
        evidence: [`segment:${index}`, `provenance:${provenance}`],
        recordedAt,
      }),
    );
  });

  return deepFreeze({ instructions, dataSegments, records });
}

/* ─────────────────────────────────────────────────────────────
 * (c) Exfiltration guards — secret patterns
 * ────────────────────────────────────────────────────────────*/

export interface SecretPattern {
  readonly patternId: string;
  readonly description: string;
  readonly pattern: RegExp;
}

/**
 * Built-in secret-shape detectors (L-T-008: credential material leaking
 * through AI outputs). Callers may declare additional tenant-specific
 * patterns; screening always merges built-ins unless explicitly disabled.
 */
export function builtInSecretPatterns(): readonly SecretPattern[] {
  return deepFreeze([
    {
      patternId: "private_key_block",
      description: "PEM private key block",
      pattern: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/,
    },
    {
      patternId: "bearer_token",
      description: "HTTP bearer credential",
      pattern: /\bBearer\s+[A-Za-z0-9\-._~+/]{16,}/i,
    },
    {
      patternId: "credential_assignment",
      description: "credential-shaped key/value assignment",
      pattern:
        /\b(api[_-]?key|secret|password|passwd|token|credential)\b\s*[:=]\s*["']?[A-Za-z0-9\-_./+]{12,}/i,
    },
    {
      patternId: "aws_access_key_id",
      description: "AWS access key id shape",
      pattern: /\bAKIA[0-9A-Z]{16}\b/,
    },
    {
      patternId: "database_uri_with_credentials",
      description: "database URI embedding user:password",
      pattern: /\b(postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s:@/]+:[^\s:@/]+@/,
    },
  ]);
}

/* ─────────────────────────────────────────────────────────────
 * (c) Exfiltration guards — output screening
 * ────────────────────────────────────────────────────────────*/

/** A declared marker associated with a tenant (for cross-tenant detection). */
export interface TenantMarker {
  readonly tenantRef: string;
  /** A string whose presence indicates that tenant's material. */
  readonly marker: string;
}

export interface ExfiltrationFinding {
  readonly kind:
    | "injection_evidence_canary"
    | "secret_shaped_output"
    | "sensitivity_above_ceiling"
    | "sensitivity_unstated_fail_closed"
    | "cross_tenant_output";
  readonly severity: "block" | "redact";
  readonly evidence: readonly string[];
}

export interface OutputScreenInput {
  readonly tenantRef: string;
  readonly purpose: string;
  readonly output: string;
  readonly recordedAt: string;
  /** Canaries embedded in this invocation's instructions (injection evidence). */
  readonly canaries?: readonly RuntimeCanary[];
  /** Caller-declared secret patterns; merged with built-ins by default. */
  readonly secretPatterns?: readonly SecretPattern[];
  /** Set false to screen only against caller-declared patterns. */
  readonly useBuiltInSecretPatterns?: boolean;
  /** Declared sensitivity ceiling for this output surface (null = none declared). */
  readonly sensitivityCeiling?: DefenseSensitivity | null;
  /** The caller-declared sensitivity of this output (null = unstated). */
  readonly declaredSensitivity?: DefenseSensitivity | null;
  /** Declared markers used to detect foreign-tenant material in output. */
  readonly foreignTenantMarkers?: readonly TenantMarker[];
}

export interface OutputScreenResult {
  readonly decision: DefenseDecision;
  /** null when blocked; the redaction placeholder when redacted; else the output. */
  readonly publishedOutput: string | null;
  readonly findings: readonly ExfiltrationFinding[];
  /** The sensitivity redaction record, when a redaction occurred. */
  readonly redactionRecord: DefenseAuditRecord | null;
  readonly records: readonly DefenseAuditRecord[];
}

const REDACTION_PLACEHOLDER = "[redacted: output withheld above declared sensitivity ceiling]";

/**
 * Screen an AI output before it leaves the gateway. Every check is
 * evidence-bearing and recorded; every run produces at least one audit
 * record. Decision precedence: any block finding blocks (secrets and
 * injection evidence are blocked, NOT redacted); otherwise any redact
 * finding redacts with a redaction record; otherwise allow.
 *
 * Fail-closed defaults:
 * - A declared ceiling with an UNSTATED output sensitivity redacts (an
 *   output whose sensitivity cannot be stated cannot pass a ceiling).
 * - A declared ceiling with an INVALID sensitivity value is a typed
 *   rejection — sensitivity is never guessed.
 */
export function screenAiOutput(input: OutputScreenInput): OutputScreenResult {
  const tenantRef = requireNonEmpty("tenantRef", input.tenantRef);
  requireNonEmpty("purpose", input.purpose);
  if (typeof input.output !== "string") {
    fail("invalid_input", "exfiltration", "output", "output must be a string");
  }
  const recordedAt = requireTimestamp("recordedAt", input.recordedAt);

  interface PendingDecision {
    decision: DefenseDecision;
    records: DefenseAuditRecord[];
    findings: ExfiltrationFinding[];
    redactionRecord: DefenseAuditRecord | null;
  }
  const pending: PendingDecision = {
    decision: "allow",
    records: [],
    findings: [],
    redactionRecord: null,
  };
  const raiseBlock = (record: DefenseAuditRecord, finding: ExfiltrationFinding): void => {
    pending.decision = "block";
    pending.records.push(record);
    pending.findings.push(finding);
  };
  const raiseRedact = (record: DefenseAuditRecord, finding: ExfiltrationFinding): void => {
    if (pending.decision !== "block") pending.decision = "redact";
    pending.records.push(record);
    pending.findings.push(finding);
    pending.redactionRecord = record;
  };

  // (a) Canary in output = injection evidence → block.
  for (const canary of input.canaries ?? []) {
    if (typeof canary?.token !== "string" || canary.token.length === 0) {
      fail(
        "invalid_input",
        "prompt_injection",
        "canaries[].token",
        "each canary requires a non-empty token",
      );
    }
    if (input.output.includes(canary.token)) {
      raiseBlock(
        buildRecord({
          family: "prompt_injection",
          decision: "block",
          tenantRef,
          reason:
            "canary token appeared in output — injection evidence; output blocked, not redacted",
          evidence: [`canary:${canary.canaryId}`],
          recordedAt,
        }),
        {
          kind: "injection_evidence_canary",
          severity: "block",
          evidence: [`canary:${canary.canaryId}`],
        },
      );
    }
  }

  // (c) Cross-tenant markers in output = exfiltration event → block.
  for (const marker of input.foreignTenantMarkers ?? []) {
    if (typeof marker?.marker !== "string" || marker.marker.length === 0) {
      fail(
        "invalid_input",
        "exfiltration",
        "foreignTenantMarkers[].marker",
        "each tenant marker requires a non-empty marker",
      );
    }
    const markerTenant = requireNonEmpty("foreignTenantMarkers[].tenantRef", marker.tenantRef);
    if (markerTenant === tenantRef) continue; // own-tenant material is not exfiltration
    if (input.output.includes(marker.marker)) {
      const markerDigest = digestContent(marker.marker);
      raiseBlock(
        buildRecord({
          family: "exfiltration",
          decision: "block",
          tenantRef,
          reason: `cross-tenant output: material of tenant "${markerTenant}" detected in this tenant's output — exfiltration event blocked`,
          evidence: [`foreignTenant:${markerTenant}`, `marker:${markerDigest}`],
          recordedAt,
        }),
        {
          kind: "cross_tenant_output",
          severity: "block",
          evidence: [`foreignTenant:${markerTenant}`, `marker:${markerDigest}`],
        },
      );
    }
  }

  // (c) Secret-shaped output → block (never redacted).
  const patterns: SecretPattern[] = [];
  if (input.useBuiltInSecretPatterns !== false) patterns.push(...builtInSecretPatterns());
  patterns.push(...(input.secretPatterns ?? []));
  for (const declared of patterns) {
    if (!(declared?.pattern instanceof RegExp)) {
      fail(
        "invalid_input",
        "exfiltration",
        "secretPatterns[].pattern",
        "each secret pattern requires a RegExp",
      );
    }
    requireNonEmpty("secretPatterns[].patternId", declared.patternId);
    const matcher = new RegExp(declared.pattern.source, declared.pattern.flags);
    const match = matcher.exec(input.output);
    if (match !== null) {
      const matchDigest = digestContent(match[0]);
      raiseBlock(
        buildRecord({
          family: "exfiltration",
          decision: "block",
          tenantRef,
          reason: `secret-shaped output material matched pattern "${declared.patternId}" — blocked, not redacted (no derivative of secret material is published)`,
          evidence: [`pattern:${declared.patternId}`, `match:${matchDigest}`],
          recordedAt,
        }),
        {
          kind: "secret_shaped_output",
          severity: "block",
          evidence: [`pattern:${declared.patternId}`, `match:${matchDigest}`],
        },
      );
    }
  }

  // (c) Sensitivity ceiling → redact with a redaction record (memory-tier pattern).
  const ceiling = input.sensitivityCeiling ?? null;
  if (ceiling !== null) {
    if (!isDefenseSensitivity(ceiling)) {
      fail(
        "unknown_sensitivity",
        "exfiltration",
        "sensitivityCeiling",
        `sensitivity ceiling "${String(ceiling)}" is outside the declared sensitivity vocabulary`,
      );
    }
    const declared = input.declaredSensitivity ?? null;
    if (declared === null) {
      // Fail-closed default: an output that cannot state its sensitivity
      // cannot pass a declared ceiling.
      raiseRedact(
        buildRecord({
          family: "exfiltration",
          decision: "redact",
          tenantRef,
          reason:
            "output sensitivity unstated against a declared ceiling — redacted fail-closed with record (nothing drops silently)",
          evidence: ["sensitivity:unstated", `ceiling:${ceiling}`],
          recordedAt,
        }),
        {
          kind: "sensitivity_unstated_fail_closed",
          severity: "redact",
          evidence: ["sensitivity:unstated", `ceiling:${ceiling}`],
        },
      );
    } else if (!isDefenseSensitivity(declared)) {
      fail(
        "unknown_sensitivity",
        "exfiltration",
        "declaredSensitivity",
        `declared sensitivity "${String(declared)}" is outside the declared sensitivity vocabulary — sensitivity is never guessed`,
      );
    } else if (SENSITIVITY_RANK[declared] > SENSITIVITY_RANK[ceiling]) {
      raiseRedact(
        buildRecord({
          family: "exfiltration",
          decision: "redact",
          tenantRef,
          reason: `output sensitivity "${declared}" exceeds the declared ceiling "${ceiling}" — redacted with record per the memory-tier exclusion pattern`,
          evidence: [`sensitivity:${declared}`, `ceiling:${ceiling}`],
          recordedAt,
        }),
        {
          kind: "sensitivity_above_ceiling",
          severity: "redact",
          evidence: [`sensitivity:${declared}`, `ceiling:${ceiling}`],
        },
      );
    }
  }

  if (pending.decision === "allow") {
    pending.records.push(
      buildRecord({
        family: "exfiltration",
        decision: "allow",
        tenantRef,
        reason:
          "output screen clean — no injection evidence, secret shapes, ceiling violations or cross-tenant markers",
        evidence: [],
        recordedAt,
      }),
    );
  }

  const publishedOutput =
    pending.decision === "block"
      ? null
      : pending.decision === "redact"
        ? REDACTION_PLACEHOLDER
        : input.output;

  return deepFreeze({
    decision: pending.decision,
    publishedOutput,
    findings: pending.findings,
    redactionRecord: pending.redactionRecord,
    records: pending.records,
  });
}

/* ─────────────────────────────────────────────────────────────
 * (b) Malicious-artifact guards — the artifact gate
 * ────────────────────────────────────────────────────────────*/

export interface ArtifactClassSpec {
  readonly classId: string;
  /** Inclusive upper size bound in bytes. */
  readonly maxBytes: number;
  readonly allowedMimeTypes: readonly string[];
}

export interface ArtifactClassRegistry {
  readonly classes: readonly ArtifactClassSpec[];
  /** The declared spec for a class id; null when the class is undeclared. */
  readonly specFor: (classId: string) => ArtifactClassSpec | null;
}

/**
 * Declare the artifact classes tool/file outputs may enter context with.
 * Anything outside this registry is unclassified and quarantined — the
 * registry is the allowlist, not a blocklist.
 */
export function declareArtifactClasses(specs: readonly ArtifactClassSpec[]): ArtifactClassRegistry {
  if (!Array.isArray(specs)) {
    fail("invalid_input", "malicious_artifact", "specs", "artifact class specs must be an array");
  }
  specs.forEach((spec, index) => {
    requireNonEmpty(`specs[${index}].classId`, spec?.classId);
    if (
      typeof spec.maxBytes !== "number" ||
      !Number.isFinite(spec.maxBytes) ||
      spec.maxBytes <= 0
    ) {
      fail(
        "invalid_input",
        "malicious_artifact",
        `specs[${index}].maxBytes`,
        "artifact class maxBytes must be a positive finite number",
      );
    }
    if (!Array.isArray(spec.allowedMimeTypes) || spec.allowedMimeTypes.length === 0) {
      fail(
        "invalid_input",
        "malicious_artifact",
        `specs[${index}].allowedMimeTypes`,
        "artifact class must declare at least one allowed mime type",
      );
    }
  });
  const frozen = deepFreeze(specs.map((spec) => ({ ...spec })));
  return deepFreeze({
    classes: frozen,
    specFor: (classId: string): ArtifactClassSpec | null =>
      frozen.find((spec) => spec.classId === classId) ?? null,
  });
}

/**
 * Scan status vocabulary. Anything OUTSIDE this vocabulary is treated as
 * unscannable (fail-closed) — an artifact whose scan state cannot be
 * interpreted never enters context.
 */
export type ArtifactScanStatus = "clean" | "suspicious" | "unscannable" | "unscanned";

export type ArtifactQuarantineReason =
  | "unclassified_artifact"
  | "size_bound_exceeded"
  | "mime_type_mismatch"
  | "not_scannable"
  | "suspicious_content";

export interface ArtifactDeclaration {
  readonly artifactId: string;
  readonly tenantRef: string;
  /** Declared class id; null or an undeclared id → unclassified → quarantine. */
  readonly declaredClass: string | null;
  readonly mimeType: string | null;
  readonly byteSize: number | null;
  readonly scanStatus: string;
  /** Optional content digest carried into the context entry when admitted. */
  readonly contentDigest?: string | null;
}

export interface ArtifactContextEntry {
  readonly artifactId: string;
  readonly classId: string;
  readonly contentDigest: string | null;
}

export interface ArtifactGateResult {
  readonly decision: "allow" | "quarantine";
  readonly artifactId: string;
  readonly classId: string | null;
  readonly quarantineReason: ArtifactQuarantineReason | null;
  /** The context entry ONLY for admitted artifacts — quarantined artifacts never appear. */
  readonly contextEntry: ArtifactContextEntry | null;
  readonly record: DefenseAuditRecord;
}

/**
 * Gate one tool/file artifact before it may enter AI context. Fail-closed
 * laws: an unclassified artifact is quarantined (the registry is an
 * allowlist); an unmeasurable size is quarantined; an out-of-bounds size is
 * quarantined; a mime type outside the class declaration is quarantined; an
 * unscanned, unscannable, suspicious or UNKNOWABLE scan status is
 * quarantined. There is no path by which an uncertain artifact enters context.
 */
export function gateArtifact(
  registry: ArtifactClassRegistry,
  artifact: ArtifactDeclaration,
  recordedAt: string,
): ArtifactGateResult {
  if (typeof registry?.specFor !== "function") {
    fail(
      "invalid_input",
      "malicious_artifact",
      "registry",
      "artifact gate requires a declared artifact class registry",
    );
  }
  const artifactId = requireNonEmpty("artifact.artifactId", artifact?.artifactId);
  const tenantRef = requireNonEmpty("artifact.tenantRef", artifact.tenantRef);
  const at = requireTimestamp("recordedAt", recordedAt);

  const quarantine = (
    reason: ArtifactQuarantineReason,
    detail: string,
    evidence: readonly string[],
  ): ArtifactGateResult => {
    const record = buildRecord({
      family: "malicious_artifact",
      decision: "quarantine",
      tenantRef,
      reason: `artifact "${artifactId}" quarantined: ${detail}`,
      evidence,
      recordedAt: at,
    });
    return deepFreeze({
      decision: "quarantine",
      artifactId,
      classId: null,
      quarantineReason: reason,
      contextEntry: null,
      record,
    });
  };

  const classId = artifact.declaredClass ?? null;
  if (classId === null) {
    return quarantine(
      "unclassified_artifact",
      "no artifact class declared — unclassified artifacts are quarantined, never silently included in context",
      ["declaredClass:none"],
    );
  }
  const spec = registry.specFor(classId);
  if (spec === null) {
    return quarantine(
      "unclassified_artifact",
      `declared class "${classId}" is not in the declared registry`,
      [`declaredClass:${classId}`],
    );
  }

  const byteSize = artifact.byteSize ?? null;
  if (typeof byteSize !== "number" || !Number.isFinite(byteSize) || byteSize < 0) {
    return quarantine(
      "size_bound_exceeded",
      "artifact size is unmeasurable — unmeasurable artifacts are quarantined",
      [`declaredClass:${classId}`],
    );
  }
  if (byteSize > spec.maxBytes) {
    return quarantine(
      "size_bound_exceeded",
      `size ${byteSize} bytes exceeds class bound ${spec.maxBytes} bytes`,
      [`declaredClass:${classId}`, `byteSize:${byteSize}`],
    );
  }

  const mimeType = artifact.mimeType ?? null;
  if (mimeType === null || !spec.allowedMimeTypes.includes(mimeType)) {
    return quarantine(
      "mime_type_mismatch",
      `mime type ${mimeType === null ? "unstated" : `"${mimeType}"`} is outside class "${classId}" allowed types [${spec.allowedMimeTypes.join(", ")}]`,
      [`declaredClass:${classId}`, `mimeType:${mimeType ?? "unstated"}`],
    );
  }

  const scanStatus = artifact.scanStatus;
  if (scanStatus === "suspicious") {
    return quarantine("suspicious_content", "scan classified the artifact as suspicious", [
      `declaredClass:${classId}`,
      "scan:suspicious",
    ]);
  }
  if (scanStatus !== "clean") {
    // "unscanned", "unscannable" AND any unknown status string all land here:
    // an artifact whose scan state is not affirmatively clean is unscannable.
    return quarantine(
      "not_scannable",
      `scan status "${scanStatus}" is not affirmatively clean — unscannable/unclassified artifacts are quarantined, never silently included in context`,
      [`declaredClass:${classId}`, `scanStatus:${scanStatus}`],
    );
  }

  const contextEntry: ArtifactContextEntry = {
    artifactId,
    classId,
    contentDigest: artifact.contentDigest ?? null,
  };
  const record = buildRecord({
    family: "malicious_artifact",
    decision: "allow",
    tenantRef,
    reason: `artifact "${artifactId}" admitted under class "${classId}" within size/type bounds, affirmatively scanned clean`,
    evidence: [
      `declaredClass:${classId}`,
      `byteSize:${byteSize}`,
      `mimeType:${mimeType}`,
      "scan:clean",
    ],
    recordedAt: at,
  });
  return deepFreeze({
    decision: "allow",
    artifactId,
    classId,
    quarantineReason: null,
    contextEntry,
    record,
  });
}

/* ─────────────────────────────────────────────────────────────
 * (c) Exfiltration guards — cross-tenant context gate
 * ────────────────────────────────────────────────────────────*/

export interface ContextTenantItem {
  readonly itemId: string;
  readonly tenantRef: string;
  readonly contentDigest?: string | null;
}

export interface ContextTenancyGateResult {
  readonly decision: "allow" | "block";
  readonly admittedItemIds: readonly string[];
  /** One evidence-bearing exfiltration record per foreign-tenant item. */
  readonly exfiltrationRecords: readonly DefenseAuditRecord[];
  readonly records: readonly DefenseAuditRecord[];
}

/**
 * Gate the tenancy of context items for one invocation. A foreign-tenant
 * item in context is an exfiltration event: it is excluded from the admitted
 * set, blocked, and recorded evidence-bearing (item id, foreign tenant, item
 * digest — never the payload). Cross-tenant context is exfiltration even
 * when nothing reaches output.
 */
export function gateContextTenancy(input: {
  readonly tenantRef: string;
  readonly items: readonly ContextTenantItem[];
  readonly recordedAt: string;
}): ContextTenancyGateResult {
  const tenantRef = requireNonEmpty("tenantRef", input.tenantRef);
  const recordedAt = requireTimestamp("recordedAt", input.recordedAt);
  if (!Array.isArray(input.items)) {
    fail("invalid_input", "exfiltration", "items", "items must be an array");
  }

  const admittedItemIds: string[] = [];
  const exfiltrationRecords: DefenseAuditRecord[] = [];

  input.items.forEach((item, index) => {
    const itemId = requireNonEmpty(`items[${index}].itemId`, item?.itemId);
    const itemTenant = requireNonEmpty(`items[${index}].tenantRef`, item.tenantRef);
    if (itemTenant === tenantRef) {
      admittedItemIds.push(itemId);
      return;
    }
    exfiltrationRecords.push(
      buildRecord({
        family: "exfiltration",
        decision: "block",
        tenantRef,
        reason: `cross-tenant context: item "${itemId}" belongs to tenant "${itemTenant}" — excluded from context as an exfiltration event`,
        evidence: [
          `item:${itemId}`,
          `foreignTenant:${itemTenant}`,
          `itemDigest:${item.contentDigest ?? digestContent(item)}`,
        ],
        recordedAt,
      }),
    );
  });

  const decision: "allow" | "block" = exfiltrationRecords.length > 0 ? "block" : "allow";
  const records =
    decision === "allow"
      ? [
          buildRecord({
            family: "exfiltration",
            decision: "allow",
            tenantRef,
            reason: `context tenancy gate clean — ${admittedItemIds.length} item(s) all belong to tenant "${tenantRef}"`,
            evidence: admittedItemIds.map((id) => `item:${id}`),
            recordedAt,
          }),
          ...exfiltrationRecords,
        ]
      : [...exfiltrationRecords];

  return deepFreeze({ decision, admittedItemIds, exfiltrationRecords, records });
}

/* ─────────────────────────────────────────────────────────────
 * Interlock — intelligence snapshots (J-015) + trust pipeline (J-035)
 * ────────────────────────────────────────────────────────────*/

export interface DefenseSnapshotBinding {
  readonly bindingId: string;
  readonly snapshotId: string;
  readonly tenantRef: string;
  /** True when any bound record BLOCKS — the pipeline's validation must fail. */
  readonly blocked: boolean;
  readonly quarantinedCount: number;
  readonly redactedCount: number;
  readonly recordCount: number;
  readonly records: readonly DefenseAuditRecord[];
}

/**
 * Bind defense audit records to an intelligence snapshot, fail-closed:
 * - the snapshot value is re-validated through the J-015 gate — an incomplete
 *   snapshot can never carry defense records;
 * - every record must belong to the snapshot's tenant — a cross-tenant
 *   defense record is itself an exfiltration-shaped violation and is
 *   rejected.
 */
export function bindDefensesToSnapshot(
  snapshot: unknown,
  records: readonly DefenseAuditRecord[],
): DefenseSnapshotBinding {
  let validated: IntelligenceSnapshot;
  try {
    validated = validateIntelligenceSnapshot(snapshot);
  } catch (error) {
    fail(
      "invalid_input",
      null,
      "snapshot",
      `defense binding requires a valid intelligence snapshot: ${error instanceof Error ? error.message : String(error)}`,
    );
    throw error;
  }
  if (!Array.isArray(records)) {
    fail("invalid_input", null, "records", "defense records must be an array");
  }
  const tenantRef = validated.attribution.tenantRef;
  records.forEach((record, index) => {
    if (typeof record?.tenantRef !== "string" || record.tenantRef !== tenantRef) {
      fail(
        "cross_tenant_binding",
        null,
        `records[${index}].tenantRef`,
        `defense record tenant "${String(record?.tenantRef ?? "<none>")}" does not match snapshot tenant "${tenantRef}" — cross-tenant defense binding is itself an exfiltration-shaped violation`,
      );
    }
  });

  const bound = records.map((record) => ({ ...record, snapshotId: validated.snapshotId }));
  const binding = {
    bindingId: "",
    snapshotId: validated.snapshotId,
    tenantRef,
    blocked: bound.some((record) => record.decision === "block"),
    quarantinedCount: bound.filter((record) => record.decision === "quarantine").length,
    redactedCount: bound.filter((record) => record.decision === "redact").length,
    recordCount: bound.length,
    records: bound,
  };
  return deepFreeze({ ...binding, bindingId: digestContent(binding) });
}

export interface DefensePipelineValidation {
  /** False when any bound defense BLOCKS — the pipeline's validated stage fails. */
  readonly schemaOk: boolean;
  /** The recorded validation detail for the pipeline trail. */
  readonly detail: string;
}

/**
 * Convert a defense binding into the trust pipeline's (J-035) validation-stage
 * input. A defense block feeds the pipeline as a validation FAILURE: the
 * proposal cannot advance past `validated`, so no blocked output ever reaches
 * policy check, approval or execution.
 */
export function defenseValidationForPipeline(
  binding: DefenseSnapshotBinding,
): DefensePipelineValidation {
  if (binding?.snapshotId === undefined) {
    fail("invalid_input", null, "binding", "defense validation requires a snapshot binding");
  }
  if (binding.blocked) {
    const blockedReasons = binding.records
      .filter((record) => record.decision === "block")
      .map((record) => record.reason);
    return deepFreeze({
      schemaOk: false,
      detail: `runtime defenses blocked the output (snapshot ${binding.snapshotId}): ${blockedReasons.join("; ")}`,
    });
  }
  return deepFreeze({
    schemaOk: true,
    detail: `runtime defenses passed (snapshot ${binding.snapshotId}): ${binding.recordCount} record(s), ${binding.quarantinedCount} quarantined, ${binding.redactedCount} redacted`,
  });
}

/* ─────────────────────────────────────────────────────────────
 * Immutability
 * ────────────────────────────────────────────────────────────*/

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    for (const member of Object.values(value as Record<string, unknown>)) {
      deepFreeze(member);
    }
    return Object.freeze(value);
  }
  return value;
}

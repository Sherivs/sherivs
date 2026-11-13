/**
 * SV1-REALITY R3 (#334) — adaptive V1 school onboarding interview engine (ADR-053).
 *
 * Pure and send-free: no storage, network, timers or AI. It sits on the R1
 * registry and answer semantics and adds only what an interview needs:
 * branching from confirmed answers, save/resume state, review, and an explicit
 * approval that any later change revokes.
 *
 * Invariants (each pinned by tests):
 *  - An unanswered question is `unknown`, never "No". Approval never turns an
 *    unknown into a value.
 *  - Only a human answer is accepted in this slice. Nothing is inferred, so
 *    nothing is inferred-as-approved.
 *  - Branching uses confirmed answers of *visible* questions only; an answer to
 *    a question the branch has hidden is dormant and is excluded from review,
 *    from the approval hash and from the approved snapshot.
 *  - `discovered` -> `approved` happens only through `approveInterview`, which
 *    refuses while a required question is open or any answer is pending or
 *    conflicting. Every edit returns the interview to `discovered`.
 *  - `operational` is never set here; activation is a later, separate step.
 *  - The approval hash detects drift (edited payload, changed registry). It is
 *    not a secret: authenticity comes from the server being the only writer.
 */
import { type AnswerMap, isSatisfied, isVisible, validateAnswer } from "./answers";
import { QUESTION_REGISTRY } from "./question-registry";
import type { DiscoveryAnswer, DiscoveryQuestion, QuestionIssue } from "./question-types";
import { canonicalJson, registryContentHash } from "./registry-validation";
import { INSTITUTION_TYPES, type RealityDomain } from "./taxonomy";

export const INTERVIEW_SCHEMA_VERSION = 1;
/** Profile key inside the existing neutral `cg_org_profile` store; no new table. */
export const INTERVIEW_PROFILE_KEY = "reality.onboarding_interview";
export const TYPE_QUESTION_ID = "core.type.institution_type";

/** Early-childhood/nursery, primary and JSS/SSS only (issue #334). */
export const SUPPORTED_INTERVIEW_TYPES = ["creche", "primary", "secondary"] as const;
export type SupportedInterviewType = (typeof SUPPORTED_INTERVIEW_TYPES)[number];

export type InterviewManifestState = "discovered" | "approved";

export interface InterviewApproval {
  readonly approvedAtMs: number;
  readonly approvedBy: string;
  readonly contentHash: string;
}

export interface InterviewState {
  readonly schemaVersion: typeof INTERVIEW_SCHEMA_VERSION;
  /** Registry content hash this interview was last edited against. */
  readonly registryHash: string;
  readonly answers: Readonly<Record<string, DiscoveryAnswer>>;
  readonly manifestState: InterviewManifestState;
  readonly approval: InterviewApproval | null;
  /** Incremented on every accepted change; used for optimistic concurrency. */
  readonly revision: number;
  readonly updatedAtMs: number;
}

export const MAX_TEXT_LENGTH = 500;
export const MAX_LIST_ITEM_LENGTH = 160;
export const MAX_ANSWER_JSON = 4000;
export const MAX_EVIDENCE_LENGTH = 200;

const QUESTION_BY_ID: ReadonlyMap<string, DiscoveryQuestion> = new Map(
  QUESTION_REGISTRY.map((q) => [q.id, q]),
);

export const currentRegistryHash = (): string => registryContentHash(QUESTION_REGISTRY);

export function emptyInterview(nowMs: number): InterviewState {
  return {
    schemaVersion: INTERVIEW_SCHEMA_VERSION,
    registryHash: currentRegistryHash(),
    answers: {},
    manifestState: "discovered",
    approval: null,
    revision: 0,
    updatedAtMs: nowMs,
  };
}

/* ────────────────────────── type and branching ────────────────────────── */

export type TypeStatus = "unset" | "supported" | "unsupported";

export function interviewType(state: InterviewState): {
  readonly status: TypeStatus;
  readonly type: SupportedInterviewType | null;
  readonly chosen: string | null;
} {
  const a = state.answers[TYPE_QUESTION_ID];
  if (!a || a.state !== "confirmed" || typeof a.value !== "string")
    return { status: "unset", type: null, chosen: null };
  if ((SUPPORTED_INTERVIEW_TYPES as readonly string[]).includes(a.value))
    return { status: "supported", type: a.value as SupportedInterviewType, chosen: a.value };
  return { status: "unsupported", type: null, chosen: a.value };
}

/**
 * Visible questions for the state. Answers to hidden questions never feed a
 * branch: the visibility pass runs to a fixed point over the *visible* subset.
 */
export function visibleQuestions(state: InterviewState): DiscoveryQuestion[] {
  return visibleQuestionsIn(state, QUESTION_REGISTRY);
}

/** Same as `visibleQuestions` over any registry; exported so chained branches can be tested. */
export function visibleQuestionsIn(
  state: InterviewState,
  registry: readonly DiscoveryQuestion[],
): DiscoveryQuestion[] {
  const typeQ = registry.find((q) => q.id === TYPE_QUESTION_ID)!;
  const t = interviewType(state);
  if (t.status !== "supported") return [typeQ];
  let visibleIds = new Set<string>();
  for (let pass = 0; pass <= registry.length; pass++) {
    const effective: AnswerMap = new Map(
      Object.entries(state.answers).filter(([id]) => visibleIds.has(id)),
    );
    const next = new Set(registry.filter((q) => isVisible(q, t.type!, effective)).map((q) => q.id));
    // The type question is always visible and always seeds the first pass.
    next.add(TYPE_QUESTION_ID);
    if (next.size === visibleIds.size && [...next].every((id) => visibleIds.has(id))) break;
    visibleIds = next;
  }
  return registry.filter((q) => visibleIds.has(q.id));
}

function visibleAnswerMap(state: InterviewState, visible: readonly DiscoveryQuestion[]): AnswerMap {
  const ids = new Set(visible.map((q) => q.id));
  return new Map(Object.entries(state.answers).filter(([id]) => ids.has(id)));
}

/* ───────────────────────────── applying input ───────────────────────────── */

export type InterviewIssueCode =
  | "unknown_question"
  | "question_not_visible"
  | "source_not_allowed"
  | "type_unsupported"
  | "value_too_large"
  | "item_too_long"
  | "text_too_long"
  | "revision_conflict"
  | "invalid_shape"
  | "not_approvable"
  | "approver_required"
  | "nothing_to_clear";

export interface InterviewIssue {
  readonly code: InterviewIssueCode | string;
  readonly questionId?: string;
  readonly message: string;
}

export type ApplyResult =
  | { readonly ok: true; readonly state: InterviewState }
  | {
      readonly ok: false;
      readonly state: InterviewState;
      readonly issues: readonly InterviewIssue[];
    };

const fail = (state: InterviewState, ...issues: InterviewIssue[]): ApplyResult => ({
  ok: false,
  state,
  issues,
});

function jsonLength(v: unknown): number {
  try {
    return JSON.stringify(v)?.length ?? 0;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

function boundIssues(q: DiscoveryQuestion, a: DiscoveryAnswer): QuestionIssue[] {
  const out: QuestionIssue[] = [];
  const bad = (code: string, message: string) => out.push({ code, questionId: q.id, message });
  const values: unknown[] = [a.value, ...(a.candidates ?? [])];
  for (const v of values) {
    if (jsonLength(v) > MAX_ANSWER_JSON) bad("value_too_large", "answer is too large");
    if (typeof v === "string" && v.length > MAX_TEXT_LENGTH) bad("text_too_long", "text too long");
    if (Array.isArray(v))
      for (const item of v) {
        if (typeof item === "string" && item.length > MAX_LIST_ITEM_LENGTH)
          bad("item_too_long", "list item too long");
        else if (typeof item !== "string") bad("invalid_shape", "list items must be text");
      }
  }
  if (
    a.evidenceRef !== undefined &&
    (typeof a.evidenceRef !== "string" || a.evidenceRef.length > MAX_EVIDENCE_LENGTH)
  )
    bad("invalid_shape", "evidenceRef must be short text");
  return out;
}

/** Copy only known fields so extra client properties never reach storage. */
function cleanAnswer(a: DiscoveryAnswer): DiscoveryAnswer {
  return {
    questionId: a.questionId,
    state: a.state,
    source: a.source,
    ...(a.value !== undefined ? { value: a.value } : {}),
    ...(a.candidates !== undefined ? { candidates: a.candidates } : {}),
    ...(a.evidenceRef !== undefined ? { evidenceRef: a.evidenceRef } : {}),
  };
}

function touched(
  state: InterviewState,
  answers: Record<string, DiscoveryAnswer>,
  nowMs: number,
): InterviewState {
  return {
    ...state,
    answers,
    registryHash: currentRegistryHash(),
    manifestState: "discovered",
    approval: null,
    revision: state.revision + 1,
    updatedAtMs: nowMs,
  };
}

/** Optimistic concurrency: a stale editor must reload, never overwrite. */
function staleRevision(state: InterviewState, expected: number | undefined): InterviewIssue | null {
  if (expected === undefined || expected === state.revision) return null;
  return {
    code: "revision_conflict",
    message: `interview changed (revision ${state.revision}, expected ${expected})`,
  };
}

export function applyAnswer(
  state: InterviewState,
  input: DiscoveryAnswer,
  nowMs: number,
  expectedRevision?: number,
): ApplyResult {
  const stale = staleRevision(state, expectedRevision);
  if (stale) return fail(state, stale);
  const q = QUESTION_BY_ID.get(input?.questionId);
  if (!q) return fail(state, { code: "unknown_question", message: "no such question" });
  if (input.source !== "human")
    return fail(state, {
      code: "source_not_allowed",
      questionId: q.id,
      message: "only human answers are accepted in the V1 onboarding interview",
    });
  if (!visibleQuestions(state).some((v) => v.id === q.id))
    return fail(state, {
      code: "question_not_visible",
      questionId: q.id,
      message: "this question does not apply to the current answers",
    });
  const answer = cleanAnswer(input);
  const issues = [...validateAnswer(q, answer), ...boundIssues(q, answer)];
  if (issues.length) return fail(state, ...issues);
  return { ok: true, state: touched(state, { ...state.answers, [q.id]: answer }, nowMs) };
}

/** Back to unanswered (`unknown`); never recorded as a "No". */
export function clearAnswer(
  state: InterviewState,
  questionId: string,
  nowMs: number,
  expectedRevision?: number,
): ApplyResult {
  const stale = staleRevision(state, expectedRevision);
  if (stale) return fail(state, stale);
  if (!QUESTION_BY_ID.has(questionId))
    return fail(state, { code: "unknown_question", message: "no such question" });
  if (!(questionId in state.answers))
    return fail(state, { code: "nothing_to_clear", questionId, message: "no answer to clear" });
  const answers = { ...state.answers };
  delete answers[questionId];
  return { ok: true, state: touched(state, answers, nowMs) };
}

/* ───────────────────────────── progress, review ───────────────────────────── */

export type BlockerCode =
  "type_unset" | "type_unsupported" | "required_open" | "conflicting" | "pending";

export interface Blocker {
  readonly code: BlockerCode;
  readonly questionId?: string;
}

export function blockers(state: InterviewState): Blocker[] {
  const t = interviewType(state);
  if (t.status === "unset") return [{ code: "type_unset", questionId: TYPE_QUESTION_ID }];
  if (t.status === "unsupported")
    return [{ code: "type_unsupported", questionId: TYPE_QUESTION_ID }];
  const visible = visibleQuestions(state);
  const map = visibleAnswerMap(state, visible);
  const out: Blocker[] = [];
  for (const q of visible) {
    const a = map.get(q.id);
    if (a?.state === "conflicting") out.push({ code: "conflicting", questionId: q.id });
    else if (a?.state === "pending") out.push({ code: "pending", questionId: q.id });
    else if (q.required && !isSatisfied(q, a))
      out.push({ code: "required_open", questionId: q.id });
  }
  return out;
}

export interface Progress {
  readonly visible: number;
  readonly answered: number; // confirmed or not_applicable
  readonly unknown: number; // visible and unanswered, or explicitly unknown
  readonly requiredOpen: number;
  readonly activationOpen: number;
}

export function progress(state: InterviewState): Progress {
  const visible = visibleQuestions(state);
  const map = visibleAnswerMap(state, visible);
  let answered = 0;
  let requiredOpen = 0;
  let activationOpen = 0;
  for (const q of visible) {
    const a = map.get(q.id);
    if (a?.state === "confirmed" || a?.state === "not_applicable") answered += 1;
    if (!isSatisfied(q, a)) {
      if (q.required) requiredOpen += 1;
      if (q.requiredToActivate) activationOpen += 1;
    }
  }
  return {
    visible: visible.length,
    answered,
    unknown: visible.length - answered,
    requiredOpen,
    activationOpen,
  };
}

/** The question to ask next: first open required one, else first unanswered optional one. */
export function nextQuestion(state: InterviewState): DiscoveryQuestion | null {
  const visible = visibleQuestions(state);
  const map = visibleAnswerMap(state, visible);
  const open = visible.filter(
    (q) => !isSatisfied(q, map.get(q.id)) && map.get(q.id)?.state !== "unknown",
  );
  return open.find((q) => q.required) ?? open[0] ?? null;
}

export interface ReviewRow {
  readonly questionId: string;
  readonly domain: RealityDomain;
  readonly prompt: string;
  /** `unknown` also covers "never answered"; it is not "No". */
  readonly state: DiscoveryAnswer["state"];
  readonly value: DiscoveryAnswer["value"] | null;
  readonly candidates: readonly unknown[] | null;
  readonly required: boolean;
  readonly publicSafe: boolean;
}

export function review(state: InterviewState): ReviewRow[] {
  const visible = visibleQuestions(state);
  const map = visibleAnswerMap(state, visible);
  return visible.map((q) => {
    const a = map.get(q.id);
    return {
      questionId: q.id,
      domain: q.domain,
      prompt: q.prompt,
      state: a?.state ?? "unknown",
      value: a?.state === "confirmed" || a?.state === "inferred" ? (a.value ?? null) : null,
      candidates: a?.state === "conflicting" ? [...(a.candidates ?? [])] : null,
      required: q.required,
      publicSafe: q.websiteMapping.publicSafe,
    };
  });
}

/** Answers that exist but no branch currently shows. They are kept for resume and never approved. */
export function dormantAnswerIds(state: InterviewState): string[] {
  const visible = new Set(visibleQuestions(state).map((q) => q.id));
  return Object.keys(state.answers)
    .filter((id) => !visible.has(id))
    .sort();
}

/* ───────────────────────────── approval ───────────────────────────── */

function fnv(text: string, seed: number): string {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Hash of exactly what an approval covers: registry, type and the visible answers. */
export function interviewContentHash(state: InterviewState): string {
  const visible = visibleQuestions(state);
  const map = visibleAnswerMap(state, visible);
  const body = canonicalJson({
    registry: state.registryHash,
    entries: visible
      .map((q) => {
        const a = map.get(q.id);
        // Never answered and explicitly unknown are the same fact: unknown.
        return a && a.state !== "unknown"
          ? { id: q.id, state: a.state, value: a.value ?? null, candidates: a.candidates ?? null }
          : { id: q.id, state: "unknown" };
      })
      .sort((x, y) => (x.id < y.id ? -1 : 1)),
  });
  return fnv(body, 0x811c9dc5) + fnv([...body].reverse().join(""), 0x01000193);
}

export function approveInterview(
  state: InterviewState,
  approvedBy: string,
  nowMs: number,
  expectedRevision?: number,
): ApplyResult {
  const stale = staleRevision(state, expectedRevision);
  if (stale) return fail(state, stale);
  if (typeof approvedBy !== "string" || approvedBy.trim().length === 0 || approvedBy.length > 128)
    return fail(state, { code: "approver_required", message: "an approving person is required" });
  if (state.registryHash !== currentRegistryHash())
    return fail(state, {
      code: "not_approvable",
      message:
        "the question set changed since the last edit; review and save again before approving",
    });
  const open = blockers(state);
  if (open.length)
    return fail(
      state,
      ...open.map((b) => ({
        code: "not_approvable" as const,
        ...(b.questionId ? { questionId: b.questionId } : {}),
        message: b.code,
      })),
    );
  const next: InterviewState = {
    ...state,
    manifestState: "approved",
    revision: state.revision + 1,
    updatedAtMs: nowMs,
    approval: { approvedAtMs: nowMs, approvedBy: approvedBy.trim(), contentHash: "" },
  };
  return {
    ok: true,
    state: { ...next, approval: { ...next.approval!, contentHash: interviewContentHash(next) } },
  };
}

/** True only while the approval still describes exactly the current visible answers. */
export function isApprovalValid(state: InterviewState): boolean {
  return (
    state.manifestState === "approved" &&
    state.approval !== null &&
    state.registryHash === currentRegistryHash() &&
    blockers(state).length === 0 &&
    state.approval.contentHash === interviewContentHash(state)
  );
}

export interface ApprovedAnswer {
  readonly questionId: string;
  readonly value: NonNullable<DiscoveryAnswer["value"]>;
  readonly configPath: string;
  readonly entityType: string;
  readonly publicSafe: boolean;
  readonly websiteField: string | null;
}

/**
 * What later steps (configuration, the public website) may read. Empty unless the
 * approval is valid; only confirmed, visible answers appear. Unknown, pending,
 * conflicting, not-applicable and dormant answers are never included.
 */
export function approvedSnapshot(state: InterviewState): ApprovedAnswer[] {
  if (!isApprovalValid(state)) return [];
  const visible = visibleQuestions(state);
  const map = visibleAnswerMap(state, visible);
  const out: ApprovedAnswer[] = [];
  for (const q of visible) {
    const a = map.get(q.id);
    if (a?.state !== "confirmed" || a.value === undefined || a.value === null) continue;
    out.push({
      questionId: q.id,
      value: a.value,
      configPath: q.configMapping.path,
      entityType: q.configMapping.entityType,
      publicSafe: q.websiteMapping.publicSafe,
      websiteField: q.websiteMapping.publicSafe ? (q.websiteMapping.field ?? null) : null,
    });
  }
  return out;
}

/* ───────────────────────────── load / save ───────────────────────────── */

export interface ParseResult {
  readonly ok: boolean;
  readonly state: InterviewState;
  /** Why something was dropped or approval was withdrawn; surfaced to the admin, never silent. */
  readonly notes: readonly string[];
}

const isPlain = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Read a stored payload. Never throws and never trusts it: a malformed payload
 * yields a fresh interview, bad answers are dropped with a note, and an approval
 * survives only if it still matches the current registry and answers.
 */
export function parseInterview(raw: unknown, nowMs: number): ParseResult {
  const notes: string[] = [];
  if (!isPlain(raw) || raw.schemaVersion !== INTERVIEW_SCHEMA_VERSION) {
    return {
      ok: false,
      state: emptyInterview(nowMs),
      notes: ["stored interview not readable; starting fresh"],
    };
  }
  const answers: Record<string, DiscoveryAnswer> = {};
  const rawAnswers = isPlain(raw.answers) ? raw.answers : {};
  for (const [id, value] of Object.entries(rawAnswers)) {
    const q = QUESTION_BY_ID.get(id);
    if (!q) {
      notes.push(`dropped answer for retired question ${id.slice(0, 80)}`);
      continue;
    }
    if (!isPlain(value)) {
      notes.push(`dropped unreadable answer for ${id}`);
      continue;
    }
    const candidate = cleanAnswer({ ...(value as unknown as DiscoveryAnswer), questionId: id });
    const issues = [
      ...(candidate.source === "human" ? [] : [{ code: "source_not_allowed", message: "" }]),
      ...validateAnswer(q, candidate),
      ...boundIssues(q, candidate),
    ];
    if (issues.length) {
      notes.push(`dropped invalid answer for ${id}`);
      continue;
    }
    answers[id] = candidate;
  }
  const rev =
    typeof raw.revision === "number" && Number.isInteger(raw.revision) && raw.revision >= 0
      ? raw.revision
      : 0;
  const updated =
    typeof raw.updatedAtMs === "number" && Number.isFinite(raw.updatedAtMs)
      ? raw.updatedAtMs
      : nowMs;
  const approval =
    isPlain(raw.approval) &&
    typeof raw.approval.approvedAtMs === "number" &&
    typeof raw.approval.approvedBy === "string" &&
    typeof raw.approval.contentHash === "string"
      ? {
          approvedAtMs: raw.approval.approvedAtMs,
          approvedBy: raw.approval.approvedBy.slice(0, 128),
          contentHash: raw.approval.contentHash.slice(0, 64),
        }
      : null;
  let state: InterviewState = {
    schemaVersion: INTERVIEW_SCHEMA_VERSION,
    registryHash: typeof raw.registryHash === "string" ? raw.registryHash : "",
    answers,
    manifestState: raw.manifestState === "approved" && approval ? "approved" : "discovered",
    approval,
    revision: rev,
    updatedAtMs: updated,
  };
  if (state.manifestState === "approved") {
    if (isApprovalValid(state)) return { ok: true, state, notes };
    notes.push(
      state.registryHash !== currentRegistryHash()
        ? "approval withdrawn: the question set changed"
        : "approval withdrawn: answers no longer match what was approved",
    );
  }
  state = {
    ...state,
    manifestState: "discovered",
    approval: null,
    registryHash: currentRegistryHash(),
  };
  return { ok: true, state, notes };
}

export const isSupportedInterviewType = (v: string): v is SupportedInterviewType =>
  (SUPPORTED_INTERVIEW_TYPES as readonly string[]).includes(v);

/** The registry lists types beyond this slice; they are named so the UI can say why they are refused. */
export const UNSUPPORTED_REGISTRY_TYPES: readonly string[] = INSTITUTION_TYPES.filter(
  (t) => !isSupportedInterviewType(t),
);

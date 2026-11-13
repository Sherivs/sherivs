/**
 * SV1-REALITY R3 (#334) — client-safe view of an interview (ADR-053).
 *
 * What the school-admin screen needs and nothing more: the visible questions with
 * their input constraints, the visible answers, progress, blockers and approval
 * status. Dormant answers are summarised as a count, never shown. Pure.
 */
import {
  blockers,
  dormantAnswerIds,
  interviewType,
  isApprovalValid,
  nextQuestion,
  progress,
  UNSUPPORTED_REGISTRY_TYPES,
  visibleQuestions,
  type Blocker,
  type InterviewManifestState,
  type InterviewState,
  type Progress,
  type TypeStatus,
} from "./interview";
import type { DiscoveryAnswer } from "./question-types";
import type { AnswerType, RealityDomain } from "./taxonomy";

export interface QuestionView {
  readonly id: string;
  readonly prompt: string;
  readonly domain: RealityDomain;
  readonly answerType: AnswerType;
  readonly options: readonly string[] | null;
  readonly min: number | null;
  readonly max: number | null;
  readonly maxLength: number | null;
  readonly minItems: number | null;
  readonly maxItems: number | null;
  readonly required: boolean;
  readonly allowNotApplicable: boolean;
  readonly publicSafe: boolean;
}

/** Serializable answer value: the engine stores only text, numbers, booleans and lists of text. */
export type ViewValue = string | number | boolean | readonly string[] | null;

export interface AnswerView {
  readonly state: DiscoveryAnswer["state"];
  readonly value: ViewValue;
  readonly candidates: readonly ViewValue[] | null;
}

function toViewValue(v: unknown): ViewValue {
  if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") return v;
  if (Array.isArray(v)) return v.map((x) => String(x));
  return null;
}

export interface InterviewView {
  readonly revision: number;
  readonly manifestState: InterviewManifestState;
  readonly approvalValid: boolean;
  readonly approvedAtMs: number | null;
  readonly type: { readonly status: TypeStatus; readonly chosen: string | null };
  readonly progress: Progress;
  readonly nextQuestionId: string | null;
  readonly blockers: readonly Blocker[];
  readonly questions: readonly QuestionView[];
  readonly answers: Readonly<Record<string, AnswerView>>;
  readonly dormantCount: number;
  readonly notes: readonly string[];
  readonly outOfScopeTypes: readonly string[];
}

export function buildInterviewView(
  state: InterviewState,
  notes: readonly string[] = [],
): InterviewView {
  const visible = visibleQuestions(state);
  const answers: Record<string, AnswerView> = {};
  for (const q of visible) {
    const a = state.answers[q.id];
    if (a)
      answers[q.id] = {
        state: a.state,
        value: a.state === "confirmed" ? toViewValue(a.value) : null,
        candidates: a.state === "conflicting" ? (a.candidates ?? []).map(toViewValue) : null,
      };
  }
  const t = interviewType(state);
  const valid = isApprovalValid(state);
  return {
    revision: state.revision,
    manifestState: valid ? "approved" : "discovered",
    approvalValid: valid,
    approvedAtMs: valid ? (state.approval?.approvedAtMs ?? null) : null,
    type: { status: t.status, chosen: t.chosen },
    progress: progress(state),
    nextQuestionId: nextQuestion(state)?.id ?? null,
    blockers: blockers(state),
    questions: visible.map((q) => ({
      id: q.id,
      prompt: q.prompt,
      domain: q.domain,
      answerType: q.answerType,
      options: q.validation.options ? [...q.validation.options] : null,
      min: q.validation.min ?? null,
      max: q.validation.max ?? null,
      maxLength: q.validation.maxLength ?? null,
      minItems: q.validation.minItems ?? null,
      maxItems: q.validation.maxItems ?? null,
      required: q.required,
      allowNotApplicable: q.allowNotApplicable,
      publicSafe: q.websiteMapping.publicSafe,
    })),
    answers,
    dormantCount: dormantAnswerIds(state).length,
    notes: [...notes],
    outOfScopeTypes: [...UNSUPPORTED_REGISTRY_TYPES],
  };
}

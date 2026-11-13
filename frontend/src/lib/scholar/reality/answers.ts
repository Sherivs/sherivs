/**
 * SV1-REALITY R1 (#332) — answer-state semantics.
 *
 * Invariants: an unanswered question is `unknown`, never "No"; AI output is at
 * most `inferred`, never `confirmed`; `not_applicable` only where the question
 * metadata permits it.
 */
import type {
  AnswerValue,
  DiscoveryAnswer,
  DiscoveryQuestion,
  QuestionIssue,
  VisibilityCondition,
} from "./question-types";

export type AnswerMap = ReadonlyMap<string, DiscoveryAnswer>;

/** The effective state of a question; missing answers are `unknown` (never false/No). */
export function effectiveState(answer: DiscoveryAnswer | undefined) {
  return answer ? answer.state : ("unknown" as const);
}

function hasValue(v: AnswerValue | undefined): boolean {
  if (v === undefined || v === null) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (Array.isArray(v)) return v.length > 0;
  return true; // false and 0 are real values
}

function matches(cond: VisibilityCondition, answer: DiscoveryAnswer | undefined): boolean {
  if (!answer || answer.state !== "confirmed") return false; // never branch on unconfirmed data
  if (cond.op === "answered") return hasValue(answer.value);
  if (cond.op === "equals") return answer.value === cond.value;
  const list = Array.isArray(cond.value) ? (cond.value as readonly string[]) : [];
  return typeof answer.value === "string" && list.includes(answer.value);
}

export function isVisible(
  q: DiscoveryQuestion,
  institutionType: string,
  answers: AnswerMap,
): boolean {
  if (!(q.institutionTypes as readonly string[]).includes(institutionType)) return false;
  return q.visibleWhen.every((c) => matches(c, answers.get(c.questionId)));
}

/** Structural + value validation of one answer against its question metadata. */
export function validateAnswer(q: DiscoveryQuestion, a: DiscoveryAnswer): QuestionIssue[] {
  const issues: QuestionIssue[] = [];
  const bad = (code: string, message: string) => issues.push({ code, questionId: q.id, message });
  if (a.questionId !== q.id) bad("answer_question_mismatch", `${a.questionId} != ${q.id}`);

  switch (a.state) {
    case "confirmed":
      if (a.source === "ai") bad("ai_cannot_confirm", "AI output is never a confirmed fact");
      if (!hasValue(a.value)) bad("confirmed_requires_value", "confirmed answer has no value");
      else issues.push(...validateValue(q, a.value as AnswerValue));
      break;
    case "inferred":
      if (a.source === "human")
        bad("inferred_not_human", "a human answer is confirmed, not inferred");
      if (!hasValue(a.value)) bad("inferred_requires_value", "inferred answer has no value");
      else issues.push(...validateValue(q, a.value as AnswerValue));
      break;
    case "conflicting":
      if (!a.candidates || a.candidates.length < 2)
        bad("conflict_requires_candidates", "needs >= 2 candidates");
      if (hasValue(a.value))
        bad("conflict_has_no_value", "a conflicting answer carries no resolved value");
      break;
    case "unknown":
    case "pending":
      if (hasValue(a.value)) bad("state_has_no_value", `${a.state} answer must not carry a value`);
      break;
    case "not_applicable":
      if (!q.allowNotApplicable)
        bad("not_applicable_forbidden", "question does not permit not_applicable");
      if (hasValue(a.value))
        bad("state_has_no_value", "not_applicable answer must not carry a value");
      break;
    default:
      bad("unknown_state", String(a.state));
  }
  return issues;
}

export function validateValue(q: DiscoveryQuestion, v: AnswerValue): QuestionIssue[] {
  const issues: QuestionIssue[] = [];
  const bad = (code: string, message: string) => issues.push({ code, questionId: q.id, message });
  const val = q.validation;
  switch (q.answerType) {
    case "bool":
      if (typeof v !== "boolean") bad("type_mismatch", "expected boolean");
      break;
    case "number":
      if (typeof v !== "number" || !Number.isFinite(v))
        bad("type_mismatch", "expected finite number");
      else {
        if (val.min !== undefined && v < val.min) bad("below_min", `${v} < ${val.min}`);
        if (val.max !== undefined && v > val.max) bad("above_max", `${v} > ${val.max}`);
      }
      break;
    case "single":
      if (typeof v !== "string" || (val.options && !val.options.includes(v)))
        bad("invalid_option", String(v));
      break;
    case "multi":
      if (!Array.isArray(v)) bad("type_mismatch", "expected array");
      else {
        const arr = v as readonly string[];
        if (val.options && arr.some((x) => !val.options!.includes(x)))
          bad("invalid_option", arr.join(","));
        if (val.minItems !== undefined && arr.length < val.minItems)
          bad("too_few_items", String(arr.length));
        if (val.maxItems !== undefined && arr.length > val.maxItems)
          bad("too_many_items", String(arr.length));
      }
      break;
    case "date":
      if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v) || Number.isNaN(Date.parse(v)))
        bad("invalid_date", String(v));
      break;
    case "time":
      if (typeof v !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(v))
        bad("invalid_time", String(v));
      break;
    case "repeating_group":
    case "hierarchy":
      if (!Array.isArray(v)) bad("type_mismatch", "expected array");
      else {
        if (val.minItems !== undefined && v.length < val.minItems)
          bad("too_few_items", String(v.length));
        if (val.maxItems !== undefined && v.length > val.maxItems)
          bad("too_many_items", String(v.length));
      }
      break;
    default:
      if (typeof v !== "string") bad("type_mismatch", "expected string");
      else if (val.maxLength !== undefined && v.length > val.maxLength)
        bad("too_long", String(v.length));
  }
  return issues;
}

/** Whether the answer satisfies the question's confidence requirement. */
export function isSatisfied(q: DiscoveryQuestion, a: DiscoveryAnswer | undefined): boolean {
  const state = effectiveState(a);
  if (state === "confirmed") return true;
  if (state === "not_applicable") return q.allowNotApplicable;
  return state === "inferred" && q.confidence === "inferred_ok";
}

/** Visible, required-to-activate questions not yet satisfied. Unanswered counts as open, never "No". */
export function openActivationQuestions(
  questions: readonly DiscoveryQuestion[],
  institutionType: string,
  answers: AnswerMap,
): DiscoveryQuestion[] {
  return questions.filter(
    (q) =>
      q.requiredToActivate &&
      isVisible(q, institutionType, answers) &&
      !isSatisfied(q, answers.get(q.id)),
  );
}

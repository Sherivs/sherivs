/**
 * SV1-REALITY R3 (#334) — form helpers for the school interview screen (ADR-052).
 * Pure: turns what a person typed into an answer value, or a plain-language
 * reason it cannot be saved yet. The server and engine remain authoritative;
 * these checks only give fast feedback. Nothing here defaults a blank to "No".
 */
import type { AnswerView, QuestionView, ViewValue } from "./interview-view";

export type Draft = string | readonly string[];

export const LIST_QUESTION_TYPES = ["repeating_group", "hierarchy"] as const;
const isList = (q: QuestionView) =>
  (LIST_QUESTION_TYPES as readonly string[]).includes(q.answerType);

export function emptyDraft(q: QuestionView): Draft {
  return q.answerType === "multi" ? [] : "";
}

export function draftFromAnswer(q: QuestionView, a: AnswerView | undefined): Draft {
  if (!a || a.state !== "confirmed" || a.value === null) return emptyDraft(q);
  const v = a.value;
  if (q.answerType === "multi") return Array.isArray(v) ? [...v] : [];
  if (isList(q)) return Array.isArray(v) ? v.join("\n") : "";
  return String(v);
}

export type DraftResult =
  | { readonly ok: true; readonly value: ViewValue }
  | { readonly ok: false; readonly message: string };

const no = (message: string): DraftResult => ({ ok: false, message });
const ask = "or choose “I don’t know yet”";

export function draftToValue(q: QuestionView, draft: Draft): DraftResult {
  switch (q.answerType) {
    case "bool":
      if (draft === "true") return { ok: true, value: true };
      if (draft === "false") return { ok: true, value: false };
      return no(`Choose Yes or No, ${ask}.`);
    case "number": {
      const raw = typeof draft === "string" ? draft.trim() : "";
      if (raw === "") return no(`Enter a number, ${ask}.`);
      const n = Number(raw);
      if (!Number.isFinite(n)) return no("That is not a number.");
      if (q.min !== null && n < q.min) return no(`Use ${q.min} or more.`);
      if (q.max !== null && n > q.max) return no(`Use ${q.max} or fewer.`);
      return { ok: true, value: n };
    }
    case "single": {
      if (typeof draft !== "string" || draft === "") return no(`Choose one option, ${ask}.`);
      if (q.options && !q.options.includes(draft)) return no("Choose one of the listed options.");
      return { ok: true, value: draft };
    }
    case "multi": {
      const picked = Array.isArray(draft) ? [...draft] : [];
      if (q.options && picked.some((p) => !q.options!.includes(p)))
        return no("Choose from the listed options.");
      const min = q.minItems ?? 1;
      if (picked.length < min) return no(`Choose at least ${min}, ${ask}.`);
      if (q.maxItems !== null && picked.length > q.maxItems)
        return no(`Choose at most ${q.maxItems}.`);
      return { ok: true, value: picked };
    }
    case "date":
      return typeof draft === "string" && /^\d{4}-\d{2}-\d{2}$/.test(draft)
        ? { ok: true, value: draft }
        : no(`Enter a date, ${ask}.`);
    case "time":
      return typeof draft === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(draft)
        ? { ok: true, value: draft }
        : no(`Enter a time, ${ask}.`);
    case "repeating_group":
    case "hierarchy": {
      const lines = (typeof draft === "string" ? draft : "")
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      if (lines.length < (q.minItems ?? 1))
        return no(`Write at least ${q.minItems ?? 1}, one per line, ${ask}.`);
      if (q.maxItems !== null && lines.length > q.maxItems)
        return no(`Write at most ${q.maxItems}.`);
      if (lines.some((l) => l.length > 160)) return no("Keep each line under 160 characters.");
      return { ok: true, value: lines };
    }
    default: {
      const t = typeof draft === "string" ? draft.trim() : "";
      if (t === "") return no(`Write an answer, ${ask}.`);
      const limit = q.maxLength ?? 500;
      if (t.length > limit) return no(`Keep this under ${limit} characters.`);
      return { ok: true, value: t };
    }
  }
}

/** Plain-language text for an engine issue code; unknown codes get a safe generic line. */
export function issueMessage(code: string): string {
  switch (code) {
    case "revision_conflict":
      return "Someone changed this interview since you opened it. The latest version is shown — please re-enter your change.";
    case "question_not_visible":
      return "That question no longer applies to the current answers.";
    case "type_unsupported":
    case "not_approvable":
      return "These answers cannot be approved yet.";
    case "approver_required":
      return "Approval needs a signed-in administrator.";
    case "nothing_to_clear":
      return "There was no answer to clear.";
    case "value_too_large":
    case "text_too_long":
    case "item_too_long":
      return "That answer is too long.";
    default:
      return "That answer could not be saved. Check it and try again.";
  }
}

export const STATE_LABEL: Record<string, string> = {
  confirmed: "Answered",
  unknown: "Not answered yet",
  pending: "To confirm",
  conflicting: "Needs a decision",
  not_applicable: "Does not apply",
  inferred: "Suggested",
};

/** How a stored answer reads in the review list. Unanswered never reads as "No". */
export function displayValue(q: QuestionView, a: AnswerView | undefined): string {
  if (!a || a.state === "unknown") return "Not answered yet";
  if (a.state === "not_applicable") return "Does not apply";
  if (a.state === "pending") return "To be confirmed";
  if (a.state === "conflicting")
    return `Needs a decision (${(a.candidates ?? []).length} different answers recorded)`;
  const v = a.value;
  if (v === null) return "Not answered yet";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  const pretty = (x: string) => x.replace(/_/g, " ");
  if (Array.isArray(v)) return v.length ? v.map(pretty).join(", ") : "Not answered yet";
  return pretty(String(v));
}

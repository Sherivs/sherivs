/**
 * M7 (ADR-118) gradebook / CA entry. Scores are written ONLY through PR #313's
 * `m06_enter_result_scores` (server function `enterResultScores`), and always via the generic
 * outbox from PR #449: every save is queued with an idempotency key and drained at once when the
 * device is online, so the online and offline paths are the same code.
 *
 * Idempotency: one key per save action and learner (`ca:<scope>:<student>:<saveId>`). A double
 * tap, a second drain, or a second tab returns the existing outbox row and sends nothing more. A
 * later save gets a new key, so editing A -> B -> A sends three times, in order, and the server
 * keeps the latest. Server side, `m06_enter_result_scores` overwrites the author's own unapproved
 * row with the same values, so a resend after an interrupted request cannot create a second grade.
 */
import { isNetworkError } from "@/lib/offline/save-or-queue";
import type { OutboxSendResult, OutboxSender } from "@/lib/offline/outbox";

export const CA_SCORE_KIND = "ca_score";

export interface CaComponent {
  code: string;
  weight: number;
  max_score: number;
}

export interface WeightProfile {
  subject: string;
  term: string;
  academic_year: string;
  ca_weight: number;
  terminal_weight: number;
  terminal_max_score: number;
  ca_components: CaComponent[];
}

export type RowState = "none" | "draft_mine" | "draft_other" | "approved" | "published";

export interface GradebookRow {
  student_id: string;
  display_name: string;
  admission_number: string | null;
  grade_id: string | null;
  ca_scores: Record<string, number | null>;
  terminal_score_raw: number | null;
  total_score: number | null;
  grade: string | null;
  state: RowState;
}

export interface ResultScope {
  subject: string;
  term: string;
  academic_year: string;
}

/** The payload `enterResultScores` validates (see results.functions.ts). */
export interface CaScorePayload extends ResultScope {
  student_id: string;
  ca_scores: Record<string, number | null>;
  terminal_score: number | null;
}

/** Draft cell values as typed (strings), keyed by component code plus `terminal`. */
export type DraftRow = Record<string, string>;

export const ROW_STATE_LABEL: Record<RowState, string> = {
  none: "Not entered",
  draft_mine: "Your draft",
  draft_other: "Entered by someone else",
  approved: "Approved (locked)",
  published: "Published (locked)",
};

/** Only the author's own draft (or a blank row) is editable here; anything else needs an amendment. */
export function rowEditable(state: RowState): boolean {
  return state === "none" || state === "draft_mine";
}

export function draftFromRow(row: GradebookRow, profile: WeightProfile): DraftRow {
  const draft: DraftRow = {};
  for (const c of profile.ca_components) {
    const v = row.ca_scores[c.code];
    draft[c.code] = v === null || v === undefined ? "" : String(v);
  }
  draft.terminal = row.terminal_score_raw === null ? "" : String(row.terminal_score_raw);
  return draft;
}

function parseCell(value: string | undefined, max: number, label: string) {
  const text = (value ?? "").trim();
  if (!text) return { value: null as number | null };
  const n = Number(text);
  if (!Number.isFinite(n)) return { error: `${label}: enter a number` };
  if (n < 0 || n > max) return { error: `${label}: must be between 0 and ${max}` };
  return { value: n };
}

/** Validate one learner's draft against the configured weights; mirrors the m06 range checks. */
export function buildPayload(
  studentId: string,
  draft: DraftRow,
  profile: WeightProfile,
): { payload: CaScorePayload } | { errors: string[] } {
  const errors: string[] = [];
  const ca: Record<string, number | null> = {};
  for (const c of profile.ca_components) {
    const r = parseCell(draft[c.code], c.max_score, c.code);
    if ("error" in r) errors.push(r.error!);
    else ca[c.code] = r.value;
  }
  const t = parseCell(draft.terminal, profile.terminal_max_score, "Exam");
  if ("error" in t) errors.push(t.error!);
  if (errors.length) return { errors };
  return {
    payload: {
      student_id: studentId,
      subject: profile.subject,
      term: profile.term,
      academic_year: profile.academic_year,
      ca_scores: ca,
      terminal_score: "error" in t ? null : t.value,
    },
  };
}

export function draftChanged(a: DraftRow, b: DraftRow): boolean {
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) if ((a[k] ?? "").trim() !== (b[k] ?? "").trim()) return true;
  return false;
}

export function caIdempotencyKey(scope: ResultScope, studentId: string, saveId: string): string {
  return ["ca", scope.academic_year, scope.term, scope.subject, studentId, saveId].join(":");
}

/** Messages from the m06 functions that mean "the server refused this row" (final; server wins). */
const REJECTIONS = [
  "not allowed",
  "result is locked",
  "belongs to another author",
  "outside its possible range",
  "weights are not configured",
  "must include each configured component",
  "must be numbers or blank",
  "invalid result scope",
  "result unavailable",
];

export function isServerRejection(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return REJECTIONS.some((text) => message.includes(text));
}

/**
 * Outbox sender for CA rows. Network failures re-throw (the outbox keeps the row queued without
 * spending an attempt); known m06 refusals become a final rejection with the server's reason;
 * anything else re-throws as transient (retried with backoff).
 */
export function createCaScoreSender(
  enter: (input: { data: CaScorePayload }) => Promise<unknown>,
): OutboxSender {
  return async ({ payload }): Promise<OutboxSendResult> => {
    try {
      await enter({ data: payload as CaScorePayload });
      return { outcome: "sent" };
    } catch (error) {
      if (isNetworkError(error)) throw error;
      if (isServerRejection(error)) {
        return {
          outcome: "rejected",
          reason: error instanceof Error ? error.message : "rejected",
        };
      }
      throw error;
    }
  };
}

export function parseWeightProfile(row: Record<string, unknown> | null): WeightProfile | null {
  if (!row || !Array.isArray(row.ca_components)) return null;
  return {
    subject: String(row.subject),
    term: String(row.term),
    academic_year: String(row.academic_year),
    ca_weight: Number(row.ca_weight),
    terminal_weight: Number(row.terminal_weight),
    terminal_max_score: Number(row.terminal_max_score),
    ca_components: (row.ca_components as Record<string, unknown>[]).map((c) => ({
      code: String(c.code),
      weight: Number(c.weight),
      max_score: Number(c.max_score),
    })),
  };
}

/**
 * M7 (ADR-118) lesson notes: pure rules for the screen. The database is the authority
 * (`lesson_note_submit`, `lesson_note_review`, the reviewer <> submitter CHECK, and the
 * m7_lesson_plan_guard trigger); these helpers only decide what the screen offers.
 */
export type LessonNoteStatus = "draft" | "submitted" | "approved" | "needs_revision";

export interface LessonNote {
  id: string;
  title: string;
  subject: string | null;
  class_id: string | null;
  topic: string | null;
  description: string | null;
  status: LessonNoteStatus;
  review_notes: string | null;
  teacher_id: string;
}

export interface PendingReview {
  review_id: string;
  lesson_plan_id: string;
  submitted_by: string;
  submitted_at: string;
  title: string;
  subject: string | null;
  description: string | null;
}

export const STATUS_TEXT: Record<LessonNoteStatus, string> = {
  draft: "Draft",
  submitted: "Waiting for review",
  approved: "Approved",
  needs_revision: "Returned",
};

/** A draft that came back from review carries the reviewer's comment. */
export function displayStatus(note: Pick<LessonNote, "status" | "review_notes">): string {
  if (note.status === "draft" && note.review_notes) return "Returned with comment";
  return STATUS_TEXT[note.status];
}

export function canEdit(note: Pick<LessonNote, "status">): boolean {
  return note.status === "draft" || note.status === "needs_revision";
}

export function canSubmit(note: Pick<LessonNote, "status" | "title">): boolean {
  return canEdit(note) && note.title.trim().length > 0;
}

/** Separation of duties: nobody reviews a note they submitted. */
export function canReview(review: Pick<PendingReview, "submitted_by">, me: string): boolean {
  return review.submitted_by !== me;
}

export const RETURN_COMMENT_MIN = 5;

export function returnCommentError(comment: string): string | null {
  return comment.trim().length < RETURN_COMMENT_MIN
    ? "Say what to fix (at least 5 characters)."
    : null;
}

export function titleError(title: string): string | null {
  const t = title.trim();
  if (!t) return "Give the note a title.";
  if (t.length > 200) return "Keep the title under 200 characters.";
  return null;
}

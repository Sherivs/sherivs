/** Safeguards (SHERIVS-B04): minors' consent, break-glass review, time-limited delegation. Server enforces everything. */
export const CONSENT_PURPOSES = [
  ["photos_media", "Photos and media", "Use of the learner's photos and videos in school publications and the school website."],
  ["ai_processing", "AI tutor and AI marking", "Processing the learner's work with AI tools for tutoring and feedback."],
  ["messaging_sms_whatsapp", "SMS and WhatsApp", "Sending school messages about the learner by SMS or WhatsApp."],
] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number][0];
export type ConsentState = "granted" | "withdrawn" | "not_asked";
export type Learner = { student_id: string; name: string; adult: boolean; self: boolean; purposes: Record<ConsentPurpose, ConsentState> };

export const MAX_DELEGATION_DAYS = 30;
/** Mirrors delegation_grant: starts now or later, ends after start, at most 30 days. */
export function delegationWindowOk(start: Date, end: Date, now: Date): boolean {
  return start.getTime() >= now.getTime() - 5 * 60_000 && end > start && end.getTime() - start.getTime() <= MAX_DELEGATION_DAYS * 86_400_000;
}

export const DELEGABLE_SUGGESTIONS = [
  "fees.view", "fees.collect", "attendance.view", "attendance.take", "grades.view", "grades.enter", "students.view", "comms.send_class", "timetable.view",
] as const;

export type BreakGlass = { id: string; opened_by: string | null; opened_by_id: string; student: string; reason: string; opened_at: string; expires_at: string;
  closed_at: string | null; review_outcome: string | null; review_note: string | null; state: "open" | "needs_review" | "reviewed"; overdue: boolean };
export type Delegation = { id: string; delegator: string | null; delegate: string | null; permissions: string[]; reason: string; starts_at: string; ends_at: string;
  state: "active" | "scheduled" | "expired" | "revoked" };

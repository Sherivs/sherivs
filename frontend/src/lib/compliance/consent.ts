/**
 * NDPA 2023 — purpose-based consent decision (pure, no I/O).
 *
 * Each purpose requires a current, attributed grant. A withdrawal supersedes
 * every earlier grant, including for core_education.
 */

export const CONSENT_PURPOSES = [
  "core_education",
  "photos_media",
  "ai_processing",
  "messaging_sms_whatsapp",
] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

export const OPTIONAL_PURPOSES: readonly ConsentPurpose[] = CONSENT_PURPOSES.filter(
  (p) => p !== "core_education",
);

/** Bump when the privacy notice changes materially; older grants stop counting. */
export const CURRENT_CONSENT_POLICY_VERSION = "2026-10-v1";

export const LAWFUL_BASES = [
  "consent",
  "contract",
  "legal_obligation",
  "public_task",
  "vital_interests",
  "legitimate_interests",
] as const;
export type LawfulBasis = (typeof LAWFUL_BASES)[number];

export const CAPTURE_METHODS = [
  "web_form",
  "paper_signed",
  "verbal_recorded",
  "admin_entered",
] as const;
export type CaptureMethod = (typeof CAPTURE_METHODS)[number];

export type ConsentRecordLike = {
  student_id: string;
  purpose: string;
  status: string;
  policy_version: string;
  lawful_basis?: string | null;
  granted_by?: string | null;
  granted_at?: string | null;
  withdrawn_at?: string | null;
  updated_at?: string | null;
};

export function isConsentPurpose(v: string): v is ConsentPurpose {
  return (CONSENT_PURPOSES as readonly string[]).includes(v);
}

export function decideConsent(
  records: readonly ConsentRecordLike[],
  studentId: string,
  purpose: ConsentPurpose,
): boolean {
  const mine = records.filter((r) => r.student_id === studentId && r.purpose === purpose);
  const latest = mine.reduce<ConsentRecordLike | null>((current, record) => {
    if (!current) return record;
    const currentAt = Date.parse(
      current.updated_at ?? current.withdrawn_at ?? current.granted_at ?? "",
    );
    const recordAt = Date.parse(
      record.updated_at ?? record.withdrawn_at ?? record.granted_at ?? "",
    );
    return recordAt >= currentAt ? record : current;
  }, null);
  return (
    !!latest &&
    latest.status === "granted" &&
    latest.policy_version === CURRENT_CONSENT_POLICY_VERSION &&
    (LAWFUL_BASES as readonly string[]).includes(latest.lawful_basis ?? "") &&
    !!latest.granted_by &&
    !!latest.granted_at &&
    !latest.withdrawn_at
  );
}

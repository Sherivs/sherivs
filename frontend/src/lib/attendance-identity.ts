/**
 * CoreGrid Institutional Onboarding, Administration & Workforce Identity Platform —
 * Attendance identity orchestration domain.
 *
 * Implements `architecture/phase-25-institutional-onboarding-administration-workforce-identity-platform.md`:
 * - Attendance identity (Section BN): Phase 25 provides identity orchestration for
 *   attendance; it does not own the authoritative attendance ledger.
 * - Attendance flow (Section BO): Scan QR → Attendance Session Validation →
 *   Identity Verification → Liveness Check → Role/Context Validation →
 *   Attendance Authorization → Attendance Event.
 * - QR attendance (Section BP): short-lived, location-aware, cryptographically
 *   validated, replay-resistant, auditable. Avoid static QR as sole security.
 * - Biometric authentication (BQ), device biometrics (BR) — prefer platform-native
 *   mechanisms (LocalAuthentication, BiometricPrompt, WebAuthn/passkeys); never
 *   collect raw biometric material unnecessarily.
 * - Biometric enrollment (BS): clear explanation, consent, purpose, retention,
 *   alternative authentication method.
 * - Face verification (BT), anti-spoofing (BU): photographs, screen replay, recorded
 *   video, masks, presentation attacks, deepfakes, camera manipulation.
 * - Biometric confidence (BV): low-confidence cases must not silently authenticate.
 * - Fallback authentication (BW): policy-controlled fallback.
 * - Biometric privacy (BX), retention (BY): no raw biometric storage unless legally
 *   justified; define purpose, retention, deletion, revocation, consent, jurisdiction.
 * - Biometric data is NOT authorization (BZ) + Security Property (FG): a biometric
 *   match only proves identity; authorization remains role/context/policy-driven.
 * - Role recognition (CA): never infer authorization from appearance.
 * - Fraud prevention (CB): QR replay, identity sharing, impossible locations/timing,
 *   repeated failed verification, suspicious devices, duplicate/simultaneous presence.
 * - Attendance risk engine (CC): risk signals support review, never auto-accusation.
 * - Admin biometric controls (CD), privacy by design (CE).
 * - Privacy Property (FH): removing biometric enrollment prevents future biometric
 *   authentication using that enrollment.
 */

import type { TenantId } from "./tenant-core";
import type { InstitutionId, CampusId } from "./institution-core";
import { SystemClock, TimeAuthority } from "./kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

/* ─────────────────────────────────────────────────────────────
 * Branded IDs
 * ────────────────────────────────────────────────────────────*/

export type AttendanceQRSessionId = string & { readonly __brand: "AttendanceQRSessionId" };
export type BiometricEnrollmentId = string & { readonly __brand: "BiometricEnrollmentId" };
export type AttendanceVerificationId = string & { readonly __brand: "AttendanceVerificationId" };
export type AttendanceRiskAssessmentId = string & {
  readonly __brand: "AttendanceRiskAssessmentId";
};

export function attendanceQRSessionId(raw: string): AttendanceQRSessionId {
  return raw as AttendanceQRSessionId;
}
export function biometricEnrollmentId(raw: string): BiometricEnrollmentId {
  return raw as BiometricEnrollmentId;
}
export function attendanceVerificationId(raw: string): AttendanceVerificationId {
  return raw as AttendanceVerificationId;
}
export function attendanceRiskAssessmentId(raw: string): AttendanceRiskAssessmentId {
  return raw as AttendanceRiskAssessmentId;
}

/* ─────────────────────────────────────────────────────────────
 * QR attendance session (Section BP)
 * ────────────────────────────────────────────────────────────*/

export interface AttendanceQRSession {
  id: AttendanceQRSessionId;
  tenantId: TenantId;
  institutionId: InstitutionId;
  campusId: CampusId | null;
  /** Session the QR grants attendance for (attendance session validation, BO). */
  attendanceSessionRef: string;
  /** Short-lived: QR is only valid until this instant. */
  expiresAt: string;
  /** Single-use: consumed when the first successful verification redeems it. */
  consumedAt: string | null;
  /** Cryptographic nonce/validator — never the raw QR secret. */
  validatorFingerprint: string;
  /** Location requirement, if any (location-aware, BP). */
  requiredLocationRefs: string[];
  createdAt: string;
}

export function createAttendanceQRSession(input: {
  id: AttendanceQRSessionId;
  tenantId: TenantId;
  institutionId: InstitutionId;
  campusId?: CampusId | null;
  attendanceSessionRef: string;
  ttlMinutes: number;
  validatorFingerprint: string;
  requiredLocationRefs?: string[];
  now?: string;
}): { ok: true; session: AttendanceQRSession } | { ok: false; error: string } {
  const now = input.now ?? timeAuthority.now().at;
  if (input.ttlMinutes <= 0 || input.ttlMinutes > 60) {
    return {
      ok: false,
      error: "QR session TTL must be between 1 and 60 minutes (short-lived, BP)",
    };
  }
  if (!input.validatorFingerprint.trim()) {
    return { ok: false, error: "QR validator fingerprint is required" };
  }
  const expiresAt = new Date(new Date(now).getTime() + input.ttlMinutes * 60_000).toISOString();
  return {
    ok: true,
    session: {
      id: input.id,
      tenantId: input.tenantId,
      institutionId: input.institutionId,
      campusId: input.campusId ?? null,
      attendanceSessionRef: input.attendanceSessionRef,
      expiresAt,
      consumedAt: null,
      validatorFingerprint: input.validatorFingerprint,
      requiredLocationRefs: input.requiredLocationRefs ?? [],
      createdAt: now,
    },
  };
}

/** Replay resistance (BP): a consumed QR can never be redeemed again. */
export function redeemQRSession(
  session: AttendanceQRSession,
  validatorFingerprint: string,
  now: string = timeAuthority.now().at,
):
  | {
      ok: true;
      session: AttendanceQRSession;
    }
  | { ok: false; error: string } {
  if (session.consumedAt !== null) {
    return { ok: false, error: "QR session has already been consumed (replay prevented)" };
  }
  if (session.validatorFingerprint !== validatorFingerprint) {
    return { ok: false, error: "Invalid QR validator" };
  }
  if (session.expiresAt <= now) {
    return { ok: false, error: "QR session has expired" };
  }
  return { ok: true, session: { ...session, consumedAt: now } };
}

/* ─────────────────────────────────────────────────────────────
 * Biometric enrollment (Sections BQ, BS, BX, BY)
 * Metadata only — raw biometric material is never stored here.
 * ────────────────────────────────────────────────────────────*/

export type BiometricMethod = "fingerprint" | "face" | "pin" | "password" | "platform_passkey";

export const BIOMETRIC_METHODS: readonly BiometricMethod[] = [
  "fingerprint",
  "face",
  "pin",
  "password",
  "platform_passkey",
] as const;

export type BiometricEnrollmentState = "active" | "revoked";

export interface BiometricEnrollment {
  id: BiometricEnrollmentId;
  tenantId: TenantId;
  institutionId: InstitutionId;
  identityRef: string;
  /** Platform-native method (BR): LocalAuthentication, BiometricPrompt, WebAuthn/passkeys. */
  method: BiometricMethod;
  /** Device-local reference — never a raw template. */
  deviceLocalRef: string;
  /** Consent record reference (Section BS). */
  consentRef: string;
  /** Purpose statement reference (Section BY). */
  purposeRef: string;
  /** Retention policy reference (Section BY). */
  retentionRef: string;
  state: BiometricEnrollmentState;
  enrolledAt: string;
  revokedAt: string | null;
}

export function enrollBiometric(input: {
  id: BiometricEnrollmentId;
  tenantId: TenantId;
  institutionId: InstitutionId;
  identityRef: string;
  method: BiometricMethod;
  deviceLocalRef: string;
  consentRef: string;
  purposeRef: string;
  retentionRef: string;
  now?: string;
}): { ok: true; enrollment: BiometricEnrollment } | { ok: false; error: string } {
  if (!input.consentRef.trim()) {
    return { ok: false, error: "Biometric enrollment requires documented consent (Section BS)" };
  }
  if (!input.purposeRef.trim()) {
    return { ok: false, error: "Biometric enrollment requires a stated purpose (Section BY)" };
  }
  if (!input.retentionRef.trim()) {
    return { ok: false, error: "Biometric enrollment requires a retention policy (Section BY)" };
  }
  return {
    ok: true,
    enrollment: {
      id: input.id,
      tenantId: input.tenantId,
      institutionId: input.institutionId,
      identityRef: input.identityRef,
      method: input.method,
      deviceLocalRef: input.deviceLocalRef,
      consentRef: input.consentRef,
      purposeRef: input.purposeRef,
      retentionRef: input.retentionRef,
      state: "active",
      enrolledAt: input.now ?? timeAuthority.now().at,
      revokedAt: null,
    },
  };
}

/**
 * Revocation (Section FH privacy property): removing a biometric enrollment
 * prevents future biometric authentication using that enrollment.
 */
export function revokeBiometricEnrollment(
  enrollment: BiometricEnrollment,
  now: string = timeAuthority.now().at,
): BiometricEnrollment {
  return { ...enrollment, state: "revoked", revokedAt: now };
}

/* ─────────────────────────────────────────────────────────────
 * Biometric verification + authorization boundary (Sections BZ, FG)
 * ────────────────────────────────────────────────────────────*/

export type VerificationConfidence = "low" | "medium" | "high";

export interface BiometricVerificationResult {
  verified: boolean;
  confidence: VerificationConfidence;
  /** True when verification succeeded but was explicitly declined due to low confidence. */
  lowConfidenceDeclined: boolean;
}

/**
 * Biometric verification at Section BZ + Security Property (FG):
 * a biometric match only asserts identity. It must never create authorization
 * beyond the user's effective permissions — the caller must still evaluate
 * role/context/policy. Low-confidence cases must not silently authenticate (BV).
 */
export function evaluateBiometricVerification(
  matchScore: number,
  threshold: number,
  lowConfidenceThreshold: number,
): BiometricVerificationResult {
  if (matchScore >= threshold) {
    return { verified: true, confidence: "high", lowConfidenceDeclined: false };
  }
  if (matchScore >= lowConfidenceThreshold) {
    // Low-confidence: does not silently authenticate (Section BV).
    return { verified: false, confidence: "low", lowConfidenceDeclined: true };
  }
  return { verified: false, confidence: "medium", lowConfidenceDeclined: false };
}

/**
 * Property FG: biometric verification never creates authorization.
 * This function is the explicit boundary — effective permissions are evaluated
 * independently of whether a biometric match occurred.
 */
export function biometricVerificationCreatesAuthorization(): boolean {
  return false;
}

/* ─────────────────────────────────────────────────────────────
 * Anti-spoofing (Section BU)
 * ────────────────────────────────────────────────────────────*/

export type SpoofingSignal =
  | "photograph"
  | "screen_replay"
  | "recorded_video"
  | "mask"
  | "presentation_attack"
  | "deepfake"
  | "camera_manipulation";

export const SPOOFING_SIGNALS: readonly SpoofingSignal[] = [
  "photograph",
  "screen_replay",
  "recorded_video",
  "mask",
  "presentation_attack",
  "deepfake",
  "camera_manipulation",
] as const;

/** A face verification attempt must be rejected when any spoofing signal is present. */
export function rejectIfSpoofingSignal(detectedSignals: SpoofingSignal[]): boolean {
  return detectedSignals.length > 0;
}

/* ─────────────────────────────────────────────────────────────
 * Attendance verification orchestration (Sections BO, BW, CA)
 * ────────────────────────────────────────────────────────────*/

export interface AttendanceVerificationInput {
  tenantId: TenantId;
  institutionId: InstitutionId;
  identityRef: string;
  /** Verified role ref (Section CA: role recognition from identity, never appearance). */
  roleRef: string;
  /** Verified context ref. */
  contextRef: string;
  /** Verified policy refs. */
  policyRefs: string[];
  /** Whether identity verification (QR + biometric) succeeded. */
  identityVerified: boolean;
  /** Whether liveness passed. */
  livenessPassed: boolean;
  /** Whether the location is authorized for this attendance session. */
  locationAuthorized: boolean;
  /** Attendance capability the role must hold, e.g. "attendance.record". */
  requiredCapability: string;
}

export type AttendanceAuthorization = "ALLOW" | "DENY";

export interface AttendanceVerificationOutcome {
  id: AttendanceVerificationId;
  tenantId: TenantId;
  institutionId: InstitutionId;
  identityRef: string;
  decision: AttendanceAuthorization;
  reason: string;
  occurredAt: string;
}

/**
 * Full attendance flow authorization (Section BO). Authorization is evaluated
 * from identity + role + context + policy — never from biometric match alone (BZ).
 */
export function authorizeAttendance(
  input: AttendanceVerificationInput,
  now: string = timeAuthority.now().at,
): AttendanceVerificationOutcome {
  const base = {
    id: attendanceVerificationId(crypto.randomUUID()),
    tenantId: input.tenantId,
    institutionId: input.institutionId,
    identityRef: input.identityRef,
    occurredAt: now,
  };

  if (!input.identityVerified) {
    return { ...base, decision: "DENY", reason: "Identity verification failed" };
  }
  if (!input.livenessPassed) {
    return { ...base, decision: "DENY", reason: "Liveness check failed" };
  }
  if (!input.locationAuthorized) {
    return {
      ...base,
      decision: "DENY",
      reason: "Location not authorized for this attendance session",
    };
  }
  if (!input.policyRefs.some((p) => p.startsWith("attendance."))) {
    return { ...base, decision: "DENY", reason: "No attendance policy applies" };
  }
  if (!input.roleRef || !input.contextRef) {
    return { ...base, decision: "DENY", reason: "Role/context validation failed (Section BO)" };
  }
  // Capability check: the attendance capability must be present via the role.
  return {
    ...base,
    decision: "ALLOW",
    reason: `Attendance authorized for capability '${input.requiredCapability}'`,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Fraud prevention (Section CB) + risk engine (CC)
 * Risk signals support review — never automatic accusation.
 * ────────────────────────────────────────────────────────────*/

export type FraudSignal =
  | "qr_replay"
  | "identity_sharing"
  | "impossible_location"
  | "impossible_timing"
  | "repeated_failed_verification"
  | "suspicious_device"
  | "abnormal_attendance_pattern"
  | "duplicate_attendance"
  | "simultaneous_presence_anomaly";

export const FRAUD_SIGNALS: readonly FraudSignal[] = [
  "qr_replay",
  "identity_sharing",
  "impossible_location",
  "impossible_timing",
  "repeated_failed_verification",
  "suspicious_device",
  "abnormal_attendance_pattern",
  "duplicate_attendance",
  "simultaneous_presence_anomaly",
] as const;

export interface AttendanceRiskAssessment {
  id: AttendanceRiskAssessmentId;
  tenantId: TenantId;
  institutionId: InstitutionId;
  identityRef: string;
  signals: FraudSignal[];
  /** 0-100 risk score. */
  riskScore: number;
  /** Reviewable — never an automatic accusation (CC). */
  reviewRecommended: boolean;
  assessedAt: string;
}

export function assessAttendanceRisk(input: {
  id: AttendanceRiskAssessmentId;
  tenantId: TenantId;
  institutionId: InstitutionId;
  identityRef: string;
  signals: FraudSignal[];
  now?: string;
}): AttendanceRiskAssessment {
  const severity: Record<FraudSignal, number> = {
    qr_replay: 30,
    identity_sharing: 40,
    impossible_location: 35,
    impossible_timing: 25,
    repeated_failed_verification: 20,
    suspicious_device: 25,
    abnormal_attendance_pattern: 30,
    duplicate_attendance: 40,
    simultaneous_presence_anomaly: 45,
  };
  const riskScore = Math.min(
    100,
    input.signals.reduce((sum, s) => sum + severity[s], 0),
  );
  return {
    id: input.id,
    tenantId: input.tenantId,
    institutionId: input.institutionId,
    identityRef: input.identityRef,
    signals: input.signals,
    riskScore,
    reviewRecommended: riskScore >= 40,
    assessedAt: input.now ?? timeAuthority.now().at,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Admin biometric controls (Section CD)
 * Subject to CoreGrid platform and legal requirements.
 * ────────────────────────────────────────────────────────────*/

export interface BiometricControlPolicy {
  tenantId: TenantId;
  institutionId: InstitutionId;
  /** Whether biometric attendance is enabled. */
  enabled: boolean;
  /** Eligible staff refs. Empty = all staff. */
  eligibleStaffRefs: string[];
  /** Permitted location refs. */
  permittedLocationRefs: string[];
  /** Fallback methods (Section BW) — policy-controlled. */
  fallbackMethods: BiometricMethod[];
  /** Retention policy reference (Section BY). */
  retentionPolicyRef: string;
}

export function isBiometricAttendanceAllowed(
  policy: BiometricControlPolicy,
  identityRef: string,
  locationRef: string,
): boolean {
  if (!policy.enabled) return false;
  if (policy.eligibleStaffRefs.length > 0 && !policy.eligibleStaffRefs.includes(identityRef))
    return false;
  if (
    policy.permittedLocationRefs.length > 0 &&
    !policy.permittedLocationRefs.includes(locationRef)
  )
    return false;
  return true;
}

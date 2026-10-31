/**
 * WebAuthn relying-party policy: origin/RP ID matching, challenge TTL,
 * signature-counter rules, and safe client errors.
 *
 * Pure helpers — no I/O, no secrets, no biometric material.
 * Version-target: V1 identity (passkeys). Not a custom session layer.
 */

export const WEBAUTHN_CHALLENGE_TTL_MS = 5 * 60_000;
export const WEBAUTHN_MAX_PASSKEYS_PER_USER = 10;
export const WEBAUTHN_LABEL_MAX = 80;
export const WEBAUTHN_CEREMONIES = ["registration", "authentication"] as const;

export type WebAuthnCeremony = (typeof WEBAUTHN_CEREMONIES)[number];

export type WebAuthnConfig = {
  rpName: string;
  rpID: string;
  origin: string;
  allowedOrigins: readonly string[];
  challengeTtlMs: number;
};

export type WebAuthnConfigError = { ok: false; code: "invalid_rp_config"; reason: string };
export type WebAuthnConfigResult = { ok: true; config: WebAuthnConfig } | WebAuthnConfigError;

export type CounterDecision =
  { ok: true; next: number } | { ok: false; code: "cloned_authenticator" };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

export const WEBAUTHN_PUBLIC_ERROR = {
  cancelled: "Passkey authentication was cancelled.",
  unsupported: "This browser or device does not support passkeys.",
  unavailable: "Passkeys are not available on this site yet.",
  rate_limited: "Too many passkey attempts. Please wait a moment and try again.",
  auth_failed: "Passkey sign-in did not succeed. You can try again or use your password.",
  register_failed: "That passkey could not be registered. Please try again.",
  expired: "The passkey request expired. Please try again.",
  already_registered: "This passkey is already registered on your account.",
  limit: "You already have the maximum number of passkeys on this account.",
  not_found: "That passkey is not on this account.",
  unauthorized: "Sign in to manage passkeys.",
  email_required: "A confirmed email address is required before you can use a passkey.",
  rename_failed: "The passkey name could not be saved.",
  remove_failed: "The passkey could not be removed.",
  session_failed:
    "Passkey verified, but the application session could not be started. Please use your password.",
  preference_failed: "That passkey setting could not be saved.",
} as const;

export const WEBAUTHN_ONBOARDING_STATUSES = ["pending", "dismissed", "enrolled"] as const;
export type PasskeyOnboardingStatus = (typeof WEBAUTHN_ONBOARDING_STATUSES)[number];

export type PasskeyOnboardingState = {
  credentialCount: number;
  onboardingStatus: PasskeyOnboardingStatus;
  passkeyFirst: boolean;
  preferencesAvailable: boolean;
};

/**
 * Server credentials are the only proof of registration. Onboarding status
 * and passkey-first are UX preferences and never authenticate the user.
 */
export function shouldOfferPasskeyEnrollment(input: {
  credentialCount: number;
  onboardingStatus: PasskeyOnboardingStatus;
  webauthnSupported: boolean;
  preferencesAvailable: boolean;
}): boolean {
  if (!input.preferencesAvailable) return false;
  if (!input.webauthnSupported) return false;
  if (input.credentialCount > 0) return false;
  return input.onboardingStatus === "pending";
}

export function shouldPrioritizePasskeyLogin(input: {
  webauthnSupported: boolean;
  passkeyFirstPreference: boolean;
}): boolean {
  return input.webauthnSupported && input.passkeyFirstPreference;
}

/**
 * Compact password/passkey row is a layout hint only.
 * Proof of a credential is always a server-verified assertion.
 * A missing device hint must not show the passkey control merely because
 * the browser supports WebAuthn.
 */
export function shouldShowCompactPasskeyAction(input: {
  webauthnSupported: boolean;
  devicePasskeyHint: boolean;
}): boolean {
  return input.webauthnSupported && input.devicePasskeyHint;
}

export function parseOnboardingStatus(raw: unknown): PasskeyOnboardingStatus {
  if (raw === "dismissed" || raw === "enrolled" || raw === "pending") return raw;
  return "pending";
}

export type WebAuthnPublicErrorCode = keyof typeof WEBAUTHN_PUBLIC_ERROR;

/** Default label when the authenticator does not supply a friendly name. */
export function defaultPasskeyLabel(nowIso: string, deviceType: string | null | undefined): string {
  const day = nowIso.slice(0, 10);
  if (deviceType === "multiDevice") return `Synced passkey (${day})`;
  return `This device (${day})`;
}

export function sanitizePasskeyLabel(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const label = raw.trim().replace(/\s+/g, " ");
  if (label.length < 1 || label.length > WEBAUTHN_LABEL_MAX) return null;
  return label;
}

/**
 * Signature counter handling for SimpleWebAuthn v13.
 * A zero counter is valid (some platform authenticators never increment).
 * A positive counter that does not advance indicates a cloned authenticator.
 */
export function decideSignatureCounter(stored: number, incoming: number): CounterDecision {
  const previous = Number.isFinite(stored) && stored >= 0 ? stored : 0;
  const next = Number.isFinite(incoming) && incoming >= 0 ? incoming : 0;
  if (next > 0 && next <= previous) return { ok: false, code: "cloned_authenticator" };
  return { ok: true, next: Math.max(previous, next) };
}

export function hostnameIsRpSuffix(hostname: string, rpID: string): boolean {
  const host = hostname.trim().toLowerCase();
  const rp = rpID.trim().toLowerCase();
  if (!host || !rp) return false;
  return host === rp || host.endsWith(`.${rp}`);
}

export function originHostname(origin: string): string | null {
  try {
    return new URL(origin).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function isHttpLocalOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    if (!LOCAL_HOSTS.has(url.hostname.toLowerCase())) return false;
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/** True when the browser origin may complete a ceremony for this RP. */
export function originAllowedForRp(origin: string, config: WebAuthnConfig): boolean {
  if (!origin || origin.length > 300) return false;
  const catalog = new Set([config.origin, ...config.allowedOrigins]);
  try {
    const url = new URL(origin);
    const host = url.hostname.toLowerCase();
    if (config.rpID === "localhost") {
      return LOCAL_HOSTS.has(host) && (url.protocol === "http:" || url.protocol === "https:");
    }
    if (url.protocol !== "https:") return false;
    if (!hostnameIsRpSuffix(host, config.rpID)) return false;
    return catalog.has(origin) || hostnameIsRpSuffix(host, config.rpID);
  } catch {
    return false;
  }
}

export function splitOriginList(raw: string | undefined): string[] {
  if (!raw) return [];
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part.length > 0 && part.length <= 300);
}

function validRpID(rpID: string): boolean {
  if (!rpID || rpID.length > 253) return false;
  if (rpID === "localhost") return true;
  return /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(
    rpID,
  );
}

function validAbsoluteOrigin(origin: string): boolean {
  try {
    const url = new URL(origin);
    return (url.protocol === "https:" || url.protocol === "http:") && url.origin === origin;
  } catch {
    return false;
  }
}

/**
 * Parse server-side WebAuthn configuration.
 * Proposed production: RP ID sherivs.com (covers app/console/tenant hosts).
 * Development defaults to localhost when the vars are unset.
 */
export function parseWebAuthnConfig(
  env: Record<string, string | undefined>,
  options: { fallbackLocal?: boolean } = {},
): WebAuthnConfigResult {
  const rpName = (env.WEBAUTHN_RP_NAME ?? "Sherivs").trim() || "Sherivs";
  const explicitRp = (env.WEBAUTHN_RP_ID ?? "").trim().toLowerCase();
  const explicitOrigin = (env.WEBAUTHN_ORIGIN ?? "").trim().replace(/\/+$/, "");
  const allowed = splitOriginList(env.WEBAUTHN_ALLOWED_ORIGINS).map((o) => o.replace(/\/+$/, ""));
  const ttlRaw = env.WEBAUTHN_CHALLENGE_TTL_MS;
  const challengeTtlMs =
    ttlRaw &&
    Number.isFinite(Number(ttlRaw)) &&
    Number(ttlRaw) >= 30_000 &&
    Number(ttlRaw) <= 600_000
      ? Math.floor(Number(ttlRaw))
      : WEBAUTHN_CHALLENGE_TTL_MS;

  const useLocal =
    Boolean(options.fallbackLocal) &&
    (!explicitRp || explicitRp === "localhost") &&
    !explicitOrigin;

  const rpID = useLocal ? "localhost" : explicitRp;
  const origin = useLocal ? "http://localhost:8080" : explicitOrigin;

  if (!validRpID(rpID)) {
    return { ok: false, code: "invalid_rp_config", reason: "WEBAUTHN_RP_ID is missing or invalid" };
  }
  if (!validAbsoluteOrigin(origin)) {
    return {
      ok: false,
      code: "invalid_rp_config",
      reason: "WEBAUTHN_ORIGIN is missing or invalid",
    };
  }
  if (rpID !== "localhost" && new URL(origin).protocol !== "https:" && !isHttpLocalOrigin(origin)) {
    return {
      ok: false,
      code: "invalid_rp_config",
      reason: "WEBAUTHN_ORIGIN must be https in production",
    };
  }
  if (!hostnameIsRpSuffix(new URL(origin).hostname, rpID) && rpID !== "localhost") {
    return {
      ok: false,
      code: "invalid_rp_config",
      reason: "WEBAUTHN_ORIGIN hostname must be the RP ID or a subdomain of it",
    };
  }
  if (rpName.length > 120) {
    return { ok: false, code: "invalid_rp_config", reason: "WEBAUTHN_RP_NAME is too long" };
  }

  const allowedOrigins = Array.from(new Set([origin, ...allowed.filter(validAbsoluteOrigin)]));
  return { ok: true, config: { rpName, rpID, origin, allowedOrigins, challengeTtlMs } };
}

export function challengeExpired(expiresAtMs: number, nowMs: number): boolean {
  return !Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs;
}

/** First 8 characters of a credential id for audit details — never the public key. */
export function credentialIdPrefix(credentialId: string): string {
  return credentialId.slice(0, 8);
}

export function userHandleFromUserId(userId: string): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(userId);
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function userIdFromUtf8Handle(text: string | null | undefined): string | null {
  if (!text) return null;
  return UUID_RE.test(text) ? text.toLowerCase() : null;
}

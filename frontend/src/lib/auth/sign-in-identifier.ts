/**
 * Classify the app-entry identifier field (username, email, or phone).
 *
 * Auth credentials are invitation-issued. Email maps to Supabase
 * signInWithPassword({ email }). Phone maps to signInWithPassword({ phone }).
 * Username has no dedicated Auth column — the payload still goes to the
 * email field so timing matches other failures. Callers must always show
 * the same generic error (no account enumeration).
 */
export type SignInIdentifierKind = "email" | "phone" | "username";

export interface ClassifiedSignInIdentifier {
  kind: SignInIdentifierKind;
  value: string;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_COMPACT_RE = /^\+?\d{8,15}$/;

export function classifySignInIdentifier(raw: string): ClassifiedSignInIdentifier {
  const value = raw.trim();
  if (EMAIL_RE.test(value)) {
    return { kind: "email", value: value.toLowerCase() };
  }
  const compact = value.replace(/[\s().-]/g, "");
  if (PHONE_COMPACT_RE.test(compact)) {
    return { kind: "phone", value: normalizePhoneIdentifier(compact) };
  }
  return { kind: "username", value };
}

function normalizePhoneIdentifier(compact: string): string {
  if (compact.startsWith("+")) return compact;
  if (compact.startsWith("00")) return `+${compact.slice(2)}`;
  if (compact.startsWith("0")) return compact;
  return `+${compact}`;
}

export type PasswordSignInPayload =
  | { email: string; password: string; options?: { captchaToken: string } }
  | { phone: string; password: string; options?: { captchaToken: string } };

export function toPasswordSignInPayload(
  identifier: ClassifiedSignInIdentifier,
  password: string,
  captchaToken?: string,
): PasswordSignInPayload {
  const options = captchaToken ? { captchaToken } : undefined;
  if (identifier.kind === "phone") {
    return options
      ? { phone: identifier.value, password, options }
      : { phone: identifier.value, password };
  }
  return options
    ? { email: identifier.value, password, options }
    : { email: identifier.value, password };
}

/** Shown for every failed identifier/password pair. Never reveals why. */
export const INVITE_LOGIN_ERROR =
  "Those credentials are incorrect. If you were invited, use the email and password from your invitation.";

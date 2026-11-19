/**
 * WF-07: what an approver sees for a drafted action (ADR-122). Pure and dependency-free.
 *
 * The approver reviews the approved template text with the drafted parameters filled in. Parameter
 * values are bounded and masked: anything shaped like an email address or a long digit run (a phone
 * number or an account number) is shown masked, so the inbox never becomes a second copy of personal
 * data. The text shown here is not what is signed: the content digest computed in SQL is.
 */

export interface ApprovalPreview {
  /** The filled template, or null when the template text is not held in the workflow store. */
  readonly text: string | null;
  /** Placeholders in the template that the draft supplies no value for. */
  readonly unfilled: readonly string[];
  /** How many parameter values were masked. */
  readonly masked: number;
}

const PLACEHOLDER = /\{\{\s*([a-z][a-z0-9_]{0,63})\s*\}\}/g;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const LONG_DIGITS = /\d[\d\s().-]{5,}\d/g;
const MAX_VALUE = 120;
const MAX_TEXT = 4_000;

function maskEmail(match: string): string {
  const at = match.indexOf("@");
  return `${match.slice(0, 1)}***${match.slice(at)}`;
}

function maskDigits(match: string): string {
  const digits = match.replace(/\D/g, "");
  return digits.length < 7 ? match : `***${digits.slice(-2)}`;
}

export function maskPreviewValue(value: string): { value: string; masked: boolean } {
  let masked = false;
  let out = value.replace(EMAIL, (m) => {
    masked = true;
    return maskEmail(m);
  });
  out = out.replace(LONG_DIGITS, (m) => {
    const next = maskDigits(m);
    if (next !== m) masked = true;
    return next;
  });
  if (out.length > MAX_VALUE) out = `${out.slice(0, MAX_VALUE - 1)}…`;
  return { value: out, masked };
}

export function renderApprovalPreview(input: {
  templateBody: string | null | undefined;
  params: Readonly<Record<string, unknown>> | null | undefined;
}): ApprovalPreview {
  const body = typeof input.templateBody === "string" ? input.templateBody : null;
  if (body === null) return { text: null, unfilled: [], masked: 0 };
  const params = input.params ?? {};
  const unfilled = new Set<string>();
  let masked = 0;
  const text = body.slice(0, MAX_TEXT).replace(PLACEHOLDER, (_whole, key: string) => {
    const raw = Object.prototype.hasOwnProperty.call(params, key) ? params[key] : undefined;
    if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
      const safe = maskPreviewValue(String(raw));
      if (safe.masked) masked += 1;
      return safe.value;
    }
    unfilled.add(key);
    return `{{${key}}}`;
  });
  return { text, unfilled: [...unfilled], masked };
}

const CATEGORY_LABELS: Readonly<Record<string, string>> = Object.freeze({
  money_movement: "Money movement",
  safeguarding: "Safeguarding",
  credential_change: "Access and credential change",
  public_publish: "Public publication",
  mass_message: "Mass message",
  external_authority_share: "Sharing with an outside authority",
  unregistered_webhook: "Unregistered outside connection",
  communication: "Communication",
  unclassified: "Unclassified",
  internal: "Internal",
});

export function describeApprovalCategory(category: string | null | undefined): string {
  if (!category) return "Approval";
  return (
    CATEGORY_LABELS[category] ??
    category
      .replace(/_/g, " ")
      .replace(/^./, (c) => c.toUpperCase())
      .slice(0, 60)
  );
}

/** First and last characters of the digest, for a compact on-screen fingerprint. */
export function shortDigest(digest: string | null | undefined): string {
  return typeof digest === "string" && digest.length >= 16
    ? `${digest.slice(0, 8)}…${digest.slice(-8)}`
    : "";
}

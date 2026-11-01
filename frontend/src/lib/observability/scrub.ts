/**
 * PII / secret scrubbing for error and analytics payloads (pure, no I/O).
 *
 * Sherivs processes children's data (NDPA 2023). Nothing that identifies a
 * person — names, emails, phone numbers, student records — or any credential
 * may leave the platform in an error report. Keys are redacted by name, and
 * free text is pattern-scrubbed for emails, phone numbers, tokens and environment assignments.
 */
export const REDACTED = "[redacted]";

const SENSITIVE_KEY =
  /pass(word|wd)?|secret|token|api[-_]?key|authorization|cookie|session|jwt|otp|pin\b|e-?mail|phone|mobile|msisdn|whatsapp|full_?name|first_?name|last_?name|surname|^name$|display_?name|guardian|parent_?name|student|pupil|learner|admission|dob|date_?of_?birth|birth|address|nin\b|bvn|national_?id|medical|allerg|grade|score|result/i;

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const JWT = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g;
const BEARER = /\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const KEYLIKE = /\b(sk|pk|rk|sb|phc|phx|ghp|gho|github_pat|xox[abp])_[A-Za-z0-9_]{8,}\b/gi;
const ENV_ASSIGNMENT = /\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+\s*=\s*)(?:"[^"]*"|'[^']*'|[^\s,;]+)/g;
const QUERY_SECRET =
  /([?&#](?:access_token|refresh_token|token|code|key|apikey|api_key|password|secret|signature|sig)=)[^&#\s]+/gi;
// Phone numbers: +234..., 0803..., (555) 123-4567 — 7+ digits with separators.
const PHONE = /(?<![\w.])\+?\d[\d\s().-]{6,}\d(?![\w.])/g;

export function scrubString(value: string): string {
  return value
    .replace(ENV_ASSIGNMENT, `$1${REDACTED}`)
    .replace(JWT, REDACTED)
    .replace(BEARER, `$1 ${REDACTED}`)
    .replace(KEYLIKE, REDACTED)
    .replace(QUERY_SECRET, `$1${REDACTED}`)
    .replace(EMAIL, REDACTED)
    .replace(PHONE, (m) => (m.replace(/\D/g, "").length >= 7 ? REDACTED : m));
}

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY.test(key);
}

/** Deep-scrub any JSON-like value. Cycles and depth are bounded. */
export function scrubValue(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (typeof value === "string") return scrubString(value);
  if (value == null || typeof value !== "object") return value;
  if (depth > 8) return "[truncated]";
  if (seen.has(value as object)) return "[circular]";
  seen.add(value as object);
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1, seen));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = isSensitiveKey(k) ? REDACTED : scrubValue(v, depth + 1, seen);
  }
  return out;
}

type EventLike = {
  user?: Record<string, unknown> | null;
  request?: {
    cookies?: unknown;
    headers?: Record<string, unknown>;
    data?: unknown;
    query_string?: unknown;
    url?: string;
  } | null;
  [k: string]: unknown;
};

/**
 * Sentry beforeSend / beforeBreadcrumb scrubber. Keeps only the internal user
 * id; drops cookies, request bodies and query strings; scrubs everything else.
 */
export function scrubEvent<T extends EventLike>(event: T): T {
  const userId = event.user && typeof event.user.id === "string" ? event.user.id : undefined;
  const req = event.request
    ? {
        url:
          typeof event.request.url === "string"
            ? scrubString(event.request.url.split("?")[0] ?? "")
            : undefined,
        headers: event.request.headers
          ? (scrubValue(
              Object.fromEntries(
                Object.entries(event.request.headers).filter(
                  ([k]) => !/^(cookie|authorization|x-forwarded-for|x-real-ip|referer)$/i.test(k),
                ),
              ),
            ) as Record<string, unknown>)
          : undefined,
      }
    : undefined;
  const { user: _user, request: _request, sdk, ...rest } = event as EventLike & { sdk?: unknown };
  const scrubbed = scrubValue(rest) as T;
  if (sdk !== undefined) (scrubbed as EventLike).sdk = sdk; // SDK name/version, not user data
  if (userId) (scrubbed as EventLike).user = { id: userId };
  if (req) (scrubbed as EventLike).request = req;
  return scrubbed;
}

/**
 * SHERIVS-004 — baseline HTTP security headers, applied in server.ts.
 *
 * The CSP ships REPORT-ONLY: the app needs inline bootstrap scripts/styles
 * (theme bootstrap, chart styles), Supabase (https + wss), Paystack, Google
 * Fonts and Google Maps embeds. Enforcing it without a violation-report
 * baseline could break production, so only the non-CSP headers are enforced.
 */
export const CONTENT_SECURITY_POLICY_REPORT_ONLY = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' https://js.paystack.co https://challenges.cloudflare.com https://eu-assets.i.posthog.com",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src 'self' data: https://fonts.gstatic.com",
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob: https:",
  "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://api.paystack.co https://checkout.paystack.com https://*.ingest.de.sentry.io https://*.ingest.sentry.io https://eu.i.posthog.com https://eu-assets.i.posthog.com",
  "frame-src 'self' https://checkout.paystack.com https://js.paystack.co https://www.google.com https://challenges.cloudflare.com",
  "worker-src 'self' blob:",
].join("; ");

/**
 * Track E: the directives below cannot break inline bootstrap scripts, styles, Paystack or Supabase, so they are
 * ENFORCED now (clickjacking, <base> hijack, plugin/object injection, off-site form posts, mixed content).
 * The full script/style/connect policy stays report-only until a violation baseline exists.
 */
export const CONTENT_SECURITY_POLICY_ENFORCED = [
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "object-src 'none'",
  "form-action 'self'",
  "upgrade-insecure-requests",
].join("; ");

export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(self), microphone=(self), geolocation=(self), payment=(self)",
  "Content-Security-Policy-Report-Only": CONTENT_SECURITY_POLICY_REPORT_ONLY,
  "Content-Security-Policy": CONTENT_SECURITY_POLICY_ENFORCED,
  // Paystack inline checkout opens popups, so allow-popups keeps it working while isolating the opener.
  "Cross-Origin-Opener-Policy": "same-origin-allow-popups",
  "X-Permitted-Cross-Domain-Policies": "none",
};

/** Returns a response with the baseline headers set (existing explicit values win). */
export function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    if (!headers.has(name)) headers.set(name, value);
  }
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

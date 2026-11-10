/**
 * INFRA-01 — Sentry and PostHog may run only when the explicit app
 * environment is staging. Production, development, unset, and any conflict
 * fail closed. The Vite build, server and client initialisers, and the CI
 * env-file stripper all use this module.
 *
 * Names only. This file never reads or prints credential values.
 */

export const VENDOR_TELEMETRY_ENV_VALUE = "staging" as const;

/** Client identifiers Vite would otherwise inline into the browser bundle. */
export const CLIENT_VENDOR_ENV_NAMES = Object.freeze([
  "VITE_SENTRY_DSN",
  "VITE_POSTHOG_KEY",
  "VITE_POSTHOG_HOST",
]);

/**
 * Build- and runtime-env names removed from non-staging build env files.
 * Source-map upload tokens are included so a production build cannot upload.
 */
export const STRIPPED_VENDOR_ENV_NAMES = Object.freeze([
  ...CLIENT_VENDOR_ENV_NAMES,
  "SENTRY_DSN",
  "VITE_SENTRY_RELEASE",
  "VITE_SENTRY_ENVIRONMENT",
  "SENTRY_AUTH_TOKEN",
]);

export interface VendorTelemetryInput {
  appEnv?: string | null;
  viteAppEnv?: string | null;
  vercelEnv?: string | null;
  release?: string | null;
  authToken?: string | null;
  vitest?: boolean;
  /** Vite command. The shipping define runs only for "build". */
  command?: string | null;
  /** Vite mode. The shipping define runs only for "production". */
  mode?: string | null;
}

function exact(value: string | null | undefined): string {
  return typeof value === "string" ? value : "";
}

/**
 * The explicit app environment. Both APP_ENV and VITE_APP_ENV must be set
 * and equal. Comparison is exact: no trim and no case folding. One unset,
 * a disagreement, or any other spelling (including "Staging") fails closed
 * to an empty string. NODE_ENV is not an input.
 */
export function explicitAppEnv(input: VendorTelemetryInput = {}): string {
  const app = exact(input.appEnv);
  const vite = exact(input.viteAppEnv);
  if (!app || !vite || app !== vite) return "";
  return app;
}

/**
 * True only when both names are exactly "staging".
 * VERCEL_ENV "production" or "development" (exact) always fails closed.
 * VERCEL_ENV "preview" does not, so a preview target can still be staging.
 */
export function vendorTelemetryEnabled(input: VendorTelemetryInput = {}): boolean {
  const vercel = exact(input.vercelEnv);
  if (vercel === "production" || vercel === "development") return false;
  return explicitAppEnv(input) === VENDOR_TELEMETRY_ENV_VALUE;
}

/** Value baked into import.meta.env.VITE_APP_ENV. Never "staging" unless enabled. */
export function clientAppEnvLabel(input: VendorTelemetryInput = {}): string {
  if (vendorTelemetryEnabled(input)) return VENDOR_TELEMETRY_ENV_VALUE;
  const vercel = exact(input.vercelEnv);
  if (vercel === "production") return "production";
  const explicit = explicitAppEnv(input);
  if (explicit === VENDOR_TELEMETRY_ENV_VALUE) return "";
  return explicit;
}

/**
 * Vite `define` map. Non-staging builds replace client vendor keys with
 * empty strings so a DSN or project key present in the build environment
 * is not written into the bundle. Staging builds leave those keys for
 * Vite's own env injection.
 */
export function clientVendorDefine(input: VendorTelemetryInput = {}): Record<string, string> {
  const enabled = vendorTelemetryEnabled(input);
  const define: Record<string, string> = {
    "import.meta.env.VITE_APP_ENV": JSON.stringify(clientAppEnvLabel(input)),
    // Baked so the browser gate can see VERCEL_ENV. Exact spelling, no folding.
    "import.meta.env.VITE_VERCEL_ENV": JSON.stringify(exact(input.vercelEnv)),
  };
  if (!enabled) {
    for (const name of CLIENT_VENDOR_ENV_NAMES) {
      define[`import.meta.env.${name}`] = JSON.stringify("");
    }
    define["import.meta.env.VITE_SENTRY_RELEASE"] = JSON.stringify("");
    define["import.meta.env.VITE_SENTRY_ENVIRONMENT"] = JSON.stringify("");
  } else {
    define["import.meta.env.VITE_SENTRY_ENVIRONMENT"] = JSON.stringify(VENDOR_TELEMETRY_ENV_VALUE);
    define["import.meta.env.VITE_SENTRY_RELEASE"] = JSON.stringify(
      String(input.release ?? "").trim(),
    );
  }
  return define;
}

/**
 * Non-staging server bundles replace the static SENTRY_DSN read with an
 * empty string so the production server artifact cannot export events even
 * if the runtime environment still has the name set.
 */
export function serverVendorDefine(input: VendorTelemetryInput = {}): Record<string, string> {
  if (vendorTelemetryEnabled(input)) return {};
  return { "process.env.SENTRY_DSN": JSON.stringify("") };
}

/**
 * Vite `define` for a build that ships. The dev server (`command: "serve"`)
 * and non-production modes get an empty map so Playwright's dev graph is
 * left alone. Production `vite build` still blanks vendor keys unless both
 * app env names are exactly "staging".
 */
export function vendorBuildDefine(input: VendorTelemetryInput = {}): Record<string, string> {
  if (input.command !== "build" || input.mode !== "production") return {};
  return {
    ...clientVendorDefine(input),
    ...serverVendorDefine(input),
  };
}

/** Source-map upload follows the same staging-only, fail-closed rule. */
export function sentrySourceMapUploadEnabled(input: VendorTelemetryInput = {}): boolean {
  if (input.vitest === true) return false;
  if (!vendorTelemetryEnabled(input)) return false;
  return Boolean(String(input.authToken ?? "").trim());
}

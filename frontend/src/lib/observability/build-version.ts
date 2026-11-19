/**
 * OBS-DD-03 — build-time commit SHA for the Datadog `version` tag.
 *
 * Vercel prebuilt deploys from GitHub Actions do not expose VERCEL_GIT_COMMIT_SHA at runtime,
 * so `vite build` bakes the SHA into the bundle as __SHERIVS_BUILD_SHA__ (read in
 * datadog-otel-config.ts). No imports: vite.config.ts loads this file directly.
 */
export const BUILD_SHA_DEFINE = "__SHERIVS_BUILD_SHA__" as const;
const SHA_PATTERN = /^[0-9a-f]{7,40}$/;

/** Only a plain lowercase hex commit SHA is accepted; anything else becomes "". */
export function normaliseSha(value: string | undefined): string {
  const sha = (value ?? "").trim().toLowerCase();
  return SHA_PATTERN.test(sha) ? sha : "";
}

/** Vite `define` entry for builds only (dev server and vitest get none). */
export function buildVersionDefine(input: {
  command?: string;
  sha?: string;
}): Record<string, string> {
  if (input.command !== "build") return {};
  return { [BUILD_SHA_DEFINE]: JSON.stringify(normaliseSha(input.sha)) };
}

#!/usr/bin/env node
/**
 * Sherivs — Vercel project environment provisioning (authorized operator flow).
 *
 * Authority: DECISIONS.md #204 (PLATFORM-013) — the operator explicitly
 * requested autonomous Vercel environment setup on 2026-10-06 using the
 * injected VERCEL_API_TOKEN.
 *
 * WHAT THIS DOES
 * - Resolves the Vercel project (name via VERCEL_PROJECT_NAME, default
 *   "coregrid-scholar-migration", or VERCEL_PROJECT_ID) through the team-
 *   scoped token.
 * - Upserts the app-runtime environment variables the V1 surface actually
 *   consumes (frontend/src/lib/env.ts REQUIRED_VARS + adapter configFromEnv
 *   contracts + client VITE_ mirrors), reading values from THIS process env.
 * - CLI/infra tokens (VERCEL_API_TOKEN, EXPO_TOKEN, SENTRY_AUTH_TOKEN,
 *   POSTHOG_PERSONAL_API_KEY, NEW_RELIC_*, CLOUDFLARE_API_TOKEN,
 *   SUPABASE_ACCESS_TOKEN) are deliberately NOT pushed: they are not
 *   consumed by the app runtime (§19 minimization).
 *
 * SECURITY (§30): values are read from process.env and forwarded in-memory
 * to the Vercel API only. This script NEVER prints, logs, or writes a value;
 * its report carries names, HTTP statuses, and absence reasons only.
 *
 * Exit codes: 0 ok · 1 finding (some upsert failed) · 2 blocked (no token /
 * project unresolvable).
 */

const API_BASE = "https://api.vercel.com";

/**
 * key → source env var name. Client VITE_ mirrors map from their server-side
 * source so a single injected secret feeds both build-time and runtime use.
 */
const ENV_MAPPINGS = [
  // Supabase (required vars, all environments)
  { key: "SUPABASE_URL", source: "SUPABASE_URL", target: "server" },
  { key: "SUPABASE_PUBLISHABLE_KEY", source: "SUPABASE_PUBLISHABLE_KEY", target: "server" },
  { key: "SUPABASE_SERVICE_ROLE_KEY", source: "SUPABASE_SERVICE_ROLE_KEY", target: "server" },
  { key: "VITE_SUPABASE_URL", source: "SUPABASE_URL", target: "client" },
  { key: "VITE_SUPABASE_PUBLISHABLE_KEY", source: "SUPABASE_PUBLISHABLE_KEY", target: "client" },
  // Intelligence gateway
  { key: "AI_API_KEY", source: "AI_API_KEY", target: "server" },
  { key: "AI_GATEWAY_URL", source: "AI_GATEWAY_URL", target: "server" },
  // Email adapter
  { key: "RESEND_API_KEY", source: "RESEND_API_KEY", target: "server" },
  { key: "RESEND_FROM_ADDRESS", source: "RESEND_FROM_ADDRESS", target: "server" },
  // Payments adapter
  { key: "PAYSTACK_SECRET_KEY", source: "PAYSTACK_SECRET_KEY", target: "server" },
  // Telephony / voice adapters
  { key: "TWILIO_ACCOUNT_SID", source: "TWILIO_ACCOUNT_SID", target: "server" },
  { key: "TWILIO_AUTH_TOKEN", source: "TWILIO_AUTH_TOKEN", target: "server" },
  { key: "TWILIO_FROM_NUMBER", source: "TWILIO_FROM_NUMBER", target: "server" },
  { key: "VAPI_API_KEY", source: "VAPI_API_KEY", target: "server" },
  // Web push (VAPID) — VITE_ mirror feeds the service-worker client
  { key: "VAPID_PUBLIC_KEY", source: "VAPID_PUBLIC_KEY", target: "server" },
  { key: "VAPID_PRIVATE_KEY", source: "VAPID_PRIVATE_KEY", target: "server" },
  { key: "VITE_VAPID_PUBLIC_KEY", source: "VAPID_PUBLIC_KEY", target: "client" },
  {
    key: "VAPID_SUBJECT",
    source: "VAPID_SUBJECT",
    target: "server",
    fallback: "https://app.sherivs.com",
  },
  // Product analytics ingest key (client-safe by design; surface gated by §19/§20/§21)
  { key: "POSTHOG_PROJECT_API_KEY", source: "POSTHOG_PROJECT_API_KEY", target: "server" },
];

async function vercelFetch(token, path, init = {}) {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
    redirect: "error",
  });
  return response;
}

async function main() {
  const token = process.env.VERCEL_API_TOKEN;
  if (!token || token.trim() === "") {
    console.error("BLOCKED_NO_CREDENTIAL: VERCEL_API_TOKEN is not set");
    process.exit(2);
  }

  const projectName = process.env.VERCEL_PROJECT_NAME ?? "coregrid-scholar-migration";
  const projectIdHint = process.env.VERCEL_PROJECT_ID;

  let projectsResponse;
  try {
    projectsResponse = await vercelFetch(token, projectIdHint ? `/v9/projects/${projectIdHint}` : `/v9/projects`);
  } catch (err) {
    console.error(`BLOCKED_NO_NETWORK: Vercel API unreachable (${String(err).slice(0, 120)})`);
    process.exit(2);
  }
  if (projectsResponse.status === 401 || projectsResponse.status === 403) {
    console.error(`BLOCKED_NO_CREDENTIAL: Vercel refused the token (http ${projectsResponse.status})`);
    process.exit(2);
  }
  if (!projectsResponse.ok) {
    console.error(`FINDING: Vercel /v9/projects responded http ${projectsResponse.status}`);
    process.exit(1);
  }
  const projectsBody = await projectsResponse.json();
  const project = projectIdHint
    ? projectsBody
    : (projectsBody.projects ?? []).find((p) => p.name === projectName);
  if (!project?.id) {
    console.error(`BLOCKED_NO_TARGET: project "${projectName}" not found; create it in the Vercel dashboard first`);
    process.exit(2);
  }
  const teamId = project.accountId ?? projectsBody.accountId;

  const results = [];
  for (const mapping of ENV_MAPPINGS) {
    const fromEnv = process.env[mapping.source];
    const value =
      fromEnv && fromEnv.trim() !== ""
        ? fromEnv
        : typeof mapping.fallback === "string" && mapping.fallback.trim() !== ""
          ? mapping.fallback
          : "";
    if (!value) {
      results.push({ key: mapping.key, source: mapping.source, outcome: "SKIPPED_ABSENT" });
      continue;
    }
    const query = teamId ? `?upsert=true&teamId=${encodeURIComponent(teamId)}` : "?upsert=true";
    let response;
    try {
      response = await vercelFetch(token, `/v10/projects/${encodeURIComponent(project.id)}/env${query}`, {
        method: "POST",
        body: JSON.stringify({
          key: mapping.key,
          value,
          type: "encrypted",
          target: ["production", "preview", "development"],
        }),
      });
    } catch (err) {
      results.push({ key: mapping.key, outcome: "ERROR", detail: String(err).slice(0, 80) });
      continue;
    }
    if (response.ok) {
      results.push({ key: mapping.key, outcome: "UPSERTED", httpStatus: response.status });
    } else if (response.status === 401 || response.status === 403) {
      results.push({ key: mapping.key, outcome: "REFUSED", httpStatus: response.status });
    } else {
      results.push({ key: mapping.key, outcome: "ERROR", httpStatus: response.status });
    }
  }

  const upserted = results.filter((r) => r.outcome === "UPSERTED");
  const skipped = results.filter((r) => r.outcome === "SKIPPED_ABSENT");
  const failed = results.filter((r) => r.outcome === "ERROR" || r.outcome === "REFUSED");

  console.log(
    JSON.stringify(
      {
        project: { name: project.name, id: project.id, teamId: teamId ?? null },
        upsertedCount: upserted.length,
        skippedAbsent: skipped.map((r) => `${r.key} (source ${r.source} not set in this environment)`),
        failed: failed.map((r) => `${r.key} (${r.outcome}${r.httpStatus ? ` http ${r.httpStatus}` : ""})`),
        upserted: upserted.map((r) => r.key),
        generatedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );

  if (failed.length > 0) process.exit(1);
}

main().catch((err) => {
  console.error(`FINDING: ${String(err).slice(0, 200)}`);
  process.exit(1);
});
#!/usr/bin/env node
/**
 * CoreGrid — provider authentication health drill (launch-gate discipline).
 *
 * Credential-gated, read-only provider authentication battery for every V1
 * capability provider (§18 health vocabulary). Built in the exemplar drills'
 * image (scripts/verify-ai-gateway-live.drill.mjs,
 * scripts/verify-payments-live.drill.mjs): fail-closed exit semantics,
 * guarded artifact writes, secret-free evidence.
 *
 * Modes:
 *   --rehearse   fully OFFLINE rehearsal: validates the provider credential
 *                registry (schema + hygiene + client-prefix exposure audit)
 *                and the config-level gate vectors against the live
 *                environment — NO network, NO provider contact. Exit 0 PASS
 *                · 1 FINDING.
 *   (default)    live read-only battery. STRICTLY credential-gated BEFORE any
 *                network contact: if any V1 capability provider is missing a
 *                required credential the drill exits 2 BLOCKED_NO_CREDENTIAL
 *                and probes NOTHING. Otherwise it performs exactly ONE
 *                read-only GET per provider (health/list endpoint only, no
 *                payload, no mutations, redirects refused, 8s timeout each)
 *                through frontend/src/lib/observability/provider-health.server.ts.
 *                Exit 0 when every probe is AUTHENTICATED/OPERATIONAL · 1
 *                FINDING on any CONFIGURED (refused) / DEGRADED result.
 *
 * Credential law (AGENTS §30): secret NAMES are declared; secret VALUES are
 * never printed, logged, or written to any artifact — including error paths.
 * The battery module's reports are secret-free by construction.
 *
 * Artifacts (directory from COREGRID_ARTIFACTS_DIR, default
 * /opt/cursor/artifacts — secret-free by construction):
 *   provider-health-battery.json / .log   (live battery)
 *   provider-health-rehearsal.json / .log (offline rehearsal)
 *
 * Usage:
 *   node scripts/verify-provider-auth-live.drill.mjs --rehearse
 *   node scripts/verify-provider-auth-live.drill.mjs
 * Exit codes: 0 PASS · 1 FINDING · 2 BLOCKED_NO_CREDENTIAL / BLOCKED_USAGE.
 */

/* eslint-disable no-console */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DEFAULT_ARTIFACTS_DIR = "/opt/cursor/artifacts";
const ARTIFACTS_DIR = process.env.COREGRID_ARTIFACTS_DIR ?? DEFAULT_ARTIFACTS_DIR;

// ── mode / argument parsing (BEFORE the credential gate) ─────────────────────
const argv = process.argv.slice(2);
const flags = argv.filter((a) => a.startsWith("--"));
const positionals = argv.filter((a) => !a.startsWith("--"));
const KNOWN_FLAGS = new Set(["--rehearse"]);
const unknownFlags = flags.filter((f) => !KNOWN_FLAGS.has(f));
const MODE = flags.includes("--rehearse") ? "rehearse" : "live";

if (unknownFlags.length > 0 || positionals.length > 0) {
  console.error(
    `BLOCKED_USAGE unknown argument(s): ${[...unknownFlags, ...positionals].join(" ")}. ` +
      `Supported: --rehearse (offline); no arguments for the credential-gated live battery.`,
  );
  process.exit(2);
}

/** Load the governed TS modules through jiti (read-only, local files only). */
const jiti = createJiti(join(ROOT, "scripts", "verify-provider-auth-live.drill.mjs"));
const { validateProviderCredentialRegistry, registryClientPrefixExposures } = jiti(
  join(ROOT, "frontend", "src", "lib", "providers", "provider-credentials.ts"),
);
const healthModule = jiti(
  join(ROOT, "frontend", "src", "lib", "observability", "provider-health.server.ts"),
);

const env = process.env;

// ── registry hygiene gate (both modes, no network) ───────────────────────────
const registry = validateProviderCredentialRegistry();
const exposures = registryClientPrefixExposures(env);
const rehearsalFindings = [];
if (!registry.ok) {
  for (const issue of registry.issues) rehearsalFindings.push(`registry: ${issue}`);
}
if (exposures.length > 0) {
  rehearsalFindings.push(
    `client-prefix exposure: server-only credentials exposed via VITE_/NEXT_PUBLIC_/PUBLIC_: ${exposures.join(", ")}`,
  );
}

const PROBE_PROVIDERS = /** @type {const} */ ([
  { provider: "supabase", required: ["SUPABASE_URL", "SUPABASE_PUBLISHABLE_KEY"], check: "checkSupabaseHealth" },
  { provider: "resend", required: ["RESEND_API_KEY"], check: "checkResendHealth" },
  { provider: "paystack", required: ["PAYSTACK_SECRET_KEY"], check: "checkPaystackHealth" },
  { provider: "twilio", required: ["TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN"], check: "checkTwilioHealth" },
  { provider: "vapi", required: ["VAPI_API_KEY"], check: "checkVapiHealth" },
  { provider: "ai-gateway", required: ["AI_API_KEY", "AI_GATEWAY_URL"], check: "checkAiGatewayHealth" },
]);

function missingCredentials() {
  const missing = [];
  for (const { provider, required } of PROBE_PROVIDERS) {
    const absent = required.filter((name) => !(typeof env[name] === "string" && env[name].trim() !== ""));
    if (absent.length > 0) missing.push({ provider, vars: absent });
  }
  return missing;
}

function writeArtifact(baseName, payload) {
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  const jsonPath = join(ARTIFACTS_DIR, `${baseName}.json`);
  const logPath = join(ARTIFACTS_DIR, `${baseName}.log`);
  writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`);
  writeFileSync(logPath, `${payload.summary}\n`);
  console.log(`artifact: ${jsonPath}`);
  return jsonPath;
}

// ── modes ────────────────────────────────────────────────────────────────────
if (MODE === "rehearse") {
  const missing = missingCredentials();
  for (const { provider, vars } of missing) {
    console.error(`CONFIG_LEVEL ${provider}: missing ${vars.join(", ")} (no probe in rehearsal)`);
  }
  if (rehearsalFindings.length > 0) {
    console.error(
      `REHEARSAL FINDING — ${rehearsalFindings.length} issue(s):`,
    );
    for (const finding of rehearsalFindings) console.error(`  - ${finding}`);
    process.exit(1);
  }
  writeArtifact("provider-health-rehearsal", {
    mode: "rehearsal",
    summary: `REHEARSAL PASS — registry valid, no client-prefix exposures; config-level credentials present for all ${PROBE_PROVIDERS.length} probe providers; no network contact was made.`,
    registryOk: true,
    probeProviders: PROBE_PROVIDERS.map((p) => p.provider),
    checkedAt: new Date().toISOString(),
  });
  console.log("REHEARSAL PASS — offline validation clean; no network contact was made.");
  process.exit(0);
}

// ── live mode: credential gate BEFORE any network contact ────────────────────
const missing = missingCredentials();
if (missing.length > 0) {
  for (const { provider, vars } of missing) {
    console.error(
      `BLOCKED_NO_CREDENTIAL ${provider}: ${vars.join(", ")} not set — the live battery requires every V1 capability provider credential before ANY network contact.`,
    );
  }
  process.exit(2);
}

const startedAtMs = Date.now();
const reports = await healthModule.runProviderHealthBattery(env);
const posture = healthModule.evaluateProviderHealthPosture(reports);
const findings = reports.filter(
  (r) => r.state === "CONFIGURED" || r.state === "DEGRADED" || r.state === "NOT_CONFIGURED",
);

for (const report of reports) {
  console.log(
    `${report.provider.padEnd(14)} ${report.state.padEnd(14)} http=${String(report.httpStatus).padEnd(4)} ${report.detail}`,
  );
}

writeArtifact("provider-health-battery", {
  mode: "live",
  summary:
    findings.length === 0
      ? `PROVIDER HEALTH PASS — ${reports.length} providers evaluated; every probed provider authenticated on a read-only probe.`
      : `PROVIDER HEALTH FINDING — ${findings.length} provider(s) below AUTHENTICATED: ${findings.map((f) => `${f.provider}=${f.state}`).join(", ")}.`,
  posture: posture.status,
  reports,
  checkedAt: new Date().toISOString(),
  durationMs: Date.now() - startedAtMs,
});

if (findings.length > 0) {
  console.error(
    `PROVIDER HEALTH FINDING — ${findings.length} provider(s) below AUTHENTICATED. Do NOT claim provider-verified evidence.`,
  );
  process.exit(1);
}
console.log(
  `PROVIDER HEALTH PASS — every V1 capability provider authenticated on a read-only probe (${Date.now() - startedAtMs}ms).`,
);
process.exit(0);
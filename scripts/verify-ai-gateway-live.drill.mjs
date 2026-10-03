#!/usr/bin/env node
/**
 * CoreGrid — H3 wave, team H3-041 (AI Live Drill Engineer), mission E-041
 * (Squad E — launch-gate drills, BLK-2, GOV-P63).
 *
 * Credential-gated governed end-to-end inference drill for the BLK-2 AI
 * gateway decision. Built in the exemplars' image (scripts/apply-canonical-
 * hardening.mjs, scripts/verify-rls-isolation-battery.mjs): fail-closed exit
 * semantics, guarded artifact writes, secret-free evidence.
 *
 * Modes:
 *   --plan      offline plan print (default-authorized, no credential read,
 *               no network, no artifacts): declares the governed invocation
 *               steps, the exit-code contract, and the credential gate BY
 *               NAME ONLY.
 *   (default)   live drill. STRICTLY credential-gated: without a usable
 *               AI_API_KEY it fails closed with BLOCKED_NO_CREDENTIAL
 *               (exit 2) BEFORE any network contact — no endpoint is
 *               resolved, no socket is opened, no artifact is written.
 *               With the credential it performs exactly ONE governed
 *               inference through the AI gateway path (AI_GATEWAY_URL, the
 *               OpenAI-compatible endpoint declared by
 *               frontend/src/lib/ai-gateway.server.ts createAiGatewayProvider):
 *               authenticate -> resolve context -> authorize -> validate ->
 *               execute -> audit -> return permitted data (§27 server-function
 *               discipline applied to model invocation).
 *
 * Governance honored:
 * - BLK-2: a missing or empty API key is an explicit block, never a live
 *   invocation attempt (same fail-closed decision the gateway itself makes).
 * - §20 (AI gateway): the drill never bypasses the gateway path — the only
 *   endpoint it contacts is the declared AI_GATEWAY_URL the gateway server
 *   itself is configured with. No other provider endpoint is ever touched.
 * - §19 (AI privacy/minimization): a fixed, non-personal, single-sentence
 *   drill prompt with a tiny token budget. No tenant data, no memory, no
 *   user content is ever sent to the provider.
 * - §21 (output trust): the completion text is UNTRUSTED output — only its
 *   sha256 digest is emitted, never the raw text.
 * - §25 (provider neutrality): the endpoint is operator-declared config; the
 *   drill is provider-neutral and hard-fails on non-https or credentialed URLs.
 * - §29/§30 + Part 29 (secret hygiene): the key value is never printed,
 *   logged, or written to any artifact; every emitted line and artifact field
 *   is additionally scrubbed against the live key as defense in depth
 *   (mirrors the gateway's scrubValue discipline).
 * - ONE governed inference: exactly one POST, one attempt, no transport
 *   retry (model invocations are billed, non-idempotent effects), bounded by
 *   a hard timeout. The drill never loops and never falls back.
 *
 * Usage:
 *   node scripts/verify-ai-gateway-live.drill.mjs --plan
 *   node scripts/verify-ai-gateway-live.drill.mjs
 *
 * Credential/configuration env vars (referenced BY NAME only — never values):
 *   AI_API_KEY              required. The BLK-2 provider key. Missing or empty
 *                           -> exit 2 before any side effect.
 *   AI_GATEWAY_URL          optional. Gateway base URL; default
 *                           https://api.openai.com/v1 (the same default as
 *                           createAiGatewayProvider). Must be https, must not
 *                           embed credentials.
 *   AI_DRILL_MODEL          required. The model id for the drill invocation.
 *                           Missing or empty -> exit 2 (BLOCKED_NO_CONFIGURATION).
 *   COREGRID_ARTIFACTS_DIR  optional evidence directory (default
 *                           /opt/cursor/artifacts).
 *
 * Exit codes: 0 PASS / PLAN_OK · 1 DRILL_FINDING · 2 BLOCKED_NO_CREDENTIAL /
 *             BLOCKED_NO_CONFIGURATION / BLOCKED_USAGE.
 */

/* eslint-disable no-console */

import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DEFAULT_ARTIFACTS_DIR = "/opt/cursor/artifacts";
const ARTIFACTS_DIR = process.env.COREGRID_ARTIFACTS_DIR ?? DEFAULT_ARTIFACTS_DIR;
const DEFAULT_GATEWAY_URL = "https://api.openai.com/v1";
/** Hard bound for the single governed attempt (mirrors the gateway policy's 60s budget). */
const DRILL_TIMEOUT_MS = 60_000;
/** Token budget: the drill asks for one short line, nothing more (§19 minimization). */
const DRILL_MAX_TOKENS = 16;
/** Declared drill identity — a control-plane drill, never a tenant workload. */
const DRILL_TENANT_REF = "control-plane/drill";
const DRILL_ACTOR_REF = "H3-041-ai-live-drill";
/** Declared purpose: the drill prompt is a fixed classification-style probe
 *  (one-word reply), drawn from the metering usage-ledger purpose vocabulary. */
const DRILL_PURPOSE = "classification";
const DRILL_PROMPT = "Reply with exactly the single word READY and nothing else.";
const RUNBOOK_PATH = "docs/runbooks/ai-gateway-live-drill.md";

// ── mode / argument parsing (BEFORE the credential gate) ─────────────────────
const argv = process.argv.slice(2);
const flags = argv.filter((a) => a.startsWith("--"));
const positionals = argv.filter((a) => !a.startsWith("--"));
const KNOWN_FLAGS = new Set(["--plan"]);
const unknownFlags = flags.filter((f) => !KNOWN_FLAGS.has(f));
const MODE = flags.includes("--plan") ? "plan" : "live";

if (unknownFlags.length > 0 || positionals.length > 0) {
  console.error(
    `BLOCKED_USAGE unknown argument(s): ${[...unknownFlags, ...positionals].join(" ")}. ` +
      `Supported: --plan (offline plan print); no arguments for the credential-gated live drill.`,
  );
  process.exit(2);
}

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/**
 * Defense in depth (Part 29): scrub the resolved key material out of any
 * string value before it can reach a log line or an artifact, even if a
 * provider or a transport error embedded it somewhere unexpected.
 */
function scrubValue(value, secret, depth = 0) {
  if (depth > 8) return "[truncated]";
  if (typeof value === "string") {
    if (secret.length > 0 && value.includes(secret)) {
      return value.split(secret).join("[REDACTED]");
    }
    return value;
  }
  if (Array.isArray(value)) return value.map((item) => scrubValue(item, secret, depth + 1));
  if (value instanceof Error) return scrubValue(String(value), secret, depth + 1);
  if (value !== null && typeof value === "object") {
    const out = {};
    for (const [field, member] of Object.entries(value)) {
      out[field] = scrubValue(member, secret, depth + 1);
    }
    return out;
  }
  return value;
}

/** Guarded artifact write: evidence must never be lost silently, and never crash the run. */
function writeArtifact(name, content, logLine) {
  try {
    mkdirSync(ARTIFACTS_DIR, { recursive: true });
    writeFileSync(join(ARTIFACTS_DIR, name), content);
    logLine(`artifact: ${join(ARTIFACTS_DIR, name)}`);
    return true;
  } catch (err) {
    logLine(`WARN artifact write failed (${join(ARTIFACTS_DIR, name)}): ${err.message}`);
    return false;
  }
}

// ── plan mode: fully offline, credential-free, artifact-free ─────────────────
if (MODE === "plan") {
  console.log("COREGRID AI GATEWAY LIVE DRILL — PLAN (offline; no credential is read, no network contact is made)");
  console.log("mode=plan databaseContact=false networkContact=false credentialRead=false artifactsWritten=false");
  console.log(`declared endpoint: AI_GATEWAY_URL (default ${DEFAULT_GATEWAY_URL}) + /chat/completions`);
  console.log(`credential gate: AI_API_KEY (presence required at drill time; absence -> exit 2 BLOCKED_NO_CREDENTIAL before any network contact)`);
  console.log(`drill model: AI_DRILL_MODEL (required; absence -> exit 2 BLOCKED_NO_CONFIGURATION before any network contact)`);
  console.log("governed inference steps (§27 server-function discipline):");
  console.log("  1. authenticate   — AI_API_KEY gate (fail closed, exit 2, before any contact)");
  console.log("  2. resolve context — fixed drill identity: tenant=control-plane/drill actor=H3-041-ai-live-drill purpose=classification");
  console.log(`  3. authorize       — operator-run drill under ${RUNBOOK_PATH}`);
  console.log("  4. validate        — https-only endpoint, no embedded credentials, declared model present");
  console.log(`  5. execute         — ONE POST /chat/completions, fixed non-personal prompt, max_tokens=${DRILL_MAX_TOKENS}, one attempt, ${DRILL_TIMEOUT_MS}ms timeout, no retry, no fallback`);
  console.log("  6. audit           — evidence artifact (usage counts, durations, digests; no key material, no raw completion text)");
  console.log("  7. return permitted data — token usage + output sha256 digest only (§21: completion text is untrusted)");
  console.log("exit codes: 0 PASS/PLAN_OK · 1 DRILL_FINDING · 2 BLOCKED_NO_CREDENTIAL / BLOCKED_NO_CONFIGURATION / BLOCKED_USAGE");
  console.log("STATUS=PLAN_OK — plan is complete; the live drill requires the approved operator window and the provisioned credential.");
  process.exit(0);
}

// ── live mode: credential gate BEFORE anything else ──────────────────────────
// BLK-2 fail-closed: no endpoint is resolved, no fetch is issued, no artifact
// is written unless a usable credential is present. Empty/whitespace keys are
// NOT usable credentials (the gateway trims before the same check).
const apiKey = (process.env.AI_API_KEY ?? "").trim();
if (apiKey.length === 0) {
  console.error(
    "BLOCKED_NO_CREDENTIAL AI_API_KEY is not set (or empty). No network contact was made; no inference was attempted.",
  );
  process.exit(2);
}

// Configuration gate — still BEFORE any network contact.
const model = (process.env.AI_DRILL_MODEL ?? "").trim();
if (model.length === 0) {
  console.error(
    "BLOCKED_NO_CONFIGURATION AI_DRILL_MODEL is not set (or empty). No network contact was made; no inference was attempted.",
  );
  process.exit(2);
}

const baseUrlRaw = (process.env.AI_GATEWAY_URL ?? DEFAULT_GATEWAY_URL).trim().replace(/\/+$/, "");
let gatewayUrl;
try {
  gatewayUrl = new URL(baseUrlRaw);
} catch {
  console.error(
    `BLOCKED_NO_CONFIGURATION AI_GATEWAY_URL is not a parseable URL. No network contact was made; no inference was attempted.`,
  );
  process.exit(2);
}
if (gatewayUrl.protocol !== "https:") {
  console.error(
    "BLOCKED_NO_CONFIGURATION AI_GATEWAY_URL must be https. No network contact was made; no inference was attempted.",
  );
  process.exit(2);
}
if (gatewayUrl.username.length > 0 || gatewayUrl.password.length > 0) {
  console.error(
    "BLOCKED_NO_CONFIGURATION AI_GATEWAY_URL must not embed credentials. No network contact was made; no inference was attempted.",
  );
  process.exit(2);
}
const endpoint = `${baseUrlRaw}/chat/completions`;

// ── governed inference: exactly ONE attempt ──────────────────────────────────
const log = [];
const startedAtIso = new Date().toISOString();
const logLine = (line) => {
  const scrubbed = scrubValue(line, apiKey);
  process.stdout.write(scrubbed + "\n");
  log.push(scrubbed);
};
const errorLine = (line) => {
  process.stderr.write(scrubValue(line, apiKey) + "\n");
};

logLine(`COREGRID AI GATEWAY LIVE DRILL (H3-041, BLK-2) — one governed inference through the declared gateway path.`);
logLine(`mode=live endpoint=${gatewayUrl.host}${gatewayUrl.pathname}/chat/completions model=${model} purpose=${DRILL_PURPOSE} tenantRef=${DRILL_TENANT_REF} actorRef=${DRILL_ACTOR_REF}`);
logLine(`authorizedBy=${RUNBOOK_PATH} invocationBudget=1 timeoutMs=${DRILL_TIMEOUT_MS} maxTokens=${DRILL_MAX_TOKENS}`);

const record = {
  mission: "E-041 — AI gateway live drill (H3-041, BLK-2, GOV-P63)",
  mode: "live",
  executedAt: startedAtIso,
  endpointHost: gatewayUrl.host,
  endpointPath: `${gatewayUrl.pathname}/chat/completions`,
  model,
  provider: "declared-gateway-path",
  purpose: DRILL_PURPOSE,
  tenantRef: DRILL_TENANT_REF,
  actorRef: DRILL_ACTOR_REF,
  promptChars: DRILL_PROMPT.length,
  promptDigest: sha256(DRILL_PROMPT),
  invocationBudget: 1,
  timeoutMs: DRILL_TIMEOUT_MS,
  networkContact: true,
  invocationCount: 0,
  decision: null,
  usage: { tokensIn: null, tokensOut: null },
  durationMs: null,
  outputDigest: null,
  findings: 0,
  finding: null,
  completedAt: null,
};

let findings = 0;
let findingCode = null;
let findingReason = null;

const invokeStartMs = Date.now();
let response;
try {
  response = await fetch(endpoint, {
    method: "POST",
    headers: {
      // The credential is forwarded to the gateway path exactly like the
      // gateway server forwards it to the provider factory — never logged.
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: DRILL_PROMPT }],
      max_tokens: DRILL_MAX_TOKENS,
      temperature: 0,
    }),
    signal: AbortSignal.timeout(DRILL_TIMEOUT_MS),
  });
} catch (err) {
  const reason =
    err?.name === "TimeoutError" || err?.name === "AbortError"
      ? `the single governed attempt exceeded the ${DRILL_TIMEOUT_MS}ms hard timeout`
      : `transport failure at the adapter boundary: ${String(err)}`;
  findings += 1;
  findingCode = err?.name === "TimeoutError" || err?.name === "AbortError" ? "timeout" : "provider_failed";
  findingReason = reason;
  record.completedAt = new Date().toISOString();
  record.durationMs = Date.now() - invokeStartMs;
  record.decision = "deny";
  record.findings = findings;
  record.finding = { code: findingCode, reason: scrubValue(reason, apiKey).slice(0, 300) };
  logLine(`FINDING provider attempt failed (code=${findingCode}): ${scrubValue(reason, apiKey).slice(0, 300)}`);
  writeArtifact("ai-gateway-live-drill.json", JSON.stringify(record, null, 2) + "\n", logLine);
  writeArtifact("ai-gateway-live-drill.log", log.join("\n") + "\n", () => {});
  errorLine(`STATUS=DRILL_FINDINGS (${findings}) — the gateway path did not complete one governed inference. Preserve the artifacts; do not claim the BLK-2 gate proven.`);
  process.exit(1);
}

record.invocationCount = 1;
record.durationMs = Date.now() - invokeStartMs;

if (!response.ok) {
  // Never print raw provider bodies or headers; truncate and scrub defensively.
  let bodyText = "";
  try {
    bodyText = (await response.text()).slice(0, 300);
  } catch {
    bodyText = "[unreadable body]";
  }
  findings += 1;
  findingCode = "provider_http_error";
  findingReason = `provider returned HTTP ${response.status}: ${scrubValue(bodyText, apiKey)}`;
  record.decision = "deny";
  record.findings = findings;
  record.finding = { code: findingCode, reason: findingReason };
  logLine(`FINDING provider returned HTTP ${response.status} — the drill treats this as a FINDING, never a retry.`);
} else {
  let body = null;
  try {
    body = await response.json();
  } catch {
    findings += 1;
    findingCode = "malformed_response";
    findingReason = "provider returned 200 with an unparseable JSON body";
  }

  if (body !== null) {
    const choice = body?.choices?.[0];
    const content = typeof choice?.message?.content === "string" ? choice.message.content : null;
    const tokensIn = typeof body?.usage?.prompt_tokens === "number" ? body.usage.prompt_tokens : null;
    const tokensOut = typeof body?.usage?.completion_tokens === "number" ? body.usage.completion_tokens : null;

    if (content === null) {
      findings += 1;
      findingCode = "malformed_response";
      findingReason = "200 response carried no completion message content (choices[0].message.content missing)";
    }
    if (tokensIn === null || tokensOut === null) {
      findings += 1;
      findingCode = findingCode ?? "incomplete_metering";
      findingReason = findingReason ?? "200 response carried no usage counts (usage.prompt_tokens/completion_tokens missing) — metering evidence is incomplete";
    }

    if (findings === 0) {
      record.decision = "allow";
      record.usage = { tokensIn, tokensOut };
      // §21 output trust: the raw completion text never leaves the drill —
      // only its digest proves that a real, attributable output came back.
      record.outputDigest = sha256(content);
      logLine(`PASS gateway path completed ONE governed inference (invocationCount=1, no retry).`);
      logLine(`PASS usage tokensIn=${tokensIn} tokensOut=${tokensOut} durationMs=${record.durationMs} outputDigest=${record.outputDigest.slice(0, 16)}… (raw completion text withheld — untrusted output)`);
    } else {
      record.decision = "deny";
      record.findings = findings;
      record.finding = { code: findingCode, reason: findingReason };
      logLine(`FINDING ${findingCode}: ${findingReason}`);
    }
  } else {
    record.decision = "deny";
    record.findings = findings;
    record.finding = { code: findingCode, reason: findingReason };
    logLine(`FINDING ${findingCode}: ${findingReason}`);
  }
}

record.completedAt = new Date().toISOString();
writeArtifact("ai-gateway-live-drill.json", JSON.stringify(record, null, 2) + "\n", logLine);
writeArtifact("ai-gateway-live-drill.log", log.join("\n") + "\n", () => {});

if (findings > 0) {
  errorLine(
    `STATUS=DRILL_FINDINGS (${findings}) — the gateway path did not complete one clean governed inference. Preserve the artifacts; do not claim the BLK-2 gate proven.`,
  );
  process.exit(1);
}

logLine("STATUS=DRILL_PASS — one governed inference completed through the declared AI gateway path: authenticated, authorized, validated, executed once, audited, minimal data emitted.");
process.exit(0);
#!/usr/bin/env node
/**
 * CoreGrid — H3 wave, team H3-044 (Communication Probe Engineer), mission
 * E-044 (Squad E — Launch-gate drills, BLK-5). Credential-gated communication
 * provider probe, built in the drill exemplars' image (mission A-001's
 * scripts/verify-recovery-drill.mjs and scripts/apply-canonical-hardening.mjs;
 * exit-2 semantics per scripts/verify-rls-isolation-battery.mjs).
 *
 * Modes:
 *   --rehearse  offline rehearsal (default-authorized; NO credential, NO
 *               network, NO database): validates the declared probe plan
 *               invariants, the embedded communication provider-catalogue
 *               facts (credential-reference hygiene, fail-closed lifecycle),
 *               the credential-hygiene shape vectors, and the send-path-
 *               absence invariant. Exit 0 PASS · 1 FINDING.
 *   (default)   live provider handshake. STRICTLY credential-gated, in this
 *               exact order, ALL gates before any network contact:
 *                 1. unknown arguments        → exit 2 BLOCKED_USAGE;
 *                 2. provider credential gate → exit 2 BLOCKED_NO_CREDENTIAL
 *                    (COREGRID_COMMUNICATION_PROVIDER_CREDENTIAL absent) —
 *                    BEFORE any network contact, nothing probed;
 *                 3. offline rehearsal must pass → exit 1 on any finding,
 *                    still with zero network contact;
 *                 4. sandbox gate → exit 2 BLOCKED_NO_SANDBOX_TARGET when the
 *                    operator-supplied sandbox verification target
 *                    (COREGRID_COMMUNICATION_SANDBOX_TARGET) is absent. The
 *                    drill REQUIRES an operator-supplied sandbox target by
 *                    design: without one there is NO authorized destination
 *                    and no network contact is ever made;
 *                 5. sandbox validation → exit 2 BLOCKED_SANDBOX_TARGET when
 *                    the target is not a valid https:// URL (cleartext and
 *                    unparseable targets are refused before any contact);
 *                 6. exactly ONE read-only handshake: a GET (verification/
 *                    handshake path only, no message payload, no body read or
 *                    written, redirects refused, 8s timeout) against the
 *                    operator-supplied sandbox target, carrying the provider
 *                    credential as a bearer header. Exit 0 on 2xx · 1 on any
 *                    other outcome.
 *
 * Provider path, read-only consumption: the drill consumes the existing
 * communication/notification server modules (frontend/src/lib/communication-
 * providers.ts, frontend/src/lib/notifications/*) through their DATA contracts
 * only — the embedded catalogue mirror below is cross-checked against the real
 * modules by tests/unit/h3-044-communication-drill.test.ts (read-only import).
 * NO send path is invoked and none is exercisable: every external provider in
 * the catalogue is DISCOVERED (no credential provisioned, routing refuses) and
 * the notification pipeline's provider path is the record-only stub adapter,
 * which is NOT_FOR_LIVE_USE and can never deliver. SEND NOTHING REAL: the only
 * network action this drill can ever take is the sandbox verification
 * handshake above, which carries no message content.
 *
 * Credential law: secret NAMES are declared (COREGRID_COMMUNICATION_PROVIDER_
 * CREDENTIAL, COREGRID_COMMUNICATION_SANDBOX_TARGET); secret VALUES are never
 * printed, logged, or written to any artifact — including in error paths. The
 * sandbox target is logged as host only (never the full URL, which could carry
 * embedded credentials). No eval, no dynamic code, no new dependencies.
 *
 * Artifacts directory: COREGRID_ARTIFACTS_DIR (default /opt/cursor/artifacts).
 *
 * Usage:
 *   node scripts/verify-communication-live.drill.mjs --rehearse [provider-id]
 *   node scripts/verify-communication-live.drill.mjs [provider-id]
 * Exit codes: 0 PASS · 1 FINDING · 2 BLOCKED_NO_CREDENTIAL /
 *             BLOCKED_NO_SANDBOX_TARGET / BLOCKED_SANDBOX_TARGET /
 *             BLOCKED_USAGE.
 */

/* eslint-disable no-console */

import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DEFAULT_ARTIFACTS_DIR = "/opt/cursor/artifacts";
const ARTIFACTS_DIR = process.env.COREGRID_ARTIFACTS_DIR ?? DEFAULT_ARTIFACTS_DIR;

/** Secret NAMES only — values are never referenced in any output. */
const CREDENTIAL_ENV_NAME = "COREGRID_COMMUNICATION_PROVIDER_CREDENTIAL";
const SANDBOX_TARGET_ENV_NAME = "COREGRID_COMMUNICATION_SANDBOX_TARGET";
const HANDSHAKE_TIMEOUT_MS = 8_000; // parity with DEFAULT_EMAIL_FAILURE_POLICY timeoutMs

// ── mode / argument parsing ──────────────────────────────────────────────────
const argv = process.argv.slice(2);
const flags = argv.filter((a) => a.startsWith("--"));
const positionals = argv.filter((a) => !a.startsWith("--"));
const KNOWN_FLAGS = new Set(["--rehearse"]);
const unknownFlags = flags.filter((f) => !KNOWN_FLAGS.has(f));
const MODE = flags.includes("--rehearse") ? "rehearse" : "live";
const providerId = positionals[0] ?? null;

if (unknownFlags.length > 0 || positionals.length > 1) {
  console.error(
    `BLOCKED_USAGE unknown argument(s): ${[...unknownFlags, ...positionals.slice(1)].join(" ")}. ` +
      `Supported: [provider-id] with optional --rehearse.`,
  );
  process.exit(2);
}

// ── credential gate (live mode, BEFORE any other work and BEFORE any network) ─
/**
 * The credential is read exactly once, here, and only its PRESENCE and this
 * variable are ever used downstream. Rehearsal is deliberately credential-
 * free (offline) and ignores the variable entirely.
 */
const credential = process.env[CREDENTIAL_ENV_NAME];
if (MODE !== "rehearse" && !credential) {
  console.error(
    `BLOCKED_NO_CREDENTIAL ${CREDENTIAL_ENV_NAME} is not set. Nothing was probed and no network contact was made.`,
  );
  process.exit(2);
}

// ── embedded contracts (self-contained; sibling TS modules are not imported) ─
/** One declared step of the communication probe plan. */
const ProbeStepSchema = z.strictObject({
  id: z.string().min(1),
  kind: z.enum([
    "catalogue-audit",
    "credential-hygiene",
    "lifecycle-fail-closed",
    "send-path-absence",
    "sandbox-handshake",
    "evidence",
  ]),
  summary: z.string().min(1),
  /** A probe never mutates anything: destructive steps are unrepresentable. */
  destructive: z.literal(false),
  /** The ONLY step permitted to touch the network is the sandbox handshake. */
  network: z.boolean(),
  requiresCredential: z.boolean(),
  requiresSandboxTarget: z.boolean(),
  /** Declared HTTP method of the network step; must be GET (read-only). */
  method: z.enum(["GET"]),
  /** The network step must declare it carries no message payload. */
  noPayload: z.boolean(),
});

const ProbePlanSchema = z.array(ProbeStepSchema).min(1);

/** Embedded mirror of one provider-catalogue adapter (facts only). */
const CatalogueFactSchema = z.strictObject({
  id: z.string().min(1),
  channels: z.array(z.string().min(1)).min(1),
  health: z.enum([
    "DISCOVERED",
    "CONFIGURED",
    "VALIDATED",
    "ACTIVE",
    "DEGRADED",
    "SUSPENDED",
    "RETIRED",
  ]),
  credentialReference: z.string().min(1),
});

const CatalogueFactsSchema = z.array(CatalogueFactSchema).min(1);

// ── declared probe plan (single source of truth for this drill) ──────────────
/** @type {readonly z.infer<typeof ProbeStepSchema>[]} */
const PROBE_PLAN = [
  {
    id: "catalogue-audit",
    kind: "catalogue-audit",
    summary:
      "audit the embedded provider-catalogue facts: unique ids, declared channels, credential-reference hygiene",
    destructive: false,
    network: false,
    requiresCredential: false,
    requiresSandboxTarget: false,
    method: "GET",
    noPayload: true,
  },
  {
    id: "credential-hygiene",
    kind: "credential-hygiene",
    summary:
      "prove the credential-reference hygiene rules fail closed against raw-key-shaped, scheme-less and empty references",
    destructive: false,
    network: false,
    requiresCredential: false,
    requiresSandboxTarget: false,
    method: "GET",
    noPayload: true,
  },
  {
    id: "lifecycle-fail-closed",
    kind: "lifecycle-fail-closed",
    summary:
      "prove every external provider is DISCOVERED and unusable (no credential provisioned, routing refuses) — the reason this drill is credential-gated",
    destructive: false,
    network: false,
    requiresCredential: false,
    requiresSandboxTarget: false,
    method: "GET",
    noPayload: true,
  },
  {
    id: "send-path-absence",
    kind: "send-path-absence",
    summary:
      "prove the probe plan contains no send-capable step: the only network step is the sandbox verification handshake (GET, no payload)",
    destructive: false,
    network: false,
    requiresCredential: false,
    requiresSandboxTarget: false,
    method: "GET",
    noPayload: true,
  },
  {
    id: "sandbox-handshake",
    kind: "sandbox-handshake",
    summary:
      "live: ONE read-only verification handshake (GET, no message payload) against the operator-supplied sandbox target — the only network contact this drill can ever make",
    destructive: false,
    network: true,
    requiresCredential: true,
    requiresSandboxTarget: true,
    method: "GET",
    noPayload: true,
  },
  {
    id: "evidence",
    kind: "evidence",
    summary: "write the drill record and transcript log (secret names only, never values)",
    destructive: false,
    network: false,
    requiresCredential: false,
    requiresSandboxTarget: false,
    method: "GET",
    noPayload: true,
  },
];

/**
 * Embedded mirror of the Phase-10 provider adapter catalogue
 * (frontend/src/lib/communication-providers.ts → PROVIDER_CATALOGUE): id,
 * channels, lifecycle health, and the credential REFERENCE (a pointer the
 * secret manager resolves — never a secret value). The unit suite deep-
 * cross-checks this mirror against the real module read-only.
 * @type {readonly z.infer<typeof CatalogueFactsSchema>}
 */
const CATALOGUE_FACTS = [
  { id: "twilio", channels: ["voice", "sms", "whatsapp"], health: "DISCOVERED", credentialReference: "secret://coregrid/communication/twilio" },
  { id: "africas-talking", channels: ["voice", "sms", "whatsapp"], health: "DISCOVERED", credentialReference: "secret://coregrid/communication/africas-talking" },
  { id: "vonage", channels: ["voice", "sms"], health: "DISCOVERED", credentialReference: "secret://coregrid/communication/vonage" },
  { id: "telnyx", channels: ["voice", "sms"], health: "DISCOVERED", credentialReference: "secret://coregrid/communication/telnyx" },
  { id: "plivo", channels: ["voice", "sms"], health: "DISCOVERED", credentialReference: "secret://coregrid/communication/plivo" },
  { id: "messagebird", channels: ["sms", "whatsapp", "voice"], health: "DISCOVERED", credentialReference: "secret://coregrid/communication/messagebird" },
  { id: "exotel", channels: ["voice", "sms"], health: "DISCOVERED", credentialReference: "secret://coregrid/communication/exotel" },
  { id: "meta-whatsapp", channels: ["whatsapp", "status"], health: "DISCOVERED", credentialReference: "secret://coregrid/communication/meta-whatsapp" },
  { id: "smtp-relay", channels: ["email"], health: "DISCOVERED", credentialReference: "secret://coregrid/communication/smtp-relay" },
  { id: "sendgrid", channels: ["email"], health: "DISCOVERED", credentialReference: "secret://coregrid/communication/sendgrid" },
  { id: "postmark", channels: ["email"], health: "DISCOVERED", credentialReference: "secret://coregrid/communication/postmark" },
  { id: "amazon-ses", channels: ["email"], health: "DISCOVERED", credentialReference: "secret://coregrid/communication/amazon-ses" },
  { id: "fcm", channels: ["push"], health: "DISCOVERED", credentialReference: "secret://coregrid/communication/fcm" },
  { id: "apns", channels: ["push"], health: "DISCOVERED", credentialReference: "secret://coregrid/communication/apns" },
  { id: "web-push", channels: ["push"], health: "DISCOVERED", credentialReference: "secret://coregrid/communication/web-push" },
  { id: "google-meet", channels: ["meeting"], health: "DISCOVERED", credentialReference: "secret://coregrid/communication/google-workspace" },
  { id: "zoom", channels: ["meeting"], health: "DISCOVERED", credentialReference: "secret://coregrid/communication/zoom" },
  { id: "meta-social", channels: ["social", "status"], health: "DISCOVERED", credentialReference: "secret://coregrid/communication/meta-social" },
  { id: "x-social", channels: ["social", "status"], health: "DISCOVERED", credentialReference: "secret://coregrid/communication/x-social" },
  { id: "linkedin-social", channels: ["social"], health: "DISCOVERED", credentialReference: "secret://coregrid/communication/linkedin-social" },
  { id: "platform-presence", channels: ["presence", "in_app"], health: "ACTIVE", credentialReference: "internal://coregrid/presence" },
];

/**
 * The one provider whose credential the live handshake may carry, when the
 * operator names a provider id. Must be a declared catalogue provider.
 * @param {string | null} id
 * @returns {z.infer<typeof CatalogueFactSchema> | null}
 */
function declaredProvider(id) {
  if (id === null) return null;
  return CATALOGUE_FACTS.find((p) => p.id === id) ?? null;
}

// ── reporting helpers ────────────────────────────────────────────────────────
/** @type {string[]} */
const log = [];
const reportLine = (line) => {
  log.push(line);
  process.stdout.write(line + "\n");
};

/**
 * Guarded artifact write: an unwritable artifacts directory degrades to a
 * warning, never silently loses evidence or crashes the run.
 */
function writeArtifact(name, content) {
  try {
    mkdirSync(ARTIFACTS_DIR, { recursive: true });
    writeFileSync(join(ARTIFACTS_DIR, name), content);
    reportLine(`artifact: ${ARTIFACTS_DIR}/${name}`);
    return true;
  } catch (err) {
    reportLine(`WARN artifact write failed (${ARTIFACTS_DIR}/${name}): ${err.message}`);
    return false;
  }
}

// ── plan validation (pure; offline) ──────────────────────────────────────────
/**
 * @param {readonly z.infer<typeof ProbeStepSchema>[]} plan
 * @returns {string[]} invariant findings (empty = the plan holds)
 */
function validatePlan(plan) {
  /** @type {string[]} */
  const findings = [];
  const shape = ProbePlanSchema.safeParse(plan);
  if (!shape.success) {
    findings.push(
      `plan shape invalid: ${shape.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
    return findings;
  }

  const ids = plan.map((s) => s.id);
  if (new Set(ids).size !== ids.length) findings.push("plan invariant violated: duplicate step ids");
  if (plan.some((s) => s.destructive)) findings.push("plan invariant violated: a probe step is destructive");
  if (plan.some((s) => s.network && s.kind !== "sandbox-handshake")) {
    findings.push("plan invariant violated: a non-handshake step declares network contact (send nothing real)");
  }

  const networkSteps = plan.filter((s) => s.network);
  if (networkSteps.length !== 1) {
    findings.push(`plan invariant violated: exactly one network step is allowed, found ${networkSteps.length}`);
  } else {
    const handshake = networkSteps[0];
    if (handshake.kind !== "sandbox-handshake") {
      findings.push("plan invariant violated: the network step must be the sandbox-handshake");
    }
    if (!(handshake.requiresCredential && handshake.requiresSandboxTarget)) {
      findings.push("plan invariant violated: the network step must require credential AND operator sandbox target");
    }
    if (handshake.method !== "GET" || !handshake.noPayload) {
      findings.push("plan invariant violated: the network step must be a read-only GET with no message payload");
    }
  }

  const credentialSteps = plan.filter((s) => s.requiresCredential);
  if (credentialSteps.length !== 1 || credentialSteps[0].id !== "sandbox-handshake") {
    findings.push("plan invariant violated: only the sandbox-handshake step may require a credential");
  }
  return findings;
}

// ── catalogue-facts validation (pure; offline) ───────────────────────────────
const CREDENTIAL_SCHEME = /^(secret|vault|kms|env|internal):\/\//;
/** Shape of raw provider material — a reference that matches is refused. */
const RAW_CREDENTIAL_SHAPE = /(sk_live_|sk_test_|SG\.[A-Za-z0-9_-]{10,}|AKIA[0-9A-Z]{16}|AC[0-9a-f]{32})/;

/**
 * Mirrors assertCredentialReference from communication-providers.ts: a
 * reference must use an approved scheme and must never look like raw key
 * material.
 * @param {string} reference
 * @returns {string | null} refusal reason, or null when the reference is clean
 */
function credentialReferenceFinding(reference) {
  if (reference.trim() === "") return "credential reference is empty";
  if (!CREDENTIAL_SCHEME.test(reference)) {
    return "credential reference must use a scheme (secret://, vault://, kms://, env://, internal://)";
  }
  if (RAW_CREDENTIAL_SHAPE.test(reference)) {
    return "credential reference looks like raw provider material";
  }
  return null;
}

/**
 * @param {readonly z.infer<typeof CatalogueFactsSchema>[]} facts
 * @returns {string[]}
 */
function validateCatalogueFacts(facts) {
  /** @type {string[]} */
  const findings = [];
  const shape = CatalogueFactsSchema.safeParse(facts);
  if (!shape.success) {
    findings.push(
      `catalogue facts shape invalid: ${shape.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ")}`,
    );
    return findings;
  }

  const ids = facts.map((p) => p.id);
  if (new Set(ids).size !== ids.length) findings.push("catalogue invariant violated: duplicate provider ids");
  for (const p of facts) {
    if (p.channels.length === 0) findings.push(`catalogue invariant violated: ${p.id} declares no channel`);
    const refFinding = credentialReferenceFinding(p.credentialReference);
    if (refFinding) findings.push(`catalogue invariant violated: ${p.id}: ${refFinding}`);
  }
  return findings;
}

// ── credential-hygiene shape vectors (pure; offline; fail-closed) ────────────
/**
 * Known-good and known-bad credential-reference vectors so the hygiene rules
 * are exercised offline. Raw-material shapes are composed at runtime from
 * fragments so no key-shaped literal ever lands in the repository.
 * @returns {{ failures: number }}
 */
function exerciseCredentialHygieneVectors() {
  const fragments = ["sk", "_live_", "t", "o", "k", "e", "n"];
  const rawShaped = fragments.join("") + "v".repeat(24);
  /** @type {[string, string, boolean][]} — [name, reference, mustBeAccepted] */
  const vectors = [
    ["scheme-clean", "secret://coregrid/communication/probe-vector", true],
    ["internal-scheme", "internal://coregrid/presence", true],
    ["raw-material-shaped", rawShaped, false],
    ["no-scheme", "coregrid/communication/probe-vector", false],
    ["empty", "   ", false],
  ];
  let failures = 0;
  for (const [name, reference, mustBeAccepted] of vectors) {
    const finding = credentialReferenceFinding(reference);
    if (mustBeAccepted && finding !== null) {
      reportLine(`FINDING hygiene-vector:${name} was REJECTED (${finding}) — the hygiene rule failed open.`);
      failures += 1;
    } else if (!mustBeAccepted && finding === null) {
      reportLine(`FINDING hygiene-vector:${name} was ACCEPTED — the hygiene rule failed closed.`);
      failures += 1;
    } else {
      reportLine(`PASS hygiene-vector:${name} — ${mustBeAccepted ? "accepted" : "refused"} as designed.`);
    }
  }
  return { failures };
}

// ── offline rehearsal ────────────────────────────────────────────────────────
/**
 * Runs the full offline rehearsal: plan invariants, catalogue-facts audit,
 * credential-hygiene vectors, and the fail-closed lifecycle proof. No network,
 * no database, no credential.
 * @returns {{ findings: number, planSteps: number, providersAudited: number }}
 */
function runRehearsal() {
  reportLine("rehearsal: zero network, zero database, zero credential — offline contract validation only.");
  let findings = 0;

  reportLine(`plan: ${PROBE_PLAN.length} declared probe steps.`);
  for (const step of PROBE_PLAN) {
    reportLine(
      `  step:${step.id} kind=${step.kind} network=${step.network}` +
        ` requiresCredential=${step.requiresCredential} requiresSandboxTarget=${step.requiresSandboxTarget}` +
        ` method=${step.method} noPayload=${step.noPayload}`,
    );
  }
  const planFindings = validatePlan(PROBE_PLAN);
  for (const f of planFindings) reportLine(`FINDING ${f}`);
  findings += planFindings.length;

  reportLine(`catalogue: ${CATALOGUE_FACTS.length} embedded provider facts (mirror of the Phase-10 adapter registry).`);
  for (const p of CATALOGUE_FACTS) {
    reportLine(`  provider:${p.id} health=${p.health} channels=${p.channels.join("+")} reference-scheme=${p.credentialReference.split("://")[0]}://`);
  }
  const catalogueFindings = validateCatalogueFacts(CATALOGUE_FACTS);
  for (const f of catalogueFindings) reportLine(`FINDING ${f}`);
  findings += catalogueFindings.length;

  reportLine("hygiene: exercising the credential-reference rules against shape vectors.");
  const vectorResult = exerciseCredentialHygieneVectors();
  findings += vectorResult.failures;

  reportLine("lifecycle: fail-closed proof — every external provider is DISCOVERED (unusable); only the internal platform channel is ACTIVE.");
  const external = CATALOGUE_FACTS.filter((p) => p.id !== "platform-presence");
  const externalUsable = external.filter((p) => p.health === "ACTIVE");
  if (externalUsable.length > 0) {
    for (const p of externalUsable) {
      reportLine(`FINDING external provider ${p.id} is ACTIVE — a live path exists without recorded authorization.`);
      findings += 1;
    }
  } else {
    reportLine(
      `PASS lifecycle fail-closed: ${external.length}/${external.length} external providers DISCOVERED — routing refuses, so the live path is unreachable without an operator-issued credential.`,
    );
  }

  reportLine(
    "send-path-absence: SEND NOTHING REAL — no send-capable step exists in this plan; the notification server modules' provider path is the record-only stub adapter (NOT_FOR_LIVE_USE), and the only network contact this drill can make is the operator-supplied sandbox verification handshake.",
  );

  return { findings, planSteps: PROBE_PLAN.length, providersAudited: CATALOGUE_FACTS.length };
}

// ── sandbox gates (live mode; all BEFORE any network contact) ────────────────
/**
 * @param {string | undefined} target
 * @returns {{ ok: true, host: string, url: URL } | { ok: false, reason: string }}
 */
function validateSandboxTarget(target) {
  if (!target || target.trim() === "") {
    return { ok: false, reason: "absent" };
  }
  let url;
  try {
    url = new URL(target);
  } catch {
    return { ok: false, reason: "not a parseable URL" };
  }
  if (url.protocol !== "https:") {
    return { ok: false, reason: `protocol ${url.protocol} is not https` };
  }
  if (url.username !== "" || url.password !== "") {
    return { ok: false, reason: "embedded credentials in the sandbox URL are refused" };
  }
  return { ok: true, host: url.host, url };
}

// ── live handshake (the ONLY network contact this drill can ever make) ───────
/**
 * One read-only verification handshake against the operator-supplied sandbox
 * target: GET, no message payload, redirects refused (a redirect could carry
 * the credential to an unapproved host), 8s timeout, response body never read
 * or written (provider responses may carry sensitive material). The
 * credential value is never printed, logged, or written — only the HTTP
 * status is reported.
 * @param {URL} url
 * @param {string} credentialValue
 * @returns {Promise<boolean>}
 */
async function sandboxHandshake(url, credentialValue) {
  reportLine(`handshake: GET ${url.host} (verification path only, no message payload, redirects refused, timeout ${HANDSHAKE_TIMEOUT_MS}ms).`);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Authorization: `Bearer ${credentialValue}` },
      redirect: "error",
      signal: AbortSignal.timeout(HANDSHAKE_TIMEOUT_MS),
    });
    if (!res.ok) {
      reportLine(`FINDING sandbox verification handshake returned status ${res.status} (response body not read; credential value never logged).`);
      return false;
    }
    reportLine(`PASS sandbox verification handshake: read-only GET succeeded (status ${res.status}).`);
    return true;
  } catch (err) {
    reportLine(`FINDING sandbox verification handshake failed: ${err.message} (credential value never logged).`);
    return false;
  }
}

// ── run ──────────────────────────────────────────────────────────────────────
const startedAtIso = new Date().toISOString();
const provider = declaredProvider(providerId);
if (providerId !== null && !provider) {
  console.error(
    `BLOCKED_USAGE provider id "${providerId}" is not declared in the communication provider catalogue.`,
  );
  process.exit(2);
}

if (MODE === "rehearse") {
  reportLine("COREGRID COMMUNICATION PROVIDER PROBE — REHEARSAL (offline; no network is contacted, nothing is sent)");
  reportLine(`mode=rehearse artifactsDir=${ARTIFACTS_DIR} databaseContact=false networkContact=false`);
  const result = runRehearsal();
  const record = {
    mission: "E-044 communication provider probe (H3-044, BLK-5)",
    mode: "rehearse",
    startedAt: startedAtIso,
    completedAt: new Date().toISOString(),
    artifactsDir: ARTIFACTS_DIR,
    databaseContact: false,
    networkContact: false,
    credentialRequired: false,
    sendCapable: false,
    planSteps: result.planSteps,
    providersAudited: result.providersAudited,
    credentialEnvName: CREDENTIAL_ENV_NAME,
    sandboxTargetEnvName: SANDBOX_TARGET_ENV_NAME,
    findings: result.findings,
    log,
  };
  writeArtifact("communication-probe-rehearsal.json", JSON.stringify(record, null, 2) + "\n");
  writeArtifact("communication-probe-rehearsal.log", log.join("\n") + "\n");
  if (result.findings > 0) {
    console.error(`STATUS=REHEARSAL_FINDINGS (${result.findings}) — the probe plan/contracts do not hold; fix before any live pass.`);
    process.exit(1);
  }
  reportLine("STATUS=REHEARSAL_PASS — plan invariants, provider-catalogue hygiene, and the fail-closed lifecycle all hold offline.");
  process.exit(0);
}

reportLine("COREGRID COMMUNICATION PROVIDER PROBE — LIVE HANDSHAKE (credential-gated; read-only verification path; sends nothing real)");
reportLine(`mode=live artifactsDir=${ARTIFACTS_DIR} providerId=${provider?.id ?? "unspecified"}`);

const rehearsal = runRehearsal();
if (rehearsal.findings > 0) {
  reportLine(`FINDING offline rehearsal produced ${rehearsal.findings} findings — live handshake refuses to proceed.`);
  const record = {
    mission: "E-044 communication provider probe (H3-044, BLK-5)",
    mode: "live",
    startedAt: startedAtIso,
    completedAt: new Date().toISOString(),
    providerId: provider?.id ?? null,
    credentialEnvName: CREDENTIAL_ENV_NAME,
    sandboxTargetEnvName: SANDBOX_TARGET_ENV_NAME,
    databaseContact: false,
    networkContact: false,
    handshake: "not-executed (offline findings)",
    findings: rehearsal.findings,
    log,
  };
  writeArtifact("communication-probe-live.json", JSON.stringify(record, null, 2) + "\n");
  writeArtifact("communication-probe-live.log", log.join("\n") + "\n");
  console.error(`STATUS=LIVE_FINDINGS (${rehearsal.findings}) — fix the offline contracts first.`);
  process.exit(1);
}

// Sandbox gate — the operator-supplied target is REQUIRED by design; without
// it there is no authorized destination and no network contact is ever made.
const sandbox = validateSandboxTarget(process.env[SANDBOX_TARGET_ENV_NAME]);
if (!sandbox.ok) {
  console.error(
    sandbox.reason === "absent"
      ? `BLOCKED_NO_SANDBOX_TARGET ${SANDBOX_TARGET_ENV_NAME} is not set — this drill requires an operator-supplied sandbox verification target by design. No network contact was made and nothing was sent.`
      : `BLOCKED_SANDBOX_TARGET ${SANDBOX_TARGET_ENV_NAME} is invalid (${sandbox.reason}). No network contact was made and nothing was sent.`,
  );
  process.exit(2);
}

const handshakeOk = await sandboxHandshake(sandbox.url, /** @type {string} */ (credential));
const record = {
  mission: "E-044 communication provider probe (H3-044, BLK-5)",
  mode: "live",
  startedAt: startedAtIso,
  completedAt: new Date().toISOString(),
  providerId: provider?.id ?? null,
  credentialEnvName: CREDENTIAL_ENV_NAME,
  credentialPresent: true,
  sandboxTargetEnvName: SANDBOX_TARGET_ENV_NAME,
  sandboxTargetHost: sandbox.host,
  databaseContact: false,
  networkContact: true,
  transport: "operator-supplied-sandbox-verification-handshake (read-only GET, no message payload)",
  sendCapable: false,
  handshake: handshakeOk ? "PASS" : "FAIL",
  findings: handshakeOk ? 0 : 1,
  log,
};
writeArtifact("communication-probe-live.json", JSON.stringify(record, null, 2) + "\n");
writeArtifact("communication-probe-live.log", log.join("\n") + "\n");

if (!handshakeOk) {
  console.error("STATUS=LIVE_FINDINGS (1) — sandbox verification handshake did not succeed; nothing was sent.");
  process.exit(1);
}
reportLine(
  "STATUS=LIVE_PASS — offline contracts hold and the operator-supplied sandbox verification handshake succeeded; no message was sent and no provider send path was exercised.",
);
process.exit(0);
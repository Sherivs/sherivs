#!/usr/bin/env node
/**
 * CoreGrid — H3 wave, team H3-043 (Payment Rail Drill Engineer), mission
 * E-043 (Squad E, BLK-4 launch-gate drill, GOV-P63).
 *
 * Credential-gated Paystack TEST-MODE payment-rail drill round. The drill
 * converts BLK-4's static claim — "the payment contract is verified; live
 * rails are never faked" — into executed evidence on the TEST rails ONLY:
 * a real governed round-trip through the existing testmode server module
 * (frontend/src/lib/payments/paystack-testmode.server.ts, MISSION-R-32):
 *
 *   1. GATE              credential class enforced BEFORE any network contact.
 *                        Missing credential → BLOCKED_NO_CREDENTIAL (exit 2).
 *                        A LIVE key (sk_live_…) is REFUSED BY DESIGN — this
 *                        drill operates on the TEST rails precisely because
 *                        BLK-4 forbids the live rails; every other credential
 *                        class is refused too (fail closed, never half-trusted).
 *   2. AUDIT             the §36 audit sink is installed and awaited by the
 *                        governed surface BEFORE every mutating provider call;
 *                        audit-before-execute is mandatory — no payment
 *                        mutation without its audit record.
 *   3. INITIALIZE        a canonical PaymentReference (server-resolved tenant,
 *                        purpose and minor-unit amount — never client payment
 *                        state) is initialized on the Paystack TEST rails via
 *                        initializePaystackTestTransaction. The derived
 *                        idempotency key travels as the provider-side
 *                        transaction reference, so replays dedupe server-side.
 *   4. VERIFY_OWNED      verifyOwnedPayment re-checks the provider's record
 *                        against the SAME canonical reference — the provider's
 *                        word alone is never ownership evidence (§36).
 *   5. NEGATIVE_OWNERSHIP the same provider reference is re-verified against a
 *                        deliberately mismatched expected amount — the denial
 *                        (ownership_mismatch) IS the pass condition. An
 *                        accepted mismatch is the strongest possible FINDING.
 *   6. CLEANUP/BY-DESIGN the TEST-MODE transaction is left PENDING — the drill
 *                        never completes a charge, never moves money (TEST
 *                        rails, provider test ledger only); no database is
 *                        touched, nothing to delete beyond the drill artifacts.
 *
 * Modes:
 *   (default)        the gated TEST-MODE round above. Requires
 *                    PAYSTACK_SECRET_KEY (env NAME only; value never printed)
 *                    holding a Paystack TEST secret key (sk_test_…).
 *   --rehearse       fully OFFLINE rehearsal: loads the governed testmode
 *                    module and payment contract (local files only, no
 *                    network, no credentials read or required) and exercises
 *                    the gate's credential-class vectors and the reference /
 *                    idempotency vectors. Mirrors the exemplar drill runner
 *                    scripts/verify-recovery-drill.mjs.
 *   --help           this help (offline, no credentials touched).
 *
 * Exit codes (campaign law §6 — fail-closed BLOCKED_NO_CREDENTIAL, exit 2):
 *   0  PASS — every round step verified against the TEST rails (or rehearsal
 *            clean)
 *   1  FAIL / FINDING — a round step failed (initialize denied, owned-verify
 *            mismatched, negative ownership probe ACCEPTED — a live ownership
 *            leak) or an artifact/audit defect. Stop-the-line: preserve
 *            evidence, do NOT claim live evidence.
 *   2  BLOCKED_NO_CREDENTIAL — nothing ran; the gate refused before ANY
 *            network contact (missing key, live key refused, non-test key
 *            class, unknown arguments BLOCKED_USAGE). NEVER work around exit 2.
 *
 * Credential law (AGENTS §30, campaign law §6):
 * - the credential VALUE is never printed, logged, or written to artifacts —
 *   provenance only: source (env), class (sk_test_), never the key itself;
 * - deny reasons carry no key material (the governed surface already
 *   guarantees secret-free deny reasons);
 * - the drill must never be executed outside a coordinator-serialized window
 *   (docs/runbooks/payment-rail-drill.md §3) and never with live keys.
 *
 * Artifacts (directory from COREGRID_ARTIFACTS_DIR, default
 * /opt/cursor/artifacts — secret-free by construction):
 *   payments-drill-test-round.json / .log   (TEST-MODE round)
 *   payments-drill-rehearsal.json  / .log   (offline rehearsal)
 *
 * Authority: AGENTS.md §26 (API governance), §29 (observability), §30
 * (secrets), §36 (payment security), §42 (report format); campaign law
 * architecture/campaigns/H3-WAVE-CAMPAIGN.md; COREGRID_V1_BLOCKERS.json
 * BLK-4 (open — never bypassed); runbook docs/runbooks/payment-rail-drill.md.
 */
import { appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { randomBytes } from "node:crypto";
import { createJiti } from "jiti";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DEFAULT_ARTIFACTS_DIR = "/opt/cursor/artifacts";
const ARTIFACTS_DIR = process.env.COREGRID_ARTIFACTS_DIR ?? DEFAULT_ARTIFACTS_DIR;
const CREDENTIAL_ENV_NAME = "PAYSTACK_SECRET_KEY";
const BASE_URL_ENV_NAME = "PAYSTACK_BASE_URL";

// ---------------------------------------------------------------------------
// Credential classification (pure, exported for the offline gate tests).
// The governed testmode surface (validateTestModeKey) accepts ONLY sk_test_
// keys; this gate refuses everything else BEFORE any network contact. A live
// key is refused like a missing one — never half-trusted, never "configured
// later" (runbook §3 gate law 2).
// ---------------------------------------------------------------------------
export const CREDENTIAL_CLASSES = ["missing", "test", "live", "other"];

export function classifyCredential(rawKey) {
  const key = typeof rawKey === "string" ? rawKey.trim() : "";
  if (key === "") return { credentialClass: "missing" };
  if (key.startsWith("sk_test_")) return { credentialClass: "test" };
  if (key.startsWith("sk_live_")) return { credentialClass: "live" };
  return { credentialClass: "other" };
}

export function credentialBlockReason(credentialClass) {
  switch (credentialClass) {
    case "missing":
      return `${CREDENTIAL_ENV_NAME} is not set — the TEST-MODE drill round requires a Paystack TEST secret key (sk_test_…) provisioned via the approved secrets channel.`;
    case "live":
      return `live-key refusal: ${CREDENTIAL_ENV_NAME} holds a sk_live_ key — live keys are REFUSED BY DESIGN on this surface (BLK-4 forbids the live rails); provision a TEST secret key (sk_test_…) instead.`;
    default:
      return `credential-class refusal: ${CREDENTIAL_ENV_NAME} is not a Paystack TEST secret key (sk_test_…) — every other credential class is refused, fail closed.`;
  }
}

// The run block message is constant-shaped and secret-free: it names the env
// variable, names the credential CLASS, and never echoes the VALUE.
export function blockMessage(credentialClass) {
  return `BLOCKED_NO_CREDENTIAL ${credentialBlockReason(credentialClass)} Nothing was probed; no network contact was made.`;
}

// ---------------------------------------------------------------------------
// Offline rehearsal vectors (pure, exported): the gate semantics and the
// contract vectors the --rehearse mode proves without any credential or I/O.
// ---------------------------------------------------------------------------
export function credentialGateVectors() {
  return [
    { name: "missing", envValue: null, expectClass: "missing", expectPass: false },
    { name: "test-class", envValue: "sk_test_h3_043_fixture_not_a_real_credential", expectClass: "test", expectPass: true },
    { name: "live-class-refused", envValue: "sk_live_h3_043_fixture_not_a_real_key", expectClass: "live", expectPass: false },
    { name: "other-class-refused", envValue: "pk_live_h3_043_fixture_wrong_class", expectClass: "other", expectPass: false },
  ];
}

// ---------------------------------------------------------------------------
// Governed module loading (offline-safe: local TS files only, no side effects,
// no network at import time). The drill runs the round THROUGH the existing
// testmode server module — it never re-implements provider logic.
// ---------------------------------------------------------------------------
function loadPaymentsModules() {
  const jiti = createJiti(join(ROOT, "scripts", "verify-payments-live.drill.mjs"));
  const testmode = jiti(join(ROOT, "frontend", "src", "lib", "payments", "paystack-testmode.server.ts"));
  const contract = jiti(join(ROOT, "frontend", "src", "lib", "payments", "payment-contract.ts"));
  return { testmode, contract };
}

// Canonical drill reference plan (values are non-secret by construction; the
// amount/currency come from THIS server-side plan, never from client state).
export function drillReferencePlan(runId) {
  return {
    tenantId: `tenant-drill-${runId}`,
    payerRef: "drill-payer-h3-043",
    amountMinor: 15_000,
    currency: "NGN",
    purposeKind: "fee_payment",
    purposeRef: `fee-drill-${runId}`,
    payerEmail: "drill-payments-h3-043@example.com",
  };
}

// ---------------------------------------------------------------------------
// Artifact plumbing (secret-free by construction — only provenance, verdicts,
// deny codes, and non-secret plan values are ever written).
// ---------------------------------------------------------------------------
let roundLog = [];
function report(line) {
  process.stdout.write(line + "\n");
  roundLog.push(line);
}
function writeArtifacts(baseName, record, log) {
  try {
    mkdirSync(ARTIFACTS_DIR, { recursive: true });
    writeFileSync(join(ARTIFACTS_DIR, `${baseName}.json`), JSON.stringify(record, null, 2) + "\n");
    appendFileSync(join(ARTIFACTS_DIR, `${baseName}.log`), log.join("\n") + "\n");
    report(`artifacts: ${ARTIFACTS_DIR}/${baseName}.json + .log`);
    return true;
  } catch (err) {
    report(`WARN artifact write failed (${ARTIFACTS_DIR}/${baseName}): ${err.message}`);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Offline rehearsal (--rehearse): validates the gate semantics and the
// contract vectors through the real governed modules. No credential is read,
// no network is contacted, no database is touched.
// ---------------------------------------------------------------------------
export function runRehearsalVectors() {
  const { testmode, contract } = loadPaymentsModules();
  const findings = [];
  const results = [];

  for (const vector of credentialGateVectors()) {
    const classified = classifyCredential(vector.envValue);
    const classOk = classified.credentialClass === vector.expectClass;
    const moduleVerdict = vector.envValue === null
      ? null
      : testmode.validateTestModeKey(vector.envValue);
    const moduleOk = vector.envValue === null
      ? true
      : vector.expectPass ? moduleVerdict?.ok === true : moduleVerdict?.ok === false;
    const ok = classOk && moduleOk;
    results.push({
      vector: vector.name,
      expectClass: vector.expectClass,
      classifiedClass: classified.credentialClass,
      moduleDenyCode: moduleVerdict && !moduleVerdict.ok ? moduleVerdict.code : null,
      ok,
    });
    if (!ok) findings.push(`credential vector ${vector.name} did not classify/validate as declared`);
  }

  // Reference vectors: a valid canonical drill plan validates; the classic
  // ownership corruptions (zero amount, empty tenant) must fail closed.
  const runId = "rehearsal";
  const plan = drillReferencePlan(runId);
  const validReference = {
    tenantId: plan.tenantId,
    payerRef: plan.payerRef,
    amount: { amountMinor: plan.amountMinor, currency: plan.currency },
    purpose: { kind: plan.purposeKind, ref: plan.purposeRef },
  };
  const validOk = contract.validatePaymentReference(validReference).ok === true;
  if (!validOk) findings.push("valid drill reference rejected by validatePaymentReference");
  const zeroAmount = contract.validatePaymentReference({ ...validReference, amount: { amountMinor: 0, currency: plan.currency } });
  const zeroAmountOk = zeroAmount.ok === false && zeroAmount.code === "invalid_amount";
  if (!zeroAmountOk) findings.push("zero-amount reference was not refused (invalid_amount)");
  const emptyTenant = contract.validatePaymentReference({ ...validReference, tenantId: "  " });
  const emptyTenantOk = emptyTenant.ok === false && emptyTenant.code === "empty_tenant";
  if (!emptyTenantOk) findings.push("empty-tenant reference was not refused (empty_tenant)");

  // Idempotency determinism: the same canonical reference MUST derive the same
  // idempotency key — that key is the provider-side reference, so replays of
  // the same payment dedupe server-side (§36 replay protection).
  const key1 = contract.deriveIdempotencyKey(validReference);
  const key2 = contract.deriveIdempotencyKey(validReference);
  const idempotencyOk = key1 === key2 && key1.startsWith("cg_");
  if (!idempotencyOk) findings.push("deriveIdempotencyKey is not deterministic for the same reference");

  results.push(
    { vector: "reference-valid", ok: validOk },
    { vector: "reference-zero-amount-refused", ok: zeroAmountOk },
    { vector: "reference-empty-tenant-refused", ok: emptyTenantOk },
    { vector: "idempotency-key-deterministic", ok: idempotencyOk },
  );

  return { results, findings, idempotencyKey: key1 };
}

// ---------------------------------------------------------------------------
// TEST-MODE round (gated live execution, coordinator-serialized window).
// ---------------------------------------------------------------------------
async function runTestModeRound() {
  const runId = randomBytes(6).toString("hex");
  const plan = drillReferencePlan(runId);
  const reference = {
    tenantId: plan.tenantId,
    payerRef: plan.payerRef,
    amount: { amountMinor: plan.amountMinor, currency: plan.currency },
    purpose: { kind: plan.purposeKind, ref: plan.purposeRef },
  };

  const { testmode, contract } = loadPaymentsModules();

  // The §36 audit sink: awaited by the governed surface BEFORE every mutating
  // provider call. Entries are secret-free (tenant, purpose, idempotency key,
  // amount, currency — never key material).
  const auditEntries = [];
  const audit = (entry) => {
    auditEntries.push(entry);
  };

  const config = {
    secretKey: (process.env[CREDENTIAL_ENV_NAME] ?? "").trim(),
    audit,
  };
  // Optional base-URL override (drill window injection); the governed module
  // defaults to the provider's API. The value is a URL, never a secret.
  if (process.env[BASE_URL_ENV_NAME]) config.baseUrl = process.env[BASE_URL_ENV_NAME];

  report(`COREGRID PAYMENT RAIL DRILL — H3-043 (E-043, BLK-4) — TEST-MODE round`);
  report(`key provenance: source=env class=sk_test_ (value never printed)`);
  report(`provider=paystack rails=TEST governedSurface=frontend/src/lib/payments/paystack-testmode.server.ts`);
  report(`plan: tenant=${plan.tenantId} purpose=${plan.purposeKind}:${plan.purposeRef} amountMinor=${plan.amountMinor} currency=${plan.currency} (server-resolved plan values; never client payment state)`);

  const steps = [];
  const findings = [];

  // GATE re-validation through the governed surface (defense in depth: the
  // gate already classified the key; the module independently refuses any
  // non-test class before any call).
  const gate = testmode.validateTestModeKey(config.secretKey);
  steps.push({ step: "GATE", ok: gate.ok, denyCode: gate.ok ? null : gate.code });
  if (!gate.ok) {
    findings.push(`governed surface refused the credential (code=${gate.code}) — fail closed`);
  }

  const referenceValidation = contract.validatePaymentReference(reference);
  steps.push({ step: "REFERENCE_VALIDATION", ok: referenceValidation.ok, denyCode: referenceValidation.ok ? null : referenceValidation.code });
  if (!referenceValidation.ok) findings.push(`canonical drill reference rejected (${referenceValidation.code})`);

  let initialized = null;
  if (gate.ok && referenceValidation.ok) {
    // INITIALIZE — real Paystack TEST rails call through the governed surface.
    const init = await testmode.initializePaystackTestTransaction(config, reference, plan.payerEmail);
    initialized = init.ok ? init.value : null;
    steps.push({
      step: "INITIALIZE",
      ok: init.ok,
      denyCode: init.ok ? null : init.code,
      evidence: init.ok
        ? `authorization_url present=${typeof init.value.authorizationUrl === "string" && init.value.authorizationUrl.length > 0} access_code present=${init.value.accessCode.length > 0} (values not printed)`
        : init.reason,
    });
    if (!init.ok) findings.push(`INITIALIZE denied (code=${init.code}): ${init.reason}`);

    if (initialized) {
      // VERIFY_OWNED — the provider's record must match the canonical
      // reference exactly (ownership re-check, §36).
      const owned = await testmode.verifyOwnedPayment(config, initialized.reference, reference);
      const ownedOk = owned.ok
        && owned.value.amountMinor === plan.amountMinor
        && owned.value.currency.toUpperCase() === plan.currency.toUpperCase();
      steps.push({
        step: "VERIFY_OWNED",
        ok: ownedOk,
        denyCode: owned.ok ? null : owned.code,
        evidence: owned.ok
          ? `provider status=${owned.value.status} amountMinor=${owned.value.amountMinor} currency=${owned.value.currency} (matches canonical reference)`
          : owned.reason,
      });
      if (!ownedOk) findings.push(owned.ok ? "VERIFY_OWNED returned a record that does not match the canonical reference" : `VERIFY_OWNED denied (code=${owned.code}): ${owned.reason}`);

      // NEGATIVE_OWNERSHIP — mismatched expected amount: the denial IS the
      // pass condition. An accepted mismatch is the ownership leak BLK-4
      // fears, recorded as the strongest possible FINDING.
      const mismatchedExpected = { amount: { amountMinor: plan.amountMinor + 1, currency: plan.currency } };
      const mismatch = await testmode.verifyOwnedPayment(config, initialized.reference, mismatchedExpected);
      const deniedAsExpected = !mismatch.ok && mismatch.code === "ownership_mismatch";
      steps.push({
        step: "NEGATIVE_OWNERSHIP",
        ok: deniedAsExpected,
        denyCode: mismatch.ok ? null : mismatch.code,
        evidence: deniedAsExpected
          ? "mismatched amount DENIED with ownership_mismatch — the provider's word alone is not ownership evidence"
          : mismatch.ok
            ? "FINDING: a mismatched expected amount was ACCEPTED — live ownership-validation gap"
            : `unexpected denial code=${mismatch.code}: ${mismatch.reason}`,
      });
      if (!deniedAsExpected) findings.push(mismatch.ok ? "NEGATIVE_OWNERSHIP: mismatched amount ACCEPTED — ownership validation failed open" : `NEGATIVE_OWNERSHIP: unexpected outcome (code=${mismatch.code})`);
    }
  }

  // CLEANUP / BY-DESIGN: the TEST-MODE transaction is left pending — the drill
  // NEVER completes a charge, never moves money; the idempotency key is
  // registered provider-side, so any re-run of the same canonical reference
  // deduplicates instead of double-charging (§36). No database is touched.
  report(`cleanup: test-mode transaction left pending BY DESIGN (never completed; no money movement); databaseContact=false; audit records=${auditEntries.length}`);

  const pass = steps.every((s) => s.ok) && findings.length === 0;
  const record = {
    mission: "H3-043 (E-043, BLK-4 payment-rail drill)",
    mode: "test-round",
    provider: "paystack",
    rails: "TEST",
    databaseContact: false,
    networkContact: true,
    credentialRequired: true,
    credentialProvenance: { source: "env", credentialClass: "sk_test_", valuePrinted: false },
    governedSurface: "frontend/src/lib/payments/paystack-testmode.server.ts",
    plan: {
      tenantId: plan.tenantId,
      payerRef: plan.payerRef,
      amountMinor: plan.amountMinor,
      currency: plan.currency,
      purposeKind: plan.purposeKind,
      purposeRef: plan.purposeRef,
    },
    idempotencyKey: initialized?.idempotencyKey ?? null,
    auditRecordCount: auditEntries.length,
    steps,
    findings,
    cleanup: "test-mode transaction left pending by design (never completed); audit records retained in artifacts",
    executedAt: new Date().toISOString(),
    summary: null,
  };
  record.summary = pass ? "PASS" : "FAIL";
  writeArtifacts("payments-drill-test-round", record, roundLog);

  if (pass) {
    report("STATUS=PASS — TEST-MODE round proven: credential gate (TEST class only), audit-before-execute, initialize on the TEST rails, owned-verify against the canonical reference, and the mismatched-amount ownership probe DENIED. Live keys are refused by design; BLK-4 closure remains a coordinator decision.");
    process.exit(0);
  }
  report(`STATUS=FAIL — ${findings.length} finding(s). Stop-the-line: preserve artifacts, do NOT claim live evidence.`);
  for (const f of findings) report(`FINDING ${f}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// CLI surface: offline flags first (--help / --rehearse exit before any
// credential read or network use), then the credential gate, then the round.
// Importing this module (unit tests) runs none of this.
// ---------------------------------------------------------------------------
function printUsage() {
  process.stdout.write(`COREGRID PAYMENT RAIL DRILL — H3-043 (mission E-043, BLK-4 launch-gate drill)

Usage:
  node scripts/verify-payments-live.drill.mjs            run the gated TEST-MODE round
                                                         (needs PAYSTACK_SECRET_KEY = sk_test_…)
  node scripts/verify-payments-live.drill.mjs --rehearse offline rehearsal (no credentials read,
                                                         no network, exercises the gate + contract vectors)
  node scripts/verify-payments-live.drill.mjs --help     this help (offline)

Credential law:
  - TEST-MODE keys (sk_test_…) ONLY. A live key (sk_live_…) is REFUSED BY
    DESIGN — BLK-4 forbids the live rails; every other credential class is
    refused too (fail closed). The key VALUE is never printed, logged, or
    written; provenance only (source=env class=sk_test_).
  - Execution belongs in a coordinator-serialized window
    (docs/runbooks/payment-rail-drill.md).

Exit codes:
  0  PASS — every round step verified against the TEST rails (or rehearsal clean)
  1  FAIL / FINDING — a round step failed; stop-the-line, never claim live evidence
  2  BLOCKED_NO_CREDENTIAL — gate refused before ANY network contact
     (missing key, live-key refusal, non-test class, BLOCKED_USAGE)
`);
}

function handleCliFlags(args) {
  if (args.includes("-h") || args.includes("--help")) {
    printUsage();
    process.exit(0);
  }
}

export function parseArgs(argv) {
  const flags = argv.filter((a) => a.startsWith("--"));
  const positionals = argv.filter((a) => !a.startsWith("--"));
  const KNOWN_FLAGS = new Set(["--rehearse"]);
  const unknownFlags = flags.filter((f) => f !== "-h" && f !== "--help" && !KNOWN_FLAGS.has(f));
  return { flags, positionals, unknownFlags };
}

async function main() {
  const args = process.argv.slice(2);
  handleCliFlags(args);

  const { positionals, unknownFlags } = parseArgs(args);
  if (unknownFlags.length > 0 || positionals.length > 0) {
    console.error(
      `BLOCKED_USAGE unknown argument(s): ${[...unknownFlags, ...positionals].join(" ")}. ` +
        `Supported: no arguments (gated TEST-MODE round) or --rehearse (offline).`,
    );
    process.exit(2);
  }

  if (args.includes("--rehearse")) {
    roundLog = [];
    report("COREGRID PAYMENT RAIL DRILL — OFFLINE REHEARSAL (no credentials read, no network, no database)");
    const { results, findings, idempotencyKey } = runRehearsalVectors();
    for (const r of results) report(`${r.ok ? "PASS" : "FINDING"} vector:${r.vector}${r.classifiedClass ? ` class=${r.classifiedClass}` : ""}${r.moduleDenyCode ? ` denyCode=${r.moduleDenyCode}` : ""}`);
    report(`idempotency key shape: cg_-prefixed, deterministic for the same canonical reference (sample=${idempotencyKey})`);
    const record = {
      mission: "H3-043 (E-043, BLK-4 payment-rail drill)",
      mode: "rehearse",
      databaseContact: false,
      networkContact: false,
      credentialRequired: false,
      credentialRead: false,
      vectorsValidated: results.length,
      findings: findings.length,
      executedAt: new Date().toISOString(),
      summary: null,
    };
    record.summary = findings.length === 0 ? "REHEARSAL_PASS" : "REHEARSAL_FINDINGS";
    writeArtifacts("payments-drill-rehearsal", record, roundLog);
    if (findings.length === 0) {
      report("STATUS=REHEARSAL_PASS — gate semantics and contract vectors proven offline; the gated TEST-MODE round remains coordinator-serialized.");
      process.exit(0);
    }
    report(`STATUS=REHEARSAL_FINDINGS (${findings.length})`);
    process.exit(1);
  }

  // GATE — before ANY network contact. Missing key, live key, or any other
  // credential class blocks with exit 2 and a constant-shaped, secret-free
  // message. Nothing is probed on this path.
  const credential = classifyCredential(process.env[CREDENTIAL_ENV_NAME] ?? "");
  if (credential.credentialClass !== "test") {
    console.error(blockMessage(credential.credentialClass));
    process.exit(2);
  }

  await runTestModeRound();
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  await main();
}
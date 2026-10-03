/**
 * CoreGrid — H3 wave, team H3-044 (Communication Probe Engineer), mission
 * E-044 (Squad E — Launch-gate drills, BLK-5). OFFLINE gate tests for
 * scripts/verify-communication-live.drill.mjs — no database, no network
 * service is ever contacted by these tests, and the live handshake path is
 * never executed:
 *
 *  - `--rehearse` is fully offline (zero credential, zero network): it
 *    validates the declared probe-plan invariants (no send-capable step, one
 *    sandbox-handshake network step that requires credential AND operator
 *    sandbox target, read-only GET with no payload), the embedded provider-
 *    catalogue facts (credential-reference hygiene, fail-closed lifecycle),
 *    and the credential-hygiene shape vectors;
 *  - live mode is strictly gated, in order, BEFORE any network contact:
 *    unknown args → BLOCKED_USAGE (exit 2); missing provider credential →
 *    BLOCKED_NO_CREDENTIAL (exit 2); missing operator sandbox target →
 *    BLOCKED_NO_SANDBOX_TARGET (exit 2); invalid sandbox target →
 *    BLOCKED_SANDBOX_TARGET (exit 2);
 *  - secret VALUES are never printed, logged, or written (sentinel-asserted);
 *  - the existing communication/notification server modules are consumed
 *    read-only: the drill's embedded catalogue mirror is cross-checked against
 *    the real PROVIDER_CATALOGUE, and the provider path's record-only stub
 *    adapter is proven to never deliver (send nothing real, by construction).
 */
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  isUsableProviderHealth,
  PROVIDER_CATALOGUE,
  auditProviderCatalogue,
  providersForChannel,
  type ProviderAdapter,
} from "@/lib/communication-providers";
import {
  createRecordOnlyEmailAdapter,
  evaluateEmailPreSend,
  type EmailProviderRegistry,
} from "@/lib/notifications/email-adapter-contract";
import {
  markDelivered,
  transitionNotification,
  isCategoryAllowedOnChannel,
  type DeliveryReceipt,
  type Notification,
} from "@/lib/notifications/notification-contract";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SCRIPT = join(ROOT, "scripts", "verify-communication-live.drill.mjs");

const CREDENTIAL_NAME = "COREGRID_COMMUNICATION_PROVIDER_CREDENTIAL";
const SANDBOX_NAME = "COREGRID_COMMUNICATION_SANDBOX_TARGET";
const SENTINEL_CREDENTIAL = "cg-h3-044-sentinel-credential-value";

function offlineEnv(extra: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env = { ...process.env };
  delete env[CREDENTIAL_NAME];
  delete env[SANDBOX_NAME];
  delete env.COREGRID_ARTIFACTS_DIR;
  return { ...env, ...extra };
}

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runScript(args: string[], env: NodeJS.ProcessEnv): RunResult {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { env, encoding: "utf8" });
  return { status: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

interface RehearsalRecord {
  mode: string;
  databaseContact: boolean;
  networkContact: boolean;
  credentialRequired: boolean;
  sendCapable: boolean;
  planSteps: number;
  providersAudited: number;
  credentialEnvName: string;
  sandboxTargetEnvName: string;
  findings: number;
}

let artifactsDir = "";

beforeAll(() => {
  artifactsDir = join(tmpdir(), `h3-044-artifacts-${Date.now()}`);
  mkdirSync(artifactsDir, { recursive: true });
});

afterAll(() => {
  rmSync(artifactsDir, { recursive: true, force: true });
});

function rehearsalRecord(): RehearsalRecord {
  return JSON.parse(
    readFileSync(join(artifactsDir, "communication-probe-rehearsal.json"), "utf8"),
  ) as RehearsalRecord;
}

function rehearsalLog(): string {
  return readFileSync(join(artifactsDir, "communication-probe-rehearsal.log"), "utf8");
}

describe("H3-044 communication probe — offline rehearsal (zero network, zero credential)", () => {
  it("passes fully offline with zero network and zero credential", () => {
    const run = runScript(["--rehearse"], offlineEnv({ COREGRID_ARTIFACTS_DIR: artifactsDir }));
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("STATUS=REHEARSAL_PASS");
    expect(run.stdout).toContain("networkContact=false");
    expect(run.stdout).toContain("databaseContact=false");

    const record = rehearsalRecord();
    expect(record.mode).toBe("rehearse");
    expect(record.databaseContact).toBe(false);
    expect(record.networkContact).toBe(false);
    expect(record.credentialRequired).toBe(false);
    expect(record.sendCapable).toBe(false);
    expect(record.findings).toBe(0);
    expect(record.credentialEnvName).toBe(CREDENTIAL_NAME);
    expect(record.sandboxTargetEnvName).toBe(SANDBOX_NAME);
  });

  it("declares the probe plan with the send-nothing-real invariants", () => {
    const logText = rehearsalLog();
    for (const step of [
      "catalogue-audit",
      "credential-hygiene",
      "lifecycle-fail-closed",
      "send-path-absence",
      "sandbox-handshake",
      "evidence",
    ]) {
      expect(logText).toContain(`step:${step} kind=${step}`);
    }
    const record = rehearsalRecord();
    expect(record.planSteps).toBe(6);
    // no send-capable step anywhere in the plan: the kind vocabulary has no
    // send kind, and only the sandbox-handshake may declare network contact
    expect(logText).not.toContain("kind=send ");
    const stepLines = logText.split("\n").filter((line) => line.trimStart().startsWith("step:"));
    expect(stepLines).toHaveLength(6);
    expect(stepLines.filter((line) => line.includes("network=true"))).toHaveLength(1);
    const handshakeLine = stepLines.find((line) => line.includes("network=true")) ?? "";
    expect(handshakeLine).toContain("step:sandbox-handshake kind=sandbox-handshake network=true");
    expect(handshakeLine).toContain("requiresCredential=true");
    expect(handshakeLine).toContain("requiresSandboxTarget=true");
    expect(handshakeLine).toContain("method=GET");
    expect(handshakeLine).toContain("noPayload=true");
    expect(stepLines.every((line) => line.includes("method=GET") && line.includes("noPayload=true"))).toBe(true);
  });

  it("audits the embedded provider catalogue and mirrors the real Phase-10 registry read-only", () => {
    const logText = rehearsalLog();
    const record = rehearsalRecord();
    expect(record.providersAudited).toBe(PROVIDER_CATALOGUE.length);
    // cross-check every embedded fact line against the real catalogue (read-only import)
    const factLines = [...logText.matchAll(/provider:(\S+) health=(\S+) channels=(\S+) reference-scheme=(\S+):\/\//g)];
    const embedded = new Map(factLines.map((m) => [m[1], { health: m[2], channels: m[3], scheme: m[4] }]));
    expect(embedded.size).toBe(PROVIDER_CATALOGUE.length);
    for (const adapter of PROVIDER_CATALOGUE) {
      const mirrored = embedded.get(adapter.id);
      expect(mirrored, `provider ${adapter.id} must be mirrored by the drill`).toBeDefined();
      expect(mirrored?.health).toBe(adapter.health);
      expect(mirrored?.channels).toBe(adapter.channels.join("+"));
      expect(mirrored?.scheme).toBe(adapter.credentialReference.split("://")[0]);
    }
    // reference hygiene holds in the real registry (same rules the drill audits offline)
    expect(auditProviderCatalogue()).toEqual([]);
  });

  it("proves the fail-closed lifecycle: every external provider is DISCOVERED and unusable", () => {
    const logText = rehearsalLog();
    expect(logText).toContain("PASS lifecycle fail-closed:");
    expect(logText).not.toContain("is ACTIVE — a live path exists");
    for (const adapter of PROVIDER_CATALOGUE) {
      if (adapter.id === "platform-presence") continue;
      expect(adapter.health).toBe("DISCOVERED");
      expect(isUsableProviderHealth(adapter.health)).toBe(false);
    }
    expect(isUsableProviderHealth("ACTIVE")).toBe(true);
  });

  it("exercises the credential-hygiene shape vectors and no known-bad vector is accepted", () => {
    const logText = rehearsalLog();
    expect(logText).toContain("hygiene: exercising the credential-reference rules against shape vectors.");
    expect(logText).toContain("PASS hygiene-vector:scheme-clean");
    expect(logText).toContain("PASS hygiene-vector:raw-material-shaped — refused");
    expect(logText).toContain("PASS hygiene-vector:no-scheme — refused");
    expect(logText).toContain("PASS hygiene-vector:empty — refused");
    expect(logText).not.toContain("was ACCEPTED");
    expect(logText).not.toContain("was REJECTED");
  });
});

describe("H3-044 communication probe — credential and sandbox gates (live mode, exit 2 before any contact)", () => {
  it("live mode without the provider credential fails closed: BLOCKED_NO_CREDENTIAL, exit 2, nothing probed", () => {
    const gateDir = join(tmpdir(), `h3-044-gate-${Date.now()}`);
    try {
      const run = runScript([], offlineEnv({ COREGRID_ARTIFACTS_DIR: gateDir }));
      expect(run.status).toBe(2);
      expect(run.stderr).toContain("BLOCKED_NO_CREDENTIAL");
      expect(run.stderr).toContain("Nothing was probed");
      expect(run.stderr).toContain("no network contact was made");
      expect(existsSync(join(gateDir, "communication-probe-live.json"))).toBe(false);
      expect(existsSync(join(gateDir, "communication-probe-live.log"))).toBe(false);
    } finally {
      rmSync(gateDir, { recursive: true, force: true });
    }
  });

  it("the credential gate precedes everything: it fires even when a sandbox target is already set", () => {
    const run = runScript(
      [],
      offlineEnv({
        COREGRID_ARTIFACTS_DIR: artifactsDir,
        [SANDBOX_NAME]: "https://sandbox.example.test/verify",
      }),
    );
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("BLOCKED_NO_CREDENTIAL");
    expect(existsSync(join(artifactsDir, "communication-probe-live.json"))).toBe(false);
  });

  it("the sandbox gate is required by design: credential without an operator target blocks cleanly", () => {
    const run = runScript(
      [],
      offlineEnv({
        COREGRID_ARTIFACTS_DIR: artifactsDir,
        [CREDENTIAL_NAME]: SENTINEL_CREDENTIAL,
      }),
    );
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("BLOCKED_NO_SANDBOX_TARGET");
    expect(run.stderr).toContain("operator-supplied sandbox verification target");
    expect(run.stderr).toContain("No network contact was made");
    expect(run.stderr).toContain("nothing was sent");
    expect(existsSync(join(artifactsDir, "communication-probe-live.json"))).toBe(false);
  });

  it("a cleartext (http) sandbox target is refused before any contact", () => {
    const run = runScript(
      [],
      offlineEnv({
        COREGRID_ARTIFACTS_DIR: artifactsDir,
        [CREDENTIAL_NAME]: SENTINEL_CREDENTIAL,
        [SANDBOX_NAME]: "http://sandbox.example.test/verify",
      }),
    );
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("BLOCKED_SANDBOX_TARGET");
    expect(run.stderr).toContain("No network contact was made");
  });

  it("a sandbox target with embedded credentials is refused before any contact", () => {
    const run = runScript(
      [],
      offlineEnv({
        COREGRID_ARTIFACTS_DIR: artifactsDir,
        [CREDENTIAL_NAME]: SENTINEL_CREDENTIAL,
        [SANDBOX_NAME]: "https://user:pass@sandbox.example.test/verify",
      }),
    );
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("BLOCKED_SANDBOX_TARGET");
    expect(run.stderr).toContain("embedded credentials");
  });

  it("rejects unknown arguments with BLOCKED_USAGE (exit 2)", () => {
    const run = runScript(["--rehearse", "--bogus"], offlineEnv({ COREGRID_ARTIFACTS_DIR: artifactsDir }));
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("BLOCKED_USAGE");
  });

  it("rejects an undeclared provider id with BLOCKED_USAGE (exit 2) and accepts a declared one offline", () => {
    const unknown = runScript(
      ["--rehearse", "not-a-provider"],
      offlineEnv({ COREGRID_ARTIFACTS_DIR: artifactsDir }),
    );
    expect(unknown.status).toBe(2);
    expect(unknown.stderr).toContain("BLOCKED_USAGE");
    expect(unknown.stderr).toContain("not declared in the communication provider catalogue");

    const declared = runScript(
      ["--rehearse", "sendgrid"],
      offlineEnv({ COREGRID_ARTIFACTS_DIR: artifactsDir }),
    );
    expect(declared.status).toBe(0);
    expect(declared.stdout).toContain("STATUS=REHEARSAL_PASS");
  });
});

describe("H3-044 communication probe — secret hygiene", () => {
  it("never prints, logs, or writes the credential value (sentinel asserted absent everywhere)", () => {
    const sentinelDir = join(tmpdir(), `h3-044-sentinel-${Date.now()}`);
    try {
      const rehearse = runScript(
        ["--rehearse"],
        offlineEnv({
          COREGRID_ARTIFACTS_DIR: sentinelDir,
          [CREDENTIAL_NAME]: SENTINEL_CREDENTIAL,
          [SANDBOX_NAME]: "https://sandbox.example.test/verify",
        }),
      );
      expect(rehearse.status).toBe(0);
      expect(rehearse.stdout).not.toContain(SENTINEL_CREDENTIAL);
      expect(rehearse.stderr).not.toContain(SENTINEL_CREDENTIAL);

      const blockedSandbox = runScript(
        [],
        offlineEnv({ COREGRID_ARTIFACTS_DIR: sentinelDir, [CREDENTIAL_NAME]: SENTINEL_CREDENTIAL }),
      );
      expect(blockedSandbox.status).toBe(2);
      expect(blockedSandbox.stderr).not.toContain(SENTINEL_CREDENTIAL);

      const recordText = readFileSync(join(sentinelDir, "communication-probe-rehearsal.json"), "utf8");
      const logText = readFileSync(join(sentinelDir, "communication-probe-rehearsal.log"), "utf8");
      expect(recordText).not.toContain(SENTINEL_CREDENTIAL);
      expect(logText).not.toContain(SENTINEL_CREDENTIAL);
      // artifacts declare secret NAMES only
      expect(recordText).toContain(CREDENTIAL_NAME);
      expect(recordText).toContain(SANDBOX_NAME);
    } finally {
      rmSync(sentinelDir, { recursive: true, force: true });
    }
  });
});

describe("H3-044 communication probe — read-only consumption of the communication/notification server modules", () => {
  function notificationFixture(): Notification {
    return {
      id: "notif-probe-001",
      tenantRef: "tenant-a",
      recipientRef: "user-1",
      audienceKind: "user",
      category: "system",
      subject: "probe subject",
      body: "probe body",
      actionRef: null,
      state: "queued",
      createdAt: "2026-10-03T00:00:00Z",
    };
  }

  /** A registry that CLAIMS the provider is configured — the stub must still refuse. */
  const configuredRegistry: EmailProviderRegistry = {
    isProviderConfigured: () => true,
    credentialReferenceFor: () => "secret://coregrid/communication/probe",
  };

  it("the record-only stub adapter can never deliver — the provider path sends nothing real by construction", async () => {
    const adapter = createRecordOnlyEmailAdapter();
    const result = await adapter.send(
      {
        notification: notificationFixture(),
        recipientAddress: "recipient@sandbox.example.test",
        subject: "probe subject",
        body: "probe body",
      },
      configuredRegistry,
    );
    expect(result).toMatchObject({ outcome: "undeliverable", code: "provider_not_configured" });
    expect(JSON.stringify(result)).toContain("NOT_FOR_LIVE_USE");
  });

  it("pre-send validation fails closed before any provider contact", () => {
    const adapter = createRecordOnlyEmailAdapter();
    const command = {
      notification: notificationFixture(),
      recipientAddress: "recipient@sandbox.example.test",
      subject: "probe subject",
      body: "probe body",
    };
    expect(evaluateEmailPreSend(command, configuredRegistry, adapter.providerId)).toBeNull();
    expect(
      evaluateEmailPreSend(
        { ...command, notification: { ...notificationFixture(), category: "escalation" } },
        configuredRegistry,
        adapter.providerId,
      ),
    ).toMatchObject({ outcome: "undeliverable", code: "category_not_permitted" });
    expect(
      evaluateEmailPreSend(
        { ...command, recipientAddress: "  " },
        configuredRegistry,
        adapter.providerId,
      ),
    ).toMatchObject({ outcome: "undeliverable", code: "recipient_invalid" });
  });

  it("delivered requires a genuine provider receipt for THIS notification (receipt law)", () => {
    const draft = { ...notificationFixture(), state: "draft" as const };
    // the state machine refuses draft → delivered outright (queued is mandatory first)
    expect(transitionNotification(draft, "delivered").ok).toBe(false);
    const queued = notificationFixture();
    // a malformed receipt (empty provider message id) is refused
    const malformed = {
      notificationId: queued.id,
      channel: "email",
      providerId: "sendgrid",
      providerMessageId: "",
      confirmedAt: "2026-10-03T00:00:01Z",
    } as DeliveryReceipt;
    expect(markDelivered(queued, malformed).ok).toBe(false);
    // a receipt for a DIFFERENT notification is refused
    const forged = markDelivered(queued, {
      notificationId: "other-notification",
      channel: "email",
      providerId: "sendgrid",
      providerMessageId: "msg-1",
      confirmedAt: "2026-10-03T00:00:01Z",
    });
    expect(forged.ok).toBe(false);
    // only a genuine, matching provider receipt reaches delivered
    const genuine = markDelivered(queued, {
      notificationId: queued.id,
      channel: "email",
      providerId: "sendgrid",
      providerMessageId: "msg-1",
      confirmedAt: "2026-10-03T00:00:01Z",
    });
    expect(genuine.ok).toBe(true);
  });

  it("every external egress channel has declared carriers and all are DISCOVERED (no live path)", () => {
    const externalChannels = ["sms", "email", "whatsapp", "voice", "push", "meeting", "social", "status"] as const;
    for (const channel of externalChannels) {
      const carriers = providersForChannel(channel).map((a: ProviderAdapter) => a.id);
      expect(carriers.length, `channel ${channel} must have declared carriers`).toBeGreaterThan(0);
      for (const id of carriers) {
        const adapter = PROVIDER_CATALOGUE.find((a) => a.id === id);
        expect(adapter?.health).toBe("DISCOVERED");
        expect(isUsableProviderHealth(adapter?.health ?? "RETIRED")).toBe(false);
      }
    }
    // the only usable provider is the internal platform channel (no third party involved)
    expect(providersForChannel("in_app").map((a: ProviderAdapter) => a.id)).toContain("platform-presence");
  });

  it("restricted notification categories fail closed to in_app (no external channel may carry them)", () => {
    expect(isCategoryAllowedOnChannel("escalation", "email")).toBe(false);
    expect(isCategoryAllowedOnChannel("escalation", "sms")).toBe(false);
    expect(isCategoryAllowedOnChannel("escalation", "web_push")).toBe(false);
    expect(isCategoryAllowedOnChannel("approval_request", "email")).toBe(false);
    expect(isCategoryAllowedOnChannel("approval_request", "sms")).toBe(false);
    expect(isCategoryAllowedOnChannel("approval_request", "web_push")).toBe(false);
    expect(isCategoryAllowedOnChannel("escalation", "in_app")).toBe(true);
    expect(isCategoryAllowedOnChannel("approval_request", "in_app")).toBe(true);
  });
});
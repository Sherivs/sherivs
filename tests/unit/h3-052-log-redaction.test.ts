/**
 * CoreGrid — H3-052 Log Redaction Auditor tests (Squad F, mission F-052).
 *
 * AGENTS §29 sweep proving that no password/token/secret material reaches a
 * log line from the cited server-side modules, and that the redaction
 * primitives in `observability/structured-log.ts` (read-only dependency)
 * keep their core guarantees intact:
 *
 *  1. Primitive guarantees — sensitive-key redaction is recursive, deep,
 *     cycle-safe, fail-closed (over-redacts rather than leaks); errors
 *     serialize as `Name: message` only, never a stack.
 *  2. Behavioral proof on the AI-gateway hot path — every emitted line is
 *     scrubbed against the live key material, even when a caller embeds it
 *     in an unexpected field (defense in depth), offline via injected sinks.
 *  3. Static sweep over a cited list of stable, pre-existing server modules
 *     — no raw credential-shaped identifier is interpolated into a
 *     `console.*` call; no secret-shaped literal is committed; logging hot
 *     paths route through the redaction primitives instead of raw console.
 *
 * All credential material in this file is clearly-marked synthetic fixture
 * data (never real secrets). Fully offline: no network, no database.
 */
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatLogLine,
  isSensitiveKey,
  logStructured,
  REDACTED,
  redactValue,
  serializeError,
  type StructuredLogEntry,
} from "../../frontend/src/lib/observability/structured-log";
import {
  createRateLimiter,
  invokeAiGateway,
} from "../../frontend/src/lib/ai-gateway.server";
import {
  paystackTestModeFromEnv,
  validateTestModeKey,
} from "../../frontend/src/lib/payments/paystack-testmode.server";
import { verifyStripeSignature } from "../../frontend/src/lib/payments/stripe-adapter";
import type { WebhookRequest } from "../../frontend/src/lib/payments/payment-contract";

/* ─────────────────────────────────────────────────────────────
 * Synthetic fixtures (clearly fake, never real secret material)
 * ────────────────────────────────────────────────────────────*/

const FAKE_API_KEY = "fixture-052-api-key-NOT-REAL-0000000000";
const FAKE_PASSWORD = "fixture-052-password-NOT-REAL-0000";
const FAKE_TOKEN = "fixture-052-token-NOT-REAL-00000000";
const FAKE_REFRESH = "fixture-052-refresh-token-NOT-REAL-00";
const FAKE_SECRET = "fixture-052-signing-secret-NOT-REAL-000";
const FAKE_LIVE_KEY = "sk_live_fixture052_notarealkey0000";
const FIXED_TS = "2026-10-03T00:00:00.000Z";
const NOW_MS = 1_769_932_800_000;

const ALL_FIXTURE_VALUES = [
  FAKE_API_KEY,
  FAKE_PASSWORD,
  FAKE_TOKEN,
  FAKE_REFRESH,
  FAKE_SECRET,
  FAKE_LIVE_KEY,
];

function assertNoFixtureMaterial(text: string): void {
  for (const fixture of ALL_FIXTURE_VALUES) {
    expect(text).not.toContain(fixture);
  }
}

/* ─────────────────────────────────────────────────────────────
 * 1. Redaction primitive guarantees (structured-log, read-only)
 * ────────────────────────────────────────────────────────────*/

describe("F-052: structured-log redaction primitives (AGENTS §29)", () => {
  it("exposes the canonical REDACTED sentinel", () => {
    expect(REDACTED).toBe("[REDACTED]");
  });

  it("isSensitiveKey matches secret/token/password/key case-insensitively and fails closed (over-redacts)", () => {
    for (const key of ["password", "userPassword", "secret", "client_secret", "SECRET_KEY", "access_token", "accessToken", "TOKEN", "apikey", "api_key", "supabaseKey", "privateKey"]) {
      expect(isSensitiveKey(key), key).toBe(true);
    }
    // Fail-closed over-redaction: substrings are enough, even in harmless names.
    expect(isSensitiveKey("monkey")).toBe(true);
    expect(isSensitiveKey("keyspace")).toBe(true);
    // Non-sensitive operational keys survive.
    for (const key of ["msg", "level", "tenant_id", "component", "duration_ms", "attempt_count", "user_email", "err"]) {
      expect(isSensitiveKey(key), key).toBe(false);
    }
  });

  it("redactValue redacts sensitive keys recursively (nested objects and arrays)", () => {
    const input = {
      tenant_id: "tenant-A",
      credentials: {
        password: FAKE_PASSWORD,
        session: { access_token: FAKE_TOKEN, scopes: ["read"] },
      },
      history: [{ api_key: FAKE_API_KEY, ok: 1 }],
    };
    const output = redactValue(input) as typeof input;
    expect(output.tenant_id).toBe("tenant-A");
    expect(output.credentials.password).toBe(REDACTED);
    expect((output.credentials.session as Record<string, unknown>).access_token).toBe(REDACTED);
    expect((output.credentials.session as Record<string, unknown>).scopes).toEqual(["read"]);
    const first = (output.history as Record<string, unknown>[])[0];
    expect(first.api_key).toBe(REDACTED);
    expect(first.ok).toBe(1);
    assertNoFixtureMaterial(JSON.stringify(output));
  });

  it("redactValue is cycle-safe and depth-safe without throwing", () => {
    const circular: Record<string, unknown> = { name: "node" };
    circular.self = circular;
    expect(redactValue(circular)).toEqual({ name: "node", self: "[circular]" });

    const deep: Record<string, unknown> = {};
    let cursor: Record<string, unknown> = deep;
    for (let i = 1; i <= 10; i += 1) {
      cursor.next = {};
      cursor = cursor.next as Record<string, unknown>;
    }
    cursor.leaf = "leaf-value";
    // Depth degrades to a sentinel instead of throwing — a logging failure
    // must never take down a request.
    expect(redactValue(deep)).toBeDefined();
    const flattened = JSON.stringify(redactValue(deep));
    expect(flattened).toContain("[truncated]");
  });

  it("redactValue preserves dates as ISO strings and primitives untouched", () => {
    const out = redactValue({ at: new Date(0), count: 3, flag: null, label: "x" }) as Record<string, unknown>;
    expect(out.at).toBe("1970-01-01T00:00:00.000Z");
    expect(out.count).toBe(3);
    expect(out.flag).toBeNull();
    expect(out.label).toBe("x");
  });

  it("serializeError never emits a stack and degrades safely", () => {
    const err = new Error("synthetic failure");
    const serialized = serializeError(err);
    expect(serialized).toBe("Error: synthetic failure");
    expect(serialized).not.toContain("at ");
    expect(serializeError("plain string")).toBe("plain string");
    expect(serializeError(undefined)).toBe("undefined");
    expect(serializeError({ code: 7 })).toBe('{"code":7}');
    expect(serializeError(BigInt(1))).toBe("[unserializable-error]");
  });

  it("formatLogLine redacts sensitive extra fields (top level and nested) and never leaks fixture values", () => {
    const entry: StructuredLogEntry = {
      msg: "synthetic event",
      level: "info",
      tenant_id: "tenant-A",
      component: "h3-052-test",
      password: FAKE_PASSWORD,
      access_token: FAKE_TOKEN,
      api_key: FAKE_API_KEY,
      attempt_count: 3,
      detail: { refresh_token: FAKE_REFRESH, kept: "visible" },
      err: new Error("synthetic failure"),
    };
    const line = formatLogLine(entry, { now: () => FIXED_TS });
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed.ts).toBe(FIXED_TS);
    expect(parsed.msg).toBe("synthetic event");
    expect(parsed.password).toBe(REDACTED);
    expect(parsed.access_token).toBe(REDACTED);
    expect(parsed.api_key).toBe(REDACTED);
    expect(parsed.attempt_count).toBe(3);
    const detail = parsed.detail as Record<string, unknown>;
    expect(detail.refresh_token).toBe(REDACTED);
    expect(detail.kept).toBe("visible");
    expect(parsed.err).toBe("Error: synthetic failure");
    assertNoFixtureMaterial(line);
  });

  it("formatLogLine fails closed on serialization failure (never throws)", () => {
    const entry: StructuredLogEntry = {
      msg: "synthetic event",
      // A BigInt in a non-sensitive extra field defeats JSON.stringify.
      weird: BigInt(1),
    };
    const line = formatLogLine(entry, { now: () => FIXED_TS });
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed.msg).toBe("log-line-serialization-failed");
    expect(parsed.level).toBe("error");
  });

  it("logStructured routes through the injected sink with the formatted line and level", () => {
    const seen: { line: string; level: string }[] = [];
    logStructured(
      { msg: "synthetic event", level: "warn", password: FAKE_PASSWORD },
      { sink: (line, level) => seen.push({ line, level }), now: () => FIXED_TS },
    );
    expect(seen).toHaveLength(1);
    expect(seen[0].level).toBe("warn");
    expect((JSON.parse(seen[0].line) as Record<string, unknown>).password).toBe(REDACTED);
    assertNoFixtureMaterial(seen[0].line);
  });

  it("logStructured maps levels onto the default console sinks and redacts there too", () => {
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      logStructured({ msg: "synthetic failure", level: "error", token: FAKE_TOKEN });
      expect(errorSpy).toHaveBeenCalledTimes(1);
      const emitted = String(errorSpy.mock.calls[0]?.[0] ?? "");
      expect((JSON.parse(emitted) as Record<string, unknown>).token).toBe(REDACTED);
      assertNoFixtureMaterial(emitted);

      logStructured({ msg: "synthetic info", level: "info" });
      expect(logSpy).toHaveBeenCalledTimes(1);
    } finally {
      errorSpy.mockRestore();
      logSpy.mockRestore();
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * 2. Behavioral redaction on the AI-gateway hot path (offline)
 * ────────────────────────────────────────────────────────────*/

describe("F-052: AI gateway emission scrubs key material (AGENTS §29 defense in depth)", () => {
  it("denies fail-closed (unconfigured) without emitting any key material", async () => {
    const seen: string[] = [];
    const outcome = await invokeAiGateway({
      tenantRef: "tenant-A",
      actorRef: "actor-1",
      model: "model-x",
      provider: "synthetic",
      purpose: "workflow_assistance",
      apiKey: "",
      invoke: async () => {
        throw new Error("must never be invoked when unconfigured");
      },
      logSink: (line) => seen.push(line),
      now: () => NOW_MS,
    });
    expect(outcome.decision).toBe("deny");
    if (outcome.decision === "deny") {
      expect(outcome.code).toBe("unconfigured");
    }
    const emitted = seen.join("\n");
    expect(emitted).toContain("unconfigured");
    assertNoFixtureMaterial(emitted);
  });

  it("scrubs the live key out of any emitted field even when a caller embeds it (tenantRef carries it)", async () => {
    const seen: string[] = [];
    // Rate limiter with a zero budget denies every check — deterministic
    // offline deny on the governed path, exercising the emit wrapper.
    const outcome = await invokeAiGateway({
      // The synthetic fixture key is deliberately embedded in tenantRef to
      // prove scrubValue removes key material from unexpected positions.
      tenantRef: `tenant-${FAKE_API_KEY}`,
      actorRef: "actor-1",
      model: "model-x",
      provider: "synthetic",
      purpose: "workflow_assistance",
      apiKey: FAKE_API_KEY,
      rateLimiter: createRateLimiter({ maxRequests: 0, windowMs: 60_000 }),
      invoke: async () => {
        throw new Error("must never be invoked when rate-limited");
      },
      logSink: (line) => seen.push(line),
      now: () => NOW_MS,
    });
    expect(outcome.decision).toBe("deny");
    if (outcome.decision === "deny") {
      expect(outcome.code).toBe("rate_limited");
    }
    const emitted = seen.join("\n");
    expect(emitted).toContain("[REDACTED]");
    assertNoFixtureMaterial(emitted);
  });

  it("usage counts are emitted as usage_in/usage_out (Part 29: 'token'-named keys are redacted) with no key material", async () => {
    const seen: string[] = [];
    const outcome = await invokeAiGateway({
      tenantRef: "tenant-A",
      actorRef: "actor-1",
      model: "model-x",
      provider: "synthetic",
      purpose: "workflow_assistance",
      apiKey: FAKE_API_KEY,
      invoke: async () => ({ payload: "ok", tokensIn: 1, tokensOut: 2 }),
      logSink: (line) => seen.push(line),
      now: () => NOW_MS,
    });
    expect(outcome.decision).toBe("allow");
    const emitted = seen.join("\n");
    expect(emitted).toContain("gateway.invoke.end");
    expect(emitted).toContain("usage_in");
    expect(emitted).toContain("usage_out");
    expect(emitted).not.toMatch(/"tokens?_/);
    assertNoFixtureMaterial(emitted);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 3. Static sweep over cited server modules (fs-based)
 * ────────────────────────────────────────────────────────────*/

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

/**
 * Cited modules: stable, pre-existing server-side surfaces that handle
 * credentials (AI keys, service-role keys, bearer tokens, payment secrets).
 * The list deliberately excludes modules owned by concurrently-running H3
 * teams. Read-only sweep — findings are reported, not fixed, per campaign
 * law (§ no destructive edits outside ownership).
 */
const CITED_MODULES: readonly { file: string; role: string }[] = [
  {
    file: "frontend/src/lib/ai-gateway.server.ts",
    role: "centralized AI gateway (§20) — credential-bearing decision logging hot path",
  },
  {
    file: "frontend/src/integrations/supabase/client.server.ts",
    role: "service-role server client (bypasses RLS; holds SUPABASE_SERVICE_ROLE_KEY)",
  },
  {
    file: "frontend/src/integrations/supabase/client.ts",
    role: "browser/SSR Supabase client (holds publishable key)",
  },
  {
    file: "frontend/src/integrations/supabase/auth-middleware.ts",
    role: "server auth middleware (validates bearer tokens)",
  },
  {
    file: "frontend/src/integrations/supabase/auth-attacher.ts",
    role: "client auth attach middleware (forwards session access tokens)",
  },
  {
    file: "frontend/src/lib/payments/paystack-adapter.ts",
    role: "Paystack webhook adapter (HMAC over the platform secret key)",
  },
  {
    file: "frontend/src/lib/payments/paystack-testmode.server.ts",
    role: "Paystack test-mode live surface (sk_test credentials on the wire)",
  },
  {
    file: "frontend/src/lib/payments/stripe-adapter.ts",
    role: "Stripe webhook adapter (whsec signing secret)",
  },
];

/**
 * Identifiers whose interpolation into a raw console call would violate
 * §29 — console bypasses the structured-log redaction pipeline entirely.
 */
const CREDENTIAL_SHAPED_IDENTIFIER =
  /(password|passwd|passphrase|secret|token|api[_-]?key|apikey|access[_-]?key|auth[_-]?key|private[_-]?key|service[_-]?role|credential|signing[_-]?key|bearer)/i;

/**
 * Literal shapes that indicate a committed real secret (prefix-only markers
 * such as `sk_test_` / `sb_secret_` / `whsec_` used in startsWith checks are
 * deliberately NOT matched — a class prefix is not secret material).
 */
const SECRET_SHAPED_LITERAL =
  /(sk_live_[A-Za-z0-9]{8,}|ghp_[A-Za-z0-9]{20,}|gho_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|AKIA[0-9A-Z]{16}|sb_secret_[A-Za-z0-9]{8,}|sb_secret_[a-z0-9!-/:-@[-`{-~]{8,}|-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----|xox[baprs]-[A-Za-z0-9-]{10,})/;

/** Console calls bypass the redaction pipeline: extract their full arg text. */
function extractConsoleCallArgs(source: string): { method: string; args: string }[] {
  const calls: { method: string; args: string }[] = [];
  const re = /console\.(log|error|warn|info|debug|trace)\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(source)) !== null) {
    let depth = 1;
    let i = re.lastIndex;
    const start = i;
    while (i < source.length && depth > 0) {
      const ch = source[i];
      if (ch === "(" || ch === "{" || ch === "[") {
        depth += 1;
      } else if (ch === ")" || ch === "}" || ch === "]") {
        depth -= 1;
      } else if (ch === '"' || ch === "'" || ch === "`") {
        const quote = ch;
        i += 1;
        while (i < source.length && source[i] !== quote) {
          if (source[i] === "\\") i += 1;
          i += 1;
        }
      }
      i += 1;
    }
    calls.push({ method: match[1], args: source.slice(start, Math.max(start, i - 1)) });
  }
  return calls;
}

function readCited(relFile: string): string {
  return readFileSync(path.resolve(REPO_ROOT, relFile), "utf8");
}

describe("F-052: static redaction sweep over cited server modules (AGENTS §29)", () => {
  it.each(CITED_MODULES.map((m) => [m.file, m.role] as const))(
    "%s exists and carries no credential-shaped console interpolation or secret-shaped literal",
    (relFile, _role) => {
      const source = readCited(relFile);
      expect(source.trim().length).toBeGreaterThan(0);

      // Rule 1: no raw console call interpolates a credential-shaped identifier.
      const consoleCalls = extractConsoleCallArgs(source);
      for (const call of consoleCalls) {
        expect(
          CREDENTIAL_SHAPED_IDENTIFIER.test(call.args),
          `${relFile}: console.${call.method}(${call.args.slice(0, 120)}) interpolates a credential-shaped identifier — §29 violation`,
        ).toBe(false);
        // Rule 1b: env credential variables are never echoed into console.
        expect(call.args, relFile).not.toMatch(/\$\{[^}]*SUPABASE_/);
      }

      // Rule 2: no secret-shaped literal is committed in the module.
      const secretLiteral = SECRET_SHAPED_LITERAL.exec(source);
      expect(
        secretLiteral,
        `${relFile}: secret-shaped literal found: ${secretLiteral?.[0]?.slice(0, 24) ?? ""}…`,
      ).toBeNull();
    },
  );

  it("AI gateway hot path routes ALL logging through the structured-log redaction pipeline", () => {
    const source = readCited("frontend/src/lib/ai-gateway.server.ts");

    // No raw console at all — every line flows through logStructured, which
    // applies sensitive-key redaction plus the gateway's own key scrubber.
    expect(extractConsoleCallArgs(source)).toHaveLength(0);

    // The redaction primitives are imported and actually used (presence
    // assertion, not exact-text matching).
    expect(source).toMatch(/from\s+"\.\/observability\/structured-log"/);
    expect(source).toContain("logStructured(");
    expect(source).toMatch(/import\s*{[^}]*\bREDACTED\b[^}]*}\s*from\s*"\.\/observability\/structured-log"/);
    expect(source).toMatch(/import\s*{[^}]*\bserializeError\b[^}]*}\s*from\s*"\.\/observability\/structured-log"/);

    // Defense-in-depth scrubber against the live key is present in the
    // emission path (Part 29: "no key material ever reaches a log line").
    expect(source).toContain("function scrubValue(");
    expect(source).toContain("scrubValue(value, secret)");
  });

  it("Supabase surfaces fail closed around their only console diagnostics (no env values in logs)", () => {
    for (const relFile of [
      "frontend/src/integrations/supabase/client.server.ts",
      "frontend/src/integrations/supabase/client.ts",
      "frontend/src/integrations/supabase/auth-middleware.ts",
    ]) {
      const source = readCited(relFile);
      // Their console calls are diagnostics before a fail-closed throw; the
      // only interpolated identifier is the generic message variable
      // (verified credential-free by the sweep rule above).
      for (const call of extractConsoleCallArgs(source)) {
        expect(call.method).toBe("error");
      }
      expect(source).toContain("throw new Error(");
      // The bearer/service-role credential values themselves are never
      // stringified into any log-adjacent expression.
      expect(source).not.toMatch(/console\.[a-z]+\([^)]*\$\{[^}]*(SERVICE_ROLE_KEY|PUBLISHABLE_KEY|access_token|supabaseKey)/);
    }
  });

  it("auth-attacher forwards session tokens in headers only — zero logging surface", () => {
    const source = readCited("frontend/src/integrations/supabase/auth-attacher.ts");
    expect(extractConsoleCallArgs(source)).toHaveLength(0);
    expect(source).toContain("access_token");
    // The token is used exclusively for the Authorization header, never
    // interpolated into any console/log expression.
    expect(source).toMatch(/Authorization:\s*`Bearer \$\{token\}`/);
    expect(source).not.toMatch(/console\./);
  });

  it("payment adapters expose structured deny results — zero console/logStructured surface", () => {
    for (const relFile of [
      "frontend/src/lib/payments/paystack-adapter.ts",
      "frontend/src/lib/payments/paystack-testmode.server.ts",
      "frontend/src/lib/payments/stripe-adapter.ts",
    ]) {
      const source = readCited(relFile);
      expect(extractConsoleCallArgs(source), relFile).toHaveLength(0);
      expect(source, relFile).not.toContain("logStructured");
      // Credential identifiers appear only as config fields, never inside a
      // logging call (there are no logging calls at all — asserted above).
    }
  });

  it("paystack test-mode deny reasons never echo the credential fixture", () => {
    const missing = validateTestModeKey("   ");
    expect(missing.ok).toBe(false);
    if (!missing.ok) {
      expect(missing.code).toBe("missing_key");
      assertNoFixtureMaterial(missing.reason);
    }

    const wrongClass = validateTestModeKey(FAKE_LIVE_KEY);
    expect(wrongClass.ok).toBe(false);
    if (!wrongClass.ok) {
      expect(wrongClass.code).toBe("non_test_key");
      assertNoFixtureMaterial(wrongClass.reason);
    }

    const fromEnv = paystackTestModeFromEnv(async () => {}, {
      PAYSTACK_SECRET_KEY: FAKE_LIVE_KEY,
    });
    expect(fromEnv.ok).toBe(false);
    if (!fromEnv.ok) {
      expect(fromEnv.code).toBe("non_test_key");
      assertNoFixtureMaterial(fromEnv.reason);
    }
  });

  it("stripe signature verification reasons never echo the signing-secret fixture (offline HMAC)", () => {
    const rawBody = new TextEncoder().encode('{"synthetic":"payload-052"}');
    const receivedAtSec = 1_700_000_000;
    const validSignature = createHmac("sha256", FAKE_SECRET)
      .update(`${receivedAtSec}.${Buffer.from(rawBody).toString("utf8")}`)
      .digest("hex");
    const request: WebhookRequest = {
      rawBody,
      headers: { "stripe-signature": `t=${receivedAtSec},v1=${validSignature}` },
      receivedAtSec,
    };

    // Correct signature verifies (the adapter works; proves the fixture path
    // is real, so the containment assertion below is meaningful).
    expect(verifyStripeSignature({ signingSecret: FAKE_SECRET }, request)).toEqual({ ok: true });

    // Tampered signature denies with a contained reason.
    const tampered: WebhookRequest = {
      ...request,
      headers: { "stripe-signature": `t=${receivedAtSec},v1=${"0".repeat(64)}` },
    };
    const mismatch = verifyStripeSignature({ signingSecret: FAKE_SECRET }, tampered);
    expect(mismatch.ok).toBe(false);
    if (!mismatch.ok) {
      expect(mismatch.code).toBe("signature_mismatch");
      assertNoFixtureMaterial(mismatch.reason);
    }
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
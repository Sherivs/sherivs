/**
 * M5 part B (ADR-108): public onboarding intake — validation, honeypot, rate limit, captcha,
 * token hashing, and that no token or hash leaks into a response or a log line.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import {
  INTAKE_ANSWERS_MAX_BYTES,
  IntakeRequestSchema,
  IntakeSaveSchema,
} from "@/lib/onboarding/intake";
import {
  generateResumeToken,
  hashResumeToken,
  loadIntakeSession,
  sameTokenHash,
  saveIntakeAnswers,
  submitIntake,
  verifyTurnstileToken,
  type IntakeDeps,
} from "@/lib/onboarding/intake.server";
import { validateIntakeValues, EMPTY_INTAKE_VALUES } from "@/lib/onboarding/intake-form";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (ref: string) => readFileSync(join(ROOT, ref), "utf8");

const valid = {
  orgName: "Northwind Academy",
  institutionType: "private_secondary",
  state: "Lagos",
  lga: "Ikeja",
  contactName: "Ada Obi",
  contactEmail: "ada@northwind.example",
  contactPhone: "+234 800 000 0000",
  contactRole: "",
  note: "",
  consent: true,
  source: "public_onboarding",
  website: "",
};

function makeDeps(overrides: Partial<IntakeDeps> = {}) {
  const logs: string[] = [];
  const rpc = vi.fn(async (fn: string, args: Record<string, unknown>) => {
    if (fn === "onboarding_intake_create") {
      return {
        data: [
          { session_id: "s-1", revision: 0, completion_pct: 0, expires_at: "2026-12-17T00:00:00Z" },
        ],
        error: null,
      };
    }
    if (fn === "onboarding_intake_load") {
      return {
        data: [
          {
            session_id: "s-1",
            resume_token_hash: args.p_token_hash,
            graph_version: "pending-graph",
            answers: { q1: "a" },
            revision: 2,
            completion_pct: 40,
            completed_at: null,
            expires_at: "2026-12-17T00:00:00Z",
          },
        ],
        error: null,
      };
    }
    return { data: [{ revision: 3 }], error: null };
  });
  const deps: IntakeDeps = {
    rpc,
    rateLimit: vi.fn(async () => ({ allowed: true as const })),
    captchaEnabled: false,
    verifyCaptcha: vi.fn(async () => true),
    log: (event, detail) => logs.push(JSON.stringify({ event, ...detail })),
    nowMs: () => Date.UTC(2026, 10, 17),
    randomToken: () => "T".repeat(43),
    ...overrides,
  };
  return { deps, rpc, logs };
}

describe("validation", () => {
  it("accepts a valid request and trims optional blanks to undefined", () => {
    const parsed = IntakeRequestSchema.parse(valid);
    expect(parsed.contactRole).toBeUndefined();
    expect(parsed.note).toBeUndefined();
  });
  it("refuses missing consent, bad email, bad phone, bad type and over-long values", () => {
    for (const bad of [
      { consent: false },
      { contactEmail: "nope" },
      { contactPhone: "call me" },
      { institutionType: "Private School!" },
      { orgName: "x".repeat(161) },
      { note: "n".repeat(2001) },
      { source: "web" },
    ]) {
      expect(IntakeRequestSchema.safeParse({ ...valid, ...bad }).success, JSON.stringify(bad)).toBe(
        false,
      );
    }
  });
  it("bounds the answers document at 64 KB", () => {
    const base = { resumeToken: "A".repeat(43), expectedRevision: 0, completionPct: 10 };
    expect(IntakeSaveSchema.safeParse({ ...base, answers: { q: "z".repeat(1000) } }).success).toBe(
      true,
    );
    expect(
      IntakeSaveSchema.safeParse({ ...base, answers: { q: "z".repeat(INTAKE_ANSWERS_MAX_BYTES) } })
        .success,
    ).toBe(false);
  });
  it("the form check marks fields with fixed messages, not the submitted values", () => {
    const errors = validateIntakeValues(
      { ...EMPTY_INTAKE_VALUES, contactEmail: "secret@" },
      "public_demo",
    );
    expect(Object.keys(errors)).toEqual(
      expect.arrayContaining(["orgName", "contactEmail", "consent"]),
    );
    expect(JSON.stringify(errors)).not.toContain("secret@");
  });
});

describe("submit", () => {
  it("stores only the sha-256 hash and returns the token once with a session view", async () => {
    const { deps, rpc, logs } = makeDeps();
    const result = await submitIntake(valid, "203.0.113.9", deps);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const token = "T".repeat(43);
    expect(result.resumeToken).toBe(token);
    const args = rpc.mock.calls[0]![1];
    expect(args.p_token_hash).toBe(hashResumeToken(token));
    expect(JSON.stringify(args)).not.toContain(token);
    expect(Object.keys(result.session).sort()).toEqual(
      ["completed", "completionPct", "expiresAt", "graphVersion", "revision"].sort(),
    );
    const response = JSON.stringify(result);
    expect(response).not.toContain(hashResumeToken(token));
    expect(response).not.toContain("ada@northwind.example");
    for (const line of logs) {
      expect(line).not.toContain(token);
      expect(line).not.toContain(hashResumeToken(token));
      expect(line).not.toContain("ada@");
      expect(line).not.toContain("203.0.113.9");
    }
  });

  it("a filled honeypot looks like success but stores nothing", async () => {
    const { deps, rpc, logs } = makeDeps();
    const result = await submitIntake(
      { ...valid, website: "http://spam.example" },
      "198.51.100.1",
      deps,
    );
    expect(result.ok).toBe(true);
    expect(rpc).not.toHaveBeenCalled();
    expect(logs.some((l) => l.includes("onboarding.intake.honeypot"))).toBe(true);
  });

  it("is rate limited by address before any validation or storage", async () => {
    const rateLimit = vi.fn(async () => ({ allowed: false as const, retryAfterSeconds: 120 }));
    const { deps, rpc } = makeDeps({ rateLimit });
    const result = await submitIntake({ junk: true }, "198.51.100.7", deps);
    expect(result).toEqual({ ok: false, code: "rate_limited", retryAfterSeconds: 120 });
    expect(rateLimit).toHaveBeenCalledWith("onboarding-intake-submit", "ip:198.51.100.7", {
      maxRequests: 5,
      windowMs: 600_000,
    });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("returns field names only on invalid input", async () => {
    const { deps } = makeDeps();
    const result = await submitIntake({ ...valid, contactEmail: "leak-me" }, "x", deps);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).not.toContain("leak-me");
  });

  it("requires and verifies Turnstile when the server holds a secret", async () => {
    const verifyCaptcha = vi.fn(async () => false);
    const { deps, rpc } = makeDeps({ captchaEnabled: true, verifyCaptcha });
    expect(await submitIntake(valid, "x", deps)).toEqual({ ok: false, code: "captcha_required" });
    expect(await submitIntake({ ...valid, captchaToken: "tok" }, "x", deps)).toEqual({
      ok: false,
      code: "captcha_required",
    });
    expect(verifyCaptcha).toHaveBeenCalledWith("tok", "x");
    expect(rpc).not.toHaveBeenCalled();
  });

  it("a database error is reported as unavailable, never as an existing email", async () => {
    const { deps } = makeDeps({ rpc: async () => ({ data: null, error: { code: "23505" } }) });
    expect(await submitIntake(valid, "x", deps)).toEqual({ ok: false, code: "unavailable" });
  });
});

describe("tokens and sessions", () => {
  it("generates 43-character base64url tokens and 64-hex hashes", () => {
    const a = generateResumeToken();
    const b = generateResumeToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(a).not.toBe(b);
    expect(hashResumeToken(a)).toMatch(/^[0-9a-f]{64}$/);
  });
  it("compares hashes in constant time and refuses malformed input", () => {
    const h = hashResumeToken("x");
    expect(sameTokenHash(h, h)).toBe(true);
    expect(sameTokenHash(h, hashResumeToken("y"))).toBe(false);
    expect(sameTokenHash("short", h)).toBe(false);
    expect(read("frontend/src/lib/onboarding/intake.server.ts")).toContain("timingSafeEqual");
  });
  it("load returns the session view and answers without the hash", async () => {
    const { deps } = makeDeps();
    const token = "A".repeat(43);
    const result = await loadIntakeSession({ resumeToken: token }, "x", deps);
    expect(result.ok).toBe(true);
    expect(JSON.stringify(result)).not.toContain(hashResumeToken(token));
  });
  it("load refuses a row whose hash does not match", async () => {
    const { deps } = makeDeps({
      rpc: async () => ({ data: [{ resume_token_hash: hashResumeToken("other") }], error: null }),
    });
    expect(await loadIntakeSession({ resumeToken: "A".repeat(43) }, "x", deps)).toEqual({
      ok: false,
      code: "not_found",
    });
  });
  it("maps a stale revision to stale", async () => {
    const { deps } = makeDeps({ rpc: async () => ({ data: null, error: { code: "PT409" } }) });
    const result = await saveIntakeAnswers(
      { resumeToken: "A".repeat(43), expectedRevision: 0, answers: {}, completionPct: 5 },
      "x",
      deps,
    );
    expect(result).toEqual({ ok: false, code: "stale" });
  });
  it("Turnstile verification fails closed on a network error", async () => {
    const failing = (async () => {
      throw new Error("down");
    }) as unknown as typeof fetch;
    expect(await verifyTurnstileToken("t", "x", "s", failing)).toBe(false);
  });
});

describe("forms no longer build a mailto as their primary action", () => {
  const screen = read("frontend/src/components/app-entry/app-onboarding-screen.tsx");
  const demo = read("frontend/src/components/public/demo-request-form.tsx");
  const route = read("frontend/src/routes/(site)/request-demo.tsx");
  it("submit goes to the intake endpoint", () => {
    for (const src of [screen, demo]) {
      expect(src).toContain("useIntakeForm");
      expect(src).toContain("onSubmit={form.onSubmit}");
      expect(src).not.toContain("window.location.href");
      expect(src).toContain("form.showFallback ?");
      expect(src).toContain("we will continue your interview by link");
    }
    expect(read("frontend/src/lib/onboarding/intake-form.ts")).toContain("submitOnboardingRequest");
    expect(route).toContain("DemoRequestForm");
    expect(route).not.toContain("MailtoForm");
  });
});

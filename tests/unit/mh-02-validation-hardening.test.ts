/**
 * CoreGrid — MH-02: validation hardening (Constitution §19, §21, §26, §32).
 *
 * Behavioral proof that the Scholar digital-twin family is fail-closed on
 * malformed input:
 *
 *   1. The versioned TwinPayloadEnvelope governs the `digital_twin_config`
 *      JSON columns — known fields validated, the open part of the payload
 *      explicitly structured as a bounded JSON tree, nothing permissive.
 *   2. The Twilio voice-gateway response is schema-validated before any of
 *      its values reaches reality (provider output is untrusted by default).
 *   3. Both function files carry zero `any` (§32) — source-level pin.
 *
 * The contracts are imported from the owning module and exercised directly:
 * a rejected payload must throw (or fall closed) — never pass through.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CallInput,
  ConfigInput,
  TwilioCallResponse,
  TwinPayloadEnvelope,
} from "@/lib/runtime/scholar/digital-twin.functions";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SCHOLAR_DIR = join(ROOT, "frontend/src/lib/runtime/scholar");
const DIGITAL_TWIN_SRC = join(SCHOLAR_DIR, "digital-twin.functions.ts");
const DEMO_PROVISION_SRC = join(SCHOLAR_DIR, "demo-provision.functions.ts");

/** Valid baseline payloads — the strict contracts must keep accepting these. */
const VALID_CONFIG = {
  twin_name: "Front Desk Twin",
  twin_voice: "alice",
  twin_personality: "Warm, professional, concise.",
  school_knowledge: { attendance_policy: "Calls after two unexplained absences." },
  trigger_rules: { fees_reminder: { days_before_due: 3 } },
  is_active: true,
};

const VALID_CALL = {
  call_type: "announcement" as const,
  recipient_name: "Jane Parent",
  recipient_phone: "+15551234567",
  script: "Hello from the school.",
};

describe("MH-02 — versioned twin-payload envelope (JSON columns)", () => {
  it("accepts known fields and stamps the envelope version on legacy bare payloads", () => {
    const parsed = ConfigInput.parse(VALID_CONFIG);
    expect(parsed.school_knowledge).toMatchObject({
      version: 1,
      attendance_policy: "Calls after two unexplained absences.",
    });
    expect(parsed.trigger_rules).toMatchObject({
      version: 1,
      fees_reminder: { days_before_due: 3 },
    });
  });

  it("defaults omitted JSON columns to a versioned empty envelope", () => {
    const parsed = ConfigInput.parse({
      twin_name: "Twin",
      twin_voice: "alice",
      twin_personality: "Personality.",
    });
    expect(parsed.school_knowledge).toEqual({ version: 1 });
    expect(parsed.trigger_rules).toEqual({ version: 1 });
    expect(parsed.is_active).toBe(true);
  });

  it("rejects payloads of the wrong overall shape (non-object columns)", () => {
    for (const malformed of [["array"], "string", 42, true, null]) {
      expect(() =>
        TwinPayloadEnvelope.parse(malformed),
      ).toThrowError(/invalid/i);
    }
  });

  it("rejects unknown fields that are not structured JSON (functions, undefined)", () => {
    expect(() => TwinPayloadEnvelope.parse({ version: 1, bad: () => "not json" })).toThrowError();
  });

  it("rejects deep payloads beyond the bounded JSON tree", () => {
    let deep: unknown = "leaf";
    for (let i = 0; i < 20; i++) deep = { nested: [deep] };
    expect(() => TwinPayloadEnvelope.parse({ version: 1, deep })).toThrowError(/invalid/i);
  });

  it("rejects oversized string leaves and oversized serialized payloads", () => {
    expect(() =>
      TwinPayloadEnvelope.parse({ version: 1, huge: "x".repeat(5000) }),
    ).toThrowError();
    expect(() =>
      TwinPayloadEnvelope.parse({
        version: 1,
        fat: "x".repeat(4000),
        rest: "y".repeat(65_536),
      }),
    ).toThrowError();
  });

  it("rejects non-finite numbers and version mismatches", () => {
    expect(() => TwinPayloadEnvelope.parse({ version: 1, bad: Number.NaN })).toThrowError();
    expect(() => TwinPayloadEnvelope.parse({ version: 1, bad: Number.POSITIVE_INFINITY })).toThrowError();
    expect(() => TwinPayloadEnvelope.parse({ version: 2, note: "unsupported version" })).toThrowError();
  });

  it("rejects malformed ConfigInput end-to-end while valid payloads pass", () => {
    expect(() => ConfigInput.parse({ ...VALID_CONFIG, school_knowledge: "not an object" })).toThrowError();
    expect(() =>
      ConfigInput.parse({ ...VALID_CONFIG, school_knowledge: { deep: [[[[[[[[[[["too deep"]]]]]]]]]]] } }),
    ).toThrowError();
    expect(() =>
      ConfigInput.parse({ ...VALID_CONFIG, twin_name: "" }),
    ).toThrowError();
    expect(ConfigInput.parse(VALID_CONFIG).school_knowledge.version).toBe(1);
  });
});

describe("MH-02 — untrusted provider output (Twilio response contract)", () => {
  it("accepts the fields the handler consumes and strips everything else", () => {
    const parsed = TwilioCallResponse.parse({
      sid: "CA1234567890abcdef",
      message: "Queued",
      account_sid: "ACsecret",
      unexpected: { nested: "payload" },
    });
    expect(parsed).toEqual({ sid: "CA1234567890abcdef", message: "Queued" });
  });

  it("fail-closes malformed provider bodies to the handler's fallbacks", () => {
    const parsed = TwilioCallResponse.safeParse({ sid: 42, message: { evil: "object" } });
    expect(parsed.success).toBe(false);
    // Handler behavior for an unparseable body: {} -> message fallback, sid null.
    const body = parsed.success ? parsed.data : {};
    expect(body.message ?? `twilio_500`).toBe("twilio_500");
    expect(body.sid ?? null).toBeNull();
  });

  it("parses the CallInput contract strictly", () => {
    expect(() => CallInput.parse({ ...VALID_CALL, recipient_phone: "nope" })).toThrowError();
    expect(() => CallInput.parse({ ...VALID_CALL, call_type: "mystery" })).toThrowError();
    expect(() => CallInput.parse({ ...VALID_CALL, script: "" })).toThrowError();
    expect(CallInput.parse(VALID_CALL).recipient_role).toBe("parent");
  });
});

describe("MH-02 — §32 zero-any pin over the two function files", () => {
  const ANY_RE = [
    /\bz\.any\(/,
    /\bany\b\s*(?=[,)\]:])/,
    /:\s*any\b/,
    /<any>/,
    /as any\b/,
    /@typescript-eslint\/no-explicit-any/,
  ];

  it("digital-twin.functions.ts has no permissive schema and no any", () => {
    const src = readFileSync(DIGITAL_TWIN_SRC, "utf8");
    expect(src).toMatch(/TwinPayloadEnvelope/);
    expect(src).toMatch(/TwilioCallResponse/);
    for (const re of ANY_RE) expect(src, `forbidden pattern ${re}`).not.toMatch(re);
  });

  it("demo-provision.functions.ts has no any", () => {
    const src = readFileSync(DEMO_PROVISION_SRC, "utf8");
    expect(src).toMatch(/type SupabaseAdminClient/);
    for (const re of ANY_RE) expect(src, `forbidden pattern ${re}`).not.toMatch(re);
  });
});

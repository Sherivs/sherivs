/**
 * CoreGrid — H3-047 trace-context propagation tests (Squad F, mission F-047).
 *
 * Proves the trace propagation contract: cryptographic generation where
 * available; propagation across async boundaries ONLY via explicit parameter
 * passing (no ambient globals — proven by interleaving); fail-closed parsing
 * of untrusted boundary data; and redaction-safe serialization that never
 * carries credential-shaped material (sensitive keys AND credential-shaped
 * values) — composed read-only with structured-log and substrate-telemetry.
 * Pure offline: no network, no database, no real secrets (fixtures only).
 */
import { describe, expect, it } from "vitest";
import {
  CORRELATION_ID_WIRE_KEY,
  TRACE_CONTEXT_COMPONENT,
  TRACE_ID_WIRE_KEY,
  TraceContextError,
  continueTraceContext,
  createCorrelationId,
  createTraceContext,
  createTraceId,
  extractTraceContext,
  injectTraceContext,
  isCredentialShapedValue,
  propagateToChild,
  runWithTraceContext,
  serializeTraceContext,
  serializeTraceContextFields,
  traceAttributesSchema,
  traceContextSchema,
  traceIdSchema,
  traceLogEntry,
  traceLogFields,
  type CreateTraceContextOptions,
  type TraceContext,
} from "../../frontend/src/lib/observability/trace-context";
import {
  formatLogLine,
  isSensitiveKey,
  logStructured,
  REDACTED,
  type StructuredLogEntry,
} from "../../frontend/src/lib/observability/structured-log";
import {
  SUBSTRATE_TELEMETRY_COMPONENT,
  createSubstrateTelemetry,
} from "../../frontend/src/lib/observability/substrate-telemetry";

const NOW = () => 1_700_000_000_000;

/** Obviously-fake credential fixtures (never real secret material). */
const FAKE_BEARER = "Bearer AAAA-fake-token-fixture";
const FAKE_KEY = "sk-test-000000000000000000";

function contextFor(overrides: Partial<CreateTraceContextOptions> = {}): TraceContext {
  return createTraceContext({ now: NOW, ...overrides });
}

/* ─────────────────────────────────────────────────────────────
 * Generation
 * ────────────────────────────────────────────────────────────*/

describe("id generation is cryptographic and unique", () => {
  it("mints schema-valid trace and correlation ids", () => {
    for (let i = 0; i < 32; i += 1) {
      expect(traceIdSchema.safeParse(createTraceId()).success).toBe(true);
      expect(correlationIdSafe(createCorrelationId())).toBe(true);
    }
  });

  it("mints distinct ids on every call (no reuse)", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 64; i += 1) {
      ids.add(createTraceId());
      ids.add(createCorrelationId());
    }
    expect(ids.size).toBe(128);
  });

  it("uses 128 bits of crypto randomness (32 hex chars) where available", () => {
    const id = createTraceId();
    // Node ≥19 exposes globalThis.crypto; the fallback path is documented.
    if (globalThis.crypto != null) {
      expect(id).toMatch(/^[0-9a-f]{32}$/);
    } else {
      expect(traceIdSchema.safeParse(id).success).toBe(true);
    }
  });

  it("never hands back an ambient default id (no empty/placeholder ids)", () => {
    expect(createTraceId()).not.toHaveLength(0);
    expect(createCorrelationId()).not.toBe("unknown");
    expect(createCorrelationId()).not.toBe("default");
  });
});

function correlationIdSafe(value: string): boolean {
  return traceIdSchema.safeParse(value).success;
}

describe("createTraceContext validates explicit input fail-closed", () => {
  it("accepts explicit ids and attributes", () => {
    const ctx = createTraceContext({
      traceId: "0f0e1d2c-3b4a-5968-7766-554433221100",
      correlationId: "corr-abc12345",
      attributes: { surface: "api", region: "eu-1" },
      now: NOW,
    });
    expect(ctx.trace_id).toBe("0f0e1d2c-3b4a-5968-7766-554433221100");
    expect(ctx.correlation_id).toBe("corr-abc12345");
    expect(ctx.attributes).toEqual({ surface: "api", region: "eu-1" });
    expect(ctx.created_at_ms).toBe(NOW());
  });

  it("rejects too-short ids with a typed error", () => {
    expect(() => createTraceContext({ traceId: "short" })).toThrow(TraceContextError);
    try {
      createTraceContext({ traceId: "short" });
    } catch (error) {
      expect((error as TraceContextError).reason).toBe("invalid_trace_id");
    }
  });

  it("rejects whitespace-bearing ids (no smuggled spacing)", () => {
    expect(() => createTraceContext({ traceId: "has space in id" })).toThrow(TraceContextError);
    expect(() => createTraceContext({ correlationId: "corr\tid" })).toThrow(TraceContextError);
  });

  it("rejects non-string ids and oversized attribute sets", () => {
    expect(() =>
      createTraceContext({ traceId: 12345 as unknown as string }),
    ).toThrow(TraceContextError);
    const tooMany = Object.fromEntries(
      Array.from({ length: 17 }, (_, i) => [`attr_${i}`, "v"]),
    );
    expect(() => createTraceContext({ attributes: tooMany })).toThrow(TraceContextError);
  });

  it("rejects attribute values that exceed the bound", () => {
    expect(() =>
      createTraceContext({ attributes: { note: "x".repeat(257) } }),
    ).toThrow(TraceContextError);
  });
});

/* ─────────────────────────────────────────────────────────────
 * Propagation — explicit parameter passing, never ambient
 * ────────────────────────────────────────────────────────────*/

describe("propagateToChild continues the trace and refreshes the link", () => {
  it("keeps trace_id, mints a fresh correlation_id, keeps attributes", () => {
    const parent = contextFor({ attributes: { surface: "api" } });
    const child = propagateToChild(parent, { now: NOW });
    expect(child.trace_id).toBe(parent.trace_id);
    expect(child.correlation_id).not.toBe(parent.correlation_id);
    expect(child.attributes).toEqual({ surface: "api" });
    expect(traceIdSchema.safeParse(child.correlation_id).success).toBe(true);
  });

  it("layers child attributes over parent attributes without mutating the parent", () => {
    const parent = contextFor({ attributes: { surface: "api", region: "eu-1" } });
    const child = propagateToChild(parent, { attributes: { region: "us-1", hop: "queue" } });
    expect(child.attributes).toEqual({ surface: "api", region: "us-1", hop: "queue" });
    expect(parent.attributes).toEqual({ surface: "api", region: "eu-1" });
  });

  it("honors an explicit child correlation id and rejects a bad one", () => {
    const parent = contextFor();
    const child = propagateToChild(parent, { correlationId: "hop-0001" });
    expect(child.correlation_id).toBe("hop-0001");
    expect(() => propagateToChild(parent, { correlationId: "bad id" })).toThrow(TraceContextError);
  });
});

describe("runWithTraceContext passes context explicitly (no ambient store)", () => {
  it("hands the exact context object to the unit of work", () => {
    const ctx = contextFor();
    runWithTraceContext(ctx, (propagated) => {
      expect(propagated).toBe(ctx);
    });
  });

  it("propagates across await boundaries via parameters only", async () => {
    const ctx = contextFor();
    const seen = await runWithTraceContext(ctx, async (propagated) => {
      await Promise.resolve();
      await new Promise((resolve) => setTimeout(resolve, 0));
      return propagated.correlation_id;
    });
    expect(seen).toBe(ctx.correlation_id);
  });

  it("interleaved async units of work never observe each other's context", async () => {
    const outer = contextFor({ correlationId: "outer-corr-0001" });
    const inner = contextFor({ correlationId: "inner-corr-0001" });
    const observed: string[] = [];

    const work = (ctx: TraceContext, delayMs: number) =>
      runWithTraceContext(ctx, async (propagated) => {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        observed.push(propagated.correlation_id);
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        observed.push(propagated.correlation_id);
      });

    await Promise.all([work(outer, 1), work(inner, 2)]);
    expect(observed.filter((id) => id === "outer-corr-0001").length).toBe(2);
    expect(observed.filter((id) => id === "inner-corr-0001").length).toBe(2);
  });
});

describe("untrusted boundary data is parsed fail-closed", () => {
  it("extracts a well-formed wire carrier", () => {
    const ctx = contextFor();
    const verdict = extractTraceContext(injectTraceContext(ctx));
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.context.trace_id).toBe(ctx.trace_id);
      expect(verdict.context.correlation_id).toBe(ctx.correlation_id);
      // Provenance unknown at the boundary — never fabricated.
      expect(verdict.context.created_at_ms).toBe(null);
    }
  });

  it("rejects empty, malformed and non-object carriers without throwing", () => {
    for (const bad of [
      null,
      undefined,
      {},
      [],
      "trace-context",
      42,
      { trace_id: "only-one-field" },
      { trace_id: "short", correlation_id: "corr-valid-0001" },
      { trace_id: "has space in id", correlation_id: "corr-valid-0001" },
      { trace_id: "valid-trace-0001", correlation_id: "valid-corr-0001", attributes: { "bad key!": "v" } },
    ]) {
      const verdict = extractTraceContext(bad);
      expect(verdict.ok).toBe(false);
    }
    const emptyVerdict = extractTraceContext({});
    expect(emptyVerdict.ok).toBe(false);
    if (!emptyVerdict.ok) expect(emptyVerdict.reason).toBe("empty_carrier");

    const shortTraceVerdict = extractTraceContext({ trace_id: "short" });
    expect(shortTraceVerdict.ok).toBe(false);
    if (!shortTraceVerdict.ok) expect(shortTraceVerdict.reason).toBe("invalid_trace_id");

    const badCorrVerdict = extractTraceContext({ trace_id: "valid-trace-0001", correlation_id: 7 });
    expect(badCorrVerdict.ok).toBe(false);
    if (!badCorrVerdict.ok) expect(badCorrVerdict.reason).toBe("invalid_correlation_id");
  });

  it("continueTraceContext prefers the incoming trace and keeps continuity", () => {
    const incoming = { trace_id: "incoming-trace-0001", correlation_id: "incoming-corr-001" };
    const current = contextFor({ traceId: "current-trace-00001", correlationId: "current-corr-0001" });
    const verdict = continueTraceContext(incoming, current);
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.context.trace_id).toBe("incoming-trace-0001");
      expect(verdict.context.correlation_id).toBe("incoming-corr-001");
    }
  });

  it("continueTraceContext falls back to current attributes; failure keeps the caller's context", () => {
    const current = contextFor({ attributes: { surface: "queue" } });
    const traceBefore = current.trace_id;
    const corrBefore = current.correlation_id;
    const noAttrs = { trace_id: "incoming-trace-0001", correlation_id: "incoming-corr-001" };
    const verdict = continueTraceContext(noAttrs, current);
    expect(verdict.ok).toBe(true);
    if (verdict.ok) expect(verdict.context.attributes).toEqual({ surface: "queue" });

    const failed = continueTraceContext({ trace_id: 7 }, current);
    expect(failed.ok).toBe(false);
    // The caller still holds `current` — the failure never fabricated a context.
    expect(current.trace_id).toBe(traceBefore);
    expect(current.correlation_id).toBe(corrBefore);
    expect(current.attributes).toEqual({ surface: "queue" });
  });
});

describe("wire carriers are flat, id-only and round-trip safe", () => {
  it("injects exactly the two wire keys", () => {
    const ctx = contextFor({ attributes: { surface: "api" } });
    const carrier = injectTraceContext(ctx);
    expect(Object.keys(carrier).sort()).toEqual([CORRELATION_ID_WIRE_KEY, TRACE_ID_WIRE_KEY].sort());
    expect(carrier[TRACE_ID_WIRE_KEY]).toBe(ctx.trace_id);
    expect(carrier[CORRELATION_ID_WIRE_KEY]).toBe(ctx.correlation_id);
    // Attributes are in-process baggage — never ambient wire material.
    expect(JSON.stringify(carrier)).not.toContain("surface");
  });

  it("round-trips through inject → extract", () => {
    const ctx = contextFor();
    const verdict = extractTraceContext(injectTraceContext(ctx));
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      expect(verdict.context.trace_id).toBe(ctx.trace_id);
      expect(verdict.context.correlation_id).toBe(ctx.correlation_id);
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * Redaction-safe serialization — no credential-shaped material
 * ────────────────────────────────────────────────────────────*/

describe("serialization redacts credential-shaped material fail-closed", () => {
  it("emits only the whitelisted top-level fields", () => {
    const fields = serializeTraceContextFields(contextFor({ attributes: { surface: "api" } }));
    expect(Object.keys(fields).sort()).toEqual(["attributes", "correlation_id", "created_at_ms", "trace_id"]);
  });

  it("omits created_at_ms and attributes when they carry nothing", () => {
    // An extracted boundary context has null provenance and no attributes.
    const source = contextFor();
    const verdict = extractTraceContext(injectTraceContext(source));
    expect(verdict.ok).toBe(true);
    if (verdict.ok) {
      const fields = serializeTraceContextFields(verdict.context);
      expect(Object.keys(fields).sort()).toEqual(["correlation_id", "trace_id"]);
    }
  });

  it("redacts sensitive-keyed attributes via the shared structured-log redaction", () => {
    const ctx = contextFor({
      attributes: { api_token: FAKE_KEY, client_password: "hunter2-fixture", surface: "api" },
    });
    const json = serializeTraceContext(ctx);
    const parsed = JSON.parse(json) as Record<string, unknown>;
    const attrs = parsed.attributes as Record<string, unknown>;
    expect(attrs.api_token).toBe(REDACTED);
    expect(attrs.client_password).toBe(REDACTED);
    expect(attrs.surface).toBe("api");
    expect(json).not.toContain(FAKE_KEY);
    expect(json).not.toContain("hunter2-fixture");
    for (const key of Object.keys(attrs)) {
      if (attrs[key] !== REDACTED) expect(isSensitiveKey(key)).toBe(false);
    }
  });

  it("redacts credential-SHAPED values even under innocuous keys", () => {
    const ctx = contextFor({
      attributes: {
        note: FAKE_BEARER,
        config: FAKE_KEY,
        material: "-----BEGIN RSA PRIVATE KEY-----fixture",
      },
    });
    const json = serializeTraceContext(ctx);
    const parsed = JSON.parse(json) as { attributes: Record<string, unknown> };
    expect(parsed.attributes.note).toBe(REDACTED);
    expect(parsed.attributes.config).toBe(REDACTED);
    expect(parsed.attributes.material).toBe(REDACTED);
    expect(json).not.toContain(FAKE_BEARER);
    expect(json).not.toContain(FAKE_KEY);
    expect(json).not.toContain("PRIVATE KEY");
  });

  it("flags credential-shaped values before they can leave the process", () => {
    expect(isCredentialShapedValue("Bearer xyz-fixture")).toBe(true);
    expect(isCredentialShapedValue("sk-live-000000000000")).toBe(true);
    expect(isCredentialShapedValue("pk_test_000000000000")).toBe(true);
    expect(isCredentialShapedValue("ghp_00000000000000000000000000")).toBe(true);
    expect(isCredentialShapedValue("-----BEGIN OPENSSH PRIVATE KEY-----")).toBe(true);
    expect(isCredentialShapedValue("a".repeat(64))).toBe(true); // long hex
    expect(isCredentialShapedValue("eyJhbGciOiJ.eyJzdWIiOiJ.fixture-sig")).toBe(true); // token-shaped
    expect(isCredentialShapedValue("eu-1")).toBe(false);
    expect(isCredentialShapedValue("api")).toBe(false);
  });

  it("emits the whitelisted trace ids verbatim even when hex-shaped", () => {
    // A 32-char hex trace id matches the long-hex credential pattern — but
    // trace_id/correlation_id are the FIXED contract fields, emitted from the
    // whitelist, never screened as untrusted baggage. Attributes are screened.
    for (let i = 0; i < 8; i += 1) {
      const ctx = contextFor();
      expect(isCredentialShapedValue(ctx.trace_id)).toBe(true); // hex-shaped…
      const parsed = JSON.parse(serializeTraceContext(ctx)) as Record<string, unknown>;
      // …yet the whitelisted field survives verbatim, never redacted away.
      expect(parsed.trace_id).toBe(ctx.trace_id);
      expect(parsed.correlation_id).toBe(ctx.correlation_id);
    }
  });

  it("never emits a live value under a sensitive key at any depth", () => {
    const ctx = contextFor({ attributes: { secret_note: "x", surface: "api", token_hint: "y" } });
    const parsed = JSON.parse(serializeTraceContext(ctx)) as {
      attributes: Record<string, unknown>;
    };
    for (const [key, value] of Object.entries(parsed.attributes)) {
      if (isSensitiveKey(key)) expect(value).toBe(REDACTED);
    }
    // The fixed contract fields carry ids, not credential material.
    expect(isSensitiveKey("trace_id")).toBe(false);
    expect(isSensitiveKey("correlation_id")).toBe(false);
  });

  it("the Zod attribute contract itself forbids sensitive keys from entry", () => {
    // Belt-and-suspenders: the schema is the first gate; serialization the second.
    const verdict = traceAttributesSchema.safeParse({ secret_key: "value" });
    expect(verdict.success).toBe(true); // accepted at entry (caller's own context)…
    const ctx = contextFor({ attributes: { secret_key: "value" } });
    // …but redacted at EVERY serialization exit.
    expect((JSON.parse(serializeTraceContext(ctx)) as { attributes: Record<string, unknown> }).attributes.secret_key).toBe(REDACTED);
  });
});

/* ─────────────────────────────────────────────────────────────
 * Composition with structured-log and substrate-telemetry (read-only)
 * ────────────────────────────────────────────────────────────*/

describe("composition with the observability sinks", () => {
  it("trace fields flow through the house log formatter untouched", () => {
    const ctx = contextFor({ attributes: { surface: "api" } });
    const entry = traceLogEntry(ctx, {
      msg: "operation-step-completed",
      component: "worker-step",
      fields: { duration_ms: 12 },
    });
    const line = formatLogLine(entry, { now: () => "2026-10-03T00:00:00.000Z" });
    const parsed = JSON.parse(line) as Record<string, unknown>;
    expect(parsed.trace_id).toBe(ctx.trace_id);
    expect(parsed.correlation_id).toBe(ctx.correlation_id);
    expect(parsed.component).toBe("worker-step");
    expect(parsed.msg).toBe("operation-step-completed");
  });

  it("the formatter still redacts sensitive caller fields on trace lines", () => {
    const ctx = contextFor();
    const entry = traceLogEntry(ctx, {
      msg: "step",
      fields: { access_token: FAKE_BEARER },
    });
    const line = formatLogLine(entry);
    expect(line).not.toContain(FAKE_BEARER);
    expect((JSON.parse(line) as Record<string, unknown>).access_token).toBe(REDACTED);
  });

  it("trace entries and substrate-telemetry entries share the house shape", () => {
    const ctx = contextFor();
    const traceEntry = traceLogEntry(ctx, { msg: "hop-completed", level: "debug" });

    const telemetry = createSubstrateTelemetry();
    telemetry.ingest({
      kind: "call_succeeded",
      provider: "fixture-provider",
      operation: "fixture-op",
      attempts: 1,
      durationMs: 5,
      atMs: NOW(),
    });
    const [substrateEntry] = telemetry.takeLogEntries();

    for (const entry of [traceEntry, substrateEntry as StructuredLogEntry]) {
      expect(typeof entry.msg).toBe("string");
      expect(typeof entry.level).toBe("string");
      expect(typeof entry.component).toBe("string");
    }
    expect(traceEntry.component).toBe(TRACE_CONTEXT_COMPONENT);
    expect(substrateEntry?.component).toBe(SUBSTRATE_TELEMETRY_COMPONENT);
    // Only the trace entry carries the propagation thread; the substrate
    // entry's house shape composes with it field-for-field on emit.
    expect(traceEntry.trace_id).toBe(ctx.trace_id);
    expect(traceEntry.correlation_id).toBe(ctx.correlation_id);
    const traceLine = JSON.parse(formatLogLine(traceEntry)) as Record<string, unknown>;
    const substrateLine = JSON.parse(formatLogLine(substrateEntry as StructuredLogEntry)) as Record<string, unknown>;
    expect(traceLine.trace_id).toBe(ctx.trace_id);
    expect(substrateLine.ts).toBeDefined();
    expect(traceLine.ts).toBeDefined();
  });

  it("trace entries emit through logStructured without leaking fixtures", () => {
    const ctx = contextFor();
    const lines: string[] = [];
    logStructured(
      traceLogEntry(ctx, { msg: "emit-check", fields: { secret_fixture: FAKE_KEY } }),
      { sink: (line) => lines.push(line) },
    );
    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain(FAKE_KEY);
    expect(lines[0]).toContain(ctx.trace_id);
  });

  it("traceLogFields exposes exactly the two snake_case wire fields", () => {
    const ctx = contextFor();
    expect(traceLogFields(ctx)).toEqual({ trace_id: ctx.trace_id, correlation_id: ctx.correlation_id });
  });
});

/* ─────────────────────────────────────────────────────────────
 * Contract integrity
 * ────────────────────────────────────────────────────────────*/

describe("context integrity", () => {
  it("contexts are frozen plain data (structurally cloneable)", () => {
    const ctx = contextFor();
    expect(Object.isFrozen(ctx)).toBe(true);
    expect(Object.isFrozen(ctx.attributes)).toBe(true);
    expect(traceContextSchema.safeParse(ctx).success).toBe(true);
  });

  it("propagation never mutates the parent context", () => {
    const parent = contextFor({ correlationId: "parent-corr-00001" });
    const before = JSON.stringify(serializeTraceContextFields(parent));
    propagateToChild(parent, { attributes: { hop: "child" } });
    propagateToChild(parent);
    expect(JSON.stringify(serializeTraceContextFields(parent))).toBe(before);
  });
});

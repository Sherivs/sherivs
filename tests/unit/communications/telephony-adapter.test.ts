/**
 * CoreGrid — V1-009: TelephonyAdapter contract tests (Twilio + Vapi stub).
 *
 * Proves:
 * 1. Contract compliance — both adapters satisfy `TelephonyAdapter`, and the
 *    Twilio adapter wraps the EXACT voice-gateway interaction the scholar
 *    digital-twin call site performs today (same credential precedence, same
 *    request shape, same bounded response contract).
 * 2. Fail-closed no-credential behavior — the typed BLOCKED_NO_CREDENTIAL
 *    result naming the missing env vars, with ZERO provider contact.
 * 3. The Vapi stub is credential-gated AND not-for-live-use: it never
 *    contacts the network in any credential state and never fabricates a
 *    receipt.
 * 4. Retry semantics — a call is a single transport attempt; `retryable`
 *    follows 408/429/5xx.
 * 5. Secret hygiene — credential values never appear in any result.
 *
 * No real provider and no real network is ever contacted: fetch is mocked.
 */
import { afterEach, describe, expect, it, vi, type MockInstance } from "vitest";
import {
  createTwilioVoiceAdapter,
  createTwilioVoiceProviderRegistry,
  DEFAULT_TWILIO_GATEWAY_URL,
  twilioVoiceConfigFromEnv,
  TWILIO_API_KEY_ENV,
  TWILIO_CREDENTIAL_REFERENCE,
  TWILIO_FROM_NUMBER_ENV,
  TWILIO_GATEWAY_BEARER_FALLBACK_ENV,
  TWILIO_GATEWAY_URL_ENV,
  TWILIO_VOICE_PROVIDER_ID,
  type ServerEnv,
} from "../../../frontend/src/lib/communications/twilio-voice.server";
import {
  createVapiVoiceAdapter,
  createVapiVoiceProviderRegistry,
  vapiVoiceConfigFromEnv,
  VAPI_API_KEY_ENV,
  VAPI_CREDENTIAL_REFERENCE,
  VAPI_VOICE_PROVIDER_ID,
} from "../../../frontend/src/lib/communications/vapi-voice.server";
import {
  isTelephonyCallReceipt,
  withTelephonyFailurePolicy,
  type TelephonyAdapter,
  type TelephonyCallCommand,
  type TelephonyCallFailure,
  type TelephonyCallResult,
  type TelephonyProviderRegistry,
} from "../../../frontend/src/lib/communications/telephony-adapter-contract";
import { createAdapterFailurePolicy } from "../../../frontend/src/lib/adapters/failure-policy";

const SENTINEL_GATEWAY_KEY = "twilio-unit-test-gateway-sentinel";
const SENTINEL_CONNECTION_KEY = "twilio-unit-test-connection-sentinel";
const SENTINEL_FROM = "+15550000000";
const SENTINEL_VAPI_KEY = "vapi-unit-test-sentinel";

function makeCommand(overrides: Partial<TelephonyCallCommand> = {}): TelephonyCallCommand {
  return {
    callKind: "attendance_alert",
    tenantRef: "tenant-a",
    recipientName: "Jane Parent",
    recipientPhone: "+15551234567",
    script: "Hello from the school.",
    triggerEvent: null,
    ...overrides,
  };
}

function twilioEnv(overrides: ServerEnv = {}): ServerEnv {
  return {
    [TWILIO_GATEWAY_BEARER_FALLBACK_ENV]: SENTINEL_GATEWAY_KEY,
    [TWILIO_API_KEY_ENV]: SENTINEL_CONNECTION_KEY,
    [TWILIO_FROM_NUMBER_ENV]: SENTINEL_FROM,
    ...overrides,
  };
}

function configuredTwilioRegistry(env: ServerEnv = twilioEnv()): TelephonyProviderRegistry {
  return createTwilioVoiceProviderRegistry(env);
}

function vapiEnv(key: string | null): ServerEnv {
  return key === null ? {} : { [VAPI_API_KEY_ENV]: key };
}

let fetchMock: MockInstance | null = null;

function mockFetch(handler: () => Response | Promise<Response>): MockInstance {
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => handler());
  fetchMock = spy;
  return spy;
}

/** Type-guard assertion: narrows the result to the failure variant for `.reason` checks. */
function assertNotReceipt(result: TelephonyCallResult): asserts result is TelephonyCallFailure {
  if (isTelephonyCallReceipt(result)) throw new Error("expected a failure result, got a receipt");
}

afterEach(() => {
  fetchMock?.mockRestore();
  fetchMock = null;
});

describe("Twilio voice adapter — credential resolution (env precedence)", () => {
  it("resolves null when any required credential is absent", () => {
    expect(twilioVoiceConfigFromEnv({})).toBeNull();
    expect(twilioVoiceConfigFromEnv({ [TWILIO_API_KEY_ENV]: SENTINEL_CONNECTION_KEY })).toBeNull();
    expect(twilioVoiceConfigFromEnv({ [TWILIO_FROM_NUMBER_ENV]: SENTINEL_FROM })).toBeNull();
  });

  it("accepts TWILIO_API_KEY alone as the gateway bearer (no AI_API_KEY)", () => {
    const config = twilioVoiceConfigFromEnv({
      [TWILIO_API_KEY_ENV]: SENTINEL_CONNECTION_KEY,
      [TWILIO_FROM_NUMBER_ENV]: SENTINEL_FROM,
    });
    expect(config).not.toBeNull();
    expect(config?.gatewayUrl).toBe(DEFAULT_TWILIO_GATEWAY_URL);
  });

  it("prefers AI_API_KEY as the gateway bearer and honors TWILIO_GATEWAY_URL", () => {
    const config = twilioVoiceConfigFromEnv(
      twilioEnv({ [TWILIO_GATEWAY_URL_ENV]: "https://gateway.example.test/2010-04-01" }),
    );
    expect(config?.gatewayKey).toBe(SENTINEL_GATEWAY_KEY);
    expect(config?.connectionKey).toBe(SENTINEL_CONNECTION_KEY);
    expect(config?.gatewayUrl).toBe("https://gateway.example.test/2010-04-01");
  });

  it("exposes a credential REFERENCE (pointer), never the credential value", () => {
    const registry = configuredTwilioRegistry();
    expect(registry.credentialReferenceFor(TWILIO_VOICE_PROVIDER_ID)).toBe("env://TWILIO_API_KEY");
    expect(registry.credentialReferenceFor(TWILIO_VOICE_PROVIDER_ID)).not.toBe(
      SENTINEL_CONNECTION_KEY,
    );
    expect(registry.credentialReferenceFor("vapi")).toBeNull();
    expect(registry.isProviderConfigured("vapi")).toBe(false);
  });
});

describe("Twilio voice adapter — fail-closed no-credential (BLOCKED_NO_CREDENTIAL)", () => {
  it("blocks with the typed result when credentials are absent, and contacts nothing", async () => {
    mockFetch(() => {
      throw new Error("provider must never be contacted without credentials");
    });
    const adapter = createTwilioVoiceAdapter(null);
    const result = await adapter.placeCall(makeCommand(), configuredTwilioRegistry({}));

    expect(isTelephonyCallReceipt(result)).toBe(false);
    assertNotReceipt(result);
    expect(result).toMatchObject({ outcome: "undeliverable", code: "provider_not_configured" });
    expect(result.reason).toContain("BLOCKED_NO_CREDENTIAL");
    expect(result.reason).toContain(TWILIO_API_KEY_ENV);
    expect(result.reason).toContain(TWILIO_FROM_NUMBER_ENV);
    expect(result.reason).toContain("no provider call was attempted");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still blocks when a registry lies about configuration (defense in depth)", async () => {
    mockFetch(() => {
      throw new Error("provider must never be contacted without credentials");
    });
    const adapter = createTwilioVoiceAdapter(null);
    const lyingRegistry: TelephonyProviderRegistry = {
      isProviderConfigured: () => true,
      credentialReferenceFor: () => TWILIO_CREDENTIAL_REFERENCE,
    };
    const result = await adapter.placeCall(makeCommand(), lyingRegistry);
    expect(result).toMatchObject({ outcome: "undeliverable", code: "provider_not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks malformed call commands locally, without provider contact", async () => {
    mockFetch(() => {
      throw new Error("a malformed command must never reach the provider");
    });
    const adapter = createTwilioVoiceAdapter(twilioVoiceConfigFromEnv(twilioEnv()));
    const registry = configuredTwilioRegistry();
    for (const bad of [
      makeCommand({ recipientPhone: "12" }),
      makeCommand({ script: "" }),
      makeCommand({ script: "x".repeat(4_001) }),
      makeCommand({ callKind: "" }),
    ]) {
      const result = await adapter.placeCall(bad, registry);
      expect(result).toMatchObject({ outcome: "undeliverable", code: "invalid_command" });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Twilio voice adapter — live path (credentials present)", () => {
  it("places the same gateway call the existing call site performs and returns a receipt", async () => {
    const spy = mockFetch(
      () =>
        new Response(
          JSON.stringify({
            sid: "CA1234567890abcdef",
            message: "Queued",
            account_sid: "ACjunk",
            unexpected: { nested: true },
          }),
          {
            status: 201,
          },
        ),
    );
    const adapter = createTwilioVoiceAdapter(twilioVoiceConfigFromEnv(twilioEnv()));
    const result = await adapter.placeCall(
      makeCommand({ script: "Tom & <Jerry> speak" }),
      configuredTwilioRegistry(),
    );

    expect(isTelephonyCallReceipt(result)).toBe(true);
    if (isTelephonyCallReceipt(result)) {
      // Untrusted provider output minimized: only the consumed fields survive.
      expect(result.callId).toBe("CA1234567890abcdef");
      expect(result.status).toBe("queued");
      expect(result.providerId).toBe(TWILIO_VOICE_PROVIDER_ID);
      expect(JSON.stringify(result)).not.toContain("ACjunk");
      expect(result.placedAt).toBeTruthy();
    }

    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${DEFAULT_TWILIO_GATEWAY_URL}/Calls.json`);
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${SENTINEL_GATEWAY_KEY}`);
    expect(headers["X-Connection-Api-Key"]).toBe(SENTINEL_CONNECTION_KEY);
    expect(headers["Content-Type"]).toBe("application/x-www-form-urlencoded");

    const body = new URLSearchParams(String(init.body));
    expect(body.get("To")).toBe("+15551234567");
    expect(body.get("From")).toBe(SENTINEL_FROM);
    const twiml = body.get("Twiml") ?? "";
    expect(twiml).toContain('<Response><Say voice="alice">');
    expect(twiml).toContain("Tom &amp; &lt;Jerry> speak");
    expect(twiml).not.toContain("Tom & <Jerry>");
  });

  it("maps a gateway 5xx to a retryable failure carrying the http status", async () => {
    mockFetch(
      () => new Response(JSON.stringify({ message: "upstream unavailable" }), { status: 500 }),
    );
    const adapter = createTwilioVoiceAdapter(twilioVoiceConfigFromEnv(twilioEnv()));
    const result = await adapter.placeCall(makeCommand(), configuredTwilioRegistry());
    expect(isTelephonyCallReceipt(result)).toBe(false);
    assertNotReceipt(result);
    expect(result).toMatchObject({ outcome: "failed", code: "provider_error", retryable: true });
    expect(result).toMatchObject({ httpStatus: 500 });
    expect(result.reason).toContain("upstream unavailable");
    expect(result.reason).not.toContain(SENTINEL_GATEWAY_KEY);
    expect(result.reason).not.toContain(SENTINEL_CONNECTION_KEY);
  });

  it("maps a gateway 4xx to a non-retryable failure", async () => {
    mockFetch(
      () => new Response(JSON.stringify({ message: "invalid phone number" }), { status: 400 }),
    );
    const adapter = createTwilioVoiceAdapter(twilioVoiceConfigFromEnv(twilioEnv()));
    const result = await adapter.placeCall(makeCommand(), configuredTwilioRegistry());
    expect(result).toMatchObject({ outcome: "failed", code: "provider_error", retryable: false });
    expect(result).toMatchObject({ httpStatus: 400 });
  });

  it("falls back to the bounded status code when the error body is unparseable", async () => {
    mockFetch(() => new Response("<html>boom</html>", { status: 502 }));
    const adapter = createTwilioVoiceAdapter(twilioVoiceConfigFromEnv(twilioEnv()));
    const result = await adapter.placeCall(makeCommand(), configuredTwilioRegistry());
    expect(result).toMatchObject({ outcome: "failed", code: "provider_error", retryable: true });
    assertNotReceipt(result);
    expect(result.reason).toContain("twilio_502");
  });

  it("never asserts a receipt when the gateway queues without a call id", async () => {
    mockFetch(() => new Response(JSON.stringify({ message: "Queued" }), { status: 201 }));
    const adapter = createTwilioVoiceAdapter(twilioVoiceConfigFromEnv(twilioEnv()));
    const result = await adapter.placeCall(makeCommand(), configuredTwilioRegistry());
    expect(isTelephonyCallReceipt(result)).toBe(true);
    if (isTelephonyCallReceipt(result)) {
      expect(result.callId).toBeNull();
    }
  });
});

describe("Vapi voice adapter stub — same contract, fail-closed, NOT_FOR_LIVE_USE", () => {
  it("blocks with the typed result when VAPI_API_KEY is absent, and contacts nothing", async () => {
    mockFetch(() => {
      throw new Error("provider must never be contacted without credentials");
    });
    const adapter = createVapiVoiceAdapter(vapiVoiceConfigFromEnv(vapiEnv(null)));
    const result = await adapter.placeCall(
      makeCommand(),
      createVapiVoiceProviderRegistry(vapiEnv(null)),
    );

    expect(isTelephonyCallReceipt(result)).toBe(false);
    assertNotReceipt(result);
    expect(result).toMatchObject({ outcome: "undeliverable", code: "provider_not_configured" });
    expect(result.reason).toContain("BLOCKED_NO_CREDENTIAL");
    expect(result.reason).toContain(VAPI_API_KEY_ENV);
    expect(result.reason).toContain("no provider call was attempted");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never delivers even when a credential exists (stub law), and contacts nothing", async () => {
    mockFetch(() => {
      throw new Error("a stub must never contact the provider, even with a credential");
    });
    const adapter = createVapiVoiceAdapter(vapiVoiceConfigFromEnv(vapiEnv(SENTINEL_VAPI_KEY)));
    const result = await adapter.placeCall(
      makeCommand(),
      createVapiVoiceProviderRegistry(vapiEnv(SENTINEL_VAPI_KEY)),
    );

    expect(isTelephonyCallReceipt(result)).toBe(false);
    assertNotReceipt(result);
    expect(result).toMatchObject({ outcome: "undeliverable", code: "provider_not_live" });
    expect(result.reason).toContain("NOT_FOR_LIVE_USE");
    expect(result.reason).not.toContain(SENTINEL_VAPI_KEY);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("exposes a credential REFERENCE (pointer), never the credential value", () => {
    const registry = createVapiVoiceProviderRegistry(vapiEnv(SENTINEL_VAPI_KEY));
    expect(registry.credentialReferenceFor(VAPI_VOICE_PROVIDER_ID)).toBe("env://VAPI_API_KEY");
    expect(registry.credentialReferenceFor(VAPI_VOICE_PROVIDER_ID)).not.toBe(SENTINEL_VAPI_KEY);
    expect(registry.isProviderConfigured("twilio")).toBe(false);
  });
});

describe("Telephony contract — shared semantics across adapters", () => {
  it("both adapters declare their registry provider ids", () => {
    expect(createTwilioVoiceAdapter(null).providerId).toBe(TWILIO_VOICE_PROVIDER_ID);
    expect(createVapiVoiceAdapter({ apiKey: null }).providerId).toBe(VAPI_VOICE_PROVIDER_ID);
  });

  it("performs exactly ONE transport attempt — retries belong to the pipeline (J-045)", async () => {
    let calls = 0;
    const failing: TelephonyAdapter = {
      providerId: "twilio",
      placeCall: async () => {
        calls += 1;
        return {
          outcome: "failed",
          code: "provider_error",
          reason: "transient",
          retryable: true,
          httpStatus: null,
        };
      },
    };
    const policy = createAdapterFailurePolicy({
      provider: "telephony",
      timeoutMs: 1_000,
      maxAttempts: 3,
      backoffBaseMs: 1,
      backoffCapMs: 4,
      degradedAfterFailures: 3,
      degradedWindowMs: 10_000,
      breakerFailureThreshold: 5,
      breakerResetMs: 10_000,
    });
    const wrapped = withTelephonyFailurePolicy(failing, policy);
    const result = await wrapped.placeCall(makeCommand(), configuredTwilioRegistry());
    expect(result).toMatchObject({ outcome: "failed", code: "provider_error", retryable: true });
    expect(calls).toBe(1);
    // The structured provider failure passes through as transport-level
    // health; the call is recorded exactly once on the policy.
    expect(policy.snapshot()).toMatchObject({ totalCalls: 1 });
  });

  it("contains a throwing provider as a structured failure, never a rejection", async () => {
    const hostile: TelephonyAdapter = {
      providerId: "twilio",
      placeCall: async () => {
        throw new Error("gateway socket exploded");
      },
    };
    const policy = createAdapterFailurePolicy({
      provider: "telephony",
      timeoutMs: 1_000,
      maxAttempts: 1,
      backoffBaseMs: 1,
      backoffCapMs: 4,
      degradedAfterFailures: 3,
      degradedWindowMs: 10_000,
      breakerFailureThreshold: 5,
      breakerResetMs: 10_000,
    });
    const wrapped = withTelephonyFailurePolicy(hostile, policy);
    const result = await wrapped.placeCall(makeCommand(), configuredTwilioRegistry());
    expect(isTelephonyCallReceipt(result)).toBe(false);
    assertNotReceipt(result);
    expect(result).toMatchObject({ outcome: "failed", code: "provider_error", retryable: true });
    expect(result.reason).toContain("gateway socket exploded");
  });
});

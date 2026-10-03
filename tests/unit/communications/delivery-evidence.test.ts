/**
 * CoreGrid — R6 delivery-evidence tests (follow-up to V1-009, team COMMS).
 *
 * Proves:
 * 1. The EmailAdapter records one append-only delivery-evidence row for
 *    EVERY attempt — provider-confirmed success AND the typed
 *    BLOCKED_NO_CREDENTIAL block (the block is itself evidence).
 * 2. The telephony adapters record the same evidence for their attempts.
 * 3. Recipient redaction — the full address/number NEVER enters an evidence
 *    record or its substrate row (§19 minimization).
 * 4. §12 provenance — who/what triggered it, aiGenerated pinned false.
 * 5. Non-fatal degradation — a missing sink (substrate absent) leaves the
 *    typed result exactly as it was, and a throwing sink never changes the
 *    result; the failure surfaces through the structured log path (§29).
 *
 * No real provider, no real network, no database: fetch is mocked.
 */
import { afterEach, describe, expect, it, vi, type MockInstance } from "vitest";
import {
  DELIVERY_EVIDENCE_COMPONENT,
  DELIVERY_EVIDENCE_TABLE,
  SUPABASE_SERVICE_ROLE_KEY_ENV,
  SUPABASE_URL_ENV,
  createPostgrestDeliveryEvidenceSink,
  deliveryEvidenceConfigFromEnv,
  redactEmailRecipient,
  redactPhoneRecipient,
  toDeliveryEvidenceRow,
  withEmailDeliveryEvidence,
  type DeliveryEvidenceRecord,
  type DeliveryEvidenceSink,
} from "../../../frontend/src/lib/communications/delivery-evidence.server";
import {
  createResendEmailAdapter,
  createResendEmailProviderRegistry,
  RESEND_API_KEY_ENV,
  RESEND_FROM_ADDRESS_ENV,
  resendEmailConfigFromEnv,
  type ServerEnv as ResendServerEnv,
} from "../../../frontend/src/lib/communications/resend-email.server";
import {
  createTwilioVoiceAdapter,
  createTwilioVoiceProviderRegistry,
  twilioVoiceConfigFromEnv,
  TWILIO_API_KEY_ENV,
  TWILIO_FROM_NUMBER_ENV,
  TWILIO_GATEWAY_BEARER_FALLBACK_ENV,
  type ServerEnv as TwilioServerEnv,
} from "../../../frontend/src/lib/communications/twilio-voice.server";
import {
  createVapiVoiceAdapter,
  createVapiVoiceProviderRegistry,
  vapiVoiceConfigFromEnv,
  VAPI_API_KEY_ENV,
} from "../../../frontend/src/lib/communications/vapi-voice.server";
import {
  isEmailDeliveryReceipt,
  type EmailAdapter,
  type EmailProviderRegistry,
  type EmailSendCommand,
} from "../../../frontend/src/lib/notifications/email-adapter-contract";
import {
  isTelephonyCallReceipt,
  type TelephonyCallCommand,
  type TelephonyProviderRegistry,
} from "../../../frontend/src/lib/communications/telephony-adapter-contract";
import type { Notification } from "../../../frontend/src/lib/notifications/notification-contract";

const SENTINEL_KEY = "resend-evidence-test-sentinel-credential";
const SENTINEL_FROM = "no-reply@coregrid-unit-test.invalid";

/* ── Recording sink (the test double for the substrate) ─────────── */

class RecordingSink implements DeliveryEvidenceSink {
  readonly kind = "recording";
  readonly records: DeliveryEvidenceRecord[] = [];

  async record(record: DeliveryEvidenceRecord): Promise<void> {
    this.records.push(record);
  }
}

class ThrowingSink implements DeliveryEvidenceSink {
  readonly kind = "throwing";
  async record(): Promise<void> {
    throw new Error("substrate unavailable (simulated outage)");
  }
}

/* ── Email fixtures ─────────────────────────────────────────────── */

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: "notif-r6-evidence",
    tenantRef: "tenant-a",
    recipientRef: "user-1",
    audienceKind: "user",
    category: "general",
    subject: "Attendance summary",
    body: "Weekly attendance summary is ready.",
    actionRef: null,
    state: "queued",
    createdAt: "2026-10-03T00:00:00.000Z",
    ...overrides,
  };
}

function makeEmailCommand(overrides: Partial<EmailSendCommand> = {}): EmailSendCommand {
  return {
    notification: makeNotification(),
    recipientAddress: "parent@example.edu",
    subject: "Attendance summary",
    body: "Weekly attendance summary is ready.",
    ...overrides,
  };
}

function configuredEmailEnv(): ResendServerEnv {
  return { [RESEND_API_KEY_ENV]: SENTINEL_KEY, [RESEND_FROM_ADDRESS_ENV]: SENTINEL_FROM };
}

function emailRegistry(env: ResendServerEnv = configuredEmailEnv()): EmailProviderRegistry {
  return createResendEmailProviderRegistry(env);
}

/* ── Telephony fixtures ─────────────────────────────────────────── */

function makeCallCommand(overrides: Partial<TelephonyCallCommand> = {}): TelephonyCallCommand {
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

function twilioEnv(): TwilioServerEnv {
  return {
    [TWILIO_GATEWAY_BEARER_FALLBACK_ENV]: "twilio-evidence-test-gateway-sentinel",
    [TWILIO_API_KEY_ENV]: "twilio-evidence-test-connection-sentinel",
    [TWILIO_FROM_NUMBER_ENV]: "+15550000000",
  };
}

function twilioRegistry(env: TwilioServerEnv = twilioEnv()): TelephonyProviderRegistry {
  return createTwilioVoiceProviderRegistry(env);
}

let fetchMock: MockInstance | null = null;

function mockFetch(handler: () => Response | Promise<Response>): MockInstance {
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => handler());
  fetchMock = spy;
  return spy;
}

afterEach(() => {
  fetchMock?.mockRestore();
  fetchMock = null;
  vi.restoreAllMocks();
});

/* ── Email evidence on every attempt ────────────────────────────── */

describe("Email adapter — records delivery evidence on every attempt", () => {
  it("records a delivered row with the provider message id on a confirmed send", async () => {
    mockFetch(() => new Response(JSON.stringify({ id: "re_msg_evidence_1" }), { status: 200 }));
    const sink = new RecordingSink();
    const adapter: EmailAdapter = createResendEmailAdapter(
      resendEmailConfigFromEnv(configuredEmailEnv()),
      sink,
    );

    const result = await adapter.send(makeEmailCommand(), emailRegistry());

    // The typed result is unchanged by evidence recording.
    expect(isEmailDeliveryReceipt(result)).toBe(true);
    expect(sink.records).toHaveLength(1);

    const record = sink.records[0];
    expect(record.outcome).toBe("delivered");
    expect(record.outcomeCode).toBe("delivered");
    expect(record.providerMessageId).toBe("re_msg_evidence_1");
    expect(record.channel).toBe("email");
    expect(record.adapter).toBe("resend");
    expect(record.tenantId).toBe("tenant-a");
    expect(record.notificationRef).toBe("notif-r6-evidence");
    expect(record.reason).toContain("provider-confirmed");
  });

  it("records an undeliverable row on the typed BLOCKED_NO_CREDENTIAL block (the block is evidence)", async () => {
    mockFetch(() => {
      throw new Error("provider must never be contacted without credentials");
    });
    const sink = new RecordingSink();
    const adapter = createResendEmailAdapter(resendEmailConfigFromEnv({}), sink);

    const result = await adapter.send(makeEmailCommand(), emailRegistry({}));

    // The typed blocked result is preserved exactly.
    expect(isEmailDeliveryReceipt(result)).toBe(false);
    if (!isEmailDeliveryReceipt(result)) {
      expect(result).toMatchObject({ outcome: "undeliverable", code: "provider_not_configured" });
      expect(result.reason).toContain("BLOCKED_NO_CREDENTIAL");
    }
    expect(fetchMock).not.toHaveBeenCalled();

    // AND the block itself was recorded as evidence.
    expect(sink.records).toHaveLength(1);
    const record = sink.records[0];
    expect(record.outcome).toBe("undeliverable");
    expect(record.outcomeCode).toBe("provider_not_configured");
    expect(record.providerMessageId).toBeNull();
    expect(record.reason).toContain("BLOCKED_NO_CREDENTIAL");
    expect(record.channel).toBe("email");
    expect(record.tenantId).toBe("tenant-a");
  });

  it("records a failed row on a provider error (429) with retry provenance in the reason", async () => {
    mockFetch(() => new Response(JSON.stringify({ message: "rate limited" }), { status: 429 }));
    const sink = new RecordingSink();
    const adapter = createResendEmailAdapter(resendEmailConfigFromEnv(configuredEmailEnv()), sink);

    await adapter.send(makeEmailCommand(), emailRegistry());

    expect(sink.records).toHaveLength(1);
    expect(sink.records[0]).toMatchObject({
      outcome: "failed",
      outcomeCode: "provider_error",
      providerMessageId: null,
    });
  });
});

/* ── Telephony evidence ─────────────────────────────────────────── */

describe("Telephony adapters — records delivery evidence on every attempt", () => {
  it("Twilio: records a delivered row with the gateway sid on a confirmed call", async () => {
    mockFetch(() => new Response(JSON.stringify({ sid: "CAevidence123", message: "Queued" }), { status: 201 }));
    const sink = new RecordingSink();
    const adapter = createTwilioVoiceAdapter(twilioVoiceConfigFromEnv(twilioEnv()), sink);

    const result = await adapter.placeCall(makeCallCommand(), twilioRegistry());

    expect(isTelephonyCallReceipt(result)).toBe(true);
    expect(sink.records).toHaveLength(1);
    const record = sink.records[0];
    expect(record.outcome).toBe("delivered");
    expect(record.providerMessageId).toBe("CAevidence123");
    expect(record.channel).toBe("voice");
    expect(record.triggerSource).toBe("telephony.placeCall:twilio");
  });

  it("Twilio: records an undeliverable row on the typed BLOCKED_NO_CREDENTIAL block", async () => {
    mockFetch(() => {
      throw new Error("provider must never be contacted without credentials");
    });
    const sink = new RecordingSink();
    const adapter = createTwilioVoiceAdapter(null, sink);

    const result = await adapter.placeCall(makeCallCommand(), twilioRegistry({}));

    expect(result).toMatchObject({ outcome: "undeliverable", code: "provider_not_configured" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sink.records).toHaveLength(1);
    expect(sink.records[0]).toMatchObject({
      outcome: "undeliverable",
      outcomeCode: "provider_not_configured",
      providerMessageId: null,
      channel: "voice",
    });
  });

  it("Vapi: records the stub's blocked attempt as evidence in both credential states", async () => {
    mockFetch(() => {
      throw new Error("a stub must never contact the provider in any credential state");
    });
    const sink = new RecordingSink();
    const blockedAdapter = createVapiVoiceAdapter(vapiVoiceConfigFromEnv({}), sink);
    await blockedAdapter.placeCall(makeCallCommand(), twilioRegistry({}));
    const vapiEnv = { [VAPI_API_KEY_ENV]: "vapi-evidence-sentinel" };
    const stubAdapter = createVapiVoiceAdapter(vapiVoiceConfigFromEnv(vapiEnv), sink);
    await stubAdapter.placeCall(makeCallCommand(), createVapiVoiceProviderRegistry(vapiEnv));

    expect(fetchMock).not.toHaveBeenCalled();
    expect(sink.records).toHaveLength(2);
    expect(sink.records[0]).toMatchObject({ outcome: "undeliverable", outcomeCode: "provider_not_configured" });
    expect(sink.records[1]).toMatchObject({ outcome: "undeliverable", outcomeCode: "provider_not_live" });
  });
});

/* ── Redaction (§19) ────────────────────────────────────────────── */

describe("Recipient redaction — full addresses/numbers never enter evidence", () => {
  it("masks email local parts and degrades unparseable input to the opaque sentinel", () => {
    expect(redactEmailRecipient("parent@example.edu")).toBe("p***@example.edu");
    expect(redactEmailRecipient("a@b.co")).toBe("a***@b.co");
    expect(redactEmailRecipient("no-at-sign")).toBe("***");
    expect(redactEmailRecipient("@weird")).toBe("***");
    expect(redactEmailRecipient("")).toBe("***");
  });

  it("masks phone numbers to prefix and last two digits, and shields short inputs", () => {
    expect(redactPhoneRecipient("+15551234567")).toBe("+15***67");
    expect(redactPhoneRecipient("+1555")).toBe("***");
    expect(redactPhoneRecipient("")).toBe("***");
  });

  it("evidence records carry only the redacted recipient — never the full address or number", async () => {
    mockFetch(() => new Response(JSON.stringify({ id: "re_msg_redaction" }), { status: 200 }));
    const sink = new RecordingSink();
    const adapter: EmailAdapter = createResendEmailAdapter(
      resendEmailConfigFromEnv(configuredEmailEnv()),
      sink,
    );
    await adapter.send(makeEmailCommand({ recipientAddress: "jane.doe@school.example.edu" }), emailRegistry());

    const serialized = JSON.stringify({ records: sink.records });
    expect(serialized).not.toContain("jane.doe@school.example.edu");
    expect(sink.records[0].recipientRedacted).toBe("j***@school.example.edu");

    const callSink = new RecordingSink();
    mockFetch(() => new Response(JSON.stringify({ sid: "CAredaction" }), { status: 201 }));
    const telephonyAdapter = createTwilioVoiceAdapter(twilioVoiceConfigFromEnv(twilioEnv()), callSink);
    await telephonyAdapter.placeCall(makeCallCommand({ recipientPhone: "+15559876543" }), twilioRegistry());
    expect(JSON.stringify({ records: callSink.records })).not.toContain("+15559876543");
    expect(callSink.records[0].recipientRedacted).toBe("+15***43");
  });
});

/* ── §12 provenance ─────────────────────────────────────────────── */

describe("Evidence provenance (§12) — who/what triggered it, AI flag false by default", () => {
  it("every record carries trigger provenance and pins aiGenerated false", async () => {
    mockFetch(() => new Response(JSON.stringify({ id: "re_msg_prov" }), { status: 200 }));
    const sink = new RecordingSink();
    const adapter = createResendEmailAdapter(resendEmailConfigFromEnv(configuredEmailEnv()), sink);
    await adapter.send(makeEmailCommand(), emailRegistry());

    const record = sink.records[0];
    expect(record.triggeredBy).toBe("communications-adapter");
    expect(record.triggerSource).toBe("email.send:resend");
    expect(record.aiGenerated).toBe(false);
    expect(record.id).toBeTruthy();
    expect(record.createdAt).toBeTruthy();
  });
});

/* ── Non-fatal degradation (fail-closed, never fail-open) ───────── */

describe("Evidence recording degrades safely — the typed result is never altered", () => {
  it("a missing sink (substrate absent) leaves the adapter unchanged: same typed results, no evidence", async () => {
    mockFetch(() => new Response(JSON.stringify({ id: "re_msg_nosink" }), { status: 200 }));
    const adapter: EmailAdapter = createResendEmailAdapter(resendEmailConfigFromEnv(configuredEmailEnv()), null);
    const result = await adapter.send(makeEmailCommand(), emailRegistry());
    expect(isEmailDeliveryReceipt(result)).toBe(true);
    if (isEmailDeliveryReceipt(result)) expect(result.providerMessageId).toBe("re_msg_nosink");

    // The withEmailDeliveryEvidence composition is an identity for a null sink.
    const inner: EmailAdapter = {
      providerId: "probe",
      send: async () => ({ outcome: "undeliverable", code: "provider_not_configured", reason: "probe" }),
    };
    expect(withEmailDeliveryEvidence(inner, null)).toBe(inner);
  });

  it("a throwing sink never changes the send result; the failure is reported through structured logs", async () => {
    mockFetch(() => new Response(JSON.stringify({ id: "re_msg_throw" }), { status: 200 }));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const adapter: EmailAdapter = createResendEmailAdapter(
      resendEmailConfigFromEnv(configuredEmailEnv()),
      new ThrowingSink(),
    );

    const result = await adapter.send(makeEmailCommand(), emailRegistry());

    // Non-fatal: the send STILL resolves to its typed receipt.
    expect(isEmailDeliveryReceipt(result)).toBe(true);
    if (isEmailDeliveryReceipt(result)) expect(result.providerMessageId).toBe("re_msg_throw");

    // §29 observability: the evidence-write failure was reported, not swallowed.
    expect(warnSpy).toHaveBeenCalledTimes(1);
    const line = JSON.parse(String(warnSpy.mock.calls[0][0])) as Record<string, unknown>;
    expect(line.msg).toContain("evidence_write_failed");
    expect(line.component).toBe(DELIVERY_EVIDENCE_COMPONENT);
    expect(line.tenant_id).toBe("tenant-a");
    expect(String(line.err)).toContain("substrate unavailable");
  });

  it("a throwing sink never changes the telephony result either", async () => {
    mockFetch(() => new Response(JSON.stringify({ sid: "CAthrow" }), { status: 201 }));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const adapter = createTwilioVoiceAdapter(twilioVoiceConfigFromEnv(twilioEnv()), new ThrowingSink());
    const result = await adapter.placeCall(makeCallCommand(), twilioRegistry());
    expect(isTelephonyCallReceipt(result)).toBe(true);
  });

  it("a blocked send with a throwing sink still resolves to the typed BLOCKED result", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const adapter = createResendEmailAdapter(resendEmailConfigFromEnv({}), new ThrowingSink());
    const result = await adapter.send(makeEmailCommand(), emailRegistry({}));
    expect(result).toMatchObject({ outcome: "undeliverable", code: "provider_not_configured" });
  });
});

/* ── Concrete substrate sink (PostgREST adapter, §25) ───────────── */

describe("PostgREST delivery-evidence sink — one bounded append, service-role only", () => {
  it("maps a record to the exact snake_case substrate row, no field added or dropped", () => {
    const record: DeliveryEvidenceRecord = {
      id: "ev-1",
      tenantId: "tenant-a",
      channel: "email",
      adapter: "resend",
      notificationRef: "notif-1",
      recipientRedacted: "p***@example.edu",
      providerMessageId: null,
      outcome: "undeliverable",
      outcomeCode: "provider_not_configured",
      reason: "blocked",
      triggeredBy: "communications-adapter",
      triggerSource: "email.send:resend",
      aiGenerated: false,
      createdAt: "2026-10-03T00:00:00.000Z",
    };
    const row = toDeliveryEvidenceRow(record);
    expect(row).toEqual({
      id: "ev-1",
      tenant_id: "tenant-a",
      channel: "email",
      adapter: "resend",
      notification_ref: "notif-1",
      recipient_redacted: "p***@example.edu",
      provider_message_id: null,
      outcome: "undeliverable",
      outcome_code: "provider_not_configured",
      reason: "blocked",
      triggered_by: "communications-adapter",
      trigger_source: "email.send:resend",
      ai_generated: false,
      created_at: "2026-10-03T00:00:00.000Z",
    });
  });

  it("appends to cg_delivery_evidence via PostgREST with service-role headers and never logs the key", async () => {
    const SERVICE_KEY = "evidence-test-service-role-sentinel";
    const spy = mockFetch(() => new Response(null, { status: 201 }));
    const sink = createPostgrestDeliveryEvidenceSink({
      supabaseUrl: "https://project.example.test",
      serviceRoleKey: SERVICE_KEY,
    });

    await sink.record({
      id: "ev-2",
      tenantId: "tenant-a",
      channel: "voice",
      adapter: "twilio",
      notificationRef: null,
      recipientRedacted: "+15***67",
      providerMessageId: "CA123",
      outcome: "delivered",
      outcomeCode: "delivered",
      reason: "provider-confirmed receipt",
      triggeredBy: "communications-adapter",
      triggerSource: "telephony.placeCall:twilio",
      aiGenerated: false,
      createdAt: "2026-10-03T00:00:00.000Z",
    });

    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`https://project.example.test/rest/v1/${DELIVERY_EVIDENCE_TABLE}`);
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe(`Bearer ${SERVICE_KEY}`);
    expect(headers.apikey).toBe(SERVICE_KEY);
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.tenant_id).toBe("tenant-a");
    expect(body.provider_message_id).toBe("CA123");
    // Secret hygiene: the key value never appears in the appended payload.
    expect(JSON.stringify(body)).not.toContain(SERVICE_KEY);
  });

  it("rejects a non-2xx append as a structured error (status only — the body is untrusted)", async () => {
    mockFetch(() => new Response("tenant data might be echoed here", { status: 403 }));
    const sink = createPostgrestDeliveryEvidenceSink({
      supabaseUrl: "https://project.example.test",
      serviceRoleKey: "k",
    });
    await expect(
      sink.record({
        id: "ev-3",
        tenantId: "tenant-a",
        channel: "email",
        adapter: "resend",
        notificationRef: null,
        recipientRedacted: "***",
        providerMessageId: null,
        outcome: "failed",
        outcomeCode: "provider_error",
        reason: "r",
        triggeredBy: "communications-adapter",
        triggerSource: "email.send:resend",
        aiGenerated: false,
        createdAt: "2026-10-03T00:00:00.000Z",
      }),
    ).rejects.toThrow("http 403");
  });

  it("fails closed to null when the substrate environment is absent", () => {
    expect(deliveryEvidenceConfigFromEnv({})).toBeNull();
    expect(deliveryEvidenceConfigFromEnv({ [SUPABASE_URL_ENV]: "https://project.example.test" })).toBeNull();
    expect(deliveryEvidenceConfigFromEnv({ [SUPABASE_SERVICE_ROLE_KEY_ENV]: "k" })).toBeNull();
    const config = deliveryEvidenceConfigFromEnv({
      [SUPABASE_URL_ENV]: " https://project.example.test ",
      [SUPABASE_SERVICE_ROLE_KEY_ENV]: "k",
    });
    expect(config).toEqual({ supabaseUrl: "https://project.example.test", serviceRoleKey: "k" });
  });
});

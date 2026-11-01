import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  africaTalkingVoiceConfigFromEnv,
  consentVoiceXml,
  createAfricaTalkingVoiceCallbackHandler,
  createVoiceAssistantFromEnv,
  dialHumanXml,
  isHumanEscalationRequest,
  recordVoiceXml,
  voiceXml,
  type VoiceCallbackDatabase,
  type VoiceServerEnv,
  type VoiceSession,
} from "../../../frontend/src/lib/communications/africas-talking-voice.server";

const SCHOOL_ID = "00000000-0000-4000-8000-000000000001";
const SESSION_ID = "at-session-123";
const CALLBACK_TOKEN = "voice-webhook-unit-test-token-with-sufficient-length";
const CALLBACK_URL = "https://voice.example.test/api/public/webhooks/africas-talking-voice";
const voiceMigration = readFileSync(
  "database/supabase/migrations/20261031000010_sherivs_107_voice_ai_support_line.sql",
  "utf8",
);
const voiceSource = readFileSync(
  "frontend/src/lib/communications/africas-talking-voice.server.ts",
  "utf8",
);
const featureFlagMigration = readFileSync(
  "database/supabase/migrations/20261024000250_sherivs_018_fee_config_flags_rate_limit.sql",
  "utf8",
);
const ENV: VoiceServerEnv = {
  AT_USERNAME: "sherivs",
  AT_API_KEY: "unit-test-at-api-key",
  AT_VOICE_WEBHOOK_TOKEN: CALLBACK_TOKEN,
  AT_VOICE_CALLBACK_URL: CALLBACK_URL,
};

function request(
  token = CALLBACK_TOKEN,
  fields: Record<string, string> = {
    sessionId: SESSION_ID,
    direction: "Inbound",
    callerNumber: "+2348012345678",
    destinationNumber: "+2348098765432",
  },
): Request {
  const body = new URLSearchParams(fields);
  return new Request(`${CALLBACK_URL}?token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body,
  });
}

function createDb(flagEnabled: boolean) {
  const calls: Array<{ table: string; operation: string; values?: Record<string, unknown> }> = [];
  let session: VoiceSession | null = null;
  const providerRefs = new Set<string>();
  const schoolRow = { school_id: SCHOOL_ID };
  const initialSession: VoiceSession = {
    id: "00000000-0000-4000-8000-000000000002",
    tenant_id: SCHOOL_ID,
    provider_session_id: SESSION_ID,
    caller_number: "+2348012345678",
    destination_number: "+2348098765432",
    state: "consent_pending",
    recording_consent_at: null,
    turn_count: 0,
  };
  const db = {
    from(table: string) {
      let inserted = false;
      const filters = new Map<string, unknown>();
      const query = {
        select() {
          calls.push({ table, operation: "select" });
          return query;
        },
        eq(column: string, value: unknown) {
          filters.set(column, value);
          return query;
        },
        order() {
          return query;
        },
        limit() {
          return query;
        },
        maybeSingle: async () => ({
          data:
            table === "comms_sender_numbers"
              ? schoolRow
              : table === "voice_call_sessions" && inserted
                ? (session = session ?? initialSession)
                : table === "voice_call_sessions"
                  ? session
                  : table === "inbound_messages" &&
                      providerRefs.has(String(filters.get("provider_ref")))
                    ? { id: "logged-message" }
                    : null,
          error: null,
        }),
        insert(values: Record<string, unknown>) {
          inserted = true;
          calls.push({ table, operation: "insert", values });
          if (table === "voice_call_sessions") {
            session = {
              ...initialSession,
              tenant_id: String(values.tenant_id),
              caller_number: String(values.caller_number),
              destination_number: String(values.destination_number),
              provider_session_id: String(values.provider_session_id),
              state: "consent_pending",
            };
          }
          return query;
        },
        upsert(values: Record<string, unknown>) {
          inserted = true;
          calls.push({ table, operation: "upsert", values });
          return query;
        },
        update(values: Record<string, unknown>) {
          calls.push({ table, operation: "update", values });
          if (table === "voice_call_sessions" && session) {
            session = { ...session, ...values } as VoiceSession;
          }
          return query;
        },
        then(resolve: (value: { data: unknown; error: null }) => unknown) {
          return Promise.resolve({ data: null, error: null }).then(resolve);
        },
      };
      return query;
    },
    async rpc(name: string, args: Record<string, unknown>) {
      calls.push({ table: name, operation: "rpc", values: args });
      if (name === "comms_inbound") {
        const providerRef = String(args.p_provider_ref);
        const inserted = !providerRefs.has(providerRef);
        providerRefs.add(providerRef);
        return { data: inserted, error: null };
      }
      return {
        data: name === "flag_on" ? flagEnabled : true,
        error: null,
      };
    },
  };
  return { db: db as unknown as VoiceCallbackDatabase, calls, session };
}

describe("Africa's Talking voice support callback", () => {
  it("requires server credentials and a canonical HTTPS callback URL", () => {
    expect(africaTalkingVoiceConfigFromEnv({})).toBeNull();
    expect(
      africaTalkingVoiceConfigFromEnv({
        ...ENV,
        AT_VOICE_CALLBACK_URL: "http://voice.example.test/callback",
      }),
    ).toBeNull();
    const config = africaTalkingVoiceConfigFromEnv(ENV);
    expect(config?.username).toBe("sherivs");
    expect(config?.callbackUrl.searchParams.get("token")).toBe(CALLBACK_TOKEN);
  });

  it("escapes untrusted speech and uses a fixed human escalation destination", () => {
    expect(voiceXml(`<answer>&" ' >`)).toContain("&lt;answer&gt;&amp;&quot; &apos; &gt;");
    expect(dialHumanXml()).toContain('<Dial phoneNumbers="+2349015056201"/>');
    expect(isHumanEscalationRequest("Please connect me to a human agent")).toBe(true);
    expect(isHumanEscalationRequest("How do I update my profile?")).toBe(false);
  });

  it("includes the callback token and callback handler in the consent-gathering XML", () => {
    const config = africaTalkingVoiceConfigFromEnv(ENV);
    expect(config).not.toBeNull();
    const xml = consentVoiceXml(config!.callbackUrl);
    expect(xml).toContain("<GetDigits");
    expect(xml).toContain(`callbackUrl="${CALLBACK_URL}?token=${CALLBACK_TOKEN}"`);
    expect(xml).toContain("Press 1 to consent");
  });

  it("rejects unauthenticated callbacks before any tenant lookup", async () => {
    const { db, calls } = createDb(true);
    const handler = createAfricaTalkingVoiceCallbackHandler({
      env: ENV,
      db,
      assistant: null,
    });
    const response = await handler(request("wrong-token"));
    expect(response.status).toBe(403);
    expect(calls).toEqual([]);
  });

  it("keeps the existing voice_live flag as the fail-closed feature gate", async () => {
    const { db, calls } = createDb(false);
    const handler = createAfricaTalkingVoiceCallbackHandler({
      env: ENV,
      db,
      assistant: null,
      audit: vi.fn(async () => undefined),
    });
    const response = await handler(request());
    const xml = await response.text();

    expect(response.status).toBe(200);
    expect(xml).toContain("currently unavailable");
    expect(calls.some((call) => call.table === "flag_on")).toBe(true);
    expect(
      calls.some((call) => call.table === "voice_call_sessions" && call.operation === "insert"),
    ).toBe(false);
    expect(calls.find((call) => call.table === "flag_on")?.values).toMatchObject({
      p_key: "voice_live",
      p_org: SCHOOL_ID,
    });
  });

  it("resolves the tenant from the registered destination and records the call before consent", async () => {
    const { db, calls } = createDb(true);
    const audit = vi.fn(async () => undefined);
    const handler = createAfricaTalkingVoiceCallbackHandler({
      env: ENV,
      db,
      assistant: null,
      audit,
      now: () => "2026-10-31T12:00:00.000Z",
    });
    const response = await handler(request());
    const xml = await response.text();

    expect(response.status).toBe(200);
    expect(xml).toContain("<GetDigits");
    expect(
      calls.find((call) => call.table === "voice_call_sessions" && call.operation === "insert")
        ?.values,
    ).toMatchObject({
      tenant_id: SCHOOL_ID,
      provider: "africas_talking",
      state: "consent_pending",
    });
    expect(calls.find((call) => call.table === "comms_inbound")?.values).toMatchObject({
      p_school: SCHOOL_ID,
      p_channel: "voice",
    });
    expect(calls.find((call) => call.table === "comms_inbound")?.values?.p_body).toContain(
      "[voice:call_started]",
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: SCHOOL_ID, action: "voice.call.started" }),
    );
  });

  it("requires consent before recording, then stores grounded responses in the comms log", async () => {
    const { db, calls } = createDb(true);
    const audit = vi.fn(async () => undefined);
    const answer = vi.fn(async () => "Request a demo to create an organization.");
    const transcribe = vi.fn(
      async () =>
        "How do I create an organization? Contact me at caller@example.com or +234 801 234 5678.",
    );
    const handler = createAfricaTalkingVoiceCallbackHandler({
      env: ENV,
      db,
      assistant: {
        transcriber: {
          providerId: "test-stt",
          transcribe,
        },
        language: { providerId: "test-llm", answer },
        speech: {
          providerId: "test-tts",
          speak: (text, callbackUrl) => recordVoiceXml(text, callbackUrl),
        },
      },
      audit,
      now: () => "2026-10-31T12:00:00.000Z",
    });

    await handler(request());
    const consent = await handler(
      request(CALLBACK_TOKEN, { sessionId: SESSION_ID, dtmfDigits: "1" }),
    );
    expect(await consent.text()).toContain("<Record");

    const response = await handler(
      request(CALLBACK_TOKEN, {
        sessionId: SESSION_ID,
        recordingUrl: "https://voice.africastalking.com/recording.wav",
      }),
    );
    const xml = await response.text();
    await handler(
      request(CALLBACK_TOKEN, {
        sessionId: SESSION_ID,
        recordingUrl: "https://voice.africastalking.com/recording.wav",
      }),
    );

    expect(xml).toContain("Request a demo to create an organization.");
    expect(xml).toContain("<Record");
    expect(answer).toHaveBeenCalledOnce();
    expect(transcribe).toHaveBeenCalledOnce();
    expect(answer).toHaveBeenCalledWith(
      "How do I create an organization? Contact me at [REDACTED_EMAIL] or [REDACTED_NUMBER].",
      SCHOOL_ID,
      expect.any(String),
    );
    expect(
      calls.some(
        (call) =>
          call.table === "comms_inbound" &&
          String(call.values?.p_body).includes("caller@example.com"),
      ),
    ).toBe(true);
    expect(
      calls
        .filter((call) => call.table === "comms_inbound")
        .map((call) => String(call.values?.p_body).match(/^\[voice:([a-z_]+)\]/)?.[1]),
    ).toEqual(["call_started", "consent_granted", "caller_transcript", "assistant_response"]);
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "voice.transcript.caller_recorded",
        after: expect.objectContaining({
          transcriptHash: expect.any(String),
          transcriptLength: expect.any(Number),
        }),
      }),
    );
    expect(audit).toHaveBeenCalledWith(
      expect.objectContaining({ action: "voice.transcript.assistant_recorded" }),
    );
    expect(JSON.stringify(audit.mock.calls)).not.toContain("caller@example.com");
  });

  it("dials the configured human support number for a caller escalation request", async () => {
    const { db, calls } = createDb(true);
    const answer = vi.fn(async () => "This should not be called.");
    const handler = createAfricaTalkingVoiceCallbackHandler({
      env: ENV,
      db,
      assistant: {
        transcriber: {
          providerId: "test-stt",
          transcribe: async () => "Please connect me to a human agent.",
        },
        language: { providerId: "test-llm", answer },
        speech: { providerId: "test-tts", speak: () => "" },
      },
      audit: vi.fn(async () => undefined),
    });

    await handler(request());
    await handler(request(CALLBACK_TOKEN, { sessionId: SESSION_ID, dtmfDigits: "1" }));
    const response = await handler(
      request(CALLBACK_TOKEN, {
        sessionId: SESSION_ID,
        recordingUrl: "https://voice.africastalking.com/escalation.wav",
      }),
    );

    expect(await response.text()).toContain('<Dial phoneNumbers="+2349015056201"/>');
    expect(answer).not.toHaveBeenCalled();
    expect(
      calls.some(
        (call) =>
          call.table === "comms_inbound" &&
          String(call.values?.p_body).startsWith("[voice:escalated]"),
      ),
    ).toBe(true);
  });

  it("selects only configured speech providers and blocks unsafe recording URLs", async () => {
    const env = {
      ...ENV,
      VOICE_STT_PROVIDER: "openai",
      VOICE_STT_API_KEY: "unit-test-stt-key",
      VOICE_LLM_PROVIDER: "ai-gateway",
      VOICE_TTS_PROVIDER: "africas_talking",
    };
    const fetcher = vi.fn<typeof fetch>();
    const assistant = createVoiceAssistantFromEnv(env, fetcher);

    expect(assistant?.transcriber.providerId).toBe("openai");
    expect(assistant?.language.providerId).toBe("ai-gateway");
    expect(assistant?.speech.providerId).toBe("africas_talking");
    await expect(
      assistant?.transcriber.transcribe("http://127.0.0.1/private.wav", "unit-test-at-api-key"),
    ).rejects.toThrow("unsupported voice recording URL");
    expect(fetcher).not.toHaveBeenCalled();
    expect(createVoiceAssistantFromEnv({ ...env, VOICE_TTS_PROVIDER: "unsupported" })).toBeNull();
  });

  it("extends comms storage and keeps the existing live flag disabled", () => {
    expect(voiceMigration).toContain("public.voice_call_sessions");
    expect(voiceMigration).toContain("tenant_id");
    expect(voiceSource).toContain('rpc("comms_inbound"');
    expect(voiceSource).toContain('"audit_chain"');
    expect(voiceMigration).not.toContain("school_id");
    expect(voiceMigration).not.toContain("voice_call_transcripts");
    expect(featureFlagMigration).toMatch(/\('voice_live', false, false/);
  });
});

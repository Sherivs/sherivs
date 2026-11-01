import { describe, expect, it, vi } from "vitest";
import {
  africaTalkingVoiceConfigFromEnv,
  createAfricaTalkingOutboundCallHandler,
  type VoiceCallbackDatabase,
  type VoiceServerEnv,
} from "../../../frontend/src/lib/communications/africas-talking-voice.server";
import {
  createAfricaTalkingVoiceAdapter,
  createAfricaTalkingVoiceProviderRegistry,
} from "../../../frontend/src/lib/communications/africas-talking-outbound.server";
import type { TelephonyCallCommand } from "../../../frontend/src/lib/communications/telephony-adapter-contract";

const ENV: VoiceServerEnv = {
  AT_USERNAME: "voice-test",
  AT_API_KEY: "unit-test-at-api-key",
  AT_VOICE_WEBHOOK_TOKEN: "unit-test-voice-webhook-token-with-enough-entropy",
  AT_VOICE_CALLBACK_URL: "https://example.test/api/public/webhooks/africas-talking-voice",
};
const COMMAND: TelephonyCallCommand = {
  callKind: "fee_reminder",
  tenantRef: "00000000-0000-4000-8000-000000000003",
  recipientName: "Recipient",
  recipientPhone: "+2348012345678",
  script: "Please contact your organization.",
  triggerEvent: "00000000-0000-4000-8000-000000000010",
};
const REGISTRY = createAfricaTalkingVoiceProviderRegistry(ENV);

describe("Africa's Talking outbound voice adapter", () => {
  it("uses the phase-1 credentials, callback route, and tenant-approved caller number", async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ entries: [{ sessionId: "ATV-1", status: "Queued" }] }), {
        status: 201,
      }),
    );
    const adapter = createAfricaTalkingVoiceAdapter({
      config: africaTalkingVoiceConfigFromEnv(ENV),
      fromNumber: "+2348098765432",
      callId: COMMAND.triggerEvent!,
      fetcher,
    });

    await expect(adapter.placeCall(COMMAND, REGISTRY)).resolves.toMatchObject({
      callId: "ATV-1",
      providerId: "africas_talking",
      status: "Queued",
    });
    expect(fetcher).toHaveBeenCalledOnce();
    const [url, init] = fetcher.mock.calls[0];
    expect(url).toBe("https://voice.africastalking.com/call");
    expect(new Headers(init?.headers).get("apikey")).toBe(ENV.AT_API_KEY);
    const body = new URLSearchParams(String(init?.body));
    expect(body.get("from")).toBe("+2348098765432");
    expect(body.get("to")).toBe(COMMAND.recipientPhone);
    expect(body.get("clientRequestId")).toBe(COMMAND.triggerEvent);
    expect(new URL(body.get("callbackUrl")!).searchParams.get("call_id")).toBe(
      COMMAND.triggerEvent,
    );
  });

  it("fails closed without phase-1 AT configuration and does not contact a provider", async () => {
    const fetcher = vi.fn<typeof fetch>();
    const adapter = createAfricaTalkingVoiceAdapter({
      config: null,
      fromNumber: "+2348098765432",
      callId: COMMAND.triggerEvent!,
      fetcher,
    });

    await expect(adapter.placeCall(COMMAND, REGISTRY)).resolves.toMatchObject({
      outcome: "undeliverable",
      code: "provider_not_configured",
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("returns a bounded failure for unaccepted provider responses", async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(JSON.stringify({ message: "private provider detail" }), { status: 503 }),
      );
    const adapter = createAfricaTalkingVoiceAdapter({
      config: africaTalkingVoiceConfigFromEnv(ENV),
      fromNumber: "+2348098765432",
      callId: COMMAND.triggerEvent!,
      fetcher,
    });

    const result = await adapter.placeCall(COMMAND, REGISTRY);
    expect(result).toMatchObject({ outcome: "failed", retryable: true, httpStatus: 503 });
    expect(JSON.stringify(result)).not.toContain("private provider detail");
  });

  it("serves call instructions only for the matching approved AT call and sender", async () => {
    const handler = createAfricaTalkingOutboundCallHandler({
      env: ENV,
      db: {
        from(table: string) {
          const query = {
            select: () => query,
            eq: () => query,
            maybeSingle: async () => ({
              data:
                table === "cg_voice_call_approvals"
                  ? {
                      tenant_ref: COMMAND.tenantRef,
                      recipient_phone: COMMAND.recipientPhone,
                      script: COMMAND.script,
                      status: "completed",
                      provider_call_id: "ATV-1",
                    }
                  : { from_number: "+2348098765432" },
              error: null,
            }),
            order: () => query,
            limit: () => query,
            insert: () => query,
            upsert: () => query,
            update: () => query,
          };
          return query;
        },
        rpc: async () => ({ data: null, error: null }),
      } as unknown as VoiceCallbackDatabase,
    });
    const body = new URLSearchParams({
      sessionId: "ATV-1",
      callerNumber: "+2348098765432",
      destinationNumber: COMMAND.recipientPhone,
      direction: "Outbound",
    });
    const response = await handler(
      new Request(
        `${ENV.AT_VOICE_CALLBACK_URL}?token=${ENV.AT_VOICE_WEBHOOK_TOKEN}&call_id=${COMMAND.triggerEvent}`,
        {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          body,
        },
      ),
    );

    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Please contact your organization.");
  });
});

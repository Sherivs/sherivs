import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  africaTalkingVoiceConfigFromEnv,
  createAfricaTalkingOutboundCallHandler,
  createAfricaTalkingVoiceCallbackHandler,
  dialHumanXml,
  type VoiceCallbackDatabase,
  type VoiceServerEnv,
} from "../../../frontend/src/lib/communications/africas-talking-voice.server";
import { createAfricaTalkingVoiceAdapter } from "../../../frontend/src/lib/communications/africas-talking-outbound.server";
import {
  PLATFORM_VOICE_TENANT_REF,
  assertNoRawVoiceNumber,
  canonicalVoiceDigits,
  assertRecipientMembership,
  assertVoiceNumberTenant,
  decideVoiceConsent,
  parseVoiceRecipientRef,
  voiceAgentConfigureInput,
  voiceCallRequestInput,
  voiceSttProviderFromEnv,
  voiceTtsProviderFromEnv,
} from "../../../frontend/src/lib/communications/voice-number-binding";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const MIGRATION = readFileSync(
  join(ROOT, "database/supabase/migrations/20261104032000_sherivs_comms01_at_number_binding.sql"),
  "utf8",
);
const ROLLBACK = readFileSync(
  join(ROOT, "database/supabase/rollbacks/20261104032000_sherivs_comms01_at_number_binding.sql"),
  "utf8",
);
const RLS_CHECK = readFileSync(join(ROOT, "database/queries/rls-isolation-check.sql"), "utf8");
const SERVER_FUNCTIONS = readFileSync(
  join(ROOT, "frontend/src/lib/communications/voice-agent.functions.ts"),
  "utf8",
);
const VOICE_SCREEN = readFileSync(
  join(ROOT, "frontend/src/components/app-shell/account-screens.tsx"),
  "utf8",
);
const TENANT_A = "00000000-0000-4000-8000-000000000003";
const TENANT_B = "00000000-0000-4000-8000-000000000004";
const USER_A = "00000000-0000-4000-8000-000000000011";
const ENV: VoiceServerEnv = {
  AT_USERNAME: "sherivs",
  AT_API_KEY: "unit-test-at-api-key",
  AT_VOICE_WEBHOOK_TOKEN: "voice-webhook-unit-test-token-with-sufficient-length",
  AT_VOICE_CALLBACK_URL: "https://voice.example.test/api/public/webhooks/africas-talking-voice",
};

const { rpcCalls } = vi.hoisted(() => ({ rpcCalls: [] as string[] }));

vi.mock("@/integrations/supabase/client.server", () => ({
  supabaseAdmin: {
    rpc: async (name: string, args: Record<string, unknown>) => {
      rpcCalls.push(name);
      if (name !== "voice_agent_assert_recipient_consent") {
        return { data: null, error: { message: "not allowed" } };
      }
      if (args.p_recipient_user !== USER_A) {
        return { data: null, error: { message: "recipient is outside this organization" } };
      }
      return { data: null, error: null };
    },
  },
}));

describe("COMMS-01 voice number binding", () => {
  beforeEach(() => {
    rpcCalls.length = 0;
  });

  it("rejects raw numbers from client or AI input", () => {
    expect(() => assertNoRawVoiceNumber({ recipientPhone: "+2348012345678" })).toThrow(
      /Raw phone numbers/,
    );
    expect(() => assertNoRawVoiceNumber({ providerNumber: "+2348012345678" })).toThrow(
      /Raw phone numbers/,
    );
    expect(() => parseVoiceRecipientRef("+2348012345678")).toThrow(/Raw phone numbers/);
    expect(
      voiceCallRequestInput.safeParse({
        category: "fee_reminder",
        recipientPhone: "+2348012345678",
      }).success,
    ).toBe(false);
    expect(
      voiceAgentConfigureInput.safeParse({
        enabled: true,
        providerNumber: "+2348012345678",
      }).success,
    ).toBe(false);
    expect(
      voiceCallRequestInput.safeParse({ category: "absence_alert", recipientUserId: USER_A })
        .success,
    ).toBe(true);
    const requestBlock = SERVER_FUNCTIONS.split("export const requestVoiceCall")[1]?.split(
      "export const listVoiceCalls",
    )[0];
    expect(requestBlock).toContain("recipientUserId");
    expect(requestBlock).not.toContain("p_recipient_phone");
    expect(requestBlock).not.toContain("recipientPhone");
    expect(VOICE_SCREEN).toContain("recipientUserId");
    expect(VOICE_SCREEN).toContain("readOnly");
    expect(VOICE_SCREEN).not.toContain('type="tel"');
  });

  it("rejects a recipient or sender number that belongs to another organization", async () => {
    expect(() =>
      assertVoiceNumberTenant(
        { orgId: TENANT_B, tenantRef: TENANT_B, bindingRole: "organization" },
        TENANT_A,
      ),
    ).toThrow(/not bound to this organization/);
    expect(() =>
      assertVoiceNumberTenant(
        { orgId: null, tenantRef: TENANT_A, bindingRole: "platform_support" },
        TENANT_A,
      ),
    ).toThrow(/not bound to this organization/);
    expect(() => assertRecipientMembership([TENANT_B], TENANT_A)).toThrow(
      /not a member of this organization/,
    );
    expect(() =>
      decideVoiceConsent({
        recipientUserId: USER_A,
        callerOrgId: TENANT_A,
        membershipOrgIds: [TENANT_B],
        phone: "+2348011111111",
        phoneConfirmed: true,
        optedIn: true,
      }),
    ).toThrow(/not a member of this organization/);

    const { assertVoiceRecipientConsent } =
      await import("../../../frontend/src/lib/communications/voice-consent.server");
    await expect(assertVoiceRecipientConsent(TENANT_A, "+2348011111111")).rejects.toThrow(
      /Raw phone numbers/,
    );
    expect(rpcCalls).toEqual([]);
    await expect(
      assertVoiceRecipientConsent(TENANT_A, "00000000-0000-4000-8000-000000000099"),
    ).rejects.toThrow(/not a member of this organization/);
    await expect(assertVoiceRecipientConsent(TENANT_A, USER_A)).resolves.toBeUndefined();
    expect(rpcCalls).toEqual([
      "voice_agent_assert_recipient_consent",
      "voice_agent_assert_recipient_consent",
    ]);
  });

  it("fails closed when an Africa's Talking key is missing and when the webhook token is wrong", async () => {
    for (const key of [
      "AT_USERNAME",
      "AT_API_KEY",
      "AT_VOICE_WEBHOOK_TOKEN",
      "AT_VOICE_CALLBACK_URL",
    ] as const) {
      expect(africaTalkingVoiceConfigFromEnv({ ...ENV, [key]: undefined })).toBeNull();
    }
    const fetcher = vi.fn<typeof fetch>();
    const adapter = createAfricaTalkingVoiceAdapter({
      config: null,
      fromNumber: "+2348098765432",
      callId: "00000000-0000-4000-8000-000000000010",
      fetcher,
    });
    await expect(
      adapter.placeCall(
        {
          callKind: "absence_alert",
          tenantRef: TENANT_A,
          recipientName: "Member",
          recipientPhone: "+2348011111111",
          script: "Please contact the office.",
          triggerEvent: null,
        },
        {
          isProviderConfigured: () => false,
          credentialReferenceFor: () => null,
        },
      ),
    ).resolves.toMatchObject({ outcome: "undeliverable", code: "provider_not_configured" });
    expect(fetcher).not.toHaveBeenCalled();

    const calls: string[] = [];
    const db = {
      from(table: string) {
        calls.push(table);
        const query = {
          select: () => query,
          eq: () => query,
          order: () => query,
          limit: () => query,
          maybeSingle: async () => ({ data: null, error: null }),
          insert: () => query,
          upsert: () => query,
          update: () => query,
          then: (resolve: (value: { data: null; error: null }) => unknown) =>
            Promise.resolve({ data: null, error: null }).then(resolve),
        };
        return query;
      },
      rpc: async () => ({ data: null, error: null }),
    } as unknown as VoiceCallbackDatabase;
    const inbound = createAfricaTalkingVoiceCallbackHandler({
      env: {},
      db,
      assistant: null,
    });
    expect(
      (await inbound(new Request("https://voice.example.test/hook", { method: "POST" }))).status,
    ).toBe(503);
    expect(calls).toEqual([]);

    const outbound = createAfricaTalkingOutboundCallHandler({ env: ENV, db });
    const denied = await outbound(
      new Request(`${ENV.AT_VOICE_CALLBACK_URL}?token=wrong-token&call_id=${USER_A}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ sessionId: "ATV-1" }),
      }),
    );
    expect(denied.status).toBe(403);
    expect(calls).toEqual([]);
  });

  it("treats a local 080 number and +234 as the same opted-in phone", () => {
    const local = "08031234567";
    const international = "+2348031234567";
    expect(canonicalVoiceDigits(local)).toBe("2348031234567");
    expect(canonicalVoiceDigits(international)).toBe(canonicalVoiceDigits(local));
    expect(canonicalVoiceDigits("2348031234567")).toBe(canonicalVoiceDigits(local));
    expect(canonicalVoiceDigits("08039999999")).not.toBe(canonicalVoiceDigits(international));
    expect(MIGRATION).toContain("WHEN d ~ '^0[0-9]{10}$' THEN '234' || substr(d, 2)");
    expect(ROLLBACK).toContain("DROP FUNCTION IF EXISTS public.comms_voice_digits(text);");
  });

  it("defaults speech to Africa's Talking Say and keeps the platform escalation number pinned", () => {
    expect(voiceTtsProviderFromEnv({})).toBe("africas_talking");
    expect(voiceSttProviderFromEnv({})).toBe("openai");
    expect(voiceTtsProviderFromEnv({ VOICE_TTS_PROVIDER: "other" })).toBe("other");
    expect(dialHumanXml()).toContain('<Dial phoneNumbers="+2349015056201"/>');
    expect(() => dialHumanXml("+2348000000000")).toThrow(/platform support line/);
  });

  it("keeps the migration inside the reserved range, forced-RLS, and fail-closed", () => {
    expect(MIGRATION).not.toMatch(/^\s*BEGIN\s*;/m);
    expect(MIGRATION).not.toMatch(/^\s*COMMIT\s*;/m);
    expect(MIGRATION).toContain(
      "ALTER TABLE public.comms_sender_numbers FORCE ROW LEVEL SECURITY;",
    );
    expect(MIGRATION).toContain("binding_role = 'platform_support'");
    expect(MIGRATION).toContain("'+2349015056201'");
    expect(MIGRATION).toContain("recipient is outside this organization");
    expect(MIGRATION).toContain("voice number is not bound for this organization");
    expect(MIGRATION).toContain("outbound voice number is not bound to this organization");
    expect(MIGRATION).toContain("INSERT INTO public.audit_chain");
    expect(MIGRATION).toContain("voice_live is disabled for this organization");
    expect(MIGRATION).not.toContain("('voice_live', true");
    const bindGrant = MIGRATION.split(
      "GRANT EXECUTE ON FUNCTION public.comms_bind_voice_sender(uuid, text),",
    )[1]?.split(";")[0];
    expect(bindGrant).toContain("TO service_role");
    expect(bindGrant).not.toContain("authenticated");
    expect(MIGRATION).toContain("public.voice_agent_request_call(text, text, text, uuid, text)");
    expect(MIGRATION).toContain(
      "DROP FUNCTION IF EXISTS public.voice_agent_request_call(text, text, text, text, text);",
    );
    expect(MIGRATION).toContain("phone_redacted");
    expect(MIGRATION).toContain("voice.number.unbound");
    expect(MIGRATION).toContain("voice.number.bound");
    expect(MIGRATION).toContain("OLD.org_id IS DISTINCT FROM NEW.org_id");
    expect(MIGRATION).toContain(
      "platform support line can only be attached to the platform organization",
    );
    expect(MIGRATION).toContain("platform support line is already attached");
    expect(MIGRATION).toContain("IS DISTINCT FROM EXCLUDED.provider");
    expect(MIGRATION).toContain("au.phone_confirmed_at IS NOT NULL");
    expect(MIGRATION).toContain(
      "public.comms_voice_digits(o.phone) = public.comms_voice_digits(v_phone)",
    );
    expect(MIGRATION).not.toContain("regexp_replace(o.phone, '\\D', '', 'g') = v_digits");
    expect(MIGRATION).not.toMatch(/u\.school_id/);
    expect(ROLLBACK).toContain(
      "DROP FUNCTION IF EXISTS public.voice_agent_assert_recipient_consent(text, uuid);",
    );
    expect(RLS_CHECK).toContain("voice_agent_assert_recipient_consent");
    expect(ROLLBACK).toContain(
      "DROP FUNCTION IF EXISTS public.comms_bind_voice_sender(uuid, text);",
    );
    expect(ROLLBACK).toContain("audit_chain entries are retained as immutable evidence.");
    expect(ROLLBACK).toContain("public.voice_agent_request_call(text, text, text, text, text)");
    expect(RLS_CHECK).toContain("comms_sender_numbers RLS is not forced after COMMS-01");
    expect(RLS_CHECK).toContain("comms_bind_voice_sender");
  });

  it("routes platform calls only to the platform tenant and survives a missing binding column", async () => {
    const PLATFORM_SCHOOL = "00000000-0000-4000-8000-0000000000aa";
    const OTHER_ORG = "00000000-0000-4000-8000-0000000000bb";
    function callbackDb(mode: "platform" | "missing-column"): VoiceCallbackDatabase {
      let wroteSession = false;
      return {
        from(table: string) {
          let selected = "";
          const filters = new Map<string, unknown>();
          const query = {
            select(columns: string) {
              selected = columns;
              return query;
            },
            eq(column: string, value: unknown) {
              filters.set(column, value);
              return query;
            },
            order: () => query,
            limit: () => query,
            maybeSingle: async () => {
              if (table === "cg_org_communication_sender") return { data: null, error: null };
              if (
                table === "comms_sender_numbers" &&
                mode === "missing-column" &&
                selected.includes("binding_role")
              ) {
                return {
                  data: null,
                  error: { message: "column binding_role does not exist", code: "42703" },
                };
              }
              if (table === "comms_sender_numbers" && mode === "missing-column") {
                return { data: { school_id: PLATFORM_SCHOOL }, error: null };
              }
              if (
                table === "comms_sender_numbers" &&
                filters.get("binding_role") === "platform_support"
              ) {
                return {
                  data: {
                    provider_number: "+2349015056201",
                    binding_role: "platform_support",
                    number_status: "active",
                  },
                  error: null,
                };
              }
              if (table === "comms_sender_numbers") {
                return {
                  data: {
                    school_id: OTHER_ORG,
                    org_id: OTHER_ORG,
                    binding_role: "platform_support",
                    tenant_ref: PLATFORM_VOICE_TENANT_REF,
                    number_status: "active",
                  },
                  error: null,
                };
              }
              if (table === "school_tenant_map") {
                return filters.get("tenant_id") === PLATFORM_VOICE_TENANT_REF
                  ? { data: { school_id: PLATFORM_SCHOOL }, error: null }
                  : { data: null, error: null };
              }
              if (table === "voice_call_sessions" && wroteSession) {
                const values = inserted[inserted.length - 1] ?? {};
                return {
                  data: {
                    id: "00000000-0000-4000-8000-0000000000cc",
                    tenant_id: values.tenant_id,
                    tenant_ref: values.tenant_ref ?? null,
                    provider_session_id: values.provider_session_id,
                    caller_number: values.caller_number,
                    destination_number: values.destination_number,
                    state: "consent_pending",
                    recording_consent_at: null,
                    turn_count: 0,
                  },
                  error: null,
                };
              }
              return { data: null, error: null };
            },
            insert(values: Record<string, unknown>) {
              wroteSession = table === "voice_call_sessions";
              if (wroteSession) inserted.push(values);
              return query;
            },
            upsert: () => query,
            update: () => query,
            then: (resolve: (value: { data: null; error: null }) => unknown) =>
              Promise.resolve({ data: null, error: null }).then(resolve),
          };
          return query;
        },
        rpc: async () => ({ data: true, error: null }),
      } as unknown as VoiceCallbackDatabase;
    }
    const inserted: Record<string, unknown>[] = [];
    const platformHandler = createAfricaTalkingVoiceCallbackHandler({
      env: ENV,
      db: callbackDb("platform"),
      assistant: null,
    });
    const platformResponse = await platformHandler(
      new Request(`${ENV.AT_VOICE_CALLBACK_URL}?token=${ENV.AT_VOICE_WEBHOOK_TOKEN}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          sessionId: "at-platform-1",
          direction: "Inbound",
          callerNumber: "+2348012345678",
          destinationNumber: "+2349015056201",
        }),
      }),
    );
    expect(platformResponse.status).toBe(200);
    expect(inserted[0]).toMatchObject({
      tenant_id: PLATFORM_SCHOOL,
      tenant_ref: PLATFORM_VOICE_TENANT_REF,
    });
    expect(inserted[0]?.tenant_id).not.toBe(OTHER_ORG);

    const missingHandler = createAfricaTalkingVoiceCallbackHandler({
      env: ENV,
      db: callbackDb("missing-column"),
      assistant: null,
    });
    const missingResponse = await missingHandler(
      new Request(`${ENV.AT_VOICE_CALLBACK_URL}?token=${ENV.AT_VOICE_WEBHOOK_TOKEN}`, {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          sessionId: "at-legacy-1",
          direction: "Inbound",
          callerNumber: "+2348012345678",
          destinationNumber: "+2348098765432",
        }),
      }),
    );
    expect(missingResponse.status).not.toBe(500);
    expect(await missingResponse.text()).toContain("<GetDigits");
  });
});

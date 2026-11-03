import { createHmac, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

const LOCAL_URL = "http://127.0.0.1:54321";
const enabled = process.env.SV1_WA_LOCAL === "1";
const serviceKey = process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY;

if (enabled) {
  const configured = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL;
  if (configured && configured !== LOCAL_URL) {
    throw new Error("WhatsApp local E2E refuses a non-local Supabase URL.");
  }
  if (!serviceKey) throw new Error("SUPABASE_LOCAL_SERVICE_ROLE_KEY is required.");
}

vi.mock("@/integrations/supabase/client.server", async () => {
  if (!process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY) {
    return { supabaseAdmin: { rpc: vi.fn() } };
  }
  const { createClient } = await import("@supabase/supabase-js");
  return {
    supabaseAdmin: createClient(
      "http://127.0.0.1:54321",
      process.env.SUPABASE_LOCAL_SERVICE_ROLE_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } },
    ),
  };
});

import { Route } from "../../frontend/src/routes/api/public/webhooks/whatsapp";

type Handler = (input: { request: Request }) => Promise<Response>;
const postWebhook = (Route as unknown as { options: { server: { handlers: { POST: Handler } } } })
  .options.server.handlers.POST;
const secret = "local-whatsapp-webhook-e2e-secret";

describe.skipIf(!enabled)("WhatsApp signed webhook E2E (local Supabase only)", () => {
  const run = randomUUID().replaceAll("-", "");
  const tenantId = randomUUID();
  const orgRef = `wa-e2e-${run}`;
  const principalRef = `wa-e2e-principal-${run}`;
  const address = "+2349015056202";
  const providerSenderRef = String(100000000000000 + Math.floor(Math.random() * 899999999999999));
  const providerRef = `wamid.e2e.${run}`;
  const providerTimestamp = String(Math.floor(Date.now() / 1000));
  const originalFetch = globalThis.fetch;
  let db: SupabaseClient | undefined;
  const graphCalls: Array<{ url: string; body: string }> = [];
  const originalEnv = {
    appSecret: process.env.WHATSAPP_APP_SECRET,
    token: process.env.WHATSAPP_TOKEN,
    phoneId: process.env.WHATSAPP_PHONE_NUMBER_ID,
    ackText: process.env.WHATSAPP_AUTO_ACK_TEXT,
  };

  function sign(raw: string) {
    return `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
  }

  async function check<T extends { error: unknown }>(result: T): Promise<T> {
    expect(result.error).toBeNull();
    return result;
  }

  beforeAll(async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    db = supabaseAdmin as unknown as SupabaseClient;
    process.env.WHATSAPP_APP_SECRET = secret;
    process.env.WHATSAPP_TOKEN = "local-e2e-token-fixture";
    process.env.WHATSAPP_PHONE_NUMBER_ID = providerSenderRef;
    process.env.WHATSAPP_AUTO_ACK_TEXT = "Thanks, we received your message.";
    globalThis.fetch = async (input, init) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (url.startsWith("https://graph.facebook.com/")) {
        graphCalls.push({ url, body: String(init?.body ?? "") });
        return new Response(JSON.stringify({ messages: [{ id: `wamid.ack.${run}` }] }), {
          status: 200,
        });
      }
      return originalFetch(input, init);
    };

    await check(
      await db.from("cg_org_unit").insert({
        id: orgRef,
        tenant_id: tenantId,
        kind: "organization",
        parent_org_unit_id: null,
        lifecycle_state: "active",
        profile: { name: `WhatsApp E2E ${run}` },
        created_by: "local-whatsapp-e2e",
      }),
    );
    await check(
      await db.from("cg_org_membership").insert({
        id: `wa-e2e-membership-${run}`,
        tenant_id: tenantId,
        org_unit_id: orgRef,
        principal_ref: principalRef,
        role_ref: "role:member",
        state: "active",
        created_by: "local-whatsapp-e2e",
      }),
    );
    await check(
      await db.from("cg_org_communication_sender").insert({
        sender_ref: `wa-${providerSenderRef}`,
        tenant_id: tenantId,
        org_ref: orgRef,
        channel: "whatsapp",
        provider: "meta_cloud",
        from_number: "+2349015056201",
        credential_ref: "env://WHATSAPP_TOKEN",
        status: "active",
        provider_sender_ref: providerSenderRef,
        provenance: { createdBy: "local-whatsapp-e2e", createdAt: new Date().toISOString() },
      }),
    );
    await check(
      await db.from("cg_communication_recipient_address").insert({
        tenant_id: tenantId,
        org_ref: orgRef,
        principal_ref: principalRef,
        channel: "whatsapp",
        address,
      }),
    );
    await check(
      await db.from("cg_communication_optin").insert({
        tenant_id: tenantId,
        org_ref: orgRef,
        channel: "whatsapp",
        address,
        status: "opted_in",
        source: "authorized_server",
      }),
    );
  });

  afterAll(async () => {
    if (db) {
      await db
        .from("cg_whatsapp_dead_letter")
        .delete()
        .eq("provider_sender_ref", providerSenderRef);
      await db
        .from("cg_whatsapp_inbound_rate_limit")
        .delete()
        .eq("provider_sender_ref", providerSenderRef);
      await db
        .from("cg_whatsapp_inbound_event")
        .delete()
        .eq("provider_sender_ref", providerSenderRef);
      await db
        .from("cg_org_communication_sender")
        .delete()
        .eq("sender_ref", `wa-${providerSenderRef}`);
      await db.from("cg_org_unit").delete().eq("id", orgRef).eq("tenant_id", tenantId);
    }
    globalThis.fetch = originalFetch;
    for (const [key, value] of Object.entries({
      WHATSAPP_APP_SECRET: originalEnv.appSecret,
      WHATSAPP_TOKEN: originalEnv.token,
      WHATSAPP_PHONE_NUMBER_ID: originalEnv.phoneId,
      WHATSAPP_AUTO_ACK_TEXT: originalEnv.ackText,
    })) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it("stores a signed inbound message, dispatches one mocked Graph acknowledgement, and dedupes replay", async () => {
    const raw = JSON.stringify({
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: providerSenderRef },
                messages: [
                  {
                    id: providerRef,
                    from: address,
                    type: "text",
                    timestamp: providerTimestamp,
                    text: { body: "Hello" },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    const send = () =>
      postWebhook({
        request: new Request(`${LOCAL_URL}/api/public/webhooks/whatsapp`, {
          method: "POST",
          headers: { "x-hub-signature-256": sign(raw) },
          body: raw,
        }),
      });

    expect((await send()).status).toBe(200);
    expect((await send()).status).toBe(200);
    expect(graphCalls).toHaveLength(1);
    expect(graphCalls[0]?.url).toBe(
      `https://graph.facebook.com/v21.0/${providerSenderRef}/messages`,
    );
    expect(JSON.parse(graphCalls[0]?.body ?? "{}")).toMatchObject({
      type: "text",
      to: address.slice(1),
      text: { body: "Thanks, we received your message.", preview_url: false },
    });

    const client = db!;
    const { data: messages } = await client
      .from("cg_communication_message")
      .select("tenant_id, org_ref, conversation_id, direction, status, body, provider_ref")
      .eq("tenant_id", tenantId)
      .eq("provider_ref", providerRef);
    expect(messages).toEqual([
      expect.objectContaining({
        tenant_id: tenantId,
        org_ref: orgRef,
        conversation_id: expect.any(String),
        direction: "inbound",
        status: "received",
        body: "Hello",
        provider_ref: providerRef,
      }),
    ]);
    const { data: forwarded } = await client
      .from("cg_whatsapp_n8n_outbox")
      .select("tenant_id, org_ref, conversation_id, provider_ref, status, payload")
      .eq("tenant_id", tenantId)
      .eq("provider_ref", providerRef);
    expect(forwarded).toEqual([
      expect.objectContaining({
        tenant_id: tenantId,
        org_ref: orgRef,
        conversation_id: messages?.[0]?.conversation_id,
        provider_ref: providerRef,
        status: "pending",
        payload: expect.objectContaining({
          tenant_id: tenantId,
          org_ref: orgRef,
          provider_message_id: providerRef,
          recipient_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
        }),
      }),
    ]);

    const { data: acknowledgements } = await client
      .from("cg_whatsapp_auto_ack")
      .select("status")
      .eq("inbound_provider_ref", providerRef);
    expect(acknowledgements).toEqual([{ status: "sent" }]);
    const { data: outbound } = await client
      .from("cg_communication_message")
      .select("id, status, provider_ref, body")
      .eq("tenant_id", tenantId)
      .eq("direction", "outbound");
    expect(outbound).toEqual([
      expect.objectContaining({
        status: "sent",
        provider_ref: `wamid.ack.${run}`,
        body: "Thanks, we received your message.",
      }),
    ]);
    const { data: sendAudit } = await client
      .from("cg_whatsapp_send_audit")
      .select("tenant_id, org_ref, conversation_id, message_id, recipient_hash")
      .eq("tenant_id", tenantId)
      .eq("message_id", outbound?.[0]?.id);
    expect(sendAudit).toEqual([
      expect.objectContaining({
        tenant_id: tenantId,
        org_ref: orgRef,
        conversation_id: messages?.[0]?.conversation_id,
        message_id: outbound?.[0]?.id,
        recipient_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      }),
    ]);

    const oldRef = `wamid.old.${run}`;
    const { data: oldResult, error: oldError } = await client.rpc("cg_whatsapp_receive", {
      p_provider_sender_ref: providerSenderRef,
      p_from: address,
      p_body: "A delayed message",
      p_provider_ref: oldRef,
      p_provider_timestamp: new Date(Number(providerTimestamp) * 1000).toISOString(),
    });
    expect(oldError).toBeNull();
    expect(oldResult).toBe("logged");
    const { error: ageError } = await client
      .from("cg_communication_message")
      .update({ provider_created_at: "2000-01-01T00:00:00.000Z" })
      .eq("tenant_id", tenantId)
      .eq("provider_ref", oldRef);
    expect(ageError).toBeNull();
    const { data: expiredTargets, error: expiredError } = await client.rpc(
      "cg_whatsapp_prepare_auto_ack",
      {
        p_provider_sender_ref: providerSenderRef,
        p_inbound_provider_ref: oldRef,
        p_body: "Should not send",
      },
    );
    expect(expiredError).toBeNull();
    expect(expiredTargets).toEqual([]);

    const stopRaw = JSON.stringify({
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: providerSenderRef },
                messages: [
                  {
                    id: `wamid.stop.${run}`,
                    from: address,
                    type: "text",
                    timestamp: providerTimestamp,
                    text: { body: "STOP" },
                  },
                ],
              },
            },
          ],
        },
      ],
    });
    const stopResponse = await postWebhook({
      request: new Request(`${LOCAL_URL}/api/public/webhooks/whatsapp`, {
        method: "POST",
        headers: { "x-hub-signature-256": sign(stopRaw) },
        body: stopRaw,
      }),
    });
    expect(stopResponse.status).toBe(200);
    expect(graphCalls).toHaveLength(1);
    const { data: optin } = await client
      .from("cg_communication_optin")
      .select("status")
      .eq("tenant_id", tenantId)
      .eq("org_ref", orgRef)
      .eq("address", address)
      .single();
    expect(optin).toEqual({ status: "opted_out" });

    for (let index = 0; index < 27; index += 1) {
      const { data, error } = await client.rpc("cg_whatsapp_receive", {
        p_provider_sender_ref: providerSenderRef,
        p_from: address,
        p_body: "Rate-limit test",
        p_provider_ref: `wamid.limit.${run}.${index}`,
        p_provider_timestamp: null,
      });
      expect(error).toBeNull();
      expect(data).toBe("logged");
    }
    const { data: limited, error: limitError } = await client.rpc("cg_whatsapp_receive", {
      p_provider_sender_ref: providerSenderRef,
      p_from: address,
      p_body: "Over the limit",
      p_provider_ref: `wamid.limit.${run}.over`,
      p_provider_timestamp: null,
    });
    expect(limitError).toBeNull();
    expect(limited).toBe("rate_limited");
    const { data: limitDeadLetters } = await client
      .from("cg_whatsapp_dead_letter")
      .select("error_code")
      .eq("provider_sender_ref", providerSenderRef)
      .eq("error_code", "rate_limited");
    expect(limitDeadLetters).toHaveLength(1);
  });
});

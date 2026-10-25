/**
 * SHERIVS-090 signed inbound webhook for a school's rest-webhook integration.
 *
 * Routing id (webhook_id) is public and non-secret; it resolves to exactly one integration
 * and therefore exactly one school. Authenticity: HMAC-SHA256 over `${timestamp}.${rawBody}`
 * with the per-integration secret from the Sherivs Vault, 5-minute replay window, constant-time
 * compare. Writes go through integration_ingest, which takes school_id from the integration row
 * (never the payload) and is idempotent per idempotency key.
 */
import { createFileRoute } from "@tanstack/react-router";
import { createHash } from "node:crypto";
import { z } from "zod";
import { clientIpFromHeaders } from "@/lib/security/request-safety";
import { verifyWebhook } from "@/lib/integrations-hub/connectors/rest-webhook";
import { CANONICAL_ENTITIES } from "@/lib/integrations-hub/sdk";

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const Body = z.object({
  entity: z.enum(CANONICAL_ENTITIES),
  records: z
    .array(
      z.object({
        external_id: z.string().min(1).max(200),
        data: z.record(z.string(), z.unknown()),
      }),
    )
    .min(1)
    .max(5000),
});
type Loose = {
  rpc: (
    f: string,
    a: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;
};

export const Route = createFileRoute("/api/public/webhooks/integrations/$webhookId")({
  server: {
    handlers: {
      POST: async ({ request, params }) => {
        if (!/^[0-9a-f-]{36}$/i.test(params.webhookId))
          return new Response("Not found", { status: 404 });
        const ip = clientIpFromHeaders(request.headers);
        const { checkPublicRateLimit } = await import("@/lib/security/public-rate-limit.server");
        const limited = await checkPublicRateLimit(
          "integration-webhook",
          `${params.webhookId}:${ip}`,
          { maxRequests: 120, windowMs: 60_000 },
        );
        if (!limited.allowed)
          return new Response("Too many requests", {
            status: 429,
            headers: { "Retry-After": String(limited.retryAfterSeconds) },
          });

        const raw = await request.text();
        if (raw.length > MAX_BODY_BYTES) return new Response("Payload too large", { status: 413 });

        const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
        const admin = supabaseAdmin as unknown as Loose;
        const { data: t } = await admin.rpc("integration_webhook_target", {
          p_webhook_id: params.webhookId,
        });
        const target = (Array.isArray(t) ? t[0] : null) as {
          integration_id: string;
          school_id: string;
          credential_provider: string;
          credential_name: string;
        } | null;
        if (!target) return new Response("Not found", { status: 404 });

        const { getIntegrationVault } = await import("@/lib/integrations-hub/vault.server");
        const vault = await getIntegrationVault();
        if (!vault) return new Response("Integrations not configured", { status: 503 });
        const ts = request.headers.get("x-sherivs-timestamp"),
          sig = request.headers.get("x-sherivs-signature");
        let ok = false;
        try {
          ok = await vault.withCredential(
            target.school_id,
            target.credential_provider,
            target.credential_name,
            async (secret) => verifyWebhook(secret, ts, sig, raw, Math.floor(Date.now() / 1000)),
          );
        } catch {
          ok = false;
        }
        if (!ok) return new Response("Invalid signature", { status: 401 });

        let body: z.infer<typeof Body>;
        try {
          body = Body.parse(JSON.parse(raw));
        } catch {
          return new Response("Invalid payload", { status: 400 });
        }
        const idem = (request.headers.get("idempotency-key") ?? "").slice(0, 200);
        const key = /^[\w.:-]{8,200}$/.test(idem)
          ? idem
          : "wh-" + createHash("sha256").update(raw).digest("hex").slice(0, 48);

        const { data, error } = await admin.rpc("integration_ingest", {
          p_integration: target.integration_id,
          p_entity: body.entity,
          p_records: body.records,
          p_idempotency_key: key,
          p_trigger: "webhook",
        });
        if (error)
          return new Response(error.code === "55000" ? "Integration paused" : "Ingest failed", {
            status: error.code === "55000" ? 409 : 500,
          });
        return Response.json(data, { status: 200 });
      },
    },
  },
});

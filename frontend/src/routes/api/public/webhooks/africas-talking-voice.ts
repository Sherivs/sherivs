import { createFileRoute } from "@tanstack/react-router";
import {
  createAfricaTalkingOutboundCallHandler,
  createAfricaTalkingVoiceCallbackHandler,
  createVoiceAssistantFromEnv,
  voiceXml,
  type VoiceCallbackDatabase,
} from "@/lib/communications/africas-talking-voice.server";
import { clientIpFromHeaders } from "@/lib/security/request-safety";
import { checkPublicRateLimit } from "@/lib/security/public-rate-limit.server";

type CallbackHandler = ReturnType<typeof createAfricaTalkingVoiceCallbackHandler>;
type OutboundHandler = ReturnType<typeof createAfricaTalkingOutboundCallHandler>;
let callbackHandler: CallbackHandler | null = null;
let callbackHandlerPromise: Promise<CallbackHandler> | null = null;
let outboundHandler: OutboundHandler | null = null;
let outboundHandlerPromise: Promise<OutboundHandler> | null = null;

async function getCallbackHandler(): Promise<CallbackHandler> {
  if (callbackHandler) return callbackHandler;
  callbackHandlerPromise ??= (async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const env = process.env;
    const handler = createAfricaTalkingVoiceCallbackHandler({
      env,
      db: supabaseAdmin as unknown as VoiceCallbackDatabase,
      assistant: createVoiceAssistantFromEnv(env),
    });
    callbackHandler = handler;
    return handler;
  })();
  return callbackHandlerPromise;
}

async function getOutboundHandler(): Promise<OutboundHandler> {
  if (outboundHandler) return outboundHandler;
  outboundHandlerPromise ??= (async () => {
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const handler = createAfricaTalkingOutboundCallHandler({
      env: process.env,
      db: supabaseAdmin as unknown as VoiceCallbackDatabase,
    });
    outboundHandler = handler;
    return handler;
  })();
  return outboundHandlerPromise;
}

export const Route = createFileRoute("/api/public/webhooks/africas-talking-voice")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const limited = await checkPublicRateLimit(
          "africastalking-voice",
          clientIpFromHeaders(request.headers),
          { maxRequests: 120, windowMs: 60_000 },
        );
        if (!limited.allowed) {
          return new Response(voiceXml("This support line is temporarily busy."), {
            status: 429,
            headers: {
              "content-type": "application/xml; charset=utf-8",
              "cache-control": "no-store",
              "retry-after": String(limited.retryAfterSeconds),
            },
          });
        }
        if (new URL(request.url).searchParams.has("call_id")) {
          return (await getOutboundHandler())(request);
        }
        return (await getCallbackHandler())(request);
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";
import {
  createAfricaTalkingVoiceCallbackHandler,
  createVoiceAssistantFromEnv,
  voiceXml,
  type VoiceCallbackDatabase,
} from "@/lib/communications/africas-talking-voice.server";
import { clientIpFromHeaders } from "@/lib/security/request-safety";
import { checkPublicRateLimit } from "@/lib/security/public-rate-limit.server";

type CallbackHandler = ReturnType<typeof createAfricaTalkingVoiceCallbackHandler>;
let callbackHandler: CallbackHandler | null = null;
let callbackHandlerPromise: Promise<CallbackHandler> | null = null;

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
        return (await getCallbackHandler())(request);
      },
    },
  },
});

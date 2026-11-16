import { createFileRoute } from "@tanstack/react-router";

/**
 * JARVIS-LIVE-01: Africa's Talking asks this URL what to say on an owner-alert call. It answers
 * only a call this server placed (HMAC over call id and severity) and says one fixed sentence.
 */
export const Route = createFileRoute("/api/public/webhooks/owner-alert-voice")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { answerOwnerAlertCallback } =
          await import("@/lib/jarvis-bridge/owner-alert-voice.server");
        return answerOwnerAlertCallback(request, process.env);
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { webauthnRelatedOriginsDocument } from "@/lib/auth/webauthn-policy";

export const Route = createFileRoute("/.well-known/webauthn")({
  server: {
    handlers: {
      GET: async () =>
        new Response(JSON.stringify(webauthnRelatedOriginsDocument()), {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=3600",
            "Access-Control-Allow-Origin": "*",
          },
        }),
    },
  },
});

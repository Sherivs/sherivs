import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { androidAssetLinks } from "@/lib/auth/webauthn-associated-domains";
import { hostnameFromHostHeader } from "@/lib/experience/experience-host";

export const Route = createFileRoute("/.well-known/assetlinks.json")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // Host routing in this app already prefers x-forwarded-host/host so proxy hosts are honored.
        const host = hostnameFromHostHeader(
          request.headers.get("x-forwarded-host") ??
            request.headers.get("host") ??
            new URL(request.url).host,
        );
        return new Response(JSON.stringify(androidAssetLinks(process.env, host)), {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=3600",
            Vary: "Host",
          },
        });
      },
    },
  },
});

import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { appleAppSiteAssociation } from "@/lib/auth/webauthn-associated-domains";
import { hostnameFromHostHeader } from "@/lib/experience/experience-host";

export const Route = createFileRoute("/.well-known/apple-app-site-association")({
  server: {
    handlers: {
      GET: async ({ request }) => {
        // Host routing in this app already prefers x-forwarded-host/host so proxy hosts are honored.
        const host = hostnameFromHostHeader(
          request.headers.get("x-forwarded-host") ??
            request.headers.get("host") ??
            new URL(request.url).host,
        );
        return new Response(JSON.stringify(appleAppSiteAssociation(process.env, host)), {
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

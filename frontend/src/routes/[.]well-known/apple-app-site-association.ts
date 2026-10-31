import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { appleAppSiteAssociation } from "@/lib/auth/webauthn-associated-domains";

export const Route = createFileRoute("/.well-known/apple-app-site-association")({
  server: {
    handlers: {
      GET: async () =>
        new Response(JSON.stringify(appleAppSiteAssociation()), {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=3600",
          },
        }),
    },
  },
});

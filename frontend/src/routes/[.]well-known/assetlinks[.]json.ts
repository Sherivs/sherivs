import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { androidAssetLinks } from "@/lib/auth/webauthn-associated-domains";

export const Route = createFileRoute("/.well-known/assetlinks.json")({
  server: {
    handlers: {
      GET: async () =>
        new Response(JSON.stringify(androidAssetLinks()), {
          headers: {
            "Content-Type": "application/json",
            "Cache-Control": "public, max-age=3600",
          },
        }),
    },
  },
});

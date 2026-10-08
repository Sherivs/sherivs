import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Legacy path. The public site formerly lived at /coregrid; the brand is now
 * Sherivs and the narrative home is `/`. Kept as a permanent redirect so
 * inbound links and the generated route tree stay valid.
 */
export const Route = createFileRoute("/(site)/coregrid")({
  beforeLoad: () => {
    throw redirect({ to: "/", statusCode: 301 });
  },
});

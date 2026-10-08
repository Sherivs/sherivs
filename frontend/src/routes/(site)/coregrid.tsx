import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Legacy landing path. The platform is presented as Sherivs at `/`; this route
 * only keeps previously published links working.
 */
export const Route = createFileRoute("/(site)/coregrid")({
  beforeLoad: () => {
    throw redirect({ to: "/", statusCode: 301 });
  },
});

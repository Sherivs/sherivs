import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Former path of the platform marketing page. Permanent redirect to the
 * company root (the marketing prototype was removed).
 */
export const Route = createFileRoute("/(site)/coregrid")({
  beforeLoad: () => {
    throw redirect({ to: "/", replace: true, statusCode: 301 });
  },
});

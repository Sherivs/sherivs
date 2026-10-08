import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Legacy platform landing page. CoreGrid is no longer the customer-facing
 * name; the Sherivs homepage at `/` carries the public narrative. Kept as a
 * permanent redirect so existing links keep resolving.
 */
export const Route = createFileRoute("/(site)/coregrid")({
  beforeLoad: () => {
    throw redirect({ to: "/", replace: true, statusCode: 301 });
  },
});

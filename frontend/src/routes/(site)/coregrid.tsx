import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Legacy customer path `/coregrid`.
 *
 * CoreGrid is the engineering kernel name. Customer-facing brand is Sherivs.
 * Keep the route so existing links and tests can observe the alias, then
 * send visitors to the canonical homepage.
 */
export const Route = createFileRoute("/(site)/coregrid")({
  beforeLoad: () => {
    throw redirect({ to: "/" });
  },
  component: function CoreGridAlias() {
    return null;
  },
});

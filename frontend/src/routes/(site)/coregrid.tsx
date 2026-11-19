import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Former path of the Sherivs product overview, named after a retired internal
 * name. Kept as a permanent redirect so existing links keep working. The
 * retired name is never rendered on a page.
 */
export const Route = createFileRoute("/(site)/coregrid")({
  beforeLoad: () => {
    throw redirect({ to: "/sherivs", replace: true, statusCode: 301 });
  },
});

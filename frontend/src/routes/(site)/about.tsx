import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Former hardcoded About marketing page. Redirects to the company root until
 * the new site is built.
 */
export const Route = createFileRoute("/(site)/about")({
  beforeLoad: () => {
    throw redirect({ to: "/", replace: true, statusCode: 301 });
  },
});

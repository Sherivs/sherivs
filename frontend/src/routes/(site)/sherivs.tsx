import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Former Lovable / hardcoded platform-marketing page. Kept as a redirect so
 * existing /sherivs links resolve to the company root, which is now a blank
 * canvas for the new site.
 */
export const Route = createFileRoute("/(site)/sherivs")({
  beforeLoad: () => {
    throw redirect({ to: "/", replace: true, statusCode: 301 });
  },
});

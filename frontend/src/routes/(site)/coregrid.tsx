import { createFileRoute, redirect } from "@tanstack/react-router";

/**
 * Compatibility route for the pre-Sherivs public landing page at /coregrid.
 *
 * The public site now lives at sherivs.com/ with dedicated pages; existing links keep
 * working. Section anchors map to their dedicated pages when the hash reaches the
 * router (client navigation); a server request carries no hash and lands on the home.
 */
const ANCHOR_DESTINATIONS = {
  security: "/security",
  pricing: "/pricing",
  runtimes: "/solutions",
  capabilities: "/platform",
} as const;

export const Route = createFileRoute("/(site)/coregrid")({
  beforeLoad: ({ location }) => {
    const anchor = location.hash.replace(/^#/u, "") as keyof typeof ANCHOR_DESTINATIONS;
    const destination = ANCHOR_DESTINATIONS[anchor] ?? "/";
    throw redirect({ to: destination, replace: true, statusCode: 301 });
  },
});

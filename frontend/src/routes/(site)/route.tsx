import { createFileRoute, Outlet } from "@tanstack/react-router";
import { PublicShell } from "@/components/sherivs/public-shell";

/**
 * Sherivs public site — pathless layout group `(site)`.
 *
 * Presentation only: no tenant context, no database reads, no fake
 * submissions. Navigation and footer are derived from the public route
 * registry (lib/experience-system/public-routes.ts).
 */
export const Route = createFileRoute("/(site)")({
  component: SiteLayout,
});

function SiteLayout() {
  return (
    <PublicShell>
      <Outlet />
    </PublicShell>
  );
}

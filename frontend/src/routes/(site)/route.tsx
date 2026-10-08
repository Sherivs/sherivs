import { createFileRoute, Outlet } from "@tanstack/react-router";
import { PublicShell } from "@/components/sherivs/public-shell";

/**
 * Sherivs public site — pathless layout group `(site)`.
 *
 * Presentation only. Account actions link to the real auth surface.
 * The capability proof page remains at /coregrid.
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

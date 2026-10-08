import { createFileRoute, Outlet } from "@tanstack/react-router";
import { PublicShell } from "@/components/sherivs/public/public-shell";

/**
 * Sherivs public website — pathless layout group `(site)`.
 *
 * Every page under this group renders inside the Sherivs public shell: a
 * header and footer whose links come from the route-architecture contract
 * (only LIVE public routes are ever linked). Presentation only — no tenant
 * context, no fake submissions.
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

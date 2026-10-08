import { createFileRoute, Outlet } from "@tanstack/react-router";
import { SherivsPublicShell } from "@/components/sherivs-public/shell";

/**
 * Sherivs public website — pathless layout group `(site)`.
 *
 * Presentation of the platform itself. Tenant public sites are NOT this
 * layout; they resolve on `/` via organization context.
 */

export const Route = createFileRoute("/(site)")({
  component: SiteLayout,
});

function SiteLayout() {
  return (
    <SherivsPublicShell>
      <Outlet />
    </SherivsPublicShell>
  );
}

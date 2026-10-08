import { createFileRoute, Outlet } from "@tanstack/react-router";
import { PublicShell } from "@/components/sherivs/public-shell";

/**
 * Sherivs public site — pathless layout group `(site)`.
 *
 * The PUBLIC plane: no identity, no tenant context, no database reads, no fake
 * submissions. Navigation and footer derive from the governed route registry
 * (lib/sherivs/routes.ts); every interactive element links to a real route.
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

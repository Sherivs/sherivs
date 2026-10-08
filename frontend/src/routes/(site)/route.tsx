import { createFileRoute, Outlet } from "@tanstack/react-router";
import { SherivsPublicShell } from "@/components/sherivs/public-shell";

/**
 * Sherivs public site — pathless layout group `(site)`.
 *
 * Presents the platform itself to visitors. Presentation only: no tenant context, no
 * database reads, no fake submissions. Header, navigation, footer and landmarks come
 * from the Sherivs public shell, whose links are generated from the public page
 * registry (content/sherivs/site-map.ts) so every link resolves to a real route.
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

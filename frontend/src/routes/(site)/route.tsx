import { createFileRoute, Outlet } from "@tanstack/react-router";
import { SiteHeader } from "@/components/public/site-header";
import { SiteFooter } from "@/components/public/site-footer";

/**
 * Sherivs public site — pathless layout group `(site)`.
 *
 * Presentation only. Internal architecture stays behind authentication.
 * Header and footer live in shared components so this file stays landmark-only.
 */

export const Route = createFileRoute("/(site)")({
  component: SiteLayout,
});

function SiteLayout() {
  return (
    <div className="sherivs-public flex min-h-dvh flex-col bg-sherivs-obsidian text-sherivs-white">
      <SiteHeader />
      <main id="main-content" className="flex-1">
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  );
}

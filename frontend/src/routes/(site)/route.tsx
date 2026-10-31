import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { SiteHeader } from "@/components/public/site-header";
import { SiteFooter } from "@/components/public/site-footer";
import { PublicAtmosphere } from "@/components/public/public-atmosphere";
import { effectiveExperienceHostKind } from "@/lib/experience/console-host-routing";
import { readRequestHostname } from "@/lib/experience/experience-host.functions";

/**
 * Sherivs public site — pathless layout group `(site)`.
 *
 * Presentation only. Internal architecture stays behind authentication.
 * Header and footer live in shared components so this file stays landmark-only.
 * The console host never renders this marketing layout.
 */

async function siteHostname(): Promise<string> {
  if (typeof window !== "undefined") return window.location.hostname;
  return readRequestHostname();
}

export const Route = createFileRoute("/(site)")({
  beforeLoad: async () => {
    const hostname = await siteHostname();
    const hostKind = effectiveExperienceHostKind(
      hostname,
      import.meta.env.VITE_SHERIVS_HOST_KIND_OVERRIDE as string | undefined,
    );
    if (hostKind === "internal") {
      throw redirect({ to: "/" });
    }
  },
  component: SiteLayout,
});

function SiteLayout() {
  return (
    <div className="sherivs-public flex min-h-dvh flex-col">
      <PublicAtmosphere />
      <SiteHeader />
      <main id="main-content" className="relative z-[1] flex-1">
        <Outlet />
      </main>
      <SiteFooter />
    </div>
  );
}

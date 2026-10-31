import { PLATFORM_NAME, PLATFORM_URL } from "@/lib/platform";
import { SherivsLogo } from "@/components/brand/sherivs-logo";
import { PublicAtmosphere } from "@/components/public/public-atmosphere";
import { GlassPanel, PublicButton } from "@/components/public/ui";

/**
 * Replacement for deleted app / console / gov / group / head shells.
 * Not a workspace. Not the public marketing homepage.
 */
export function ApplicationUnavailable({ surface }: { surface: string }) {
  return (
    <div className="sherivs-public flex min-h-dvh flex-col items-center justify-center px-6">
      <PublicAtmosphere />
      <GlassPanel enter className="relative z-[1] max-w-md px-6 py-10 text-center sm:px-10">
        <a href={PLATFORM_URL} aria-label={`${PLATFORM_NAME} home`} className="mb-8 inline-flex">
          <SherivsLogo size={32} lettering="brand" />
        </a>
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          This application is not available
        </h1>
        <p className="mt-3 text-sm text-sherivs-muted">
          The hardcoded {surface} interface has been removed. The {PLATFORM_NAME} company website
          remains at sherivs.com.
        </p>
        <PublicButton href={PLATFORM_URL} className="mt-8">
          Open sherivs.com
        </PublicButton>
      </GlassPanel>
    </div>
  );
}

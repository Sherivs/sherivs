import { PLATFORM_NAME, PLATFORM_URL } from "@/lib/platform";
import { SherivsLockup } from "@/components/brand/sherivs-logo";

/**
 * Replacement for deleted app / console / gov / group / head shells.
 * Not a workspace. Not the public marketing homepage.
 */
export function ApplicationUnavailable({ surface }: { surface: string }) {
  return (
    <div className="sherivs-public flex min-h-dvh flex-col items-center justify-center bg-sherivs-obsidian px-6 text-sherivs-white">
      <div className="max-w-md text-center">
        <a href={PLATFORM_URL} aria-label={`${PLATFORM_NAME} home`} className="mb-8 inline-flex">
          <SherivsLockup height={44} />
        </a>
        <h1 className="font-display text-2xl font-semibold tracking-tight">
          This application is not available
        </h1>
        <p className="mt-3 text-sm text-sherivs-muted">
          The hardcoded {surface} interface has been removed. The {PLATFORM_NAME} company
          website remains at sherivs.com.
        </p>
        <a
          href={PLATFORM_URL}
          className="mt-8 inline-flex items-center justify-center rounded-md bg-sherivs-blue px-4 py-2 text-sm font-semibold text-white hover:opacity-90"
        >
          Open sherivs.com
        </a>
      </div>
    </div>
  );
}

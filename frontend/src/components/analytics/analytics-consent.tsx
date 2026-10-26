import { useEffect, useState } from "react";
import { useApp } from "@/contexts/app-context";
import {
  analyticsAllowed,
  doNotTrackEnabled,
  readAnalyticsConsent,
  shouldAskForAnalyticsConsent,
  writeAnalyticsConsent,
  type AnalyticsConsent,
} from "@/lib/analytics/consent";
import { identifyPosthog, startPosthog, stopPosthog } from "@/lib/analytics/posthog";
import { resolveExperienceHost } from "@/lib/experience/experience-host";

const KEY = import.meta.env.VITE_POSTHOG_KEY as string | undefined;
const HOST = import.meta.env.VITE_POSTHOG_HOST as string | undefined;

/**
 * Consent banner + PostHog bridge. Nothing loads or is sent until the user
 * accepts. Students and Do-Not-Track browsers are never tracked or asked.
 */
export function AnalyticsConsent() {
  const { profile, role, school } = useApp();
  const [consent, setConsent] = useState<AnalyticsConsent>("unset");
  const [ready, setReady] = useState(false);
  const [dnt, setDnt] = useState(false);

  useEffect(() => {
    setConsent(readAnalyticsConsent(window.localStorage));
    setDnt(doNotTrackEnabled(window.navigator, window));
    setReady(true);
  }, []);

  const allowed = ready && analyticsAllowed({ key: KEY, consent, doNotTrack: dnt, role });

  useEffect(() => {
    if (!ready || !KEY) return;
    if (!allowed) {
      stopPosthog();
      return;
    }
    void startPosthog(KEY, HOST).then(() =>
      identifyPosthog({ id: profile?.id, role, tenantId: school?.id ?? profile?.school_id }),
    );
  }, [ready, allowed, profile?.id, role, school?.id, profile?.school_id]);

  if (!ready || !shouldAskForAnalyticsConsent({ key: KEY, consent, doNotTrack: dnt, role })) {
    return null;
  }

  const choose = (choice: "granted" | "denied") => {
    writeAnalyticsConsent(window.localStorage, choice);
    setConsent(choice);
  };

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Analytics consent"
      data-testid="analytics-consent"
      className="fixed inset-x-3 bottom-3 z-[90] mx-auto max-w-xl uos-card p-4 shadow-lg sm:inset-x-auto sm:right-4 sm:bottom-4"
    >
      <p className="text-sm font-semibold">Help us improve Sherivs</p>
      <p className="mt-1 text-xs text-muted-foreground">
        With your permission we collect anonymous usage analytics (pages visited and buttons
        used). We never record your screen, what you type, or your name, email or phone.
        Student accounts are never tracked. See our{" "}
        <a
          href={
            resolveExperienceHost(window.location.hostname) === "tenant"
              ? "/privacy"
              : "/privacy-policy"
          }
          className="underline"
        >
          privacy notice
        </a>
        .
      </p>
      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          onClick={() => choose("denied")}
          className="rounded-md border px-3 py-1.5 text-xs font-medium hover:bg-muted"
        >
          No thanks
        </button>
        <button
          type="button"
          onClick={() => choose("granted")}
          className="rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90"
        >
          Allow analytics
        </button>
      </div>
    </div>
  );
}

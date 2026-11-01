import { createFileRoute } from "@tanstack/react-router";
import { ApplicationUnavailable } from "@/components/public/application-unavailable";
import { AppOnboardingScreen } from "@/components/app-entry/app-onboarding-screen";
import { isRetiredApplicationHostname } from "@/lib/experience/retired-application-host";
import { readRequestHostname } from "@/lib/experience/experience-host.functions";
import { effectiveExperienceHostKind } from "@/lib/experience/console-host-routing";
import { PLATFORM_NAME } from "@/lib/platform";

async function loaderHostname(): Promise<string> {
  if (typeof window !== "undefined") return window.location.hostname;
  return readRequestHostname();
}

export const Route = createFileRoute("/onboarding")({
  loader: async () => {
    const hostname = await loaderHostname();
    const hostKind = effectiveExperienceHostKind(
      hostname,
      import.meta.env.VITE_SHERIVS_HOST_KIND_OVERRIDE as string | undefined,
    );
    const blocked = isRetiredApplicationHostname(hostname) || hostKind === "internal";
    return { blocked, surface: hostKind === "internal" ? "internal console" : "console" };
  },
  component: OnboardingPage,
  head: () => ({
    meta: [
      { title: `Bring your school into Sherivs — ${PLATFORM_NAME}` },
      {
        name: "description",
        content:
          "Request an administrator account to set up your organization, configure school operations, and invite your community into Sherivs Scholar. This page opens your email app. It does not create an account or a ticket.",
      },
      { name: "robots", content: "noindex, nofollow" },
    ],
  }),
});

function OnboardingPage() {
  const data = Route.useLoaderData();
  if (data.blocked) {
    return <ApplicationUnavailable surface={data.surface} />;
  }
  return <AppOnboardingScreen />;
}

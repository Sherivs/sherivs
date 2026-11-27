import { createFileRoute } from "@tanstack/react-router";
import { ConsoleOnboardingRequest } from "@/components/internal-console/onboarding-screens";

export const Route = createFileRoute("/console/onboarding/$requestId")({
  component: ConsoleOnboardingRequest,
  head: () => ({ meta: [{ title: "Onboarding request — Sherivs Console" }] }),
});

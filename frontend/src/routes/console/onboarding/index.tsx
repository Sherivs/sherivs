import { createFileRoute } from "@tanstack/react-router";
import { ConsoleOnboardingQueue } from "@/components/internal-console/onboarding-screens";

export const Route = createFileRoute("/console/onboarding/")({
  component: ConsoleOnboardingQueue,
  head: () => ({ meta: [{ title: "Onboarding requests — Sherivs Console" }] }),
});

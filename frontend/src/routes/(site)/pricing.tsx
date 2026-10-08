import { createFileRoute } from "@tanstack/react-router";
import { PricingPage } from "@/components/experience/public-pages";
import { PLATFORM_NAME } from "@/lib/platform";

export const Route = createFileRoute("/(site)/pricing")({
  component: PricingPage,
  head: () => ({
    meta: [
      { title: `Pricing — ${PLATFORM_NAME}` },
      { name: "description", content: "Commercial tiers mirrored from the entitlement catalog." },
    ],
  }),
});

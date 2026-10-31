import { createFileRoute } from "@tanstack/react-router";
import { ConsoleAccessReview } from "@/components/internal-console/support-access-screens";

export const Route = createFileRoute("/console/team/access")({
  component: ConsoleAccessReview,
  head: () => ({ meta: [{ title: "Access Review — Sherivs Console" }] }),
});

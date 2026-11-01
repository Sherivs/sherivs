import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/(site)/privacy-policy")({
  beforeLoad: () => {
    throw redirect({ to: "/privacy" });
  },
});

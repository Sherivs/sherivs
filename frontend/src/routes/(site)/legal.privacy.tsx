import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/(site)/legal/privacy")({
  beforeLoad: () => {
    throw redirect({ to: "/privacy" });
  },
});

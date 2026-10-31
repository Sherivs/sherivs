import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/(site)/legal/terms")({
  beforeLoad: () => {
    throw redirect({ to: "/terms" });
  },
});

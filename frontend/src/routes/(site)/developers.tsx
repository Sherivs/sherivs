import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/(site)/developers")({
  beforeLoad: () => {
    throw redirect({ to: "/docs" });
  },
});

import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/(site)/solutions/research")({
  beforeLoad: () => {
    throw redirect({ to: "/solutions" });
  },
});

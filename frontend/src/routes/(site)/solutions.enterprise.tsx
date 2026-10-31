import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/(site)/solutions/enterprise")({
  beforeLoad: () => {
    throw redirect({ to: "/solutions" });
  },
});

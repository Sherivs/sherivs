import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/(site)/company/about")({
  beforeLoad: () => {
    throw redirect({ to: "/about" });
  },
});

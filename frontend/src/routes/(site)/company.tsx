import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/(site)/company")({
  beforeLoad: () => {
    throw redirect({ to: "/about" });
  },
});

import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/(site)/product/architecture")({
  beforeLoad: () => {
    throw redirect({ to: "/sherivs" });
  },
});

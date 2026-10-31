import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/(site)/product/institutional-computing")({
  beforeLoad: () => {
    throw redirect({ to: "/sherivs" });
  },
});

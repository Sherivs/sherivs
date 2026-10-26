import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/(site)/product")({
  beforeLoad: () => {
    throw redirect({ to: "/sherivs" });
  },
});

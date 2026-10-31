import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/(site)/product/intelligence")({
  beforeLoad: () => {
    throw redirect({ to: "/sherivs" });
  },
});

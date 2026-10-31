import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/(site)/product/ai-workforce")({
  beforeLoad: () => {
    throw redirect({ to: "/sherivs" });
  },
});

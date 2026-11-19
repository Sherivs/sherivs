import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/console/onboarding")({
  component: () => <Outlet />,
  head: () => ({ meta: [{ title: "Onboarding requests — Sherivs Console" }] }),
});

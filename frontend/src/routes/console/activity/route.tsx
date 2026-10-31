import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/console/activity")({
  component: () => <Outlet />,
  head: () => ({ meta: [{ title: "Activity — Sherivs Console" }] }),
});

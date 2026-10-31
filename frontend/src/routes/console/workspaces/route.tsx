import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/console/workspaces")({
  component: () => <Outlet />,
  head: () => ({ meta: [{ title: "Workspaces — Sherivs Console" }] }),
});

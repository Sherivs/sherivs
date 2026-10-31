import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/console/team")({
  component: () => <Outlet />,
  head: () => ({ meta: [{ title: "Team — Sherivs Console" }] }),
});

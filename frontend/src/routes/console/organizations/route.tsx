import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/console/organizations")({
  component: () => <Outlet />,
  head: () => ({ meta: [{ title: "Organizations — Sherivs Console" }] }),
});

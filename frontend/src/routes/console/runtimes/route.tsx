import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/console/runtimes")({
  component: () => <Outlet />,
  head: () => ({ meta: [{ title: "Runtimes — Sherivs Console" }] }),
});

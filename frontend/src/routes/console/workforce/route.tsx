import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/console/workforce")({
  component: () => <Outlet />,
  head: () => ({ meta: [{ title: "AI Workforce — Sherivs Console" }] }),
});

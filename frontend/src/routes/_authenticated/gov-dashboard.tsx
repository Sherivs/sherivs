/** Old location of the government dashboard: now the separate government portal at /gov (SHERIVS-027). */
import { createFileRoute, redirect } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/gov-dashboard")({
  beforeLoad: () => { throw redirect({ to: "/gov" }); },
});

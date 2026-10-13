import { createFileRoute, Outlet } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/o/$organization/scholar")({
  component: ScholarRuntimeLayout,
});

/** Education runtime shell. Role authorization is applied on the bound splat. */
function ScholarRuntimeLayout() {
  return <Outlet />;
}

import { createFileRoute, Outlet } from "@tanstack/react-router";

/** Layout for `/solutions/*`. Index content lives in `solutions.index.tsx`. */
export const Route = createFileRoute("/(site)/solutions")({
  component: SolutionsLayout,
});

function SolutionsLayout() {
  return <Outlet />;
}

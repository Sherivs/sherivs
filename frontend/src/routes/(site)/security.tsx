import { createFileRoute, Outlet } from "@tanstack/react-router";

/** Layout for `/security/*`. Index content lives in `security.index.tsx`. */
export const Route = createFileRoute("/(site)/security")({
  component: SecurityLayout,
});

function SecurityLayout() {
  return <Outlet />;
}

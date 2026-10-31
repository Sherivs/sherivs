import { createFileRoute, Outlet } from "@tanstack/react-router";

/** Layout for `/help/*`. Index content lives in `help.index.tsx`. */
export const Route = createFileRoute("/(site)/help")({
  component: HelpLayout,
});

function HelpLayout() {
  return <Outlet />;
}

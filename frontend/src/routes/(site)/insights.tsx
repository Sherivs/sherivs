import { createFileRoute, Outlet } from "@tanstack/react-router";

/** Layout for `/insights/*`. Index content lives in `insights.index.tsx`. Company writing stays here; tenant blogs remain at `/blog`. */
export const Route = createFileRoute("/(site)/insights")({
  component: InsightsLayout,
});

function InsightsLayout() {
  return <Outlet />;
}

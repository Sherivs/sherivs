import { createFileRoute } from "@tanstack/react-router";
import { AppProfileScreen } from "@/components/app-shell/account-screens";

export const Route = createFileRoute("/home/profile")({
  component: AppProfileScreen,
});

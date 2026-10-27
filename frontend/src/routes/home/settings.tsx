import { createFileRoute } from "@tanstack/react-router";
import { AppSettingsScreen } from "@/components/app-shell/account-screens";

export const Route = createFileRoute("/home/settings")({
  component: AppSettingsScreen,
});

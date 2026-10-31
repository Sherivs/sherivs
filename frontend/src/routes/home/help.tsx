import { createFileRoute } from "@tanstack/react-router";
import { AppHelpScreen } from "@/components/app-shell/account-screens";

export const Route = createFileRoute("/home/help")({
  component: AppHelpScreen,
});

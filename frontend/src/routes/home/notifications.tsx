import { createFileRoute } from "@tanstack/react-router";
import { AppNotificationsScreen } from "@/components/app-shell/account-screens";

export const Route = createFileRoute("/home/notifications")({
  component: AppNotificationsScreen,
});

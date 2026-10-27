import { createFileRoute } from "@tanstack/react-router";
import { AppSecurityScreen } from "@/components/app-shell/account-screens";

export const Route = createFileRoute("/home/security")({
  component: AppSecurityScreen,
});

import { createFileRoute } from "@tanstack/react-router";
import { AppHomeScreen } from "@/components/app-shell/home-screen";

export const Route = createFileRoute("/home/")({
  component: AppHomeScreen,
});

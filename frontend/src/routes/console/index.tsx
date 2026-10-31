import { createFileRoute } from "@tanstack/react-router";
import { ConsoleHomeScreen } from "@/components/internal-console/home-screen";

export const Route = createFileRoute("/console/")({
  component: ConsoleHomeScreen,
});

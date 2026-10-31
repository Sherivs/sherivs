import { createFileRoute } from "@tanstack/react-router";
import { AppAiScreen } from "@/components/app-shell/account-screens";

export const Route = createFileRoute("/home/ai")({
  component: AppAiScreen,
  head: () => ({ meta: [{ title: "AI — Sherivs" }] }),
});

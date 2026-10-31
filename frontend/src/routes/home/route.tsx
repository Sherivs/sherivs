import { createFileRoute } from "@tanstack/react-router";
import { AppShellLayout } from "@/components/app-shell/app-shell";

export const Route = createFileRoute("/home")({
  component: AppShellLayout,
  head: () => ({ meta: [{ title: "Home — Sherivs" }] }),
});

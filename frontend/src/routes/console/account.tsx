import { createFileRoute } from "@tanstack/react-router";
import { ConsoleAccount } from "@/components/internal-console/module-screens";

export const Route = createFileRoute("/console/account")({
  component: ConsoleAccount,
  head: () => ({ meta: [{ title: "Account — Sherivs Console" }] }),
});

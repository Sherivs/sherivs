import { createFileRoute } from "@tanstack/react-router";
import { WhatsAppOperationsScreen } from "@/components/internal-console/whatsapp-operations-screen";

export const Route = createFileRoute("/console/communications")({
  component: WhatsAppOperationsScreen,
  head: () => ({ meta: [{ title: "WhatsApp — Sherivs Console" }] }),
});

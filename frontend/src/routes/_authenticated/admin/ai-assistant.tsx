import { createFileRoute } from "@tanstack/react-router";
import { PortalPage } from "@/components/portal-shell";
import { AdminAIAssistant } from "@/components/ai/admin-ai-assistant";

export const Route = createFileRoute("/_authenticated/admin/ai-assistant")({
  ssr: false,
  component: AdminAssistantPage,
});

function AdminAssistantPage() {
  return (
    <PortalPage
      title="Vibeora Command AI"
      subtitle="Ask anything about your school, answered from live data"
    >
      <AdminAIAssistant />
    </PortalPage>
  );
}

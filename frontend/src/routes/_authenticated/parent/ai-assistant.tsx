import { createFileRoute } from "@tanstack/react-router";
import { PortalPage } from "@/components/portal-shell";
import { ParentAIAssistant } from "@/components/ai/parent-ai-assistant";

export const Route = createFileRoute("/_authenticated/parent/ai-assistant")({
  ssr: false,
  component: ParentAssistantPage,
});

function ParentAssistantPage() {
  return (
    <PortalPage
      title="School Hermes"
      subtitle="Your personal AI companion for your child's school life"
    >
      <ParentAIAssistant />
    </PortalPage>
  );
}

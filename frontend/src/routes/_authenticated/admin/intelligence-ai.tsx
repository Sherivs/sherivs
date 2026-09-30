import { createFileRoute } from "@tanstack/react-router";
import { Bot, Workflow, FileBarChart2 } from "lucide-react";
import { IntelligenceCenter } from "@/components/intelligence-center";

export const Route = createFileRoute("/_authenticated/admin/intelligence-ai")({
  ssr: false,
  component: AiCommandCenter,
});

function AiCommandCenter() {
  return (
    <IntelligenceCenter
      title="AI Command Center"
      subtitle="Every AI agent, workflow and report — managed in one place."
      tagline="Deploy Vibeora AI agents for admissions, communications, grading and analytics. Compose workflows that chain agents together, then ship reports your team actually reads."
      stats={[
        { label: "Active agents", value: 8, hint: "deployed" },
        { label: "Workflows", value: 12, hint: "running" },
        { label: "Reports generated", value: 246, hint: "this month" },
        { label: "AI hours saved", value: "1,840", hint: "rolling 30-day" },
      ]}
      features={[
        {
          title: "AI Agents",
          description:
            "Specialist agents for admissions, parent comms, grading assistance, lesson planning and more.",
          icon: Bot,
          tone: "violet",
          metric: { label: "Deployed", value: "8" },
        },
        {
          title: "AI Workflows",
          description:
            "Drag-and-drop multi-step automations — e.g. ‘flag at-risk students → notify counsellor’.",
          icon: Workflow,
          tone: "sky",
          metric: { label: "Running", value: "12" },
        },
        {
          title: "AI Reports",
          description:
            "Auto-generated term, monthly and ad-hoc reports — narrative + charts, board-ready.",
          icon: FileBarChart2,
          tone: "emerald",
          metric: { label: "This month", value: "246" },
        },
      ]}
    />
  );
}

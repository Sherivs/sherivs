import { createFileRoute } from "@tanstack/react-router";
import { Baby, LineChart, HeartHandshake, Wallet, MessageSquare } from "lucide-react";
import { IntelligenceCenter } from "@/components/intelligence-center";

export const Route = createFileRoute("/_authenticated/admin/intelligence-parents")({
  ssr: false,
  component: ParentExperienceCenter,
});

function ParentExperienceCenter() {
  return (
    <IntelligenceCenter
      title="Parent Experience Center"
      subtitle="Build trust with every family — visibility, growth and conversation in one hub."
      tagline="Give parents a beautifully curated timeline of their child's journey while you track engagement, sentiment and fee health to keep every family confident and connected."
      stats={[
        { label: "Active parents", value: 412, hint: "last 30 days" },
        { label: "Trust score", value: "4.7", hint: "out of 5" },
        { label: "Fee on-time rate", value: "88%", hint: "this term" },
        { label: "Messages this week", value: 1280, hint: "two-way" },
      ]}
      features={[
        {
          title: "Child Timeline",
          description:
            "Single feed of every milestone — grades, attendance, behaviour, projects and photos.",
          icon: Baby,
          tone: "sky",
          metric: { label: "Events this week", value: "3,420" },
        },
        {
          title: "Growth Analytics",
          description:
            "Term-over-term progress charts across academics, attendance, behaviour and wellbeing.",
          icon: LineChart,
          tone: "violet",
          metric: { label: "+ improvement", value: "+12%" },
        },
        {
          title: "Parent Trust Score",
          description:
            "Sentiment + engagement + survey response → a per-family trust index you can act on.",
          icon: HeartHandshake,
          tone: "emerald",
          metric: { label: "School avg", value: "4.7 / 5" },
        },
        {
          title: "Fee Insights",
          description:
            "Who's likely to pay late, who needs a plan, and where to focus collections this week.",
          icon: Wallet,
          tone: "amber",
          metric: { label: "On-time", value: "88%" },
        },
        {
          title: "Communication Center",
          description:
            "Unified inbox across SMS, WhatsApp, email and push — with auto-translation and AI replies.",
          icon: MessageSquare,
          tone: "slate",
          metric: { label: "Open threads", value: "57" },
        },
      ]}
    />
  );
}

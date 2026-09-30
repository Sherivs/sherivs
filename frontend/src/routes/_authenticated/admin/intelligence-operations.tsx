import { createFileRoute } from "@tanstack/react-router";
import { CalendarCheck, Bus, Building2, AlertTriangle, Activity } from "lucide-react";
import { IntelligenceCenter } from "@/components/intelligence-center";

export const Route = createFileRoute("/_authenticated/admin/intelligence-operations")({
  ssr: false,
  component: OperationsCommandCenter,
});

function OperationsCommandCenter() {
  return (
    <IntelligenceCenter
      title="Operations Command Center"
      subtitle="Run the whole school in one screen — every signal, live."
      tagline="A live operating picture across attendance, transport, facilities and incidents — with proactive alerts whenever anything drifts outside the green zone."
      stats={[
        { label: "Live attendance", value: "94%", hint: "right now" },
        { label: "Buses on route", value: 6, hint: "of 8 active" },
        { label: "Facility issues", value: 4, hint: "open tickets" },
        { label: "Incidents (24h)", value: 2, hint: "all resolved" },
      ]}
      features={[
        {
          title: "Attendance Monitoring",
          description:
            "Live per-class attendance grid with absence reasons and parent auto-notifications.",
          icon: CalendarCheck,
          tone: "emerald",
          metric: { label: "Present now", value: "94%" },
        },
        {
          title: "Transport Monitoring",
          description:
            "Every bus on a live map with route ETAs, geofence alerts and child boarding events.",
          icon: Bus,
          tone: "sky",
          metric: { label: "On route", value: "6 / 8" },
        },
        {
          title: "Facilities Monitoring",
          description:
            "Maintenance tickets, room usage and asset status — from classrooms to labs.",
          icon: Building2,
          tone: "violet",
          metric: { label: "Open", value: "4" },
        },
        {
          title: "Incident Monitoring",
          description:
            "Centralised incident log: bullying, injuries, safeguarding — with response timelines.",
          icon: AlertTriangle,
          tone: "rose",
          metric: { label: "24h", value: "2 resolved" },
        },
        {
          title: "Operational Analytics",
          description:
            "Weekly trends, bottleneck detection and predictive load forecasts across operations.",
          icon: Activity,
          tone: "amber",
          metric: { label: "Health", value: "Green" },
        },
      ]}
    />
  );
}

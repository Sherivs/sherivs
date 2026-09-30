import { createFileRoute } from "@tanstack/react-router";
import { Gauge, Flame, CalendarCheck, GraduationCap, Award } from "lucide-react";
import { IntelligenceCenter } from "@/components/intelligence-center";

export const Route = createFileRoute("/_authenticated/admin/intelligence-teachers")({
  ssr: false,
  component: TeacherIntelligenceCenter,
});

function TeacherIntelligenceCenter() {
  return (
    <IntelligenceCenter
      title="Teacher Intelligence Center"
      subtitle="Measure, support and celebrate every teacher with one unified view."
      tagline="Pulls signals from lesson plans, gradebook activity, attendance, parent feedback and student outcomes to surface burnout risk early and highlight teachers worth recognising."
      stats={[
        { label: "Avg performance", value: "8.4", hint: "out of 10" },
        { label: "Burnout risk", value: 3, hint: "teachers flagged" },
        { label: "Training completion", value: "76%", hint: "this term" },
        { label: "Recognitions issued", value: 14, hint: "last 30 days" },
      ]}
      features={[
        {
          title: "Teacher Performance Score",
          description:
            "Composite score weighing student outcomes, lesson quality, attendance and parent feedback.",
          icon: Gauge,
          tone: "emerald",
          metric: { label: "School avg", value: "8.4 / 10" },
          href: "/admin/teachers",
        },
        {
          title: "Burnout Detection",
          description:
            "Predictive workload + sentiment model flags teachers trending toward burnout — 4 weeks ahead.",
          icon: Flame,
          tone: "rose",
          metric: { label: "High risk", value: "3" },
          href: "/admin/teachers",
        },
        {
          title: "Attendance Trends",
          description:
            "Late arrivals, sick days and substitution patterns across departments and terms.",
          icon: CalendarCheck,
          tone: "sky",
          metric: { label: "Punctuality", value: "97%" },
          href: "/admin/attendance",
        },
        {
          title: "Training Progress",
          description:
            "Track CPD hours, certifications and required compliance training per teacher.",
          icon: GraduationCap,
          tone: "violet",
          metric: { label: "Completed", value: "76%" },
          href: "/admin/lesson-plans",
        },
        {
          title: "Recognition System",
          description: "Spot top performers and queue automated commendations, badges and bonuses.",
          icon: Award,
          tone: "amber",
          metric: { label: "This month", value: "14" },
          href: "/admin/teachers",
        },
      ]}
    />
  );
}

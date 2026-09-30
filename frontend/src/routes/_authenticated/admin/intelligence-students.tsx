import { createFileRoute } from "@tanstack/react-router";
import { Target, CalendarCheck, Brain, Trophy, TrendingDown, ShieldAlert } from "lucide-react";
import { IntelligenceCenter } from "@/components/intelligence-center";

export const Route = createFileRoute("/_authenticated/admin/intelligence-students")({
  ssr: false,
  component: StudentIntelligenceCenter,
});

function StudentIntelligenceCenter() {
  return (
    <IntelligenceCenter
      title="Student Intelligence Center"
      subtitle="Real-time insights on every learner — success, risk, and momentum."
      tagline="Vibeora AI continuously fuses attendance, grades, behaviour, and engagement signals into a single Student Success Score so you can act before warning signs become outcomes."
      stats={[
        { label: "Avg success score", value: "82", hint: "+4 vs last term" },
        { label: "At-risk students", value: 17, hint: "early-warning flags" },
        { label: "Attendance index", value: "94%", hint: "rolling 30-day" },
        { label: "Scholarship candidates", value: 9, hint: "top 5% performers" },
      ]}
      features={[
        {
          title: "Student Success Score",
          description:
            "Composite 0–100 score blending attendance, grades, participation, and behaviour signals.",
          icon: Target,
          tone: "emerald",
          metric: { label: "School avg", value: "82 / 100" },
          href: "/admin/students",
        },
        {
          title: "Attendance Intelligence",
          description:
            "Detect chronic absentees, pattern truancy and class-level attendance dips automatically.",
          icon: CalendarCheck,
          tone: "sky",
          metric: { label: "30-day rate", value: "94%" },
          href: "/admin/attendance",
        },
        {
          title: "Academic Intelligence",
          description:
            "Subject-by-subject mastery, term-over-term trajectory and predicted exam outcomes.",
          icon: Brain,
          tone: "violet",
          metric: { label: "Predicted pass", value: "89%" },
          href: "/admin/grades",
        },
        {
          title: "Scholarship Ranking",
          description:
            "Auto-ranked merit list using academics, attendance and conduct — ready for awards.",
          icon: Trophy,
          tone: "amber",
          metric: { label: "Candidates", value: "9" },
          href: "/admin/report-cards",
        },
        {
          title: "Dropout Prediction",
          description:
            "Forecast which students are likely to drop out next term, with the top contributing signals.",
          icon: TrendingDown,
          tone: "rose",
          metric: { label: "Flagged", value: "5" },
          href: "/admin/students",
        },
        {
          title: "Student Risk Detection",
          description:
            "Unified risk register: academic, behavioural, wellbeing and safeguarding alerts in one place.",
          icon: ShieldAlert,
          tone: "rose",
          metric: { label: "Open alerts", value: "12" },
          href: "/admin/audit-logs",
        },
      ]}
    />
  );
}

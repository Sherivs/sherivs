import { createFileRoute, Link } from "@tanstack/react-router";
import { CheckCircle2, XCircle, ExternalLink } from "lucide-react";
import { useApp } from "@/contexts/app-context";
import { PortalPage } from "@/components/portal-shell";
import {
  getTier,
  getTierFeatures,
  SUBSCRIPTION_TIERS,
  type FeatureKey,
} from "@/lib/subscription-tiers";

export const Route = createFileRoute("/_authenticated/admin/enterprise-checklist")({
  ssr: false,
  component: EnterpriseChecklist,
});

type Item = { key: FeatureKey; label: string; url: string };

const CHECKS: Item[] = [
  { key: "admin_portal", label: "Admin dashboard", url: "/admin/dashboard" },
  { key: "cms_management", label: "Public site CMS", url: "/admin/cms" },
  { key: "news_management", label: "News management", url: "/admin/news" },
  { key: "school_blog", label: "School blog", url: "/admin/cms" },
  { key: "qr_attendance", label: "QR attendance", url: "/admin/attendance" },
  { key: "manual_attendance", label: "Manual attendance", url: "/admin/attendance" },
  { key: "ai_timetable", label: "AI timetable", url: "/admin/timetable" },
  { key: "grade_publishing", label: "Grades", url: "/admin/grades" },
  { key: "report_cards", label: "Report cards", url: "/admin/report-cards" },
  { key: "lesson_plans", label: "Lesson plans", url: "/admin/lesson-plans" },
  { key: "fee_management", label: "Fees", url: "/admin/fees" },
  { key: "expense_tracking", label: "Expenses", url: "/admin/expenses" },
  { key: "transport_basic", label: "Bus management", url: "/admin/bus-management" },
  { key: "bus_live_tracking", label: "Live bus tracking", url: "/admin/buses" },
  { key: "vibeora_intelligence", label: "CoreGrid Intelligence", url: "/admin/intelligence" },
  {
    key: "teacher_performance_ai",
    label: "Teacher Intelligence",
    url: "/admin/intelligence-teachers",
  },
  { key: "student_at_risk", label: "Student Intelligence", url: "/admin/intelligence-students" },
  {
    key: "parent_engagement_score",
    label: "Parent Experience",
    url: "/admin/intelligence-parents",
  },
  { key: "school_health_certificate", label: "Health certificate", url: "/admin/health" },
  { key: "digital_twin", label: "Digital Twin", url: "/admin/digital-twin" },
  { key: "advanced_analytics", label: "Advanced analytics", url: "/admin/analytics" },
  { key: "audit_logs", label: "Audit logs", url: "/admin/audit-logs" },
  { key: "api_access", label: "API keys", url: "/admin/api-keys" },
  { key: "alumni_portal", label: "Alumni portal", url: "/admin/settings" },
];

function EnterpriseChecklist() {
  const { school } = useApp();
  const tier = getTier(school?.subscription_tier as string | null);
  const tierFeatures = getTierFeatures(tier);
  const active = (school?.active_features as Record<string, unknown> | null) ?? {};

  const isOn = (k: FeatureKey) => (k in active ? active[k] === true : tierFeatures[k] === true);

  const totalOn = CHECKS.filter((c) => isOn(c.key)).length;

  return (
    <PortalPage
      title="Enterprise checklist"
      subtitle={`Plan: ${SUBSCRIPTION_TIERS[tier].name} — ${totalOn}/${CHECKS.length} modules unlocked`}
    >
      <div className="uos-card divide-y divide-border">
        {CHECKS.map((c) => {
          const on = isOn(c.key);
          return (
            <div key={c.key} className="flex items-center justify-between gap-4 p-4">
              <div className="flex items-center gap-3 min-w-0">
                {on ? (
                  <CheckCircle2 className="size-5 shrink-0 text-emerald-500" />
                ) : (
                  <XCircle className="size-5 shrink-0 text-muted-foreground/60" />
                )}
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium">{c.label}</div>
                  <div className="truncate text-xs text-muted-foreground">{c.url}</div>
                </div>
              </div>
              {on ? (
                <Link
                  to={c.url}
                  className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-3 py-1.5 text-xs font-semibold text-primary hover:bg-primary/20"
                >
                  Open <ExternalLink className="size-3" />
                </Link>
              ) : (
                <span className="text-xs uppercase tracking-wide text-muted-foreground">
                  Locked
                </span>
              )}
            </div>
          );
        })}
      </div>
    </PortalPage>
  );
}

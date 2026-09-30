import { Fragment } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { PortalPage, SectionGrid, StatCard } from "@/components/portal-shell";
import { SUBSCRIPTION_TIERS, ALL_TIERS, type FeatureKey } from "@/lib/subscription-tiers";

export const Route = createFileRoute("/_authenticated/super-admin/tiers")({
  ssr: false,
  component: TiersPage,
});

const ROW_GROUPS: { title: string; rows: { key: FeatureKey; label: string }[] }[] = [
  {
    title: "Portals",
    rows: [
      { key: "admin_portal", label: "Admin" },
      { key: "teacher_portal", label: "Teacher" },
      { key: "parent_portal", label: "Parent" },
      { key: "student_portal", label: "Student" },
      { key: "bursar_portal", label: "Bursar" },
      { key: "hq_portal", label: "HQ" },
      { key: "alumni_portal", label: "Alumni" },
    ],
  },
  {
    title: "Attendance",
    rows: [
      { key: "qr_attendance", label: "QR attendance" },
      { key: "face_biometrics", label: "Face biometrics" },
      { key: "geofence", label: "Geofence" },
      { key: "offline_attendance", label: "Offline attendance" },
    ],
  },
  {
    title: "Payments",
    rows: [
      { key: "paystack_payments", label: "Paystack" },
      { key: "flutterwave_payments", label: "Flutterwave" },
      { key: "stripe_payments", label: "Stripe" },
    ],
  },
  {
    title: "Intelligence",
    rows: [
      { key: "ai_timetable", label: "AI timetable" },
      { key: "teacher_performance_ai", label: "Teacher performance AI" },
      { key: "burnout_prediction", label: "Burnout prediction" },
      { key: "student_at_risk", label: "Student at-risk" },
      { key: "advanced_analytics", label: "Advanced analytics" },
    ],
  },
  {
    title: "Enterprise",
    rows: [
      { key: "api_access", label: "API access" },
      { key: "white_label", label: "White label" },
      { key: "custom_domain", label: "Custom domain" },
      { key: "multi_branch", label: "Multi-branch" },
      { key: "remove_branding", label: "Remove branding" },
    ],
  },
];

function TiersPage() {
  return (
    <PortalPage
      title="Subscription tiers"
      subtitle="Feature matrix that governs what each plan can enable."
    >
      <SectionGrid>
        {ALL_TIERS.map((t) => {
          const meta = SUBSCRIPTION_TIERS[t];
          const price =
            meta.price_monthly === 0
              ? t === "trial"
                ? "Free 30d"
                : "Custom"
              : `₦${meta.price_monthly.toLocaleString()}/mo`;
          return <StatCard key={t} label={meta.name} value={price} />;
        })}
      </SectionGrid>

      <div className="mt-8 uos-card overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
              <th className="p-3 text-left">Feature</th>
              {ALL_TIERS.map((t) => (
                <th key={t} className="p-3 text-center">
                  {SUBSCRIPTION_TIERS[t].name}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-border/60 bg-muted/10">
              <td className="p-3 font-semibold">Limits</td>
              {ALL_TIERS.map((t) => {
                const m = SUBSCRIPTION_TIERS[t];
                return (
                  <td key={t} className="p-3 text-center text-xs">
                    <div>{m.max_students === -1 ? "∞" : m.max_students} students</div>
                    <div className="text-muted-foreground">
                      {m.storage_gb === -1 ? "∞" : `${m.storage_gb}GB`}
                    </div>
                  </td>
                );
              })}
            </tr>
            {ROW_GROUPS.map((group) => (
              <Fragment key={group.title}>
                <tr key={`${group.title}-h`} className="bg-muted/10">
                  <td
                    colSpan={ALL_TIERS.length + 1}
                    className="p-2 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
                  >
                    {group.title}
                  </td>
                </tr>
                {group.rows.map((row) => (
                  <tr key={row.key} className="border-b border-border/40">
                    <td className="p-3">{row.label}</td>
                    {ALL_TIERS.map((t) => {
                      const has =
                        (SUBSCRIPTION_TIERS[t].features as Record<string, boolean>)[row.key] ===
                        true;
                      return (
                        <td key={t} className="p-3 text-center">
                          {has ? (
                            <span className="text-emerald-500">●</span>
                          ) : (
                            <span className="text-muted-foreground/40">—</span>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>
    </PortalPage>
  );
}

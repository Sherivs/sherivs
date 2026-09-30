import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PortalPage, StatCard, SectionGrid } from "@/components/portal-shell";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  SUBSCRIPTION_TIERS,
  getTier,
  getTierFeatures,
  hasTierFeature,
  type FeatureKey,
  type TierFeatures,
} from "@/lib/subscription-tiers";

export const Route = createFileRoute("/_authenticated/admin/features")({
  ssr: false,
  component: FeaturesDashboard,
});

const FEATURE_GROUPS: { title: string; features: { key: FeatureKey; label: string }[] }[] = [
  {
    title: "Portals",
    features: [
      { key: "admin_portal", label: "Admin portal" },
      { key: "teacher_portal", label: "Teacher portal" },
      { key: "parent_portal", label: "Parent portal" },
      { key: "student_portal", label: "Student portal" },
      { key: "bursar_portal", label: "Bursar portal" },
      { key: "hq_portal", label: "HQ portal" },
      { key: "alumni_portal", label: "Alumni portal" },
    ],
  },
  {
    title: "Attendance & identity",
    features: [
      { key: "manual_attendance", label: "Manual attendance" },
      { key: "qr_attendance", label: "QR attendance" },
      { key: "face_biometrics", label: "Face biometrics" },
      { key: "geofence", label: "Geofence check-in" },
      { key: "offline_attendance", label: "Offline attendance" },
    ],
  },
  {
    title: "Academics",
    features: [
      { key: "grade_publishing", label: "Grade publishing" },
      { key: "report_cards", label: "Report cards" },
      { key: "lesson_plans", label: "Lesson plans" },
      { key: "ai_timetable", label: "AI timetable" },
    ],
  },
  {
    title: "Finance",
    features: [
      { key: "fee_management", label: "Fee management" },
      { key: "paystack_payments", label: "Paystack" },
      { key: "flutterwave_payments", label: "Flutterwave" },
      { key: "stripe_payments", label: "Stripe" },
    ],
  },
  {
    title: "Communication",
    features: [
      { key: "email_notifications", label: "Email notifications" },
      { key: "sms_notifications", label: "SMS notifications" },
      { key: "whatsapp_notifications", label: "WhatsApp notifications" },
      { key: "push_notifications", label: "Push notifications" },
    ],
  },
  {
    title: "Content & site",
    features: [
      { key: "school_website", label: "Public school site" },
      { key: "cms_management", label: "CMS management" },
      { key: "news_management", label: "News management" },
      { key: "school_blog", label: "School blog" },
    ],
  },
  {
    title: "Intelligence",
    features: [
      { key: "teacher_performance_ai", label: "Teacher performance AI" },
      { key: "burnout_prediction", label: "Burnout prediction" },
      { key: "student_at_risk", label: "Student at-risk alerts" },
      { key: "parent_engagement_score", label: "Parent engagement score" },
      { key: "school_health_certificate", label: "School health certificate" },
      { key: "advanced_analytics", label: "Advanced analytics" },
      { key: "exportable_reports", label: "Exportable reports" },
    ],
  },
  {
    title: "Platform",
    features: [
      { key: "audit_logs", label: "Audit logs" },
      { key: "bulk_import", label: "Bulk import" },
      { key: "api_access", label: "API access" },
      { key: "white_label", label: "White label" },
      { key: "custom_domain", label: "Custom domain" },
      { key: "remove_branding", label: "Remove branding" },
      { key: "priority_support", label: "Priority support" },
    ],
  },
];

function FeaturesDashboard() {
  const { school, refresh, role } = useApp();
  const tier = getTier(school?.subscription_tier as string | null);
  const tierMeta = SUBSCRIPTION_TIERS[tier];
  const tierFeatures = getTierFeatures(tier);

  const [overrides, setOverrides] = useState<Partial<Record<FeatureKey, boolean>>>({});
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  useEffect(() => {
    const active = (school?.active_features as Record<string, unknown> | null) ?? {};
    const next: Partial<Record<FeatureKey, boolean>> = {};
    (Object.keys(tierFeatures) as FeatureKey[]).forEach((k) => {
      next[k] = k in active ? active[k] === true : tierFeatures[k] === true;
    });
    setOverrides(next);
    setDirty(false);
  }, [school?.id, school?.active_features, tier]); // eslint-disable-line react-hooks/exhaustive-deps

  const allowed = Object.keys(tierFeatures).filter(
    (k) => tierFeatures[k as FeatureKey] === true,
  ).length;
  const enabled = Object.values(overrides).filter((v) => v === true).length;

  function toggle(key: FeatureKey, v: boolean) {
    if (role !== "super_admin" && !hasTierFeature(tier, key)) return;
    setOverrides((s) => ({ ...s, [key]: v }));
    setDirty(true);
  }

  async function save() {
    if (!school?.id) return;
    setSaving(true);
    const payload = Object.fromEntries(
      Object.entries(overrides).filter(
        ([k]) => role === "super_admin" || hasTierFeature(tier, k as FeatureKey),
      ),
    );
    const { error } = await supabase
      .from("schools")
      .update({ active_features: payload })
      .eq("id", school.id);
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("Feature settings saved");
    setDirty(false);
    await refresh();
  }

  if (!school) {
    return (
      <PortalPage title="Features">
        <div className="uos-empty p-8 text-center text-sm text-muted-foreground">
          No school in scope.
        </div>
      </PortalPage>
    );
  }

  return (
    <PortalPage
      title="Features"
      subtitle={`Toggle what's active for ${school.name}. Your plan: ${tierMeta.name}.`}
    >
      <SectionGrid>
        <StatCard label="Current plan" value={tierMeta.name} />
        <StatCard label="Features allowed by plan" value={allowed} />
        <StatCard label="Currently enabled" value={enabled} />
        <StatCard
          label="Max students"
          value={tierMeta.max_students === -1 ? "∞" : tierMeta.max_students}
        />
      </SectionGrid>

      <div className="mt-6 flex items-center justify-end gap-3">
        {dirty && <span className="text-xs text-muted-foreground">Unsaved changes</span>}
        <Button onClick={save} disabled={!dirty || saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {FEATURE_GROUPS.map((group) => (
          <section key={group.title} className="uos-card p-5">
            <h3 className="font-display text-base font-semibold">{group.title}</h3>
            <div className="mt-4 space-y-2">
              {group.features.map(({ key, label }) => {
                const allowedByPlan = (tierFeatures as TierFeatures)[key] === true;
                const checked = overrides[key] === true;
                return (
                  <label
                    key={key}
                    className={`flex items-center justify-between gap-4 rounded-md border border-border bg-background/40 px-3 py-2 ${
                      allowedByPlan ? "" : "opacity-60"
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="text-sm font-medium truncate">{label}</div>
                      {!allowedByPlan && (
                        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                          Upgrade required
                        </div>
                      )}
                    </div>
                    <Switch
                      checked={checked}
                      disabled={!allowedByPlan || saving}
                      onCheckedChange={(v) => toggle(key, Boolean(v))}
                    />
                  </label>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    </PortalPage>
  );
}

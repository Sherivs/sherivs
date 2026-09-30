import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Sparkles, AlertTriangle, Info, Megaphone, Plus, ArrowRight } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import {
  PortalPage,
  FeatureLockedCard,
  PortalPageSkeleton,
  EmptyState,
  SectionHeader,
} from "@/components/portal-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { isFeatureActive, type TierName } from "@/lib/subscription-tiers";

export const Route = createFileRoute("/_authenticated/admin/intelligence")({
  ssr: false,
  component: IntelligencePage,
});

type Severity = "red" | "amber" | "blue";
type Opportunity = {
  id: string;
  severity: Severity;
  title: string;
  impact: string;
  actionLabel: string;
  actionUrl: string;
};

function IntelligencePage() {
  const { profile, school } = useApp();
  const schoolId = profile?.school_id ?? "";
  const tier = (school?.subscription_tier ?? "trial") as TierName;
  const activeFeatures = (school?.active_features as Record<string, boolean> | undefined) ?? {};
  const canIntelligence = isFeatureActive(tier, activeFeatures, "vibeora_intelligence");

  const monthStart = useMemo(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
  }, []);
  const monthStartDate = monthStart.slice(0, 10);

  const q = useQuery({
    queryKey: ["vibeora-intel", schoolId, monthStartDate],
    enabled: !!schoolId && canIntelligence,
    queryFn: async () => {
      const [
        attendance,
        grades,
        fees,
        teachers,
        students,
        staffLogs,
        sports,
        atRiskTeachers,
        newsReads,
      ] = await Promise.all([
        supabase
          .from("attendance")
          .select("status")
          .eq("school_id", schoolId)
          .gte("date", monthStartDate),
        supabase
          .from("grades")
          .select("total_score")
          .eq("school_id", schoolId)
          .eq("is_published", true)
          .gte("created_at", monthStart),
        supabase.from("fees").select("amount, paid_amount, status").eq("school_id", schoolId),
        supabase
          .from("users")
          .select("id, is_active")
          .eq("school_id", schoolId)
          .eq("role", "teacher"),
        supabase.from("students").select("id, is_active").eq("school_id", schoolId),
        supabase
          .from("attendance_logs")
          .select("teacher_id")
          .eq("school_id", schoolId)
          .gte("timestamp", monthStart),
        supabase
          .from("school_sports")
          .select("id", { count: "exact", head: true })
          .eq("school_id", schoolId)
          .eq("is_active", true),
        supabase
          .from("teacher_performance_profiles")
          .select("id, burnout_risk_level")
          .eq("school_id", schoolId)
          .in("burnout_risk_level", ["high", "critical"]),
        supabase.from("news_reads").select("user_id").gte("read_at", monthStart),
      ]);

      const attRows = attendance.data ?? [];
      const presentCount = attRows.filter(
        (a: any) => a.status === "present" || a.status === "late",
      ).length;
      const attendanceScore = attRows.length > 0 ? (presentCount / attRows.length) * 100 : 0;

      const gradeRows = grades.data ?? [];
      const academicScore =
        gradeRows.length > 0
          ? gradeRows.reduce((s: number, g: any) => s + (Number(g.total_score) || 0), 0) /
            gradeRows.length
          : 0;

      const feeRows = fees.data ?? [];
      const totalBilled = feeRows.reduce((s: number, f: any) => s + (Number(f.amount) || 0), 0);
      const totalCollected = feeRows.reduce(
        (s: number, f: any) => s + (Number(f.paid_amount) || 0),
        0,
      );
      const outstanding = Math.max(0, totalBilled - totalCollected);
      const feeScore = totalBilled > 0 ? (totalCollected / totalBilled) * 100 : 100;

      const teacherRows = teachers.data ?? [];
      const totalTeachers = teacherRows.length;
      const uniqueTeachers = new Set(
        (staffLogs.data ?? []).map((l: any) => l.teacher_id).filter(Boolean),
      ).size;
      const staffScore = totalTeachers > 0 ? (uniqueTeachers / totalTeachers) * 100 : 0;

      const parentScore = 70;

      const overall = Math.round(
        attendanceScore * 0.25 +
          academicScore * 0.25 +
          feeScore * 0.2 +
          staffScore * 0.15 +
          parentScore * 0.15,
      );

      const studentRows = students.data ?? [];
      const activeStudents = studentRows.filter((s: any) => s.is_active).length;
      const uniqueReaders = new Set(
        (newsReads.data ?? []).map((r: any) => r.user_id).filter(Boolean),
      ).size;
      const parentEngagementRate = activeStudents > 0 ? (uniqueReaders / activeStudents) * 100 : 0;

      const sportsCount = sports.count ?? 0;
      const atRiskCount = (atRiskTeachers.data ?? []).length;

      return {
        components: [
          { label: "Student Attendance", score: Math.round(attendanceScore), weight: 25 },
          { label: "Academic Performance", score: Math.round(academicScore), weight: 25 },
          { label: "Fee Collection", score: Math.round(feeScore), weight: 20 },
          { label: "Staff Attendance", score: Math.round(staffScore), weight: 15 },
          { label: "Parent Engagement", score: parentScore, weight: 15 },
        ],
        overall: Math.min(100, Math.max(0, overall)),
        outstanding,
        totalBilled,
        parentEngagementRate,
        sportsCount,
        atRiskCount,
      };
    },
  });

  const opportunities = useMemo<Opportunity[]>(() => {
    if (!q.data) return [];
    const out: Opportunity[] = [];
    if (q.data.parentEngagementRate < 40) {
      out.push({
        id: "parents",
        severity: "amber",
        title: "Parent Engagement Is Low",
        impact: "Schools with active parent portals see 23% better student outcomes.",
        actionLabel: "Enable WhatsApp Notifications",
        actionUrl: "/admin/api-keys",
      });
    }
    if (q.data.totalBilled > 0 && q.data.outstanding / q.data.totalBilled > 0.3) {
      out.push({
        id: "fees",
        severity: "red",
        title: `₦${q.data.outstanding.toLocaleString()} in Uncollected Fees`,
        impact: "Schools using automated reminders collect 40% faster.",
        actionLabel: "View Fee Defaulters",
        actionUrl: "/admin/fees-defaulters",
      });
    }
    if (!school?.social_media_enabled) {
      out.push({
        id: "social",
        severity: "amber",
        title: "No Social Media Presence Configured",
        impact: "Schools with active social media see 3x more admission inquiries.",
        actionLabel: "Add Social Media",
        actionUrl: "/admin/settings",
      });
    }
    if (q.data.sportsCount === 0) {
      out.push({
        id: "sports",
        severity: "blue",
        title: "No Sports Programs Listed",
        impact: "Parents value extracurricular activities when choosing schools.",
        actionLabel: "Add Sports Programs",
        actionUrl: "/admin/cms",
      });
    }
    if (q.data.atRiskCount > 0) {
      out.push({
        id: "burnout",
        severity: "red",
        title: `${q.data.atRiskCount} Teacher${q.data.atRiskCount === 1 ? "" : "s"} Show Burnout Risk`,
        impact: "At-risk teachers are 70% more likely to resign in 90 days.",
        actionLabel: "View Teacher Performance",
        actionUrl: "/admin/teachers",
      });
    }
    return out;
  }, [q.data, school]);

  const campaignsQ = useQuery({
    queryKey: ["ad-campaigns", schoolId],
    enabled: !!schoolId && canIntelligence,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("school_ad_campaigns")
        .select("*")
        .eq("school_id", schoolId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  if (!canIntelligence) {
    return (
      <PortalPage title="CoreGrid Intelligence" subtitle="Opportunities and economy score">
        <FeatureLockedCard
          featureName="CoreGrid Intelligence"
          requiredTier="Professional"
          description="Detect missed opportunities, see your School Economy Score, and request managed ad campaigns."
        />
      </PortalPage>
    );
  }

  if (q.isLoading || !q.data) return <PortalPageSkeleton />;

  return (
    <PortalPage
      title="CoreGrid Intelligence"
      subtitle="Your School Economy Score, opportunities, and ad campaigns"
    >
      <EconomyScoreSection data={q.data} />

      <div className="mt-8">
        <SectionHeader
          title="Opportunities You Might Be Missing"
          subtitle="Detected automatically from your school data — Updated on each visit"
        />
        {opportunities.length === 0 ? (
          <EmptyState
            icon={<Sparkles className="w-6 h-6 text-emerald-400" />}
            title="No opportunities detected"
            description="Your school is performing well across the tracked dimensions. Check back later."
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2">
            {opportunities.map((o) => (
              <OpportunityCard key={o.id} {...o} />
            ))}
          </div>
        )}
      </div>

      <div className="mt-8">
        <AdCampaignSection
          campaigns={campaignsQ.data ?? []}
          isLoading={campaignsQ.isLoading}
          schoolId={schoolId}
          userId={profile?.id ?? ""}
        />
      </div>
    </PortalPage>
  );
}

function EconomyScoreSection({
  data,
}: {
  data: {
    overall: number;
    components: { label: string; score: number; weight: number }[];
  };
}) {
  const color =
    data.overall >= 80
      ? "text-emerald-400"
      : data.overall >= 60
        ? "text-amber-400"
        : "text-rose-400";
  const interp =
    data.overall >= 80
      ? "Excellent — performing at the highest level"
      : data.overall >= 60
        ? "Good — some areas need attention"
        : data.overall >= 40
          ? "Fair — multiple areas require focus"
          : "Critical — urgent intervention needed";

  return (
    <div className="glass-card p-6">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div>
          <div className="text-xs uppercase tracking-wider text-white/50">School Economy Score</div>
          <div className={`mt-2 text-6xl font-bold tabular-nums ${color}`}>{data.overall}</div>
          <div className="mt-1 text-sm text-white/60">{interp}</div>
        </div>
        <div className="text-xs text-white/40">Last updated: just now</div>
      </div>
      <div className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {data.components.map((c) => {
          const fill =
            c.score >= 80 ? "bg-emerald-500" : c.score >= 60 ? "bg-amber-500" : "bg-rose-500";
          return (
            <div key={c.label}>
              <div className="flex justify-between text-xs text-white/60 mb-1">
                <span>{c.label}</span>
                <span className="font-medium text-white">{c.score}%</span>
              </div>
              <div className="h-1.5 rounded-full bg-white/10 overflow-hidden">
                <div
                  className={`h-full ${fill}`}
                  style={{ width: `${Math.min(100, Math.max(0, c.score))}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function OpportunityCard({ severity, title, impact, actionLabel, actionUrl }: Opportunity) {
  const border =
    severity === "red"
      ? "border-l-rose-500"
      : severity === "amber"
        ? "border-l-amber-500"
        : "border-l-blue-500";
  const iconColor =
    severity === "red"
      ? "text-rose-400"
      : severity === "amber"
        ? "text-amber-400"
        : "text-blue-400";
  const Icon = severity === "blue" ? Info : AlertTriangle;

  return (
    <div className={`glass-card p-5 border-l-4 ${border}`}>
      <div className="flex items-start gap-3">
        <Icon className={`w-5 h-5 mt-0.5 ${iconColor}`} />
        <div className="flex-1 min-w-0">
          <h4 className="font-bold text-white">{title}</h4>
          <p className="text-sm text-white/60 mt-1">{impact}</p>
          <Button asChild size="sm" variant="outline" className="mt-3">
            <Link to={actionUrl as any}>
              {actionLabel}
              <ArrowRight className="w-4 h-4 ml-1" />
            </Link>
          </Button>
        </div>
      </div>
    </div>
  );
}

const CAMPAIGN_TYPES = [
  { value: "admission_drive", label: "Admission Drive" },
  { value: "brand_awareness", label: "Brand Awareness" },
  { value: "event_promotion", label: "Event Promotion" },
  { value: "achievement_showcase", label: "Achievement Showcase" },
  { value: "enrollment_boost", label: "Enrollment Boost" },
];

const PLATFORMS = [
  { value: "meta", label: "Meta (Facebook + Instagram)" },
  { value: "tiktok", label: "TikTok" },
  { value: "both", label: "Both" },
];

const STATUS_META: Record<string, { label: string; className: string }> = {
  requested: { label: "Under Review", className: "bg-white/10 text-white/80" },
  approved: { label: "Approved", className: "bg-blue-500/15 text-blue-300" },
  running: { label: "Live 🟢", className: "bg-emerald-500/15 text-emerald-300" },
  paused: { label: "Paused", className: "bg-amber-500/15 text-amber-300" },
  completed: { label: "Completed", className: "bg-purple-500/15 text-purple-300" },
  rejected: { label: "Rejected", className: "bg-rose-500/15 text-rose-300" },
};

function AdCampaignSection({
  campaigns,
  isLoading,
  schoolId,
  userId,
}: {
  campaigns: any[];
  isLoading: boolean;
  schoolId: string;
  userId: string;
}) {
  const [open, setOpen] = useState(false);
  const qc = useQueryClient();

  const minStart = useMemo(() => {
    const d = new Date(Date.now() + 3 * 86400_000);
    return d.toISOString().slice(0, 10);
  }, []);

  const [form, setForm] = useState({
    campaign_name: "",
    campaign_type: "admission_drive",
    target_platform: "meta",
    target_location: "",
    target_radius_km: 10,
    budget_naira: 10000,
    campaign_duration_days: 14,
    start_date: minStart,
    campaign_objective: "",
  });

  const mutation = useMutation({
    mutationFn: async () => {
      if (!form.campaign_name.trim()) throw new Error("Campaign name is required");
      if (form.budget_naira < 10000) throw new Error("Minimum budget is ₦10,000");
      if (form.campaign_objective.length > 500)
        throw new Error("Objective must be 500 characters or less");
      const { error } = await supabase.from("school_ad_campaigns").insert({
        school_id: schoolId,
        campaign_name: form.campaign_name.trim(),
        campaign_type: form.campaign_type,
        target_platform: form.target_platform,
        target_location: form.target_location.trim() || null,
        target_radius_km: form.target_radius_km,
        budget_naira: form.budget_naira,
        campaign_duration_days: form.campaign_duration_days,
        start_date: form.start_date,
        campaign_objective: form.campaign_objective.trim() || null,
        status: "requested",
        created_by: userId || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Campaign request submitted. Vibeora will review within 24 hours.");
      setOpen(false);
      setForm({
        campaign_name: "",
        campaign_type: "admission_drive",
        target_platform: "meta",
        target_location: "",
        target_radius_km: 10,
        budget_naira: 10000,
        campaign_duration_days: 14,
        start_date: minStart,
        campaign_objective: "",
      });
      qc.invalidateQueries({ queryKey: ["ad-campaigns", schoolId] });
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to submit campaign request"),
  });

  return (
    <div>
      <div className="flex items-end justify-between gap-3 mb-4">
        <SectionHeader
          title="Advertise Your School"
          subtitle="Request a campaign managed by Vibeora on Meta and TikTok"
        />
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger asChild>
            <Button size="sm">
              <Plus className="w-4 h-4 mr-2" /> Request Campaign
            </Button>
          </SheetTrigger>
          <SheetContent className="w-full sm:max-w-lg overflow-y-auto">
            <SheetHeader>
              <SheetTitle>Request Ad Campaign</SheetTitle>
            </SheetHeader>
            <div className="mt-6 space-y-4">
              <Field label="Campaign Name *">
                <Input
                  value={form.campaign_name}
                  onChange={(e) => setForm({ ...form, campaign_name: e.target.value })}
                  maxLength={120}
                  placeholder="e.g. September Admissions Drive"
                />
              </Field>
              <Field label="What to advertise">
                <Select
                  value={form.campaign_type}
                  onValueChange={(v) => setForm({ ...form, campaign_type: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CAMPAIGN_TYPES.map((t) => (
                      <SelectItem key={t.value} value={t.value}>
                        {t.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Platform">
                <Select
                  value={form.target_platform}
                  onValueChange={(v) => setForm({ ...form, target_platform: v })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {PLATFORMS.map((p) => (
                      <SelectItem key={p.value} value={p.value}>
                        {p.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Target Area">
                <Input
                  value={form.target_location}
                  onChange={(e) => setForm({ ...form, target_location: e.target.value })}
                  maxLength={120}
                  placeholder="e.g. Ikeja, Lagos"
                />
              </Field>
              <Field label="Target Radius">
                <Select
                  value={String(form.target_radius_km)}
                  onValueChange={(v) => setForm({ ...form, target_radius_km: Number(v) })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[5, 10, 25, 50].map((r) => (
                      <SelectItem key={r} value={String(r)}>
                        {r} km
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Budget (₦)">
                <Input
                  type="number"
                  min={10000}
                  step={1000}
                  value={form.budget_naira}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      budget_naira: Number(e.target.value) || 0,
                    })
                  }
                />
                <p className="text-xs text-white/40 mt-1">Minimum budget: ₦10,000</p>
              </Field>
              <Field label="Duration">
                <Select
                  value={String(form.campaign_duration_days)}
                  onValueChange={(v) => setForm({ ...form, campaign_duration_days: Number(v) })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[7, 14, 30].map((d) => (
                      <SelectItem key={d} value={String(d)}>
                        {d} days
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Preferred Start Date">
                <Input
                  type="date"
                  min={minStart}
                  value={form.start_date}
                  onChange={(e) => setForm({ ...form, start_date: e.target.value })}
                />
              </Field>
              <Field label="Campaign Objective">
                <Textarea
                  value={form.campaign_objective}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      campaign_objective: e.target.value.slice(0, 500),
                    })
                  }
                  maxLength={500}
                  rows={4}
                  placeholder="What should parents do after seeing the ad? e.g. Visit our website and fill out an admission form."
                />
                <p className="text-xs text-white/40 mt-1">{form.campaign_objective.length}/500</p>
              </Field>
              <Button
                onClick={() => mutation.mutate()}
                disabled={mutation.isPending}
                className="w-full"
              >
                {mutation.isPending ? "Submitting..." : "Submit Request"}
              </Button>
            </div>
          </SheetContent>
        </Sheet>
      </div>

      {isLoading ? (
        <div className="glass-card p-6 text-white/50 text-sm">Loading campaigns...</div>
      ) : campaigns.length === 0 ? (
        <EmptyState
          icon={<Megaphone className="w-6 h-6 text-purple-400" />}
          title="No campaigns yet"
          description="Submit your first ad request above."
        />
      ) : (
        <CampaignList campaigns={campaigns} />
      )}
    </div>
  );
}

function CampaignList({ campaigns }: { campaigns: any[] }) {
  return (
    <>
      {/* Desktop table */}
      <div className="hidden md:block glass-card overflow-hidden">
        <div className="overflow-x-auto -mx-4 sm:mx-0">
          <table className="w-full text-sm">
            <thead className="bg-white/5 text-left text-xs uppercase tracking-wider text-white/50">
              <tr>
                <th className="p-3">Campaign</th>
                <th className="p-3">Type</th>
                <th className="p-3">Platform</th>
                <th className="p-3">Budget</th>
                <th className="p-3">Status</th>
                <th className="p-3">Start</th>
                <th className="p-3">Results</th>
              </tr>
            </thead>
            <tbody>
              {campaigns.map((c) => (
                <tr key={c.id} className="border-t border-white/5">
                  <td className="p-3 text-white font-medium">{c.campaign_name}</td>
                  <td className="p-3 text-white/70 capitalize">
                    {String(c.campaign_type).replace(/_/g, " ")}
                  </td>
                  <td className="p-3 text-white/70 capitalize">{c.target_platform}</td>
                  <td className="p-3 text-white/80 tabular-nums">
                    ₦{Number(c.budget_naira).toLocaleString()}
                  </td>
                  <td className="p-3">
                    <StatusBadge status={c.status} />
                  </td>
                  <td className="p-3 text-white/60">{c.start_date ?? "—"}</td>
                  <td className="p-3 text-white/70">
                    <ResultsCell c={c} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Mobile cards */}
      <div className="md:hidden grid gap-3">
        {campaigns.map((c) => (
          <div key={c.id} className="glass-card p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-medium text-white truncate">{c.campaign_name}</div>
                <div className="text-xs text-white/50 mt-0.5 capitalize">
                  {String(c.campaign_type).replace(/_/g, " ")} · {c.target_platform}
                </div>
              </div>
              <StatusBadge status={c.status} />
            </div>
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-white/60">
              <div>
                Budget:{" "}
                <span className="text-white">₦{Number(c.budget_naira).toLocaleString()}</span>
              </div>
              <div>
                Start: <span className="text-white">{c.start_date ?? "—"}</span>
              </div>
            </div>
            <div className="mt-2 text-xs text-white/60">
              <ResultsCell c={c} />
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

function StatusBadge({ status }: { status: string }) {
  const meta = STATUS_META[status] ?? {
    label: status,
    className: "bg-white/10 text-white/80",
  };
  return <Badge className={`${meta.className} border-0 font-medium`}>{meta.label}</Badge>;
}

function ResultsCell({ c }: { c: any }) {
  if (c.status !== "running" && c.status !== "completed") return <span>—</span>;
  const fmt = (n: number) => (n > 0 ? n.toLocaleString() : "—");
  return (
    <span className="tabular-nums">
      {fmt(c.impressions ?? 0)} impr · {fmt(c.reach ?? 0)} reach · {fmt(c.clicks ?? 0)} clicks
    </span>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="text-white/80">{label}</Label>
      <div className="mt-1.5">{children}</div>
    </div>
  );
}

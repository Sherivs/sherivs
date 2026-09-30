import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Flame,
  MoreVertical,
  Search,
  Users,
} from "lucide-react";

import { useDebounce } from "@/hooks/use-debounce";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PortalPage } from "@/components/portal-shell";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_authenticated/admin/teacher-intelligence")({
  ssr: false,
  component: TeacherIntelligencePage,
});

type TeacherRow = { id: string; full_name: string; subject_specialty: string | null };
type AttLog = { teacher_id: string; timestamp: string | null; type: string };
type Plan = { teacher_id: string; status: string | null; created_at: string | null };
type Grade = { teacher_id: string | null; total_score: number | null; created_at: string | null };
type Slot = { teacher_id: string | null; subject: string; day_of_week: string };

type Enriched = {
  id: string;
  name: string;
  subjects: string;
  classesAssigned: number;
  attendanceRate: number; // 0-1
  submissionRate: number; // 0-1
  engagementRate: number; // 0-1
  health: number; // 0-100
  burnout: number; // 0-100
  burnoutReasons: string[];
  avgStudentGrade: number | null;
  weeklyAttendance: { present: boolean }[][]; // 4 weeks × 5 days
};

type SortKey =
  "name" | "attendanceRate" | "submissionRate" | "health" | "burnout" | "classesAssigned";

const HEALTH_LEVELS = [
  {
    key: "excellent",
    label: "Excellent",
    min: 80,
    max: 100,
    color: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
  },
  {
    key: "good",
    label: "Good",
    min: 60,
    max: 79,
    color: "bg-teal-500/15 text-teal-600 border-teal-500/30",
  },
  {
    key: "support",
    label: "Needs Support",
    min: 40,
    max: 59,
    color: "bg-amber-500/15 text-amber-600 border-amber-500/30",
  },
  {
    key: "at-risk",
    label: "At Risk",
    min: 0,
    max: 39,
    color: "bg-red-500/15 text-red-600 border-red-500/30",
  },
] as const;

function healthLevel(score: number) {
  return HEALTH_LEVELS.find((l) => score >= l.min && score <= l.max) ?? HEALTH_LEVELS[3];
}

function burnoutLevel(score: number) {
  if (score >= 51)
    return { label: "High Risk", color: "bg-red-500/15 text-red-600 border-red-500/30" };
  if (score >= 21)
    return { label: "Early Signs", color: "bg-amber-500/15 text-amber-600 border-amber-500/30" };
  return { label: "None", color: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30" };
}

function daysAgo(d: number) {
  const x = new Date();
  x.setDate(x.getDate() - d);
  return x;
}

function TeacherIntelligencePage() {
  const { school } = useApp();
  const schoolId = school?.id ?? null;

  const query = useQuery({
    queryKey: ["teacher-intelligence", schoolId],
    enabled: !!schoolId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      if (!schoolId) return null;
      const since30 = daysAgo(30).toISOString();
      const [teachersRes, logsRes, plansRes, gradesRes, slotsRes] = await Promise.all([
        supabase
          .from("users")
          .select("id, full_name, subject_specialty")
          .eq("school_id", schoolId)
          .eq("role", "teacher")
          .eq("is_active", true),
        supabase
          .from("attendance_logs")
          .select("teacher_id, timestamp, type")
          .eq("school_id", schoolId)
          .gte("timestamp", since30),
        supabase
          .from("lesson_plans")
          .select("teacher_id, status, created_at")
          .eq("school_id", schoolId)
          .gte("created_at", since30),
        supabase
          .from("grades")
          .select("teacher_id, total_score, created_at")
          .eq("school_id", schoolId)
          .gte("created_at", daysAgo(90).toISOString()),
        supabase
          .from("timetable_slots")
          .select("teacher_id, subject, day_of_week")
          .eq("school_id", schoolId)
          .eq("is_break", false),
      ]);
      return {
        teachers: (teachersRes.data ?? []) as TeacherRow[],
        logs: (logsRes.data ?? []) as AttLog[],
        plans: (plansRes.data ?? []) as Plan[],
        grades: (gradesRes.data ?? []) as Grade[],
        slots: (slotsRes.data ?? []) as Slot[],
      };
    },
  });

  const enriched = useMemo<Enriched[]>(() => {
    if (!query.data) return [];
    const { teachers, logs, plans, grades, slots } = query.data;

    // Aggregate signals per teacher
    const logDays = new Map<string, Set<string>>(); // teacher_id -> unique days signed in
    for (const l of logs) {
      if (l.type !== "sign_in" && l.type !== "signin" && l.type !== "check_in") {
        // still count any log as an attendance signal
      }
      if (!l.timestamp) continue;
      const day = l.timestamp.slice(0, 10);
      const set = logDays.get(l.teacher_id) ?? new Set<string>();
      set.add(day);
      logDays.set(l.teacher_id, set);
    }

    const planBy = new Map<string, { total: number; approved: number; lastWeek: number }>();
    const weekAgo = daysAgo(7).toISOString();
    for (const p of plans) {
      const cur = planBy.get(p.teacher_id) ?? { total: 0, approved: 0, lastWeek: 0 };
      cur.total += 1;
      if (p.status === "approved") cur.approved += 1;
      if ((p.created_at ?? "") >= weekAgo) cur.lastWeek += 1;
      planBy.set(p.teacher_id, cur);
    }

    const gradeBy = new Map<string, { total: number; sum: number; lastAt: string | null }>();
    for (const g of grades) {
      if (!g.teacher_id) continue;
      const cur = gradeBy.get(g.teacher_id) ?? { total: 0, sum: 0, lastAt: null };
      cur.total += 1;
      cur.sum += Number(g.total_score ?? 0);
      if (!cur.lastAt || (g.created_at ?? "") > cur.lastAt) cur.lastAt = g.created_at ?? cur.lastAt;
      gradeBy.set(g.teacher_id, cur);
    }

    const slotsBy = new Map<string, { count: number; subjects: Set<string> }>();
    for (const s of slots) {
      if (!s.teacher_id) continue;
      const cur = slotsBy.get(s.teacher_id) ?? { count: 0, subjects: new Set<string>() };
      cur.count += 1;
      cur.subjects.add(s.subject);
      slotsBy.set(s.teacher_id, cur);
    }

    // Expected working days last 30 (approx 22)
    const expectedDays = 22;

    // Average classes for burnout comparison
    const loads = teachers.map((t) => slotsBy.get(t.id)?.count ?? 0);
    const avgLoad = loads.length ? loads.reduce((a, b) => a + b, 0) / loads.length : 0;

    // Attendance decline: last 2 weeks vs previous 2 weeks
    const cutRecent = daysAgo(14).toISOString().slice(0, 10);
    const cutOld = daysAgo(28).toISOString().slice(0, 10);

    return teachers.map((t) => {
      const days = logDays.get(t.id) ?? new Set<string>();
      const attendanceRate = Math.min(1, days.size / expectedDays);
      const pb = planBy.get(t.id);
      const submissionRate = pb && pb.total ? pb.approved / pb.total : 0;
      const gb = gradeBy.get(t.id);
      const engagementRate = Math.min(1, ((gb?.total ?? 0) + (pb?.total ?? 0)) / 20);
      const health = Math.round(attendanceRate * 40 + submissionRate * 30 + engagementRate * 30);

      // Burnout
      const slotInfo = slotsBy.get(t.id);
      const classesAssigned = slotInfo?.count ?? 0;
      const subjects = slotInfo
        ? Array.from(slotInfo.subjects).join(", ")
        : (t.subject_specialty ?? "—");

      let burnout = 0;
      const reasons: string[] = [];
      if (avgLoad > 0 && classesAssigned > avgLoad * 1.2) {
        burnout += 30;
        reasons.push(`Workload ${classesAssigned} (avg ${avgLoad.toFixed(1)})`);
      }
      const recentDays = Array.from(days).filter((d) => d >= cutRecent).length;
      const priorDays = Array.from(days).filter((d) => d >= cutOld && d < cutRecent).length;
      if (priorDays > 0 && recentDays < priorDays) {
        burnout += 25;
        reasons.push(`Attendance declining (${recentDays} vs ${priorDays})`);
      }
      if (!pb || pb.lastWeek === 0) {
        burnout += 25;
        reasons.push("No lesson plans submitted last week");
      }
      const noRecentGrades = !gb?.lastAt || gb.lastAt < daysAgo(14).toISOString();
      if (noRecentGrades) {
        burnout += 20;
        reasons.push("No grade entries in 14 days");
      }
      burnout = Math.min(100, burnout);

      // Weekly attendance heatmap: last 4 weeks × Mon–Fri
      const weeklyAttendance: { present: boolean }[][] = [];
      const today = new Date();
      const monday = new Date(today);
      monday.setDate(today.getDate() - ((today.getDay() + 6) % 7));
      for (let w = 3; w >= 0; w--) {
        const weekStart = new Date(monday);
        weekStart.setDate(monday.getDate() - w * 7);
        const week: { present: boolean }[] = [];
        for (let d = 0; d < 5; d++) {
          const day = new Date(weekStart);
          day.setDate(weekStart.getDate() + d);
          const key = day.toISOString().slice(0, 10);
          week.push({ present: days.has(key) });
        }
        weeklyAttendance.push(week);
      }

      return {
        id: t.id,
        name: t.full_name,
        subjects,
        classesAssigned,
        attendanceRate,
        submissionRate,
        engagementRate,
        health,
        burnout,
        burnoutReasons: reasons,
        avgStudentGrade: gb && gb.total ? Math.round(gb.sum / gb.total) : null,
        weeklyAttendance,
      };
    });
  }, [query.data]);

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [statusFilter, setStatusFilter] = useState("all");
  const [sortKey, setSortKey] = useState<SortKey>("health");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [expanded, setExpanded] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const term = debouncedSearch.trim().toLowerCase();
    let list = enriched.filter((r) => {
      if (statusFilter !== "all") {
        const lvl = HEALTH_LEVELS.find((l) => l.key === statusFilter);
        if (!lvl || r.health < lvl.min || r.health > lvl.max) return false;
      }
      if (term && !r.name.toLowerCase().includes(term)) return false;
      return true;
    });
    list = [...list].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      const cmp =
        typeof av === "number" && typeof bv === "number"
          ? av - bv
          : String(av).localeCompare(String(bv));
      return sortDir === "asc" ? cmp : -cmp;
    });
    return list;
  }, [enriched, debouncedSearch, statusFilter, sortKey, sortDir]);

  const burnoutAlerts = useMemo(
    () => enriched.filter((r) => r.burnout > 50).sort((a, b) => b.burnout - a.burnout),
    [enriched],
  );

  const avgLoad = useMemo(() => {
    if (!enriched.length) return 0;
    return enriched.reduce((a, b) => a + b.classesAssigned, 0) / enriched.length;
  }, [enriched]);

  const departments = useMemo(() => {
    // Group by primary subject (first subject) — proxy for department
    const map = new Map<string, { total: number; health: number; teachers: number }>();
    for (const t of enriched) {
      const dept = t.subjects.split(",")[0]?.trim() || "Unassigned";
      const cur = map.get(dept) ?? { total: 0, health: 0, teachers: 0 };
      cur.teachers += 1;
      cur.health += t.health;
      cur.total += 1;
      map.set(dept, cur);
    }
    return Array.from(map.entries())
      .map(([name, v]) => ({
        name,
        teachers: v.teachers,
        avgHealth: Math.round(v.health / v.total),
      }))
      .sort((a, b) => b.avgHealth - a.avgHealth);
  }, [enriched]);

  return (
    <PortalPage
      title="Teacher Intelligence Center"
      subtitle="Workforce analytics, performance insights, and burnout prevention"
    >
      {/* Burnout alert panel */}
      {burnoutAlerts.length > 0 && (
        <Card className="mb-6 border-red-500/30 bg-red-500/5 p-5">
          <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-red-600">
            <Flame className="h-4 w-4" /> Burnout Risk — {burnoutAlerts.length} teacher
            {burnoutAlerts.length > 1 ? "s" : ""} need attention
          </div>
          <ul className="space-y-2">
            {burnoutAlerts.slice(0, 8).map((t) => (
              <li
                key={t.id}
                className="rounded-md border border-red-500/20 bg-background/50 p-2 text-sm"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-medium">{t.name}</span>
                  <Badge variant="outline" className="border-red-500/30 bg-red-500/10 text-red-600">
                    Burnout {t.burnout}
                  </Badge>
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {t.burnoutReasons.join(" · ") || "Multiple risk signals"}
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}

      {/* Workload chart */}
      <Card className="mb-6 p-5">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <Users className="h-4 w-4" /> Workload Distribution
          </div>
          <span className="text-xs text-muted-foreground">
            Avg {avgLoad.toFixed(1)} classes / teacher
          </span>
        </div>
        {enriched.length === 0 ? (
          <p className="text-xs text-muted-foreground">No teacher data.</p>
        ) : (
          <div className="space-y-1.5">
            {[...enriched]
              .sort((a, b) => b.classesAssigned - a.classesAssigned)
              .slice(0, 12)
              .map((t) => {
                const max = Math.max(...enriched.map((x) => x.classesAssigned), 1);
                const pct = (t.classesAssigned / max) * 100;
                const critical = avgLoad > 0 && t.classesAssigned > avgLoad * 2;
                const over = !critical && avgLoad > 0 && t.classesAssigned > avgLoad * 1.2;
                const color = critical ? "bg-red-500" : over ? "bg-amber-500" : "bg-primary";
                return (
                  <div key={t.id} className="flex items-center gap-3 text-xs">
                    <span className="w-40 shrink-0 truncate">{t.name}</span>
                    <div className="h-4 flex-1 overflow-hidden rounded bg-muted">
                      <div
                        className={`h-full ${color}`}
                        style={{ width: `${Math.max(4, pct)}%` }}
                      />
                    </div>
                    <span className="w-10 text-right font-medium">{t.classesAssigned}</span>
                  </div>
                );
              })}
          </div>
        )}
      </Card>

      {/* Filters */}
      <Card className="mb-4 p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_200px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search teacher name"
              className="pl-9"
            />
          </div>
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger>
              <SelectValue placeholder="All health statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All health statuses</SelectItem>
              {HEALTH_LEVELS.map((l) => (
                <SelectItem key={l.key} value={l.key}>
                  {l.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>

      {/* Table / cards */}
      <Card className="mb-6 overflow-hidden">
        {query.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No teachers match filters.
          </div>
        ) : (
          <>
            <div className="hidden md:block">
              <div className="overflow-x-auto -mx-4 sm:mx-0">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <th className="w-8" />
                      <SortableTh
                        label="Teacher"
                        k="name"
                        sortKey={sortKey}
                        sortDir={sortDir}
                        setSortKey={setSortKey}
                        setSortDir={setSortDir}
                      />
                      <th className="px-3 py-2">Subjects</th>
                      <SortableTh
                        label="Classes"
                        k="classesAssigned"
                        sortKey={sortKey}
                        sortDir={sortDir}
                        setSortKey={setSortKey}
                        setSortDir={setSortDir}
                      />
                      <SortableTh
                        label="Attendance"
                        k="attendanceRate"
                        sortKey={sortKey}
                        sortDir={sortDir}
                        setSortKey={setSortKey}
                        setSortDir={setSortDir}
                      />
                      <SortableTh
                        label="Submissions"
                        k="submissionRate"
                        sortKey={sortKey}
                        sortDir={sortDir}
                        setSortKey={setSortKey}
                        setSortDir={setSortDir}
                      />
                      <SortableTh
                        label="Health"
                        k="health"
                        sortKey={sortKey}
                        sortDir={sortDir}
                        setSortKey={setSortKey}
                        setSortDir={setSortDir}
                      />
                      <SortableTh
                        label="Burnout"
                        k="burnout"
                        sortKey={sortKey}
                        sortDir={sortDir}
                        setSortKey={setSortKey}
                        setSortDir={setSortDir}
                      />
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {filtered.map((t) => {
                      const hl = healthLevel(t.health);
                      const bl = burnoutLevel(t.burnout);
                      const open = expanded === t.id;
                      return (
                        <>
                          <tr key={t.id} className="border-t border-border/60 hover:bg-muted/30">
                            <td className="px-2 py-2">
                              <button
                                onClick={() => setExpanded(open ? null : t.id)}
                                className="text-muted-foreground hover:text-foreground"
                              >
                                {open ? (
                                  <ChevronUp className="h-4 w-4" />
                                ) : (
                                  <ChevronDown className="h-4 w-4" />
                                )}
                              </button>
                            </td>
                            <td className="px-3 py-2 font-medium">{t.name}</td>
                            <td className="px-3 py-2 text-xs text-muted-foreground">
                              {t.subjects}
                            </td>
                            <td className="px-3 py-2">{t.classesAssigned}</td>
                            <td className="px-3 py-2">{Math.round(t.attendanceRate * 100)}%</td>
                            <td className="px-3 py-2">{Math.round(t.submissionRate * 100)}%</td>
                            <td className="px-3 py-2">
                              <Badge variant="outline" className={hl.color}>
                                {t.health} · {hl.label}
                              </Badge>
                            </td>
                            <td className="px-3 py-2">
                              <Badge variant="outline" className={bl.color}>
                                {t.burnout} · {bl.label}
                              </Badge>
                            </td>
                            <td className="px-3 py-2 text-right">
                              <TeacherActions />
                            </td>
                          </tr>
                          {open && (
                            <tr className="bg-muted/20">
                              <td colSpan={9} className="px-3 py-4">
                                <TeacherDetails t={t} />
                              </td>
                            </tr>
                          )}
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="divide-y divide-border/60 md:hidden">
              {filtered.map((t) => {
                const hl = healthLevel(t.health);
                const bl = burnoutLevel(t.burnout);
                const open = expanded === t.id;
                return (
                  <div key={t.id} className="p-3">
                    <button
                      className="flex w-full items-start justify-between gap-2 text-left"
                      onClick={() => setExpanded(open ? null : t.id)}
                    >
                      <div>
                        <div className="font-medium">{t.name}</div>
                        <div className="text-xs text-muted-foreground">{t.subjects}</div>
                      </div>
                      <div className="flex flex-col items-end gap-1">
                        <Badge variant="outline" className={hl.color}>
                          H {t.health}
                        </Badge>
                        <Badge variant="outline" className={bl.color}>
                          B {t.burnout}
                        </Badge>
                      </div>
                    </button>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {t.classesAssigned} classes · Att {Math.round(t.attendanceRate * 100)}% · Sub{" "}
                      {Math.round(t.submissionRate * 100)}%
                    </div>
                    {open && (
                      <div className="mt-3">
                        <TeacherDetails t={t} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </>
        )}
      </Card>

      {/* Department summary */}
      <Card className="mb-6 p-5">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <AlertTriangle className="h-4 w-4" /> Department Summary
        </div>
        {departments.length === 0 ? (
          <p className="text-xs text-muted-foreground">No department data.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4">
            {departments.map((d) => {
              const hl = healthLevel(d.avgHealth);
              return (
                <div key={d.name} className={`rounded-lg border p-3 ${hl.color}`}>
                  <div className="text-sm font-semibold">{d.name}</div>
                  <div className="text-xs opacity-80">
                    {d.teachers} teacher{d.teachers !== 1 ? "s" : ""}
                  </div>
                  <div className="mt-2 flex items-baseline gap-1">
                    <span className="text-2xl font-bold">{d.avgHealth}</span>
                    <span className="text-xs opacity-70">avg health</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </PortalPage>
  );
}

function SortableTh({
  label,
  k,
  sortKey,
  sortDir,
  setSortKey,
  setSortDir,
}: {
  label: string;
  k: SortKey;
  sortKey: SortKey;
  sortDir: "asc" | "desc";
  setSortKey: (k: SortKey) => void;
  setSortDir: (d: "asc" | "desc") => void;
}) {
  const active = sortKey === k;
  return (
    <th className="px-3 py-2">
      <button
        className="flex items-center gap-1 hover:text-foreground"
        onClick={() => {
          if (active) setSortDir(sortDir === "asc" ? "desc" : "asc");
          else {
            setSortKey(k);
            setSortDir("desc");
          }
        }}
      >
        {label}
        {active && <span className="text-[10px]">{sortDir === "asc" ? "▲" : "▼"}</span>}
      </button>
    </th>
  );
}

function TeacherActions() {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" variant="ghost">
          <MoreVertical className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem>Schedule Support Meeting</DropdownMenuItem>
        <DropdownMenuItem>Send Encouragement Message</DropdownMenuItem>
        <DropdownMenuItem>Review Lesson Plans</DropdownMenuItem>
        <DropdownMenuItem>View Full Profile</DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TeacherDetails({ t }: { t: Enriched }) {
  const hl = healthLevel(t.health);
  const dayLabels = ["M", "T", "W", "T", "F"];
  return (
    <div className="grid gap-4 md:grid-cols-[1fr_1fr_180px]">
      <div>
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Attendance heatmap (4 weeks)
        </div>
        <div className="space-y-1">
          {t.weeklyAttendance.map((week, wi) => (
            <div key={wi} className="flex items-center gap-2">
              <span className="w-10 text-[10px] text-muted-foreground">W{wi + 1}</span>
              <div className="flex gap-1">
                {week.map((d, di) => (
                  <div
                    key={di}
                    className={`h-5 w-5 rounded ${d.present ? "bg-emerald-500" : "bg-muted"}`}
                    title={dayLabels[di]}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
      <div className="space-y-3">
        <ProgressRow label="Lesson plan approval" value={t.submissionRate * 100} />
        <ProgressRow label="Grade / engagement" value={t.engagementRate * 100} />
        <ProgressRow label="Attendance" value={t.attendanceRate * 100} />
        {t.avgStudentGrade != null && (
          <div className="text-xs text-muted-foreground">
            Avg student grade in classes:{" "}
            <span className="font-medium text-foreground">{t.avgStudentGrade}</span>
          </div>
        )}
      </div>
      <div className="flex flex-col items-center justify-center">
        <HealthGauge score={t.health} colorClass={hl.color} />
        <div className="mt-1 text-xs text-muted-foreground">Health Score</div>
      </div>
    </div>
  );
}

function ProgressRow({ label, value }: { label: string; value: number }) {
  const v = Math.max(0, Math.min(100, value));
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{Math.round(v)}%</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div className="h-full bg-primary" style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}

function HealthGauge({ score, colorClass }: { score: number; colorClass: string }) {
  const r = 32;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  const stroke =
    score >= 80
      ? "stroke-emerald-500"
      : score >= 60
        ? "stroke-teal-500"
        : score >= 40
          ? "stroke-amber-500"
          : "stroke-red-500";
  return (
    <div
      className={`relative flex h-20 w-20 items-center justify-center rounded-full border ${colorClass}`}
    >
      <svg className="absolute inset-0" viewBox="0 0 80 80">
        <circle cx="40" cy="40" r={r} className="fill-none stroke-muted" strokeWidth="6" />
        <circle
          cx="40"
          cy="40"
          r={r}
          className={`fill-none ${stroke} transition-all`}
          strokeWidth="6"
          strokeLinecap="round"
          strokeDasharray={c}
          strokeDashoffset={c * (1 - pct)}
          transform="rotate(-90 40 40)"
        />
      </svg>
      <span className="text-xl font-bold">{score}</span>
    </div>
  );
}

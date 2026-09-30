import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Search, ShieldAlert, TrendingDown, Users, X } from "lucide-react";

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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { usePagination } from "@/hooks/use-pagination";

export const Route = createFileRoute("/_authenticated/admin/student-intelligence")({
  ssr: false,
  component: StudentIntelligencePage,
});

type StudentRow = {
  id: string;
  admission_number: string | null;
  parent_name: string | null;
  class_id: string | null;
};
type ClassRow = { id: string; name: string };
type AttendanceRow = { student_id: string; status: string; date: string };
type GradeRow = {
  student_id: string;
  total_score: number | null;
  created_at: string | null;
  subject: string;
};
type FeeRow = {
  student_id: string;
  amount: number;
  paid_amount: number | null;
  paid_at: string | null;
  created_at: string | null;
};

type Enriched = {
  id: string;
  name: string;
  admission_number: string;
  class_id: string | null;
  className: string;
  attendanceRate: number; // 0-1
  attendanceCount: number;
  gradeAvg: number; // 0-100
  gradeCount: number;
  feeRate: number; // 0-1
  feeCount: number;
  risk: number; // 0-100
};

type SortKey = "name" | "className" | "attendanceRate" | "gradeAvg" | "feeRate" | "risk";

const RISK_LEVELS = [
  {
    key: "critical",
    label: "Critical",
    min: 81,
    max: 100,
    color: "bg-red-500/15 text-red-600 border-red-500/30",
  },
  {
    key: "high",
    label: "High Risk",
    min: 61,
    max: 80,
    color: "bg-orange-500/15 text-orange-600 border-orange-500/30",
  },
  {
    key: "medium",
    label: "Medium Risk",
    min: 31,
    max: 60,
    color: "bg-amber-500/15 text-amber-600 border-amber-500/30",
  },
  {
    key: "low",
    label: "Low Risk",
    min: 0,
    max: 30,
    color: "bg-emerald-500/15 text-emerald-600 border-emerald-500/30",
  },
] as const;

function riskLevel(score: number) {
  return RISK_LEVELS.find((l) => score >= l.min && score <= l.max) ?? RISK_LEVELS[3];
}

function daysAgoISO(days: number) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

function StudentIntelligencePage() {
  const { school } = useApp();
  const schoolId = school?.id ?? null;

  const query = useQuery({
    queryKey: ["student-intelligence", schoolId],
    enabled: !!schoolId,
    staleTime: 5 * 60_000,
    queryFn: async () => {
      if (!schoolId) return null;
      const since30 = daysAgoISO(30);
      const [studentsRes, classesRes, attRes, gradesRes, feesRes] = await Promise.all([
        supabase
          .from("students")
          .select("id, admission_number, parent_name, class_id")
          .eq("school_id", schoolId)
          .eq("is_active", true),
        supabase.from("classes").select("id, name").eq("school_id", schoolId),
        supabase
          .from("attendance")
          .select("student_id, status, date")
          .eq("school_id", schoolId)
          .gte("date", since30),
        supabase
          .from("grades")
          .select("student_id, total_score, created_at, subject")
          .eq("school_id", schoolId),
        supabase
          .from("fees")
          .select("student_id, amount, paid_amount, paid_at, created_at")
          .eq("school_id", schoolId),
      ]);
      return {
        students: (studentsRes.data ?? []) as StudentRow[],
        classes: (classesRes.data ?? []) as ClassRow[],
        attendance: (attRes.data ?? []) as AttendanceRow[],
        grades: (gradesRes.data ?? []) as GradeRow[],
        fees: (feesRes.data ?? []) as FeeRow[],
      };
    },
  });

  const enriched = useMemo<Enriched[]>(() => {
    if (!query.data) return [];
    const { students, classes, attendance, grades, fees } = query.data;
    const classMap = new Map(classes.map((c) => [c.id, c.name] as const));
    const attBy = new Map<string, { present: number; total: number }>();
    for (const a of attendance) {
      const cur = attBy.get(a.student_id) ?? { present: 0, total: 0 };
      cur.total += 1;
      if (a.status === "present") cur.present += 1;
      attBy.set(a.student_id, cur);
    }
    const gradeBy = new Map<string, { sum: number; count: number }>();
    for (const g of grades) {
      if (g.total_score == null) continue;
      const cur = gradeBy.get(g.student_id) ?? { sum: 0, count: 0 };
      cur.sum += Number(g.total_score);
      cur.count += 1;
      gradeBy.set(g.student_id, cur);
    }
    const feeBy = new Map<string, { billed: number; paid: number; count: number }>();
    for (const f of fees) {
      const cur = feeBy.get(f.student_id) ?? { billed: 0, paid: 0, count: 0 };
      cur.billed += Number(f.amount ?? 0);
      cur.paid += Number(f.paid_amount ?? 0);
      cur.count += 1;
      feeBy.set(f.student_id, cur);
    }
    return students.map((s) => {
      const att = attBy.get(s.id);
      const attendanceRate = att && att.total ? att.present / att.total : 1;
      const g = gradeBy.get(s.id);
      const gradeAvg = g && g.count ? g.sum / g.count : 100;
      const f = feeBy.get(s.id);
      const feeRate = f && f.billed > 0 ? Math.min(1, f.paid / f.billed) : 1;
      const risk = Math.max(
        0,
        Math.min(
          100,
          Math.round(100 - (attendanceRate * 40 + (gradeAvg / 100) * 35 + feeRate * 25)),
        ),
      );
      return {
        id: s.id,
        name: s.parent_name?.trim() || `Student ${s.admission_number ?? s.id.slice(0, 6)}`,
        admission_number: s.admission_number ?? "—",
        class_id: s.class_id,
        className: (s.class_id && classMap.get(s.class_id)) || "Unassigned",
        attendanceRate,
        attendanceCount: att?.total ?? 0,
        gradeAvg,
        gradeCount: g?.count ?? 0,
        feeRate,
        feeCount: f?.count ?? 0,
        risk,
      };
    });
  }, [query.data]);

  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  const [classFilter, setClassFilter] = useState<string>("all");
  const [riskFilter, setRiskFilter] = useState<string>("all");
  const [sortKey, setSortKey] = useState<SortKey>("risk");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { page, from, to, nextPage, prevPage, reset } = usePagination(20);

  useEffect(() => {
    reset();
  }, [debouncedSearch, classFilter, riskFilter, sortKey, sortDir, reset]);

  const filtered = useMemo(() => {
    const term = debouncedSearch.trim().toLowerCase();
    let list = enriched.filter((r) => {
      if (classFilter !== "all" && r.class_id !== classFilter) return false;
      if (riskFilter !== "all") {
        const lvl = RISK_LEVELS.find((l) => l.key === riskFilter);
        if (!lvl || r.risk < lvl.min || r.risk > lvl.max) return false;
      }
      if (term) {
        const hay = `${r.name} ${r.admission_number}`.toLowerCase();
        if (!hay.includes(term)) return false;
      }
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
  }, [enriched, debouncedSearch, classFilter, riskFilter, sortKey, sortDir]);

  const pageRows = filtered.slice(from, to + 1);
  const totalPages = Math.max(1, Math.ceil(filtered.length / 20));

  const distribution = useMemo(() => {
    const counts = { critical: 0, high: 0, medium: 0, low: 0 } as Record<string, number>;
    for (const r of enriched) counts[riskLevel(r.risk).key] += 1;
    return counts;
  }, [enriched]);

  const interventions = useMemo(() => {
    return enriched
      .filter((r) => r.risk > 60)
      .sort((a, b) => b.risk - a.risk)
      .slice(0, 25)
      .map((r) => {
        const reasons: string[] = [];
        const rec: string[] = [];
        const attPct = r.attendanceRate * 100;
        const feePct = r.feeRate * 100;
        const lowAtt = attPct < 60;
        const lowGrade = r.gradeAvg < 50;
        const lowFee = feePct < 50;
        if (lowAtt) {
          reasons.push(`Attendance ${Math.round(attPct)}%`);
          rec.push("Immediate attendance intervention required. Contact parent.");
        } else if (attPct < 75) {
          reasons.push(`Attendance ${Math.round(attPct)}%`);
          rec.push("Schedule parent-teacher meeting about attendance.");
        }
        if (lowGrade) {
          reasons.push(`Grade avg ${Math.round(r.gradeAvg)}`);
          rec.push("Academic support sessions recommended.");
        }
        if (lowFee) {
          reasons.push(`Fees ${Math.round(feePct)}%`);
          rec.push("Fee payment plan discussion with bursar needed.");
        }
        if (lowAtt && lowGrade && lowFee) {
          rec.length = 0;
          rec.push("Urgent multi-department intervention required.");
        }
        return { student: r, reasons, recommendations: rec };
      })
      .filter((i) => i.recommendations.length > 0);
  }, [enriched]);

  const classHeatmap = useMemo(() => {
    const map = new Map<string, { name: string; total: number; sum: number }>();
    for (const r of enriched) {
      const key = r.class_id ?? "unassigned";
      const cur = map.get(key) ?? { name: r.className, total: 0, sum: 0 };
      cur.total += 1;
      cur.sum += r.risk;
      map.set(key, cur);
    }
    return Array.from(map.values())
      .map((c) => ({ name: c.name, count: c.total, avgRisk: Math.round(c.sum / c.total) }))
      .sort((a, b) => b.avgRisk - a.avgRisk);
  }, [enriched]);

  const insights = useMemo(() => {
    if (!query.data) return [] as string[];
    const { attendance, fees } = query.data;
    // Insight 1: declining attendance last 3 weeks vs previous 3
    const today = new Date();
    const cutRecent = new Date(today);
    cutRecent.setDate(today.getDate() - 21);
    const cutOld = new Date(today);
    cutOld.setDate(today.getDate() - 42);
    const byStudentRecent = new Map<string, { p: number; t: number }>();
    const byStudentOld = new Map<string, { p: number; t: number }>();
    for (const a of attendance) {
      const d = new Date(a.date);
      const bucket = d >= cutRecent ? byStudentRecent : d >= cutOld ? byStudentOld : null;
      if (!bucket) continue;
      const key = a.student_id;
      const cur = bucket.get(key) ?? { p: 0, t: 0 };
      cur.t += 1;
      if (a.status === "present") cur.p += 1;
      bucket.set(key, cur);
    }
    let declining = 0;
    for (const [id, r] of byStudentRecent) {
      const o = byStudentOld.get(id);
      if (!o || o.t === 0 || r.t === 0) continue;
      if (r.p / r.t < o.p / o.t - 0.1) declining += 1;
    }
    // Insight 2: worst class
    const worst = classHeatmap[0];
    // Insight 3: fee collection improvement — paid vs billed overall
    let billed = 0;
    let paid = 0;
    for (const f of fees) {
      billed += Number(f.amount ?? 0);
      paid += Number(f.paid_amount ?? 0);
    }
    const feePct = billed > 0 ? Math.round((paid / billed) * 100) : 0;

    return [
      declining > 0
        ? `${declining} students are showing declining attendance over the past 3 weeks.`
        : "No significant attendance decline detected across the school.",
      worst
        ? `Class ${worst.name} has the highest risk concentration (avg ${worst.avgRisk}) — review teaching resources.`
        : "Risk is evenly distributed across classes.",
      billed > 0
        ? `Fee collection stands at ${feePct}% of billed amounts this cycle.`
        : "No fee records available for this school yet.",
    ];
  }, [query.data, classHeatmap]);

  const selected = selectedId ? (enriched.find((r) => r.id === selectedId) ?? null) : null;

  return (
    <PortalPage
      title="Student Intelligence Center"
      subtitle="AI-powered risk monitoring and academic profiling for every learner"
    >
      {/* AI Insights */}
      <Card className="mb-6 border-primary/20 bg-primary/5 p-5">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-primary">
          <ShieldAlert className="h-4 w-4" /> AI Insights
        </div>
        {query.isLoading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-4 w-1/2" />
            <Skeleton className="h-4 w-3/5" />
          </div>
        ) : (
          <ul className="space-y-2 text-sm text-foreground/90">
            {insights.map((s, i) => (
              <li key={i} className="flex gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-primary" />
                {s}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Distribution */}
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4">
        {RISK_LEVELS.map((lvl) => (
          <Card key={lvl.key} className={`border p-4 ${lvl.color}`}>
            <div className="text-xs font-medium uppercase tracking-wide opacity-80">
              {lvl.label}
            </div>
            <div className="mt-1 text-3xl font-bold">
              {query.isLoading ? "—" : (distribution[lvl.key] ?? 0)}
            </div>
            <div className="text-xs opacity-70">
              Score {lvl.min}–{lvl.max}
            </div>
          </Card>
        ))}
      </div>

      {/* Filters */}
      <Card className="mb-4 p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_180px_180px]">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search student name or admission #"
              className="pl-9"
            />
          </div>
          <Select value={classFilter} onValueChange={setClassFilter}>
            <SelectTrigger>
              <SelectValue placeholder="All classes" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All classes</SelectItem>
              {(query.data?.classes ?? []).map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={riskFilter} onValueChange={setRiskFilter}>
            <SelectTrigger>
              <SelectValue placeholder="All risk levels" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All risk levels</SelectItem>
              {RISK_LEVELS.map((l) => (
                <SelectItem key={l.key} value={l.key}>
                  {l.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </Card>

      {/* Table (desktop) / Cards (mobile) */}
      <Card className="mb-6 overflow-hidden">
        {query.isLoading ? (
          <div className="space-y-2 p-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-full" />
            ))}
          </div>
        ) : filtered.length === 0 ? (
          <div className="p-8 text-center text-sm text-muted-foreground">
            No students match the current filters.
          </div>
        ) : (
          <>
            <div className="hidden md:block">
              <div className="overflow-x-auto -mx-4 sm:mx-0">
                <table className="w-full text-sm">
                  <thead className="bg-muted/50 text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <tr>
                      <SortableTh
                        label="Student"
                        k="name"
                        sortKey={sortKey}
                        sortDir={sortDir}
                        setSortKey={setSortKey}
                        setSortDir={setSortDir}
                      />
                      <SortableTh
                        label="Class"
                        k="className"
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
                        label="Grade Avg"
                        k="gradeAvg"
                        sortKey={sortKey}
                        sortDir={sortDir}
                        setSortKey={setSortKey}
                        setSortDir={setSortDir}
                      />
                      <SortableTh
                        label="Fees"
                        k="feeRate"
                        sortKey={sortKey}
                        sortDir={sortDir}
                        setSortKey={setSortKey}
                        setSortDir={setSortDir}
                      />
                      <SortableTh
                        label="Risk"
                        k="risk"
                        sortKey={sortKey}
                        sortDir={sortDir}
                        setSortKey={setSortKey}
                        setSortDir={setSortDir}
                      />
                      <th className="px-3 py-2" />
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((r) => {
                      const lvl = riskLevel(r.risk);
                      return (
                        <tr key={r.id} className="border-t border-border/60 hover:bg-muted/30">
                          <td className="px-3 py-2 font-medium">
                            <div>{r.name}</div>
                            <div className="text-xs text-muted-foreground">
                              {r.admission_number}
                            </div>
                          </td>
                          <td className="px-3 py-2">{r.className}</td>
                          <td className="px-3 py-2">{Math.round(r.attendanceRate * 100)}%</td>
                          <td className="px-3 py-2">{Math.round(r.gradeAvg)}</td>
                          <td className="px-3 py-2">{Math.round(r.feeRate * 100)}%</td>
                          <td className="px-3 py-2">
                            <Badge variant="outline" className={lvl.color}>
                              {r.risk} · {lvl.label}
                            </Badge>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Button size="sm" variant="ghost" onClick={() => setSelectedId(r.id)}>
                              Review
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="divide-y divide-border/60 md:hidden">
              {pageRows.map((r) => {
                const lvl = riskLevel(r.risk);
                return (
                  <button
                    key={r.id}
                    className="flex w-full flex-col gap-1 p-3 text-left hover:bg-muted/30"
                    onClick={() => setSelectedId(r.id)}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium">{r.name}</span>
                      <Badge variant="outline" className={lvl.color}>
                        {r.risk}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {r.className} · Att {Math.round(r.attendanceRate * 100)}% · Grade{" "}
                      {Math.round(r.gradeAvg)} · Fees {Math.round(r.feeRate * 100)}%
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="flex items-center justify-between border-t border-border/60 px-4 py-2 text-xs text-muted-foreground">
              <span>
                {filtered.length} students · page {page + 1} of {totalPages}
              </span>
              <div className="flex gap-2">
                <Button size="sm" variant="outline" disabled={page === 0} onClick={prevPage}>
                  Prev
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={page >= totalPages - 1}
                  onClick={nextPage}
                >
                  Next
                </Button>
              </div>
            </div>
          </>
        )}
      </Card>

      {/* Interventions */}
      <Card className="mb-6 p-5">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <AlertTriangle className="h-4 w-4 text-orange-500" /> Intervention Recommendations
        </div>
        {interventions.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No students currently require intervention. 🎉
          </p>
        ) : (
          <ul className="space-y-3">
            {interventions.map((i) => {
              const lvl = riskLevel(i.student.risk);
              return (
                <li key={i.student.id} className="rounded-lg border border-border/60 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <div className="font-medium">{i.student.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {i.student.className} · {i.reasons.join(" · ")}
                      </div>
                    </div>
                    <Badge variant="outline" className={lvl.color}>
                      Risk {i.student.risk}
                    </Badge>
                  </div>
                  <ul className="mt-2 space-y-1 text-sm text-foreground/90">
                    {i.recommendations.map((r, idx) => (
                      <li key={idx} className="flex gap-2">
                        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-orange-500" />
                        {r}
                      </li>
                    ))}
                  </ul>
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* Class Heatmap */}
      <Card className="mb-6 p-5">
        <div className="mb-3 flex items-center gap-2 text-sm font-semibold">
          <Users className="h-4 w-4" /> Class Performance Heatmap
        </div>
        {classHeatmap.length === 0 ? (
          <p className="text-sm text-muted-foreground">No class data available.</p>
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5">
            {classHeatmap.map((c) => {
              const lvl = riskLevel(c.avgRisk);
              return (
                <div key={c.name} className={`rounded-lg border p-3 ${lvl.color}`}>
                  <div className="text-sm font-semibold">{c.name}</div>
                  <div className="text-xs opacity-80">{c.count} students</div>
                  <div className="mt-2 flex items-baseline gap-1">
                    <span className="text-2xl font-bold">{c.avgRisk}</span>
                    <span className="text-xs opacity-70">avg risk</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Detail Drawer */}
      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelectedId(null)}>
        <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-md">
          {selected && (
            <StudentDetail
              student={selected}
              attendance={query.data?.attendance ?? []}
              grades={query.data?.grades ?? []}
              fees={query.data?.fees ?? []}
              onClose={() => setSelectedId(null)}
            />
          )}
        </SheetContent>
      </Sheet>
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

function StudentDetail({
  student,
  attendance,
  grades,
  fees,
  onClose,
}: {
  student: Enriched;
  attendance: AttendanceRow[];
  grades: GradeRow[];
  fees: FeeRow[];
  onClose: () => void;
}) {
  const lvl = riskLevel(student.risk);

  // Last 8 weeks attendance
  const weeks = useMemo(() => {
    const bins: { label: string; present: number; total: number }[] = [];
    const today = new Date();
    for (let i = 7; i >= 0; i--) {
      const end = new Date(today);
      end.setDate(today.getDate() - i * 7);
      const start = new Date(end);
      start.setDate(end.getDate() - 6);
      bins.push({ label: `${start.getMonth() + 1}/${start.getDate()}`, present: 0, total: 0 });
    }
    for (const a of attendance) {
      if (a.student_id !== student.id) continue;
      const d = new Date(a.date);
      const diffDays = Math.floor((Date.now() - d.getTime()) / 86400000);
      if (diffDays < 0 || diffDays > 55) continue;
      const weekIdx = 7 - Math.floor(diffDays / 7);
      if (weekIdx < 0 || weekIdx > 7) continue;
      const bin = bins[weekIdx];
      bin.total += 1;
      if (a.status === "present") bin.present += 1;
    }
    return bins;
  }, [attendance, student.id]);

  // Last 4 assessment periods (grade order by created_at)
  const gradeTrend = useMemo(() => {
    const list = grades
      .filter((g) => g.student_id === student.id && g.total_score != null)
      .sort((a, b) => (a.created_at ?? "").localeCompare(b.created_at ?? ""))
      .slice(-4);
    return list.map((g, i) => ({
      label: g.subject.slice(0, 8),
      score: Number(g.total_score) || 0,
      i,
    }));
  }, [grades, student.id]);

  const studentFees = useMemo(
    () =>
      fees
        .filter((f) => f.student_id === student.id)
        .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""))
        .slice(0, 6),
    [fees, student.id],
  );

  return (
    <>
      <SheetHeader>
        <div className="flex items-start justify-between gap-2">
          <div>
            <SheetTitle>{student.name}</SheetTitle>
            <SheetDescription>
              {student.admission_number} · {student.className}
            </SheetDescription>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </div>
        <Badge variant="outline" className={`w-fit ${lvl.color}`}>
          Risk {student.risk} · {lvl.label}
        </Badge>
      </SheetHeader>

      <div className="mt-6 space-y-6">
        <section>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Attendance (last 8 weeks)
          </h4>
          <div className="flex h-24 items-end gap-1">
            {weeks.map((w, i) => {
              const pct = w.total ? (w.present / w.total) * 100 : 0;
              return (
                <div key={i} className="flex flex-1 flex-col items-center gap-1">
                  <div
                    className="w-full rounded-t bg-emerald-500"
                    style={{ height: `${Math.max(4, pct)}%`, opacity: w.total ? 1 : 0.15 }}
                    title={`${Math.round(pct)}%`}
                  />
                  <span className="text-[9px] text-muted-foreground">{w.label}</span>
                </div>
              );
            })}
          </div>
        </section>

        <section>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Grade trend (last 4)
          </h4>
          {gradeTrend.length === 0 ? (
            <p className="text-xs text-muted-foreground">No grades recorded.</p>
          ) : (
            <div className="flex h-24 items-end gap-2">
              {gradeTrend.map((g) => (
                <div key={g.i} className="flex flex-1 flex-col items-center gap-1">
                  <div
                    className="w-full rounded-t bg-primary"
                    style={{ height: `${g.score}%` }}
                    title={`${g.score}`}
                  />
                  <span className="text-[10px] text-muted-foreground">{g.label}</span>
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Fee payment timeline
          </h4>
          {studentFees.length === 0 ? (
            <p className="text-xs text-muted-foreground">No fee records.</p>
          ) : (
            <ul className="space-y-1 text-xs">
              {studentFees.map((f, i) => {
                const pct = f.amount > 0 ? Math.round(((f.paid_amount ?? 0) / f.amount) * 100) : 0;
                return (
                  <li
                    key={i}
                    className="flex items-center justify-between rounded border border-border/60 px-2 py-1"
                  >
                    <span>{(f.created_at ?? "").slice(0, 10) || "—"}</span>
                    <span>
                      {Math.round(f.paid_amount ?? 0)} / {Math.round(f.amount)} ({pct}%)
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <section>
          <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Risk score breakdown
          </h4>
          <div className="space-y-2">
            <RiskBar label="Attendance" pct={student.attendanceRate * 100} />
            <RiskBar label="Grades" pct={student.gradeAvg} />
            <RiskBar label="Fees paid" pct={student.feeRate * 100} />
            <RiskBar label="Overall risk" pct={student.risk} inverse />
          </div>
        </section>

        <section className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm">
            <TrendingDown className="mr-1 h-3.5 w-3.5" />
            Contact Parent
          </Button>
          <Button variant="outline" size="sm">
            Flag for Review
          </Button>
          <Button variant="outline" size="sm">
            Schedule Meeting
          </Button>
        </section>
      </div>
    </>
  );
}

function RiskBar({ label, pct, inverse }: { label: string; pct: number; inverse?: boolean }) {
  const clamped = Math.max(0, Math.min(100, pct));
  const good = inverse ? clamped < 40 : clamped >= 70;
  const bad = inverse ? clamped > 70 : clamped < 40;
  const color = good ? "bg-emerald-500" : bad ? "bg-red-500" : "bg-amber-500";
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-medium">{Math.round(clamped)}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div className={`h-full ${color}`} style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}

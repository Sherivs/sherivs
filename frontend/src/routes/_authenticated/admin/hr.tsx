import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Users,
  DollarSign,
  CalendarDays,
  FileText,
  Plus,
  Pencil,
  Printer,
  CheckCircle2,
  XCircle,
  Clock,
  TrendingUp,
} from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { withUserPrivateFields } from "@/lib/identity/user-private-fields";
import { useApp } from "@/contexts/app-context";
import {
  PortalPage,
  GlassCard,
  StatCard,
  PortalPageSkeleton,
  EmptyState,
} from "@/components/portal-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { parseHrStaffPatch } from "@/lib/runtime/identity-privilege";
import { useServerFn } from "@tanstack/react-start";
import { updateStaffPrivilege } from "@/lib/runtime/scholar/staff-privilege.functions";

export const Route = createFileRoute("/_authenticated/admin/hr")({
  ssr: false,
  component: HRPage,
});

type StaffUser = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  role: string;
  subject_specialty: string | null;
  employment_type: string | null;
  salary: number | null;
  date_enrolled: string | null;
  is_active: boolean | null;
  avatar_url: string | null;
};

type Payroll = {
  id: string;
  user_id: string | null;
  month: number;
  year: number;
  basic_salary: number;
  housing_allowance: number | null;
  transport_allowance: number | null;
  other_allowances: number | null;
  tax_deduction: number | null;
  pension_deduction: number | null;
  other_deductions: number | null;
  loan_deduction: number | null;
  gross_salary: number;
  net_salary: number;
  status: string;
  payment_date: string | null;
};

type Leave = {
  id: string;
  user_id: string | null;
  leave_type: string;
  start_date: string;
  end_date: string;
  days_requested: number | null;
  reason: string | null;
  status: string;
  approved_at: string | null;
  notes: string | null;
  created_at: string;
};

type School = { name: string | null; logo_url: string | null; currency: string | null };

const STAFF_ROLES = ["teacher", "admin", "principal", "bursar", "driver", "librarian", "nurse"];

function money(n: number, cur = "NGN") {
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: cur,
      maximumFractionDigits: 0,
    }).format(n);
  } catch {
    return `${cur} ${Math.round(n).toLocaleString()}`;
  }
}

function HRPage() {
  const { profile, authUser } = useApp();
  const schoolId = profile?.school_id ?? "";
  const qc = useQueryClient();
  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [staffDlg, setStaffDlg] = useState<{ open: boolean; staff?: StaffUser | null }>({
    open: false,
  });
  const [leaveDlg, setLeaveDlg] = useState(false);
  const [payslipFor, setPayslipFor] = useState<string | null>(null);

  const schoolQ = useQuery({
    queryKey: ["hr-school", schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      const { data } = await supabase
        .from("schools")
        .select("name, logo_url, currency")
        .eq("id", schoolId)
        .maybeSingle();
      return (data ?? null) as School | null;
    },
  });
  const currency = schoolQ.data?.currency ?? "NGN";

  const staffQ = useQuery({
    queryKey: ["hr-staff", schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("users")
        .select(
          "id, full_name, email, role, subject_specialty, employment_type, date_enrolled, is_active, avatar_url",
        )
        .eq("school_id", schoolId)
        .in("role", STAFF_ROLES)
        .order("full_name");
      if (error) throw error;
      // SHERIVS-015: phone/salary come from the role-checked RPC.
      return (await withUserPrivateFields(supabase, data ?? [], [
        "phone",
        "salary",
      ])) as StaffUser[];
    },
  });

  const payrollQ = useQuery({
    queryKey: ["hr-payroll", schoolId, month, year],
    enabled: !!schoolId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("staff_payroll")
        .select("*")
        .eq("school_id", schoolId)
        .eq("month", month)
        .eq("year", year);
      if (error) throw error;
      return (data ?? []) as Payroll[];
    },
  });

  const leaveQ = useQuery({
    queryKey: ["hr-leave", schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("staff_leave")
        .select("*")
        .eq("school_id", schoolId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Leave[];
    },
  });

  const staffMap = useMemo(() => {
    const m = new Map<string, StaffUser>();
    (staffQ.data ?? []).forEach((s) => m.set(s.id, s));
    return m;
  }, [staffQ.data]);

  const staffCount = staffQ.data?.length ?? 0;
  const activeCount = (staffQ.data ?? []).filter((s) => s.is_active !== false).length;
  const pendingLeave = (leaveQ.data ?? []).filter((l) => l.status === "pending").length;
  const monthTotal = (payrollQ.data ?? []).reduce((s, p) => s + (p.net_salary || 0), 0);

  const updatePrivilege = useServerFn(updateStaffPrivilege);
  const saveStaff = useMutation({
    mutationFn: async (payload: Partial<StaffUser> & { id?: string }) => {
      if (!payload.id) throw new Error("Use user creation flow to add new staff");
      const { id, ...rest } = payload;
      const current = staffMap.get(id);
      const patch = parseHrStaffPatch({
        actorId: profile?.id ?? authUser?.id,
        targetId: id,
        patch: rest,
        currentRole: current?.role ?? rest.role ?? null,
        currentActive: current?.is_active ?? rest.is_active ?? null,
      });
      if (Object.keys(patch).length > 0) {
        const { error } = await supabase.from("users").update(patch).eq("id", id);
        if (error) throw error;
      }
      // role / is_active are service_role-only: go through the server path.
      const roleChanged = rest.role !== undefined && rest.role !== current?.role;
      const activeChanged = rest.is_active !== undefined && rest.is_active !== current?.is_active;
      if (roleChanged || activeChanged) {
        await updatePrivilege({
          data: {
            userId: id,
            ...(roleChanged ? { role: rest.role as string } : {}),
            ...(activeChanged ? { isActive: Boolean(rest.is_active) } : {}),
          },
        });
      }
    },
    onSuccess: () => {
      toast.success("Staff updated");
      qc.invalidateQueries({ queryKey: ["hr-staff"] });
      setStaffDlg({ open: false });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const generatePayroll = useMutation({
    mutationFn: async () => {
      const existing = new Set((payrollQ.data ?? []).map((p) => p.user_id));
      const rows = (staffQ.data ?? [])
        .filter((s) => s.is_active !== false && !existing.has(s.id))
        .map((s) => ({
          school_id: schoolId,
          user_id: s.id,
          month,
          year,
          basic_salary: s.salary ?? 0,
          status: "draft",
        }));
      if (!rows.length) return 0;
      const { error } = await supabase.from("staff_payroll").insert(rows);
      if (error) throw error;
      return rows.length;
    },
    onSuccess: (n) => {
      toast.success(
        n ? `Generated ${n} payroll records` : "All staff already on payroll for this period",
      );
      qc.invalidateQueries({ queryKey: ["hr-payroll"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updatePayroll = useMutation({
    mutationFn: async (p: Partial<Payroll> & { id: string }) => {
      const { id, ...rest } = p;
      const { error } = await supabase.from("staff_payroll").update(rest).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hr-payroll"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const bulkApprove = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("staff_payroll")
        .update({ status: "approved" })
        .eq("school_id", schoolId)
        .eq("month", month)
        .eq("year", year)
        .eq("status", "draft");
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Payroll approved");
      qc.invalidateQueries({ queryKey: ["hr-payroll"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const bulkPay = useMutation({
    mutationFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { error } = await supabase
        .from("staff_payroll")
        .update({ status: "paid", payment_date: today })
        .eq("school_id", schoolId)
        .eq("month", month)
        .eq("year", year)
        .eq("status", "approved");
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Marked as paid");
      qc.invalidateQueries({ queryKey: ["hr-payroll"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const submitLeave = useMutation({
    mutationFn: async (row: {
      user_id: string;
      leave_type: string;
      start_date: string;
      end_date: string;
      reason?: string;
      notes?: string;
    }) => {
      const days = Math.max(
        1,
        Math.ceil((+new Date(row.end_date) - +new Date(row.start_date)) / 86400000) + 1,
      );
      const { error } = await supabase.from("staff_leave").insert({
        school_id: schoolId,
        user_id: row.user_id,
        leave_type: row.leave_type,
        start_date: row.start_date,
        end_date: row.end_date,
        days_requested: days,
        reason: row.reason,
        notes: row.notes,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Leave request created");
      qc.invalidateQueries({ queryKey: ["hr-leave"] });
      setLeaveDlg(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const decideLeave = useMutation({
    mutationFn: async ({ id, status, notes }: { id: string; status: string; notes?: string }) => {
      const { error } = await supabase
        .from("staff_leave")
        .update({ status, notes, approved_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["hr-leave"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  if (!schoolId || staffQ.isLoading) return <PortalPageSkeleton />;

  return (
    <PortalPage
      title="Human Capital Management"
      subtitle="Staff lifecycle, payroll, and workforce intelligence"
    >
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total Staff" value={staffCount} />
        <StatCard label="Active" value={activeCount} />
        <StatCard label="Pending Leave" value={pendingLeave} />
        <StatCard
          label={`${monthNames[month - 1]} Net Payroll`}
          value={money(monthTotal, currency)}
        />
      </div>

      <Tabs defaultValue="staff" className="w-full">
        <TabsList className="grid w-full grid-cols-4 max-w-2xl">
          <TabsTrigger value="staff">
            <Users className="w-4 h-4 mr-1" />
            Staff
          </TabsTrigger>
          <TabsTrigger value="payroll">
            <DollarSign className="w-4 h-4 mr-1" />
            Payroll
          </TabsTrigger>
          <TabsTrigger value="leave">
            <CalendarDays className="w-4 h-4 mr-1" />
            Leave
          </TabsTrigger>
          <TabsTrigger value="reports">
            <FileText className="w-4 h-4 mr-1" />
            Reports
          </TabsTrigger>
        </TabsList>

        {/* STAFF TAB */}
        <TabsContent value="staff" className="mt-4">
          <GlassCard>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {(staffQ.data ?? []).map((s) => (
                <div key={s.id} className="rounded-xl border border-white/10 p-4 space-y-2">
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="font-semibold">{s.full_name}</div>
                      <div className="text-xs text-muted-foreground capitalize">
                        {s.role}
                        {s.subject_specialty ? ` · ${s.subject_specialty}` : ""}
                      </div>
                    </div>
                    <Badge
                      variant={s.is_active === false ? "outline" : "default"}
                      className="capitalize"
                    >
                      {s.employment_type ?? (s.is_active === false ? "inactive" : "active")}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {s.email ?? "—"} · {s.phone ?? "—"}
                  </div>
                  <div className="text-xs">
                    Joined: {s.date_enrolled ? new Date(s.date_enrolled).toLocaleDateString() : "—"}
                  </div>
                  <div className="text-xs">Basic salary: {money(s.salary ?? 0, currency)}</div>
                  <div className="flex gap-2 pt-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setStaffDlg({ open: true, staff: s })}
                    >
                      <Pencil className="w-3 h-3 mr-1" />
                      Edit
                    </Button>
                    <Button size="sm" variant="outline" onClick={() => setPayslipFor(s.id)}>
                      <Printer className="w-3 h-3 mr-1" />
                      Payslip
                    </Button>
                  </div>
                </div>
              ))}
              {!(staffQ.data ?? []).length && (
                <EmptyState
                  title="No staff yet"
                  description="Add teachers and staff from the Staff creation flow."
                />
              )}
            </div>
          </GlassCard>
        </TabsContent>

        {/* PAYROLL TAB */}
        <TabsContent value="payroll" className="mt-4 space-y-4">
          <GlassCard>
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <Label>Month</Label>
                <Select value={String(month)} onValueChange={(v) => setMonth(Number(v))}>
                  <SelectTrigger className="w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {monthNames.map((n, i) => (
                      <SelectItem key={i} value={String(i + 1)}>
                        {n}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Year</Label>
                <Input
                  type="number"
                  value={year}
                  onChange={(e) => setYear(Number(e.target.value) || year)}
                  className="w-28"
                />
              </div>
              <div className="ml-auto flex flex-wrap gap-2">
                <Button
                  onClick={() => generatePayroll.mutate()}
                  disabled={generatePayroll.isPending}
                >
                  <Plus className="w-4 h-4 mr-1" />
                  Generate Payroll
                </Button>
                <Button
                  variant="outline"
                  onClick={() => bulkApprove.mutate()}
                  disabled={bulkApprove.isPending}
                >
                  Approve All
                </Button>
                <Button
                  variant="outline"
                  onClick={() => bulkPay.mutate()}
                  disabled={bulkPay.isPending}
                >
                  Mark All Paid
                </Button>
              </div>
            </div>
          </GlassCard>

          <GlassCard>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground text-left">
                  <tr className="border-b border-white/10">
                    <th className="py-2 pr-3">Staff</th>
                    <th className="py-2 pr-3">Basic</th>
                    <th className="py-2 pr-3">Allowances</th>
                    <th className="py-2 pr-3">Deductions</th>
                    <th className="py-2 pr-3">Net</th>
                    <th className="py-2 pr-3">Status</th>
                    <th className="py-2 pr-3">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {(payrollQ.data ?? []).map((p) => {
                    const allow =
                      (p.housing_allowance || 0) +
                      (p.transport_allowance || 0) +
                      (p.other_allowances || 0);
                    const deduct =
                      (p.tax_deduction || 0) +
                      (p.pension_deduction || 0) +
                      (p.other_deductions || 0) +
                      (p.loan_deduction || 0);
                    const s = p.user_id ? staffMap.get(p.user_id) : null;
                    return (
                      <tr key={p.id} className="border-b border-white/5">
                        <td className="py-2 pr-3">{s?.full_name ?? "—"}</td>
                        <td className="py-2 pr-3">{money(p.basic_salary, currency)}</td>
                        <td className="py-2 pr-3">{money(allow, currency)}</td>
                        <td className="py-2 pr-3">{money(deduct, currency)}</td>
                        <td className="py-2 pr-3 font-semibold">{money(p.net_salary, currency)}</td>
                        <td className="py-2 pr-3">
                          <Badge
                            variant={
                              p.status === "paid"
                                ? "default"
                                : p.status === "approved"
                                  ? "secondary"
                                  : "outline"
                            }
                            className="capitalize"
                          >
                            {p.status}
                          </Badge>
                        </td>
                        <td className="py-2 pr-3">
                          <div className="flex gap-1">
                            <EditPayrollButton
                              payroll={p}
                              onSave={(patch) => updatePayroll.mutate({ id: p.id, ...patch })}
                              currency={currency}
                            />
                            {p.user_id && (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setPayslipFor(p.user_id!)}
                              >
                                <Printer className="w-3 h-3" />
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {!(payrollQ.data ?? []).length && (
                    <tr>
                      <td colSpan={7} className="py-6 text-center text-muted-foreground text-sm">
                        No payroll records. Click "Generate Payroll".
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </GlassCard>
        </TabsContent>

        {/* LEAVE TAB */}
        <TabsContent value="leave" className="mt-4 space-y-4">
          <div className="flex justify-end">
            <Button onClick={() => setLeaveDlg(true)}>
              <Plus className="w-4 h-4 mr-1" />
              New Leave Request
            </Button>
          </div>
          <GlassCard>
            <div className="text-sm font-semibold mb-3">Pending requests</div>
            <div className="space-y-2">
              {(leaveQ.data ?? [])
                .filter((l) => l.status === "pending")
                .map((l) => {
                  const s = l.user_id ? staffMap.get(l.user_id) : null;
                  return (
                    <div
                      key={l.id}
                      className="rounded-lg border border-white/10 p-3 flex flex-wrap items-center gap-3"
                    >
                      <div className="flex-1 min-w-[200px]">
                        <div className="font-medium">
                          {s?.full_name ?? "—"} ·{" "}
                          <span className="capitalize text-xs text-muted-foreground">
                            {l.leave_type}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {l.start_date} → {l.end_date} ({l.days_requested} days)
                        </div>
                        {l.reason && <div className="text-xs mt-1">{l.reason}</div>}
                      </div>
                      <Button
                        size="sm"
                        onClick={() => decideLeave.mutate({ id: l.id, status: "approved" })}
                      >
                        <CheckCircle2 className="w-3 h-3 mr-1" />
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => decideLeave.mutate({ id: l.id, status: "rejected" })}
                      >
                        <XCircle className="w-3 h-3 mr-1" />
                        Reject
                      </Button>
                    </div>
                  );
                })}
              {!(leaveQ.data ?? []).some((l) => l.status === "pending") && (
                <div className="text-sm text-muted-foreground">No pending requests.</div>
              )}
            </div>
          </GlassCard>

          <GlassCard>
            <div className="text-sm font-semibold mb-3">All leave records</div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-xs text-muted-foreground text-left">
                  <tr className="border-b border-white/10">
                    <th className="py-2 pr-3">Staff</th>
                    <th className="py-2 pr-3">Type</th>
                    <th className="py-2 pr-3">Dates</th>
                    <th className="py-2 pr-3">Days</th>
                    <th className="py-2 pr-3">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {(leaveQ.data ?? []).map((l) => (
                    <tr key={l.id} className="border-b border-white/5">
                      <td className="py-2 pr-3">
                        {l.user_id ? (staffMap.get(l.user_id)?.full_name ?? "—") : "—"}
                      </td>
                      <td className="py-2 pr-3 capitalize">{l.leave_type}</td>
                      <td className="py-2 pr-3">
                        {l.start_date} → {l.end_date}
                      </td>
                      <td className="py-2 pr-3">{l.days_requested}</td>
                      <td className="py-2 pr-3">
                        <Badge variant="outline" className="capitalize">
                          {l.status}
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </GlassCard>

          <GlassCard>
            <div className="text-sm font-semibold mb-3">Leave balance (annual)</div>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {(staffQ.data ?? []).map((s) => {
                const used = (leaveQ.data ?? [])
                  .filter(
                    (l) =>
                      l.user_id === s.id && l.status === "approved" && l.leave_type === "annual",
                  )
                  .reduce((n, l) => n + (l.days_requested || 0), 0);
                const total = 21;
                return (
                  <div key={s.id} className="rounded-lg border border-white/10 p-3">
                    <div className="text-sm font-medium">{s.full_name}</div>
                    <div className="text-xs text-muted-foreground">
                      {used}/{total} days used
                    </div>
                    <div className="mt-2 h-1.5 bg-white/10 rounded overflow-hidden">
                      <div
                        className="h-full bg-primary"
                        style={{ width: `${Math.min(100, (used / total) * 100)}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </GlassCard>
        </TabsContent>

        {/* REPORTS TAB */}
        <TabsContent value="reports" className="mt-4 space-y-4">
          <div className="grid gap-3 sm:grid-cols-3">
            <StatCard
              label="Full-time"
              value={(staffQ.data ?? []).filter((s) => s.employment_type === "full-time").length}
            />
            <StatCard
              label="Part-time"
              value={(staffQ.data ?? []).filter((s) => s.employment_type === "part-time").length}
            />
            <StatCard
              label="Contract"
              value={(staffQ.data ?? []).filter((s) => s.employment_type === "contract").length}
            />
          </div>
          <GlassCard>
            <div className="text-sm font-semibold mb-2">
              Payroll — {monthNames[month - 1]} {year}
            </div>
            <div className="grid gap-3 sm:grid-cols-4 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">Records</div>
                <div className="text-lg font-semibold">{payrollQ.data?.length ?? 0}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Gross</div>
                <div className="text-lg font-semibold">
                  {money(
                    (payrollQ.data ?? []).reduce((s, p) => s + (p.gross_salary || 0), 0),
                    currency,
                  )}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Deductions</div>
                <div className="text-lg font-semibold">
                  {money(
                    (payrollQ.data ?? []).reduce(
                      (s, p) => s + ((p.gross_salary || 0) - (p.net_salary || 0)),
                      0,
                    ),
                    currency,
                  )}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Net</div>
                <div className="text-lg font-semibold">{money(monthTotal, currency)}</div>
              </div>
            </div>
          </GlassCard>
          <GlassCard>
            <div className="text-sm font-semibold mb-2">Leave utilization</div>
            <div className="grid gap-3 sm:grid-cols-4 text-sm">
              <div>
                <div className="text-xs text-muted-foreground">Pending</div>
                <div className="text-lg font-semibold">
                  {(leaveQ.data ?? []).filter((l) => l.status === "pending").length}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Approved</div>
                <div className="text-lg font-semibold">
                  {(leaveQ.data ?? []).filter((l) => l.status === "approved").length}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Rejected</div>
                <div className="text-lg font-semibold">
                  {(leaveQ.data ?? []).filter((l) => l.status === "rejected").length}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground">Days approved</div>
                <div className="text-lg font-semibold">
                  {(leaveQ.data ?? [])
                    .filter((l) => l.status === "approved")
                    .reduce((n, l) => n + (l.days_requested || 0), 0)}
                </div>
              </div>
            </div>
          </GlassCard>
          <GlassCard>
            <div className="flex items-center gap-2 text-sm font-semibold mb-2">
              <TrendingUp className="w-4 h-4" />
              Turnover indicators
            </div>
            <div className="text-sm text-muted-foreground">
              Inactive staff: {(staffQ.data ?? []).filter((s) => s.is_active === false).length} ·
              Active rate: {staffCount ? Math.round((activeCount / staffCount) * 100) : 0}%
            </div>
          </GlassCard>
        </TabsContent>
      </Tabs>

      {/* Edit staff dialog */}
      <Dialog open={staffDlg.open} onOpenChange={(o) => setStaffDlg({ open: o })}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit staff</DialogTitle>
          </DialogHeader>
          {staffDlg.staff && (
            <StaffForm
              staff={staffDlg.staff}
              onSubmit={(v) => saveStaff.mutate({ id: staffDlg.staff!.id, ...v })}
              saving={saveStaff.isPending}
            />
          )}
        </DialogContent>
      </Dialog>

      {/* Leave request dialog */}
      <Dialog open={leaveDlg} onOpenChange={setLeaveDlg}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>New leave request</DialogTitle>
          </DialogHeader>
          <LeaveForm
            staff={staffQ.data ?? []}
            onSubmit={(v) => submitLeave.mutate(v)}
            saving={submitLeave.isPending}
          />
        </DialogContent>
      </Dialog>

      {/* Payslip dialog */}
      <Dialog open={!!payslipFor} onOpenChange={(o) => !o && setPayslipFor(null)}>
        <DialogContent className="max-w-2xl print:shadow-none max-h-[90vh] overflow-y-auto">
          {payslipFor && (
            <Payslip
              staff={staffMap.get(payslipFor) ?? null}
              payroll={(payrollQ.data ?? []).find((p) => p.user_id === payslipFor) ?? null}
              school={schoolQ.data ?? null}
              month={month}
              year={year}
              currency={currency}
            />
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPayslipFor(null)}>
              Close
            </Button>
            <Button onClick={() => window.print()}>
              <Printer className="w-4 h-4 mr-1" />
              Print
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PortalPage>
  );
}

const monthNames = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

function StaffForm({
  staff,
  onSubmit,
  saving,
}: {
  staff: StaffUser;
  onSubmit: (v: Partial<StaffUser>) => void;
  saving: boolean;
}) {
  const [v, setV] = useState({
    full_name: staff.full_name,
    email: staff.email ?? "",
    phone: staff.phone ?? "",
    role: staff.role,
    subject_specialty: staff.subject_specialty ?? "",
    employment_type: staff.employment_type ?? "full-time",
    date_enrolled: staff.date_enrolled ?? "",
    salary: staff.salary ?? 0,
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(v);
      }}
      className="space-y-3"
    >
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label>Full name</Label>
          <Input
            value={v.full_name}
            onChange={(e) => setV({ ...v, full_name: e.target.value })}
            required
          />
        </div>
        <div>
          <Label>Email</Label>
          <Input
            type="email"
            value={v.email}
            onChange={(e) => setV({ ...v, email: e.target.value })}
          />
        </div>
        <div>
          <Label>Phone</Label>
          <Input value={v.phone} onChange={(e) => setV({ ...v, phone: e.target.value })} />
        </div>
        <div>
          <Label>Role</Label>
          <Select value={v.role} onValueChange={(x) => setV({ ...v, role: x })}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {STAFF_ROLES.map((r) => (
                <SelectItem key={r} value={r} className="capitalize">
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Subject / Department</Label>
          <Input
            value={v.subject_specialty}
            onChange={(e) => setV({ ...v, subject_specialty: e.target.value })}
          />
        </div>
        <div>
          <Label>Employment type</Label>
          <Select
            value={v.employment_type}
            onValueChange={(x) => setV({ ...v, employment_type: x })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="full-time">Full-time</SelectItem>
              <SelectItem value="part-time">Part-time</SelectItem>
              <SelectItem value="contract">Contract</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>Start date</Label>
          <Input
            type="date"
            value={v.date_enrolled?.slice(0, 10) ?? ""}
            onChange={(e) => setV({ ...v, date_enrolled: e.target.value })}
          />
        </div>
        <div>
          <Label>Basic salary</Label>
          <Input
            type="number"
            value={v.salary}
            onChange={(e) => setV({ ...v, salary: Number(e.target.value) })}
          />
        </div>
      </div>
      <DialogFooter>
        <Button className="w-full sm:w-auto" type="submit" disabled={saving}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}

function EditPayrollButton({
  payroll,
  onSave,
  currency,
}: {
  payroll: Payroll;
  onSave: (p: Partial<Payroll>) => void;
  currency: string;
}) {
  const [open, setOpen] = useState(false);
  const [v, setV] = useState({
    basic_salary: payroll.basic_salary,
    housing_allowance: payroll.housing_allowance ?? 0,
    transport_allowance: payroll.transport_allowance ?? 0,
    other_allowances: payroll.other_allowances ?? 0,
    tax_deduction: payroll.tax_deduction ?? 0,
    pension_deduction: payroll.pension_deduction ?? 0,
    other_deductions: payroll.other_deductions ?? 0,
    loan_deduction: payroll.loan_deduction ?? 0,
  });
  const preview =
    v.basic_salary +
    v.housing_allowance +
    v.transport_allowance +
    v.other_allowances -
    v.tax_deduction -
    v.pension_deduction -
    v.other_deductions -
    v.loan_deduction;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        <Pencil className="w-3 h-3" />
      </Button>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Edit payroll</DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {Object.entries(v).map(([k, val]) => (
            <div key={k}>
              <Label className="capitalize text-xs">{k.replace(/_/g, " ")}</Label>
              <Input
                type="number"
                value={val}
                onChange={(e) => setV({ ...v, [k]: Number(e.target.value) })}
              />
            </div>
          ))}
        </div>
        <div className="text-sm">
          Net salary preview: <span className="font-semibold">{money(preview, currency)}</span>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>
            Cancel
          </Button>
          <Button
            onClick={() => {
              onSave(v);
              setOpen(false);
            }}
          >
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LeaveForm({
  staff,
  onSubmit,
  saving,
}: {
  staff: StaffUser[];
  onSubmit: (v: {
    user_id: string;
    leave_type: string;
    start_date: string;
    end_date: string;
    reason: string;
    notes: string;
  }) => void;
  saving: boolean;
}) {
  const [v, setV] = useState({
    user_id: "",
    leave_type: "annual",
    start_date: "",
    end_date: "",
    reason: "",
    notes: "",
  });
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!v.user_id) return;
        onSubmit(v);
      }}
      className="space-y-3"
    >
      <div>
        <Label>Staff</Label>
        <Select value={v.user_id} onValueChange={(x) => setV({ ...v, user_id: x })}>
          <SelectTrigger>
            <SelectValue placeholder="Select staff" />
          </SelectTrigger>
          <SelectContent>
            {staff.map((s) => (
              <SelectItem key={s.id} value={s.id}>
                {s.full_name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label>Type</Label>
        <Select value={v.leave_type} onValueChange={(x) => setV({ ...v, leave_type: x })}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {["annual", "sick", "maternity", "paternity", "study", "emergency", "unpaid"].map(
              (t) => (
                <SelectItem key={t} value={t} className="capitalize">
                  {t}
                </SelectItem>
              ),
            )}
          </SelectContent>
        </Select>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <Label>Start</Label>
          <Input
            type="date"
            value={v.start_date}
            onChange={(e) => setV({ ...v, start_date: e.target.value })}
            required
          />
        </div>
        <div>
          <Label>End</Label>
          <Input
            type="date"
            value={v.end_date}
            onChange={(e) => setV({ ...v, end_date: e.target.value })}
            required
          />
        </div>
      </div>
      <div>
        <Label>Reason</Label>
        <Textarea value={v.reason} onChange={(e) => setV({ ...v, reason: e.target.value })} />
      </div>
      <DialogFooter>
        <Button className="w-full sm:w-auto" type="submit" disabled={saving || !v.user_id}>
          Submit
        </Button>
      </DialogFooter>
    </form>
  );
}

function Payslip({
  staff,
  payroll,
  school,
  month,
  year,
  currency,
}: {
  staff: StaffUser | null;
  payroll: Payroll | null;
  school: School | null;
  month: number;
  year: number;
  currency: string;
}) {
  if (!staff) return <div className="p-6 text-sm text-muted-foreground">Staff not found.</div>;
  const earnings = [
    { label: "Basic salary", value: payroll?.basic_salary ?? staff.salary ?? 0 },
    { label: "Housing allowance", value: payroll?.housing_allowance ?? 0 },
    { label: "Transport allowance", value: payroll?.transport_allowance ?? 0 },
    { label: "Other allowances", value: payroll?.other_allowances ?? 0 },
  ];
  const deductions = [
    { label: "Tax (PAYE)", value: payroll?.tax_deduction ?? 0 },
    { label: "Pension", value: payroll?.pension_deduction ?? 0 },
    { label: "Loan repayment", value: payroll?.loan_deduction ?? 0 },
    { label: "Other deductions", value: payroll?.other_deductions ?? 0 },
  ];
  const gross = earnings.reduce((s, e) => s + (e.value || 0), 0);
  const totalDed = deductions.reduce((s, e) => s + (e.value || 0), 0);
  const net = payroll?.net_salary ?? gross - totalDed;
  return (
    <div className="bg-background text-foreground p-6 rounded-lg space-y-4 print:p-8">
      <div className="flex items-center gap-3 border-b pb-3">
        {school?.logo_url && (
          <img
            src={school.logo_url}
            alt=""
            width={48}
            height={48}
            loading="lazy"
            decoding="async"
            className="w-12 h-12 rounded object-cover"
          />
        )}
        <div>
          <div className="font-bold text-lg">{school?.name ?? "School"}</div>
          <div className="text-xs text-muted-foreground">
            Payslip · {monthNames[month - 1]} {year}
          </div>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3 text-sm">
        <div>
          <span className="text-muted-foreground">Employee:</span>{" "}
          <strong>{staff.full_name}</strong>
        </div>
        <div>
          <span className="text-muted-foreground">Role:</span>{" "}
          <span className="capitalize">{staff.role}</span>
        </div>
        <div>
          <span className="text-muted-foreground">Employment:</span> {staff.employment_type ?? "—"}
        </div>
        <div>
          <span className="text-muted-foreground">Status:</span> {payroll?.status ?? "draft"}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4">
        <div>
          <div className="text-xs font-semibold mb-1">EARNINGS</div>
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full text-sm">
              <tbody>
                {earnings.map((e) => (
                  <tr key={e.label} className="border-b">
                    <td className="py-1">{e.label}</td>
                    <td className="py-1 text-right">{money(e.value || 0, currency)}</td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="py-1">Gross</td>
                  <td className="py-1 text-right">{money(gross, currency)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
        <div>
          <div className="text-xs font-semibold mb-1">DEDUCTIONS</div>
          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full text-sm">
              <tbody>
                {deductions.map((e) => (
                  <tr key={e.label} className="border-b">
                    <td className="py-1">{e.label}</td>
                    <td className="py-1 text-right">{money(e.value || 0, currency)}</td>
                  </tr>
                ))}
                <tr className="font-semibold">
                  <td className="py-1">Total</td>
                  <td className="py-1 text-right">{money(totalDed, currency)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
      <div className="rounded-lg bg-primary/10 border border-primary/30 p-4 flex items-center justify-between">
        <div className="text-sm font-semibold">NET SALARY</div>
        <div className="text-2xl font-bold">{money(net, currency)}</div>
      </div>
      <div className="grid grid-cols-2 gap-6 pt-8 text-xs">
        <div className="border-t pt-2">Employee signature</div>
        <div className="border-t pt-2">Authorized signature</div>
      </div>
    </div>
  );
}

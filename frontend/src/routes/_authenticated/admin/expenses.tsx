/**
 * Admin Expenses Tracker — tier-gated CRUD + charts + budgets + CSV export.
 *
 * Tier: requires `expense_tracking`. Trial/starter see FeatureLockedCard.
 * Data: school_expenses (CRUD) + school_expense_budgets (read + form upsert).
 *
 * Layout:
 *   1) Header + actions (Export CSV / Add expense)
 *   2) 4 summary StatCards (month / year / top category / today)
 *   3) Charts row — monthly bars + category pie
 *   4) Filters bar (month, category, payment method, search, clear)
 *   5) Expenses table (desktop) / card list (mobile) + edit/delete
 *   6) Budget tracking with progress bars
 */
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { AlertTriangle, Download, Edit2, Plus, Search, Trash2, TrendingUp, X } from "lucide-react";
import {
  Bar,
  BarChart,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import {
  PortalPage,
  StatCard,
  SectionGrid,
  EmptyState,
  FeatureLockedCard,
} from "@/components/portal-shell";
import { SkeletonTable } from "@/components/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { isFeatureActive } from "@/lib/subscription-tiers";

export const Route = createFileRoute("/_authenticated/admin/expenses")({
  ssr: false,
  component: AdminExpensesPage,
});

const EXPENSE_CATEGORIES = [
  "Generator and Fuel",
  "School Bus Fuel",
  "School Bus Maintenance",
  "Building Maintenance",
  "Classroom Supplies",
  "Laboratory Supplies",
  "Sports Equipment",
  "Library Books",
  "Printing and Stationery",
  "Cleaning Supplies",
  "Electricity Bill",
  "Water Bill",
  "Internet and Connectivity",
  "Security Services",
  "Catering and Meals",
  "Event and Excursion",
  "Marketing and Advertising",
  "ICT Equipment",
  "Furniture and Fittings",
  "Medical Supplies",
  "Examination Fees",
  "Staff Welfare",
  "Other",
] as const;

const PAYMENT_METHODS = ["Cash", "Bank Transfer", "Card", "Cheque", "Other"] as const;
const RECURRING_FREQUENCIES = ["Weekly", "Monthly", "Quarterly", "Annual"] as const;

const PIE_COLORS = [
  "#0d9488",
  "#f59e0b",
  "#8b5cf6",
  "#ef4444",
  "#3b82f6",
  "#10b981",
  "#f97316",
  "#6b7280",
];

const CATEGORY_COLORS: Record<string, string> = EXPENSE_CATEGORIES.reduce(
  (acc, c, i) => ({ ...acc, [c]: PIE_COLORS[i % PIE_COLORS.length] }),
  {},
);

type Expense = {
  id: string;
  expense_title: string;
  expense_category: string;
  amount: number;
  currency: string | null;
  expense_date: string;
  vendor_name: string | null;
  payment_method: string | null;
  description: string | null;
  is_recurring: boolean | null;
  recurring_frequency: string | null;
};

type Budget = {
  id: string;
  category: string;
  monthly_budget: number;
  academic_year: string;
};

const naira = (n: number) => `₦${Number(n || 0).toLocaleString("en-NG")}`;
const nairaCents = (n: number) =>
  `₦${Number(n || 0).toLocaleString("en-NG", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const formatDate = (iso: string) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

function AdminExpensesPage() {
  const { school } = useApp();
  const qc = useQueryClient();
  const schoolId = school?.id ?? "";
  const tier = (school?.subscription_tier as string | null) ?? "trial";
  const activeFeatures = (school?.active_features as Record<string, unknown> | null) ?? null;
  const canExpenses = isFeatureActive(tier, activeFeatures, "expense_tracking");

  // Filters
  const now = new Date();
  const monthDefault = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [fMonth, setFMonth] = useState<string>(""); // "" = all
  const [fCategory, setFCategory] = useState<string>("all");
  const [fPayment, setFPayment] = useState<string>("all");
  const [fSearch, setFSearch] = useState<string>("");

  // Sheets / dialogs
  const [editing, setEditing] = useState<Expense | null>(null);
  const [deleting, setDeleting] = useState<Expense | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const expensesQ = useQuery<Expense[]>({
    queryKey: ["admin-expenses", schoolId],
    enabled: !!schoolId && canExpenses,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("school_expenses")
        .select(
          "id, expense_title, expense_category, amount, currency, expense_date, vendor_name, payment_method, description, is_recurring, recurring_frequency",
        )
        .eq("school_id", schoolId)
        .order("expense_date", { ascending: false })
        .limit(1000);
      if (error) throw new Error(error.message);
      return (data ?? []) as Expense[];
    },
  });

  const budgetsQ = useQuery<Budget[]>({
    queryKey: ["admin-expense-budgets", schoolId],
    enabled: !!schoolId && canExpenses,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("school_expense_budgets")
        .select("id, category, monthly_budget, academic_year")
        .eq("school_id", schoolId)
        .order("category");
      if (error) throw new Error(error.message);
      return (data ?? []) as Budget[];
    },
  });

  const rows = expensesQ.data ?? [];

  // ---- Filter ----
  const filtered = useMemo(() => {
    const q = fSearch.trim().toLowerCase();
    return rows.filter((r) => {
      if (fMonth && !r.expense_date.startsWith(fMonth)) return false;
      if (fCategory !== "all" && r.expense_category !== fCategory) return false;
      if (fPayment !== "all" && r.payment_method !== fPayment) return false;
      if (q) {
        const hay = `${r.expense_title} ${r.vendor_name ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, fMonth, fCategory, fPayment, fSearch]);

  // ---- Aggregates (always over full dataset for summary cards) ----
  const totals = useMemo(() => {
    const today = new Date().toISOString().slice(0, 10);
    const yearStart = `${now.getFullYear()}-01-01`;
    const monthStart = monthDefault;
    let monthTotal = 0,
      yearTotal = 0,
      todayTotal = 0;
    const byCat = new Map<string, number>();
    for (const r of rows) {
      const amt = Number(r.amount) || 0;
      if (r.expense_date >= yearStart) yearTotal += amt;
      if (r.expense_date.startsWith(monthStart)) monthTotal += amt;
      if (r.expense_date === today) todayTotal += amt;
      byCat.set(r.expense_category, (byCat.get(r.expense_category) ?? 0) + amt);
    }
    const top = [...byCat.entries()].sort((a, b) => b[1] - a[1])[0];
    return { monthTotal, yearTotal, todayTotal, topCategory: top };
  }, [rows, monthDefault, now]);

  // ---- Monthly bars (current year) ----
  const monthlyData = useMemo(() => {
    const yr = now.getFullYear();
    const months = [
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
    const data = months.map((m) => ({ month: m, amount: 0 }));
    for (const r of rows) {
      const d = new Date(r.expense_date);
      if (d.getFullYear() === yr) data[d.getMonth()].amount += Number(r.amount) || 0;
    }
    return data;
  }, [rows, now]);

  // ---- Category pie (top 7 + Other) ----
  const categoryData = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows)
      m.set(r.expense_category, (m.get(r.expense_category) ?? 0) + Number(r.amount));
    const sorted = [...m.entries()].sort((a, b) => b[1] - a[1]);
    const top = sorted.slice(0, 7);
    const restSum = sorted.slice(7).reduce((s, [, v]) => s + v, 0);
    const out = top.map(([name, value]) => ({ name, value }));
    if (restSum > 0) out.push({ name: "Other (rest)", value: restSum });
    return out;
  }, [rows]);

  // ---- Mutations ----
  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("school_expenses").delete().eq("id", id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Expense deleted");
      setDeleting(null);
      void qc.invalidateQueries({ queryKey: ["admin-expenses", schoolId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  function clearFilters() {
    setFMonth("");
    setFCategory("all");
    setFPayment("all");
    setFSearch("");
  }

  function exportCsv() {
    const headers = [
      "Date",
      "Title",
      "Category",
      "Vendor",
      "Amount",
      "Payment Method",
      "Description",
    ];
    const lines = [headers.join(",")];
    for (const r of filtered) {
      const cells = [
        r.expense_date,
        r.expense_title,
        r.expense_category,
        r.vendor_name ?? "",
        String(r.amount),
        r.payment_method ?? "",
        r.description ?? "",
      ].map((c) => `"${String(c).replace(/"/g, '""')}"`);
      lines.push(cells.join(","));
    }
    const blob = new Blob([lines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `expenses-${monthDefault}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    toast.success("CSV exported");
  }

  if (!canExpenses) {
    return (
      <PortalPage title="Expenses" subtitle="Track every naira spent by your school">
        <FeatureLockedCard
          featureName="Expense Tracker"
          requiredTier="Growth"
          description="Record school spending, manage category budgets, and export accountant-ready reports."
        />
      </PortalPage>
    );
  }

  const isLoading = expensesQ.isLoading;

  return (
    <PortalPage
      title="Expenses"
      subtitle="Track every naira spent by your school"
      actions={
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="outline" onClick={exportCsv} disabled={filtered.length === 0}>
            <Download className="mr-1.5 size-4" /> Export CSV
          </Button>
          <Sheet open={addOpen} onOpenChange={setAddOpen}>
            <SheetTrigger asChild>
              <Button size="sm">
                <Plus className="mr-1.5 size-4" /> Add expense
              </Button>
            </SheetTrigger>
            <ExpenseSheet
              key={addOpen ? "add-open" : "add-closed"}
              mode="create"
              schoolId={schoolId}
              onClose={() => setAddOpen(false)}
              onSaved={() => qc.invalidateQueries({ queryKey: ["admin-expenses", schoolId] })}
            />
          </Sheet>
        </div>
      }
    >
      {/* --- SECTION 2: Summary cards --- */}
      <SectionGrid>
        <StatCard label="This month" value={naira(totals.monthTotal)} isLoading={isLoading} />
        <StatCard label="This year" value={naira(totals.yearTotal)} isLoading={isLoading} />
        <StatCard
          label="Largest category"
          value={totals.topCategory?.[0] ?? "—"}
          hint={totals.topCategory ? naira(totals.topCategory[1]) : undefined}
          isLoading={isLoading}
        />
        <StatCard label="Today's spend" value={naira(totals.todayTotal)} isLoading={isLoading} />
      </SectionGrid>

      {/* --- SECTION 3: Charts --- */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="glass-card p-4">
          <h3 className="mb-3 font-display text-sm font-semibold text-[color:var(--text-secondary)]">
            Monthly spending ({now.getFullYear()})
          </h3>
          <ResponsiveContainer width="100%" height={240}>
            <BarChart data={monthlyData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <XAxis dataKey="month" stroke="#94a3b8" fontSize={11} />
              <YAxis
                stroke="#94a3b8"
                fontSize={11}
                tickFormatter={(v) => `₦${(v / 1000).toFixed(0)}k`}
              />
              <Tooltip
                cursor={{ fill: "rgba(255,255,255,0.05)" }}
                contentStyle={{
                  background: "#0f172a",
                  border: "1px solid #334155",
                  borderRadius: 8,
                  fontSize: 12,
                }}
                formatter={(v: number) => [naira(v), "Total"]}
                labelFormatter={(l) => `Month: ${l}`}
              />
              <Bar dataKey="amount" fill="#0d9488" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="glass-card p-4">
          <h3 className="mb-3 font-display text-sm font-semibold text-[color:var(--text-secondary)]">
            Category breakdown
          </h3>
          {categoryData.length === 0 ? (
            <div className="grid h-[240px] place-items-center text-sm text-[color:var(--text-muted)]">
              No expenses to break down yet.
            </div>
          ) : (
            <>
              <ResponsiveContainer width="100%" height={200}>
                <PieChart>
                  <Pie
                    data={categoryData}
                    dataKey="value"
                    nameKey="name"
                    outerRadius={80}
                    innerRadius={40}
                  >
                    {categoryData.map((_, i) => (
                      <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      background: "#0f172a",
                      border: "1px solid #334155",
                      borderRadius: 8,
                      fontSize: 12,
                    }}
                    formatter={(v: number, n) => [naira(v), n as string]}
                  />
                </PieChart>
              </ResponsiveContainer>
              <ul className="mt-2 grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
                {categoryData.map((c, i) => (
                  <li key={c.name} className="flex items-center justify-between gap-2">
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span
                        className="size-2.5 shrink-0 rounded-sm"
                        style={{ background: PIE_COLORS[i % PIE_COLORS.length] }}
                      />
                      <span className="truncate text-[color:var(--text-secondary)]">{c.name}</span>
                    </span>
                    <span className="font-mono tabular-nums text-[color:var(--text-muted)]">
                      {naira(c.value)}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      </div>

      {/* --- SECTION 4: Filters --- */}
      <div className="glass-card p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[140px]">
            <Label className="text-xs">Month</Label>
            <Input type="month" value={fMonth} onChange={(e) => setFMonth(e.target.value)} />
          </div>
          <div className="min-w-[180px]">
            <Label className="text-xs">Category</Label>
            <Select value={fCategory} onValueChange={setFCategory}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All categories</SelectItem>
                {EXPENSE_CATEGORIES.map((c) => (
                  <SelectItem key={c} value={c}>
                    {c}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[160px]">
            <Label className="text-xs">Payment method</Label>
            <Select value={fPayment} onValueChange={setFPayment}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All methods</SelectItem>
                {PAYMENT_METHODS.map((p) => (
                  <SelectItem key={p} value={p}>
                    {p}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-[200px] flex-1">
            <Label className="text-xs">Search title or vendor</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
              <Input
                value={fSearch}
                onChange={(e) => setFSearch(e.target.value)}
                placeholder="Generator, ABC Vendor…"
                className="pl-8"
              />
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={clearFilters}>
            <X className="mr-1 size-4" /> Clear
          </Button>
        </div>
      </div>

      {/* --- SECTION 5: Table / mobile cards --- */}
      <div className="glass-card p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg font-semibold">
            Expenses{" "}
            <span className="text-sm font-normal text-[color:var(--text-muted)]">
              ({filtered.length})
            </span>
          </h2>
        </div>
        {isLoading ? (
          <SkeletonTable rows={5} />
        ) : filtered.length === 0 ? (
          <EmptyState
            title="No expenses recorded yet"
            description="Add your first expense to start tracking school spending."
            action={
              <Button onClick={() => setAddOpen(true)}>
                <Plus className="mr-1.5 size-4" /> Add expense
              </Button>
            }
          />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden overflow-x-auto md:block">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                    <th className="p-2">Date</th>
                    <th className="p-2">Title</th>
                    <th className="p-2">Category</th>
                    <th className="p-2">Vendor</th>
                    <th className="p-2 text-right">Amount</th>
                    <th className="p-2">Payment</th>
                    <th className="p-2 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((r) => (
                    <tr key={r.id} className="border-b border-border/40 hover:bg-white/[0.02]">
                      <td className="p-2 whitespace-nowrap">{formatDate(r.expense_date)}</td>
                      <td className="p-2 font-medium">{r.expense_title}</td>
                      <td className="p-2">
                        <CategoryBadge category={r.expense_category} />
                      </td>
                      <td className="p-2 text-muted-foreground">{r.vendor_name ?? "—"}</td>
                      <td className="p-2 text-right font-mono tabular-nums">
                        {nairaCents(r.amount)}
                      </td>
                      <td className="p-2">
                        {r.payment_method ? (
                          <span className="rounded-md border border-border bg-muted/30 px-2 py-0.5 text-xs">
                            {r.payment_method}
                          </span>
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="p-2">
                        <div className="flex justify-end gap-1">
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => setEditing(r)}
                            aria-label="Edit expense"
                          >
                            <Edit2 className="size-4" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => setDeleting(r)}
                            aria-label="Delete expense"
                          >
                            <Trash2 className="size-4 text-red-400" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {/* Mobile card list */}
            <ul className="flex flex-col gap-2 md:hidden">
              {filtered.map((r) => (
                <li key={r.id} className="rounded-xl border border-border bg-muted/20 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs text-muted-foreground">
                        {formatDate(r.expense_date)}
                      </div>
                      <div className="truncate font-medium">{r.expense_title}</div>
                      <div className="mt-1">
                        <CategoryBadge category={r.expense_category} />
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-sm font-semibold">{nairaCents(r.amount)}</div>
                      <div className="mt-1 flex justify-end gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={() => setEditing(r)}
                          aria-label="Edit"
                        >
                          <Edit2 className="size-3.5" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={() => setDeleting(r)}
                          aria-label="Delete"
                        >
                          <Trash2 className="size-3.5 text-red-400" />
                        </Button>
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      {/* --- SECTION 6: Budget tracking --- */}
      <BudgetTracking budgets={budgetsQ.data ?? []} expenses={rows} />

      {/* Edit sheet */}
      <Sheet open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        {editing && (
          <ExpenseSheet
            key={editing.id}
            mode="edit"
            schoolId={schoolId}
            expense={editing}
            onClose={() => setEditing(null)}
            onSaved={() => qc.invalidateQueries({ queryKey: ["admin-expenses", schoolId] })}
          />
        )}
      </Sheet>

      {/* Delete confirm */}
      <AlertDialog open={!!deleting} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this expense record?</AlertDialogTitle>
            <AlertDialogDescription>This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleting && deleteMut.mutate(deleting.id)}
              disabled={deleteMut.isPending}
              className="bg-red-500 text-white hover:bg-red-600"
            >
              {deleteMut.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PortalPage>
  );
}

function CategoryBadge({ category }: { category: string }) {
  const color = CATEGORY_COLORS[category] ?? "#6b7280";
  return (
    <span
      className="inline-flex max-w-[180px] items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs"
      style={{ borderColor: `${color}55`, background: `${color}1a`, color }}
    >
      <span className="size-1.5 rounded-full" style={{ background: color }} />
      <span className="truncate">{category}</span>
    </span>
  );
}

/* ---------------- Add / Edit Sheet ---------------- */

function ExpenseSheet({
  mode,
  schoolId,
  expense,
  onClose,
  onSaved,
}: {
  mode: "create" | "edit";
  schoolId: string;
  expense?: Expense;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form, setForm] = useState({
    expense_title: expense?.expense_title ?? "",
    expense_category: expense?.expense_category ?? EXPENSE_CATEGORIES[0],
    amount: expense ? String(expense.amount) : "",
    expense_date: expense?.expense_date ?? new Date().toISOString().slice(0, 10),
    vendor_name: expense?.vendor_name ?? "",
    payment_method: expense?.payment_method ?? PAYMENT_METHODS[0],
    description: expense?.description ?? "",
    is_recurring: !!expense?.is_recurring,
    recurring_frequency: expense?.recurring_frequency ?? RECURRING_FREQUENCIES[1],
  });

  const save = useMutation({
    mutationFn: async () => {
      const title = form.expense_title.trim();
      const amt = Number(form.amount);
      if (!title) throw new Error("Title is required");
      if (!Number.isFinite(amt) || amt <= 0) throw new Error("Amount must be positive");
      const payload = {
        school_id: schoolId,
        expense_title: title,
        expense_category: form.expense_category,
        amount: amt,
        currency: "NGN",
        expense_date: form.expense_date,
        vendor_name: form.vendor_name.trim() || null,
        payment_method: form.payment_method,
        description: form.description.trim() || null,
        is_recurring: form.is_recurring,
        recurring_frequency: form.is_recurring ? form.recurring_frequency : null,
      };
      if (mode === "create") {
        const { data: auth } = await supabase.auth.getUser();
        const { error } = await supabase
          .from("school_expenses")
          .insert({ ...payload, created_by: auth.user?.id ?? null });
        if (error) throw new Error(error.message);
      } else {
        const { error } = await supabase
          .from("school_expenses")
          .update(payload)
          .eq("id", expense!.id);
        if (error) throw new Error(error.message);
      }
    },
    onSuccess: () => {
      toast.success(mode === "create" ? "Expense recorded" : "Expense updated");
      onSaved();
      onClose();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <SheetContent side="right" className="flex h-full w-full flex-col overflow-y-auto sm:max-w-md">
      <SheetHeader>
        <SheetTitle>{mode === "create" ? "Add expense" : "Edit expense"}</SheetTitle>
      </SheetHeader>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate();
        }}
        className="mt-4 flex flex-1 flex-col gap-3"
      >
        <div>
          <Label>
            Expense title <span className="text-red-400">*</span>
          </Label>
          <Input
            value={form.expense_title}
            onChange={(e) => setForm({ ...form, expense_title: e.target.value })}
            required
            maxLength={200}
          />
        </div>
        <div>
          <Label>Category</Label>
          <Select
            value={form.expense_category}
            onValueChange={(v) => setForm({ ...form, expense_category: v })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {EXPENSE_CATEGORIES.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <Label>Amount</Label>
            <div className="relative">
              <span className="pointer-events-none absolute left-2.5 top-2 text-sm text-muted-foreground">
                ₦
              </span>
              <Input
                type="number"
                min="0"
                step="0.01"
                value={form.amount}
                onChange={(e) => setForm({ ...form, amount: e.target.value })}
                required
                className="pl-6"
              />
            </div>
          </div>
          <div>
            <Label>Expense date</Label>
            <Input
              type="date"
              value={form.expense_date}
              onChange={(e) => setForm({ ...form, expense_date: e.target.value })}
              required
            />
          </div>
        </div>
        <div>
          <Label>
            Vendor / Supplier <span className="text-xs text-muted-foreground">(optional)</span>
          </Label>
          <Input
            value={form.vendor_name}
            onChange={(e) => setForm({ ...form, vendor_name: e.target.value })}
            maxLength={160}
          />
        </div>
        <div>
          <Label>Payment method</Label>
          <Select
            value={form.payment_method}
            onValueChange={(v) => setForm({ ...form, payment_method: v })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {PAYMENT_METHODS.map((p) => (
                <SelectItem key={p} value={p}>
                  {p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div>
          <Label>
            Description <span className="text-xs text-muted-foreground">(optional, max 500)</span>
          </Label>
          <Textarea
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value.slice(0, 500) })}
            rows={3}
            maxLength={500}
          />
        </div>
        <div className="flex items-center justify-between rounded-lg border border-border p-3">
          <div>
            <div className="text-sm font-medium">Recurring expense</div>
            <div className="text-xs text-muted-foreground">
              Mark if this expense repeats on a schedule.
            </div>
          </div>
          <Switch
            checked={form.is_recurring}
            onCheckedChange={(v) => setForm({ ...form, is_recurring: v })}
          />
        </div>
        {form.is_recurring && (
          <div>
            <Label>Frequency</Label>
            <Select
              value={form.recurring_frequency}
              onValueChange={(v) => setForm({ ...form, recurring_frequency: v })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RECURRING_FREQUENCIES.map((f) => (
                  <SelectItem key={f} value={f}>
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        <div className="mt-auto flex gap-2 pt-4">
          <Button type="button" variant="outline" className="flex-1" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" className="w-full sm:w-auto flex-1" disabled={save.isPending}>
            {save.isPending ? "Saving…" : mode === "create" ? "Save expense" : "Update expense"}
          </Button>
        </div>
      </form>
    </SheetContent>
  );
}

/* ---------------- Budget Tracking ---------------- */

function BudgetTracking({ budgets, expenses }: { budgets: Budget[]; expenses: Expense[] }) {
  const now = new Date();
  const monthPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;

  const actualByCategory = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of expenses) {
      if (!e.expense_date.startsWith(monthPrefix)) continue;
      m.set(e.expense_category, (m.get(e.expense_category) ?? 0) + Number(e.amount));
    }
    return m;
  }, [expenses, monthPrefix]);

  return (
    <div className="glass-card p-4">
      <div className="mb-3 flex items-center gap-2">
        <TrendingUp className="size-4 text-primary" />
        <h2 className="font-display text-lg font-semibold">Budget tracking</h2>
        <span className="text-xs text-muted-foreground">— {monthPrefix}</span>
      </div>
      {budgets.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Set monthly budgets in settings to track spending.
        </p>
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2">
          {budgets.map((b) => {
            const actual = actualByCategory.get(b.category) ?? 0;
            const pct = b.monthly_budget > 0 ? (actual / b.monthly_budget) * 100 : 0;
            const cappedPct = Math.min(100, pct);
            const tone = pct >= 100 ? "bg-red-500" : pct >= 80 ? "bg-amber-500" : "bg-emerald-500";
            const labelColor =
              pct >= 100 ? "text-red-300" : pct >= 80 ? "text-amber-300" : "text-emerald-300";
            return (
              <li key={b.id} className="rounded-xl border border-border bg-muted/20 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{b.category}</div>
                    <div className="text-xs text-muted-foreground">
                      {naira(actual)} of {naira(b.monthly_budget)} this month
                    </div>
                  </div>
                  <div className={`text-sm font-semibold ${labelColor}`}>
                    {pct.toFixed(0)}%
                    {pct >= 80 && pct < 100 && <AlertTriangle className="ml-1 inline size-3.5" />}
                  </div>
                </div>
                <div className="mt-2 h-2 overflow-hidden rounded-full bg-white/10">
                  <div
                    className={`h-full transition-all ${tone}`}
                    style={{ width: `${cappedPct}%` }}
                  />
                </div>
                {pct >= 100 && (
                  <div className="mt-1.5 inline-flex items-center gap-1 rounded-md bg-red-500/20 px-2 py-0.5 text-[11px] font-semibold text-red-300">
                    Over budget by {naira(actual - b.monthly_budget)}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

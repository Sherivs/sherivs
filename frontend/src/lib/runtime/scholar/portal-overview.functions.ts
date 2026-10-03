/**
 * CoreGrid — portal overview server reads (V1-011 placeholder-page disposition).
 *
 * The zero-state admin surfaces that covered REAL V1 capabilities read their
 * numbers through these server functions instead of rendering fabricated
 * statics. Every function:
 *   1. authenticates via `requireSupabaseAuth` (verified JWT, per-request client);
 *   2. authorizes through the neutral RBAC role-gate core — the
 *      `school_admin` gate kind resolves registry-first through
 *      `registerRuntimeRoleGate` (runtime contribution) and fails closed to
 *      the frozen legacy binding;
 *   3. resolves the tenant server-side (`get_my_school_id`) — never from the
 *      client (AGENTS §26);
 *   4. returns only permitted aggregates over existing, RLS-protected tables.
 *
 * No write path is exposed: the payroll processing, report generation and
 * export actions the old placeholder pages rendered as disabled buttons are
 * planned capability and are rendered as an honest planned-capability state,
 * not as fake controls.
 */
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { tokenMsRemaining } from "@/lib/auth-helpers";
import { requireSchoolAdminScope } from "@/lib/security-role-gate";
import { SystemClock, TimeAuthority } from "../../kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

/* ─────────────────────────────────────────────────────────────
 * Pure aggregation helpers (unit-tested; no I/O)
 * ────────────────────────────────────────────────────────────*/

export type FeeStatus = "unpaid" | "partial" | "paid";

export interface FeeAmountRow {
  amount: number | null;
  paid_amount: number | null;
  status: string | null;
}

export interface FeeTotals {
  billed: number;
  collected: number;
  outstanding: number;
  byStatus: Record<FeeStatus, number>;
  count: number;
}

const FEE_STATUSES: readonly FeeStatus[] = ["unpaid", "partial", "paid"];

function isFeeStatus(value: string | null): value is FeeStatus {
  return value !== null && (FEE_STATUSES as readonly string[]).includes(value);
}

/** Aggregate fee rows into billed/collected/outstanding/status counts. */
export function aggregateFeeRows(rows: readonly FeeAmountRow[]): FeeTotals {
  const byStatus: Record<FeeStatus, number> = { unpaid: 0, partial: 0, paid: 0 };
  let billed = 0;
  let collected = 0;
  let count = 0;
  for (const row of rows) {
    const amount = Number(row.amount) || 0;
    const paid = Number(row.paid_amount) || 0;
    billed += amount;
    collected += paid;
    if (isFeeStatus(row.status)) byStatus[row.status] += 1;
    count += 1;
  }
  return { billed, collected, outstanding: billed - collected, byStatus, count };
}

export interface ExpenseAmountRow {
  amount: number | null;
}

export interface ExpenseTotals {
  total: number;
  count: number;
}

/** Aggregate expense rows into a total and count. */
export function aggregateExpenseRows(rows: readonly ExpenseAmountRow[]): ExpenseTotals {
  let total = 0;
  for (const row of rows) total += Number(row.amount) || 0;
  return { total, count: rows.length };
}

export interface PayrollAmountRow {
  gross_salary: number | null;
  net_salary: number | null;
  status: string | null;
}

export interface PayrollTotals {
  payslipCount: number;
  grossTotal: number;
  netTotal: number;
  byStatus: { draft: number; approved: number; paid: number; other: number };
}

/** Aggregate payroll rows for one payroll period. */
export function aggregatePayrollRows(rows: readonly PayrollAmountRow[]): PayrollTotals {
  const byStatus = { draft: 0, approved: 0, paid: 0, other: 0 };
  let grossTotal = 0;
  let netTotal = 0;
  for (const row of rows) {
    grossTotal += Number(row.gross_salary) || 0;
    netTotal += Number(row.net_salary) || 0;
    const status = row.status ?? "other";
    if (status === "draft" || status === "approved" || status === "paid") byStatus[status] += 1;
    else byStatus.other += 1;
  }
  return { payslipCount: rows.length, grossTotal, netTotal, byStatus };
}

/* ─────────────────────────────────────────────────────────────
 * Lifecycle/session signals threaded to the gate (AGENTS §31)
 * ────────────────────────────────────────────────────────────*/

function gateSignals(claims: unknown): { lifecycle: null; sessionValid: boolean } {
  const exp = (claims as { exp?: number } | null | undefined)?.exp;
  return {
    // The JWT carries no lifecycle claim: flag the identity lifecycle
    // unverified (never silent) while attesting session validity from exp.
    lifecycle: null,
    sessionValid: typeof exp === "number" && tokenMsRemaining(exp) > 0,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Audit overview (route: /admin/audit) — audit_logs
 * ────────────────────────────────────────────────────────────*/

export type AuditOverview = {
  totalEvents: number;
  eventsToday: number;
  securityEvents: number;
  lastEventAt: string | null;
};

const SECURITY_EVENT_ACTIONS = [
  "password_reset_requested",
  "password_reset_completed",
  "login_failed",
  "login_succeeded",
] as const;

export const loadAuditOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<AuditOverview> => {
    const lifecycle = gateSignals(context.claims);
    const schoolId = await requireSchoolAdminScope(context.supabase, lifecycle);

    const today = timeAuthority.now().at.slice(0, 10);
    const [total, todayCount, security, last] = await Promise.all([
      context.supabase
        .from("audit_logs")
        .select("id", { count: "exact", head: true })
        .eq("school_id", schoolId),
      context.supabase
        .from("audit_logs")
        .select("id", { count: "exact", head: true })
        .eq("school_id", schoolId)
        .gte("created_at", today),
      context.supabase
        .from("audit_logs")
        .select("id", { count: "exact", head: true })
        .eq("school_id", schoolId)
        .in("action", [...SECURITY_EVENT_ACTIONS]),
      context.supabase
        .from("audit_logs")
        .select("created_at")
        .eq("school_id", schoolId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);

    if (total.error) throw new Error(total.error.message);
    if (todayCount.error) throw new Error(todayCount.error.message);
    if (security.error) throw new Error(security.error.message);
    if (last.error) throw new Error(last.error.message);

    return {
      totalEvents: total.count ?? 0,
      eventsToday: todayCount.count ?? 0,
      securityEvents: security.count ?? 0,
      lastEventAt: (last.data?.created_at as string | null) ?? null,
    };
  });

/* ─────────────────────────────────────────────────────────────
 * Payroll overview (route: /admin/payroll) — staff_payroll
 * ────────────────────────────────────────────────────────────*/

export type PayrollOverview = {
  period: { year: number; month: number };
  staffWithPayroll: number;
} & PayrollTotals;

export const loadPayrollOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<PayrollOverview> => {
    const lifecycle = gateSignals(context.claims);
    const schoolId = await requireSchoolAdminScope(context.supabase, lifecycle);

    const now = new Date(timeAuthority.now().atMs);
    const year = now.getFullYear();
    const month = now.getMonth() + 1;

    const rowsRes = await context.supabase
      .from("staff_payroll")
      .select("gross_salary, net_salary, status")
      .eq("school_id", schoolId)
      .eq("year", year)
      .eq("month", month);
    if (rowsRes.error) throw new Error(rowsRes.error.message);

    const staffRes = await context.supabase
      .from("staff_payroll")
      .select("user_id")
      .eq("school_id", schoolId)
      .eq("year", year);
    if (staffRes.error) throw new Error(staffRes.error.message);

    const staffIds = new Set(
      ((staffRes.data ?? []) as { user_id: string | null }[])
        .map((r) => r.user_id)
        .filter((u): u is string => u !== null),
    );

    return {
      period: { year, month },
      staffWithPayroll: staffIds.size,
      ...aggregatePayrollRows((rowsRes.data ?? []) as PayrollAmountRow[]),
    };
  });

/* ─────────────────────────────────────────────────────────────
 * Financial reports overview (route: /admin/financial-reports)
 * — fees + school_expenses
 * ────────────────────────────────────────────────────────────*/

export type FinancialReportsOverview = {
  fees: FeeTotals;
  expenses: ExpenseTotals;
};

export const loadFinancialReportsOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<FinancialReportsOverview> => {
    const lifecycle = gateSignals(context.claims);
    const schoolId = await requireSchoolAdminScope(context.supabase, lifecycle);

    const [feesRes, expensesRes] = await Promise.all([
      context.supabase.from("fees").select("amount, paid_amount, status").eq("school_id", schoolId),
      context.supabase.from("school_expenses").select("amount").eq("school_id", schoolId),
    ]);
    if (feesRes.error) throw new Error(feesRes.error.message);
    if (expensesRes.error) throw new Error(expensesRes.error.message);

    return {
      fees: aggregateFeeRows((feesRes.data ?? []) as FeeAmountRow[]),
      expenses: aggregateExpenseRows((expensesRes.data ?? []) as ExpenseAmountRow[]),
    };
  });

/* ─────────────────────────────────────────────────────────────
 * Extracurricular overview (route: /admin/extracurricular)
 * — school_sports
 * ────────────────────────────────────────────────────────────*/

export interface SportsProgramRow {
  sport_name: string;
  sport_category: string | null;
  coach_name: string | null;
  is_active: boolean | null;
}

export interface ExtracurricularOverview {
  totalPrograms: number;
  activePrograms: number;
  byCategory: { category: string; count: number }[];
  programs: SportsProgramRow[];
}

/** Aggregate sports-program rows into counts and a category breakdown. */
export function aggregateSportsPrograms(
  rows: readonly SportsProgramRow[],
): Omit<ExtracurricularOverview, "programs"> {
  const byCategory = new Map<string, number>();
  let active = 0;
  for (const row of rows) {
    if (row.is_active) active += 1;
    const category = row.sport_category?.trim() || "Uncategorized";
    byCategory.set(category, (byCategory.get(category) ?? 0) + 1);
  }
  return {
    totalPrograms: rows.length,
    activePrograms: active,
    byCategory: [...byCategory.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => b.count - a.count),
  };
}

export const loadExtracurricularOverview = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<ExtracurricularOverview> => {
    const lifecycle = gateSignals(context.claims);
    const schoolId = await requireSchoolAdminScope(context.supabase, lifecycle);

    const { data, error } = await context.supabase
      .from("school_sports")
      .select("sport_name, sport_category, coach_name, is_active")
      .eq("school_id", schoolId)
      .order("sport_name");
    if (error) throw new Error(error.message);

    const programs = (data ?? []) as SportsProgramRow[];
    return { programs, ...aggregateSportsPrograms(programs) };
  });

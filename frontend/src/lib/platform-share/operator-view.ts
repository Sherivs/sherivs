/**
 * PSA-01 operator view (ADR-162): pure parsing and arithmetic over the rows returned by
 * `platform_share_collections` and `platform_share_student_list`. No I/O. Nothing here invents
 * a number: a row that is not in the expected shape is dropped and counted, not guessed at.
 */

export interface SchoolCollection {
  schoolId: string;
  enrolledActive: number;
  accrued: number;
  accruedAmount: number;
  collectedOnline: number;
  collectedWalletCash: number;
  collectedWalletAuto: number;
  waived: number;
  pending: number;
  overdue: number;
  overdueAmount: number;
  /** Students with a recorded payment whose Sherivs share has not been taken. */
  paidShareNotTaken: number;
  walletBalance: number;
  /** Overdue amount the wallet cannot cover today. */
  walletCoverGap: number;
}

export interface StudentShareRow {
  studentId: string;
  channel: "online" | "wallet_cash" | "wallet_auto" | "waived" | "pending" | "other";
  amount: number;
  hasRecordedPayment: boolean;
  overdue: boolean;
}

export interface CollectionsView {
  schools: SchoolCollection[];
  dropped: number;
  totals: Omit<SchoolCollection, "schoolId">;
  /** Collected students as a share of accrued, 0..1; null when nothing has accrued. */
  collectionRate: number | null;
}

const NUM_KEYS = [
  "enrolled_active",
  "accrued",
  "accrued_amount",
  "collected_online",
  "collected_wallet_cash",
  "collected_wallet_auto",
  "waived",
  "pending",
  "overdue",
  "overdue_amount",
  "paid_share_not_taken",
  "wallet_balance",
  "wallet_cover_gap",
] as const;

/** Postgres returns bigint and numeric as strings through PostgREST; accept both. */
function num(v: unknown): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function parseCollectionRow(raw: unknown): SchoolCollection | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.school_id !== "string" || r.school_id === "") return null;
  const n: Record<string, number> = {};
  for (const k of NUM_KEYS) {
    const v = num(r[k]);
    if (v === null) return null;
    n[k] = v;
  }
  return {
    schoolId: r.school_id,
    enrolledActive: n.enrolled_active!,
    accrued: n.accrued!,
    accruedAmount: n.accrued_amount!,
    collectedOnline: n.collected_online!,
    collectedWalletCash: n.collected_wallet_cash!,
    collectedWalletAuto: n.collected_wallet_auto!,
    waived: n.waived!,
    pending: n.pending!,
    overdue: n.overdue!,
    overdueAmount: n.overdue_amount!,
    paidShareNotTaken: n.paid_share_not_taken!,
    walletBalance: n.wallet_balance!,
    walletCoverGap: n.wallet_cover_gap!,
  };
}

export const collectedCount = (s: Pick<SchoolCollection, "collectedOnline" | "collectedWalletCash" | "collectedWalletAuto">) =>
  s.collectedOnline + s.collectedWalletCash + s.collectedWalletAuto;

export function buildCollectionsView(data: unknown): CollectionsView {
  const list = Array.isArray(data) ? data : [];
  const schools: SchoolCollection[] = [];
  let dropped = 0;
  for (const raw of list) {
    const row = parseCollectionRow(raw);
    if (row) schools.push(row);
    else dropped += 1;
  }
  const totals = {
    enrolledActive: 0, accrued: 0, accruedAmount: 0, collectedOnline: 0, collectedWalletCash: 0,
    collectedWalletAuto: 0, waived: 0, pending: 0, overdue: 0, overdueAmount: 0,
    paidShareNotTaken: 0, walletBalance: 0, walletCoverGap: 0,
  };
  for (const s of schools) {
    for (const k of Object.keys(totals) as (keyof typeof totals)[]) totals[k] += s[k];
  }
  const collected = collectedCount(totals);
  return {
    schools,
    dropped,
    totals,
    collectionRate: totals.accrued > 0 ? collected / totals.accrued : null,
  };
}

/** Schools that need attention first: share paid for but not taken, then largest uncovered gap. */
export function attentionOrder(schools: SchoolCollection[]): SchoolCollection[] {
  return [...schools].sort(
    (a, b) =>
      b.paidShareNotTaken - a.paidShareNotTaken ||
      b.walletCoverGap - a.walletCoverGap ||
      b.overdueAmount - a.overdueAmount ||
      a.schoolId.localeCompare(b.schoolId),
  );
}

const CHANNELS = new Set(["online", "wallet_cash", "wallet_auto", "waived", "pending"]);

export function parseStudentRow(raw: unknown): StudentShareRow | null {
  if (typeof raw !== "object" || raw === null) return null;
  const r = raw as Record<string, unknown>;
  const amount = num(r.amount);
  if (typeof r.student_id !== "string" || r.student_id === "" || amount === null) return null;
  const ch = typeof r.channel === "string" ? r.channel : "";
  return {
    studentId: r.student_id,
    channel: (CHANNELS.has(ch) ? ch : "other") as StudentShareRow["channel"],
    amount,
    hasRecordedPayment: r.has_recorded_payment === true,
    overdue: r.overdue === true,
  };
}

export interface StudentListView {
  rows: StudentShareRow[];
  dropped: number;
  /** Paid at the school but the share is not taken: the case the operator must chase. */
  paidShareNotTaken: StudentShareRow[];
  truncated: boolean;
}

export function buildStudentListView(data: unknown, limit: number): StudentListView {
  const list = Array.isArray(data) ? data : [];
  const rows: StudentShareRow[] = [];
  let dropped = 0;
  for (const raw of list) {
    const row = parseStudentRow(raw);
    if (row) rows.push(row);
    else dropped += 1;
  }
  return {
    rows,
    dropped,
    paidShareNotTaken: rows.filter(
      (r) => r.hasRecordedPayment && (r.channel === "pending" || r.channel === "other"),
    ),
    truncated: list.length >= limit,
  };
}

export type ScopeCheck = { ok: true; year: string; term: string } | { ok: false; reason: string };

/** The year and term are free text in the database, so only shape and length are checked here. */
export function checkScope(year: string, term: string): ScopeCheck {
  const y = year.trim();
  const t = term.trim();
  if (y.length < 4 || y.length > 20) return { ok: false, reason: "Enter the academic year, for example 2026/2027." };
  if (t.length < 1 || t.length > 20) return { ok: false, reason: "Enter the term, for example First." };
  return { ok: true, year: y, term: t };
}

/** Whole naira with grouping; the ledger stores naira, not kobo. */
export function formatNaira(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}₦${Math.abs(Math.round(n)).toLocaleString("en-NG")}`;
}

export const formatPercent = (rate: number | null): string =>
  rate === null ? "n/a" : `${Math.round(rate * 100)}%`;

/** Error text safe to show: permission failures are named, everything else is generic. */
export function describeRpcError(message: string): string {
  if (/not allowed|42501|permission denied/i.test(message)) {
    return "This view is for Sherivs platform operators only.";
  }
  return "The report could not be loaded. Try again; nothing was changed.";
}

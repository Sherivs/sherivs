/** PSA-01 operator view core (ADR-162): parsing, totals, ordering and error wording. */
import { describe, expect, it } from "vitest";
import {
  attentionOrder,
  buildCollectionsView,
  buildStudentListView,
  checkScope,
  collectedCount,
  describeRpcError,
  formatNaira,
  formatPercent,
  parseCollectionRow,
} from "../../frontend/src/lib/platform-share/operator-view";

const row = (over: Record<string, unknown> = {}) => ({
  school_id: "s1", enrolled_active: "100", accrued: "100", accrued_amount: "50000.00",
  collected_online: "40", collected_wallet_cash: "10", collected_wallet_auto: "5", waived: "5",
  pending: "40", overdue: "20", overdue_amount: "10000", paid_share_not_taken: "3",
  wallet_balance: "4000", wallet_cover_gap: "6000", ...over,
});

describe("collections parsing", () => {
  it("reads bigint and numeric strings from PostgREST", () => {
    const r = parseCollectionRow(row());
    expect(r).toMatchObject({ schoolId: "s1", accrued: 100, accruedAmount: 50000, overdueAmount: 10000 });
    expect(collectedCount(r!)).toBe(55);
  });
  it("drops and counts rows that are not in shape instead of guessing", () => {
    const v = buildCollectionsView([row(), row({ school_id: "" }), row({ overdue: "abc" }), null, "x"]);
    expect(v.schools).toHaveLength(1);
    expect(v.dropped).toBe(4);
  });
  it("treats a non-array as an empty report", () => {
    expect(buildCollectionsView(null)).toMatchObject({ schools: [], dropped: 0, collectionRate: null });
  });
  it("totals across schools and computes the collection rate", () => {
    const v = buildCollectionsView([row(), row({ school_id: "s2", accrued: "100", collected_online: "0", collected_wallet_cash: "0", collected_wallet_auto: "0" })]);
    expect(v.totals.accrued).toBe(200);
    expect(v.totals.overdueAmount).toBe(20000);
    expect(v.collectionRate).toBeCloseTo(55 / 200);
  });
});

describe("attention order", () => {
  it("puts schools with paid-but-not-taken shares first, then the biggest uncovered gap", () => {
    const a = parseCollectionRow(row({ school_id: "a", paid_share_not_taken: "0", wallet_cover_gap: "9000" }))!;
    const b = parseCollectionRow(row({ school_id: "b", paid_share_not_taken: "7", wallet_cover_gap: "0" }))!;
    const c = parseCollectionRow(row({ school_id: "c", paid_share_not_taken: "0", wallet_cover_gap: "100" }))!;
    expect(attentionOrder([a, c, b]).map((s) => s.schoolId)).toEqual(["b", "a", "c"]);
  });
  it("does not mutate its input", () => {
    const list = [parseCollectionRow(row({ school_id: "z" }))!, parseCollectionRow(row({ school_id: "y", paid_share_not_taken: "9" }))!];
    attentionOrder(list);
    expect(list.map((s) => s.schoolId)).toEqual(["z", "y"]);
  });
});

describe("student list", () => {
  const stu = (over: Record<string, unknown> = {}) => ({
    student_id: "u1", channel: "pending", amount: "500", has_recorded_payment: true, overdue: true, ...over,
  });
  it("finds students who paid at the school with the share not taken", () => {
    const v = buildStudentListView([stu(), stu({ student_id: "u2", channel: "online" }), stu({ student_id: "u3", has_recorded_payment: false })], 1000);
    expect(v.paidShareNotTaken.map((r) => r.studentId)).toEqual(["u1"]);
    expect(v.truncated).toBe(false);
  });
  it("maps unknown channels to other and flags truncation at the limit", () => {
    const v = buildStudentListView([stu({ channel: "mystery" }), stu({ student_id: "u2" })], 2);
    expect(v.rows[0]!.channel).toBe("other");
    expect(v.truncated).toBe(true);
  });
  it("drops rows with no id or amount", () => {
    expect(buildStudentListView([{ channel: "pending" }, stu({ amount: null })], 10).dropped).toBe(2);
  });
});

describe("scope and wording", () => {
  it("requires a plausible year and term", () => {
    expect(checkScope(" 2026/2027 ", " First ")).toEqual({ ok: true, year: "2026/2027", term: "First" });
    expect(checkScope("", "First").ok).toBe(false);
    expect(checkScope("2026/2027", "").ok).toBe(false);
  });
  it("formats naira and percentages", () => {
    expect(formatNaira(1234567.4)).toBe("₦1,234,567");
    expect(formatNaira(-500)).toBe("-₦500");
    expect(formatPercent(0.275)).toBe("28%");
    expect(formatPercent(null)).toBe("n/a");
  });
  it("names a permission refusal and hides every other database message", () => {
    expect(describeRpcError("not allowed")).toMatch(/operators only/);
    expect(describeRpcError("relation public.x does not exist")).not.toMatch(/relation/);
  });
});

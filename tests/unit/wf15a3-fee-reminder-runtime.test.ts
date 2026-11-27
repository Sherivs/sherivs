import { describe, expect, it, vi } from "vitest";
import { createFeeReminderScanHandler } from "../../frontend/src/routes/api/public/cron/workflow-fee-reminders";
import {
  formatDueDate,
  formatNaira,
  renderFeeMessage,
} from "../../frontend/src/lib/runtime/scholar/workflow-packs/fee-message-render";

const env = { CRON_SECRET: "s3cret-value", WORKFLOWS_ENABLED: "true" };
const req = (auth?: string) =>
  new Request("https://x.invalid/", { headers: auth ? { authorization: auth } : {} });
const GOOD = {
  guardian: "Amina",
  student: "Fatima",
  school: "Bright Future School",
  amount: "NGN 85,000",
  balance: "NGN 85,000",
  due_date: "4 Dec 2026",
  pay_link: "https://pay.sherivs.com/abc123",
};

describe("fee reminder scan route", () => {
  it("refuses with no secret configured, no header and a wrong header", async () => {
    expect((await createFeeReminderScanHandler({ env: {} })(req("Bearer x"))).status).toBe(503);
    expect((await createFeeReminderScanHandler({ env })(req())).status).toBe(401);
    expect((await createFeeReminderScanHandler({ env })(req("Bearer nope"))).status).toBe(401);
  });
  it("does nothing while workflows are disabled and never calls the scanner", async () => {
    const scan = vi.fn();
    const res = await createFeeReminderScanHandler({
      env: { CRON_SECRET: "a", WORKFLOWS_ENABLED: "false" },
      scan,
    })(req("Bearer a"));
    expect(await res.json()).toEqual({ ok: true, skipped: "workflows_disabled" });
    expect(scan).not.toHaveBeenCalled();
  });
  it("returns counts only, with the fixed limit", async () => {
    const scan = vi
      .fn()
      .mockResolvedValue({ scanned: 4, emitted: 3, skipped_paid: 1, org: "leak", invoice: "leak" });
    const res = await createFeeReminderScanHandler({ env, scan })(req("Bearer s3cret-value"));
    expect(await res.json()).toEqual({ ok: true, scanned: 4, emitted: 3, skipped_paid: 1 });
    expect(scan).toHaveBeenCalledWith(500);
  });
  it("hides the failure reason", async () => {
    const scan = vi.fn().mockRejectedValue(new Error("secret db detail"));
    const res = await createFeeReminderScanHandler({ env, scan })(req("Bearer s3cret-value"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ ok: false, error: "fee_reminder_scan_failed" });
  });
});

describe("fee message renderer", () => {
  it("renders an SMS with every variable filled and the STOP wording", () => {
    const r = renderFeeMessage("ps.fee.due_day.sms", GOOD);
    expect(r).toMatchObject({ ok: true, channel: "sms" });
    if (r.ok) {
      expect(r.text).toContain("NGN 85,000");
      expect(r.text).toContain("Reply STOP");
      expect(r.text).not.toContain("{{");
    }
  });
  it("gives WhatsApp the body parameters in Meta order and only the link token for the button", () => {
    const r = renderFeeMessage("ps.fee.due_day.whatsapp", GOOD);
    expect(r.ok && r.whatsappParams).toEqual([
      "Amina",
      "NGN 85,000",
      "Fatima",
      "Bright Future School",
      "4 Dec 2026",
      "abc123",
    ]);
  });
  it("refuses a missing, empty, oversized or injected value", () => {
    expect(renderFeeMessage("ps.fee.due_day.sms", { ...GOOD, student: undefined })).toEqual({
      ok: false,
      error: "missing_student",
    });
    expect(renderFeeMessage("ps.fee.due_day.sms", { ...GOOD, student: "  " })).toEqual({
      ok: false,
      error: "missing_student",
    });
    expect(renderFeeMessage("ps.fee.due_day.sms", { ...GOOD, student: "x".repeat(121) })).toEqual({
      ok: false,
      error: "unsafe_student",
    });
    expect(renderFeeMessage("ps.fee.due_day.sms", { ...GOOD, student: "{{pay_link}}" })).toEqual({
      ok: false,
      error: "unsafe_student",
    });
    expect(
      renderFeeMessage("ps.fee.due_day.sms", { ...GOOD, school: "Visit http://evil.example" }),
    ).toEqual({ ok: false, error: "unsafe_school" });
    expect(
      renderFeeMessage("ps.fee.due_day.sms", { ...GOOD, guardian: "a\nb", school: "ok" }).ok,
    ).toBe(true);
  });
  it("accepts only an https pay link on a plain path", () => {
    for (const bad of [
      "http://pay.sherivs.com/abc",
      "https://pay.sherivs.com/abc?x=1",
      "javascript:alert(1)",
      "https://pay.sherivs.com/",
    ])
      expect(renderFeeMessage("ps.fee.due_day.sms", { ...GOOD, pay_link: bad })).toEqual({
        ok: false,
        error: "unsafe_pay_link",
      });
  });
  it("refuses an unknown template and an SMS that grows past two segments", () => {
    expect(renderFeeMessage("ps.fee.nope", GOOD)).toEqual({ ok: false, error: "unknown_template" });
    const long = {
      ...GOOD,
      school: "S".repeat(120),
      student: "T".repeat(120),
      balance: "B".repeat(120),
    };
    expect(renderFeeMessage("ps.fee.overdue.sms", long)).toEqual({
      ok: false,
      error: "sms_too_long",
    });
  });
  it("formats kobo and dates strictly", () => {
    expect(formatNaira(8_500_000)).toBe("NGN 85,000");
    expect(formatNaira(8_500_099)).toBe("NGN 85,000");
    expect(() => formatNaira(-1)).toThrow();
    expect(() => formatNaira(1.5)).toThrow();
    expect(formatDueDate("2026-12-04")).toBe("4 Dec 2026");
    expect(() => formatDueDate("2026-13-04")).toThrow();
    expect(() => formatDueDate("04/12/2026")).toThrow();
  });
});

import { describe, expect, it } from "vitest";
import { CONSENT_PURPOSES, delegationWindowOk } from "@/lib/safeguards";

describe("SHERIVS-B04 safeguards", () => {
  const now = new Date("2026-10-25T08:00:00Z");
  const days = (n: number) => new Date(now.getTime() + n * 86_400_000);
  it("bounds delegation windows like the database", () => {
    expect(delegationWindowOk(now, days(7), now)).toBe(true);
    expect(delegationWindowOk(now, days(30), now)).toBe(true);
    expect(delegationWindowOk(now, days(31), now)).toBe(false);
    expect(delegationWindowOk(now, now, now)).toBe(false);
    expect(delegationWindowOk(days(-1), days(2), now)).toBe(false);
  });
  it("only optional purposes are offered (core education is not consent-based)", () => {
    expect(CONSENT_PURPOSES.map(([k]) => k)).toEqual(["photos_media", "ai_processing", "messaging_sms_whatsapp"]);
  });
});

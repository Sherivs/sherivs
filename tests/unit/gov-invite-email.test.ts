import { describe, expect, it } from "vitest";
import { buildInviteEmail, inviteLink, mapEmailOutcome, safeOrigin } from "@/lib/gov/invite-email";

const ctx = { invite_id: "i1", email: "o@moe.gov.ng", agency_role: "planning_officer", expires_at: "2026-11-01T00:00:00Z", jurisdiction: "Borno MoE", host_label: "borno", now: "2026-10-25T00:00:00Z" };

describe("SHERIVS-B07 invite email", () => {
  it("accepts only https (or localhost) bare origins", () => {
    expect(safeOrigin("https://borno.gov.sherivs.com")).toBe("https://borno.gov.sherivs.com");
    expect(safeOrigin("http://localhost:3000")).toBe("http://localhost:3000");
    expect(safeOrigin("http://evil.example")).toBeNull();
    expect(safeOrigin("javascript:alert(1)")).toBeNull();
    expect(safeOrigin("https://a.com/path")).toBeNull();
    expect(safeOrigin("https://u:p@a.com")).toBeNull();
  });
  it("builds the email with link, role and expiry", () => {
    const m = buildInviteEmail(ctx, inviteLink("https://x.com", "ab12"));
    expect(m.subject).toContain("Borno MoE");
    expect(m.body).toContain("https://x.com/gov-invite?token=ab12");
    expect(m.body).toContain("planning officer");
    expect(m.body).toContain("2026-11-01");
  });
  it("maps adapter outcomes; no provider means stubbed", () => {
    expect(mapEmailOutcome({ providerMessageId: "re_1" }).status).toBe("sent");
    expect(mapEmailOutcome({ outcome: "undeliverable", code: "provider_not_configured" }).status).toBe("stubbed");
    expect(mapEmailOutcome({ outcome: "failed", code: "provider_error" }).status).toBe("failed");
  });
});

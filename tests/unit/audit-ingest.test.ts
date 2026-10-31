import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { auditEventRequiresSession, bindAuditActor } from "@/lib/security/audit-ingest";
import { isCloudflarePeer } from "@/lib/security/request-safety";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (path: string) => readFileSync(join(ROOT, path), "utf8");

describe("audit ingest identity", () => {
  it("refuses session-bound events that have no verified caller", () => {
    expect(auditEventRequiresSession("login_succeeded")).toBe(true);
    expect(auditEventRequiresSession("password_reset_completed")).toBe(true);
    expect(auditEventRequiresSession("login_failed")).toBe(false);
    expect(
      bindAuditActor({
        event: "login_succeeded",
        verified: null,
        claimedEmail: "victim@school.test",
        directory: { userId: "00000000-0000-4000-8000-000000000001", schoolId: "school" },
      }),
    ).toBeNull();
  });

  it("names a successful login after the verified subject, not the claimed email or user id", () => {
    expect(
      bindAuditActor({
        event: "login_succeeded",
        verified: { userId: "user-a", email: "a@school.test" },
        claimedEmail: "victim@school.test",
        directory: { userId: "user-b", schoolId: "other-school" },
      }),
    ).toEqual({ userId: "user-a", schoolId: null, email: "a@school.test" });
  });

  it("keeps a password-reset request tied to the directory row for that email", () => {
    expect(
      bindAuditActor({
        event: "password_reset_requested",
        verified: null,
        claimedEmail: "a@school.test",
        directory: { userId: "user-a", schoolId: "school-a" },
      }),
    ).toEqual({ userId: "user-a", schoolId: "school-a", email: "a@school.test" });
  });

  it("does not attach a directory identity to a client-asserted login failure", () => {
    expect(
      bindAuditActor({
        event: "login_failed",
        verified: { userId: "user-a", email: "a@school.test" },
        claimedEmail: "victim@school.test",
        directory: { userId: "user-victim", schoolId: "school" },
      }),
    ).toEqual({ userId: null, schoolId: null, email: "victim@school.test" });
  });

  it("the route verifies a bearer token before it writes a session-bound event", () => {
    const src = read("frontend/src/routes/api/public/audit.password-reset.ts");
    expect(src.indexOf("checkPublicRateLimit(")).toBeLessThan(src.indexOf("supabaseAdmin"));
    expect(src.indexOf("verifiedAuditUser(")).toBeLessThan(src.indexOf("supabaseAdmin"));
    expect(src).toContain("auditEventRequiresSession");
    expect(src).toContain("bindAuditActor");
    expect(src).not.toContain("parsed.user_id");
    expect(src).not.toContain("user_id: parsed");
    expect(src).toContain("user_id: actor.userId");
    expect(src).not.toMatch(/Date\.now\s*\(/);
  });
});

describe("Cloudflare peer classification", () => {
  it("accepts published Cloudflare ranges and rejects other addresses", () => {
    expect(isCloudflarePeer("104.16.1.1")).toBe(true);
    expect(isCloudflarePeer("104.24.1.1")).toBe(true);
    expect(isCloudflarePeer("104.15.255.255")).toBe(false);
    expect(isCloudflarePeer("203.0.113.10")).toBe(false);
    expect(isCloudflarePeer("2606:4700:1::1")).toBe(true);
    expect(isCloudflarePeer("2001:4860:4860::8888")).toBe(false);
  });
});

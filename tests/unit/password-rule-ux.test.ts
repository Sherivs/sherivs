import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  PASSWORD_MIN_LENGTH,
  PASSWORD_RULE_SUMMARY,
  passwordPolicyError,
} from "@/lib/security/password-policy";
import { newPasswordError } from "@/lib/security/password-strength";
import { newPasswordServerMessage } from "@/lib/security/auth-feedback";

describe("password rule: 10+ chars, upper, lower, digit (matches Supabase Auth)", () => {
  it("rejects each missing class and short passwords", () => {
    expect(PASSWORD_MIN_LENGTH).toBe(10);
    expect(passwordPolicyError("Abcdefgh1")).toMatch(/at least 10/);
    expect(passwordPolicyError("abcdefghi1")).toMatch(/uppercase/);
    expect(passwordPolicyError("ABCDEFGHI1")).toMatch(/lowercase/);
    expect(passwordPolicyError("Abcdefghij")).toMatch(/digit/);
    expect(passwordPolicyError("Tqv7mWz2pLk")).toBeNull();
    expect(newPasswordError("Tqv7mWz2pLk")).toBeNull();
  });

  it("explains the rule in plain words, including on a server weak_password error", () => {
    expect(PASSWORD_RULE_SUMMARY).toMatch(/10 characters.*uppercase.*lowercase.*number/);
    const msg = newPasswordServerMessage({ code: "weak_password", message: "x" });
    expect(msg).toContain(PASSWORD_RULE_SUMMARY);
  });

  it("signup, reset and change-password forms all validate with the shared rule and show it", () => {
    for (const f of [
      "frontend/src/routes/auth.tsx",
      "frontend/src/routes/reset-password.tsx",
    ]) {
      const src = readFileSync(f, "utf8");
      expect(src, f).toContain("newPasswordError(");
      expect(src, f).toContain("<PasswordStrengthMeter");
      expect(src, f).toContain("newPasswordServerMessage(");
    }
    expect(
      readFileSync("frontend/src/components/security/password-strength-meter.tsx", "utf8"),
    ).toContain("PASSWORD_RULE_SUMMARY");
  });
});

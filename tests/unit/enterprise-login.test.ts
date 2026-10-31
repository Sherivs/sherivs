import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  ACCOUNT_INVITATION_COPY,
  SIGN_IN_IDENTIFIER_PLACEHOLDER,
} from "../../frontend/src/lib/auth/organization-access";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("enterprise login layout", () => {
  it("uses one identity field, invitation copy, Turnstile, and a visible Sign in button", () => {
    const fields = read("frontend/src/components/auth/enterprise-login-fields.tsx");
    const entry = read("frontend/src/components/app-entry/app-entry-screen.tsx");
    const auth = read("frontend/src/routes/auth.tsx");
    expect(fields).toContain(SIGN_IN_IDENTIFIER_PLACEHOLDER);
    expect(fields).toContain('autoComplete="username"');
    expect(fields).not.toContain("webauthn");
    expect(fields).toContain("Forgot password?");
    expect(fields).toContain("Remember for 30 days");
    expect(fields).not.toContain("login-passkey-row");
    expect(entry).toContain("EnterpriseLoginFields");
    expect(entry).toContain("ACCOUNT_INVITATION_COPY");
    expect(entry).toContain("<Turnstile");
    expect(entry).toContain("app-entry-login-submit");
    expect(entry).not.toContain("PASSKEY_DEVICE_HELP");
    expect(entry).not.toContain("Sign in to Sherivs");
    expect(auth).toContain("EnterpriseLoginFields");
    expect(auth).toContain("<Turnstile");
    expect(auth).toContain("app-entry-login-submit");
    expect(auth).not.toContain("PASSKEY_DEVICE_HELP");
    expect(auth).toContain('hostKind === "internal"');
    expect(auth).toContain("{experience.subtext}");
    expect(ACCOUNT_INVITATION_COPY).toBe("Don't have an account? Contact your administrator.");
  });

  it("always shows remember-for-30-days on the browser form", () => {
    const fields = read("frontend/src/components/auth/enterprise-login-fields.tsx");
    expect(fields).toContain("Remember for 30 days");
    expect(fields).not.toMatch(/passkeyEligible/);
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");

describe("passkey UI integration", () => {
  it("keeps password, Google, and Turnstile on web login and hides passkeys", () => {
    const entry = read("frontend/src/components/app-entry/app-entry-screen.tsx");
    const auth = read("frontend/src/routes/auth.tsx");
    for (const src of [entry, auth]) {
      expect(src).toContain("EnterpriseLoginFields");
      expect(src).toContain("Sign in with Google");
      expect(src).toContain("signInWithPassword");
      expect(src).toContain("<Turnstile");
      expect(src).toContain("app-entry-login-submit");
      expect(src).not.toContain("PASSKEY_DEVICE_HELP");
      expect(src).not.toContain("passkeyLoginPriority");
      expect(src).not.toContain("PasskeySignInButton");
      expect(src).not.toContain("PasskeyConditionalLogin");
      expect(src).not.toContain("completePasskeySignIn");
    }
    expect(entry).toContain('data-testid="app-entry-submit"');
    expect(entry).toContain("app-entry-login-submit");
    expect(auth).toContain('data-testid="auth-submit"');
    const fields = read("frontend/src/components/auth/enterprise-login-fields.tsx");
    expect(fields).toContain('autoComplete="username"');
    expect(fields).not.toContain("webauthn");
    expect(fields).not.toContain("PasskeyConditionalLogin");
    expect(fields).not.toContain("PasskeySignInButton");
    expect(fields).not.toContain("login-passkey-row");
  });

  it("does not gate the web app or console on first-login passkey enrollment", () => {
    const shell = read("frontend/src/components/app-shell/app-shell.tsx");
    const consoleShell = read("frontend/src/components/internal-console/console-shell.tsx");
    expect(shell).not.toContain("PasskeyEnrollmentGate");
    expect(consoleShell).not.toContain("PasskeyEnrollmentGate");
  });

  it("points web account screens at the native apps instead of a browser manager", () => {
    const security = read("frontend/src/components/app-shell/account-screens.tsx");
    const consoleAccount = read("frontend/src/components/internal-console/module-screens.tsx");
    expect(security).not.toContain("PasskeyManager");
    expect(consoleAccount).not.toContain("PasskeyManager");
    expect(security).toContain("Sherivs iOS and Android apps");
    expect(consoleAccount).toContain("Sherivs iOS and Android apps");
    expect(security.toLowerCase()).not.toContain("enable fingerprint or face id");
  });
});

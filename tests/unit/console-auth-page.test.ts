import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  authPageExperience,
  effectiveAuthMode,
} from "../../frontend/src/lib/experience/auth-page-experience";
import { effectiveExperienceHostKind } from "../../frontend/src/lib/experience/console-host-routing";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const authSource = readFileSync(join(ROOT, "frontend/src/routes/auth.tsx"), "utf8");

describe("sign-in page per host", () => {
  it("console host: staff-branded copy and no self-service sign-up", () => {
    const x = authPageExperience(effectiveExperienceHostKind("console.sherivs.com"));
    expect(x.heading).toBe("Sherivs Console");
    expect(x.subtext).toBe("Staff sign-in. Access is restricted to Sherivs staff.");
    expect(x.allowSignup).toBe(false);
    expect(effectiveAuthMode("signup", x)).toBe("signin");
    expect(effectiveAuthMode("signin", x)).toBe("signin");
  });

  it("console host cannot be overridden into the app experience", () => {
    const x = authPageExperience(effectiveExperienceHostKind("console.sherivs.com", "app"));
    expect(x.allowSignup).toBe(false);
  });

  it("app host: invitation copy and no self-service sign-up", () => {
    const x = authPageExperience(effectiveExperienceHostKind("app.sherivs.com"));
    expect(x.heading).toBe("Sherivs");
    expect(x.allowSignup).toBe(false);
    expect(effectiveAuthMode("signup", x)).toBe("signin");
    expect(effectiveAuthMode("bogus", x)).toBe("signin");
    expect(x.subtext.toLowerCase()).toContain("invitation");
  });

  it("auth page wires the host experience and gates the sign-up toggle", () => {
    expect(authSource).toContain("authPageExperience(currentEffectiveHostKind())");
    expect(authSource).toContain("effectiveAuthMode(requestedMode, experience)");
    expect(authSource).toContain('mode === "signin" && experience.allowSignup');
    expect(authSource).toContain("{experience.subtext}");
    expect(authSource).toContain("<Turnstile");
    expect(authSource).toContain('to="/forgot-password"');
    expect(authSource).toContain("startGoogleSignIn");
    expect(authSource).toContain("Sign in with Google");
    expect(authSource).toContain("Remember for 30 days");
    expect(authSource).toContain("Ask your administrator to invite you");
    expect(authSource).not.toContain("SherivsLockup");
    expect(authSource).not.toContain("app-entry-login-chrome");
  });
});

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  isAppEntryHostname,
  isAppEntryKind,
  parseAppEntryPanel,
} from "@/lib/experience/app-entry-host";
import { isRetiredApplicationHostname } from "@/lib/experience/retired-application-host";
import { resolveExperienceHost } from "@/lib/experience/experience-host";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (ref: string) => readFileSync(join(ROOT, ref), "utf8");

describe("app-entry host", () => {
  it("classifies canonical app hosts as the splash entry, not retired", () => {
    expect(resolveExperienceHost("app.sherivs.com")).toBe("app");
    expect(isAppEntryKind("app")).toBe(true);
    expect(isAppEntryHostname("app.sherivs.com")).toBe(true);
    expect(isAppEntryHostname("app.universalschoolos.com")).toBe(true);
    expect(isRetiredApplicationHostname("app.sherivs.com")).toBe(false);
    expect(isRetiredApplicationHostname("app.universalschoolos.com")).toBe(false);
  });

  it("keeps gov, head, and group hosts retired; console is the Internal Console", () => {
    expect(isAppEntryHostname("console.sherivs.com")).toBe(false);
    expect(isRetiredApplicationHostname("console.sherivs.com")).toBe(false);
    expect(isRetiredApplicationHostname("internal.sherivs.com")).toBe(false);
    expect(isRetiredApplicationHostname("gov.sherivs.com")).toBe(true);
    expect(isRetiredApplicationHostname("head.sherivs.com")).toBe(true);
    expect(isRetiredApplicationHostname("group.sherivs.com")).toBe(true);
    expect(isRetiredApplicationHostname("admin.sherivs.com")).toBe(true);
  });

  it("does not treat public or tenant sites as app entry", () => {
    expect(isAppEntryHostname("sherivs.com")).toBe(false);
    expect(isAppEntryHostname("www.sherivs.com")).toBe(false);
    expect(isAppEntryHostname("northwind.sherivs.com")).toBe(false);
    expect(isRetiredApplicationHostname("northwind.sherivs.com")).toBe(false);
  });

  it("parses the sign-in panel and keeps other values on splash", () => {
    expect(parseAppEntryPanel("signin")).toBe("signin");
    expect(parseAppEntryPanel("splash")).toBe("splash");
    expect(parseAppEntryPanel("signup")).toBe("splash");
    expect(parseAppEntryPanel(undefined)).toBe("splash");
  });

  it("does not render the splash slogan under the wordmark", () => {
    const splash = read("frontend/src/components/app-entry/app-entry-screen.tsx");
    const onboarding = read("frontend/src/components/app-entry/app-onboarding-screen.tsx");
    const css = read("frontend/src/components/app-entry/app-entry.css");
    const wordmark = read("frontend/src/components/app-entry/app-entry-wordmark.tsx");
    const canvas = read("frontend/src/components/app-entry/app-entry-canvas.tsx");
    expect(splash).not.toContain("Build a smarter");
    expect(onboarding).not.toContain("Build a smarter");
    expect(splash).not.toContain("app-entry-tagline");
    expect(css).not.toContain("Nunito");
    expect(splash).toContain("AppEntryWordmark");
    expect(onboarding).toContain("SherivsLogo");
    expect(onboarding).toContain('lettering="brand"');
    expect(onboarding).toContain('tone="login"');
    expect(onboarding).not.toContain("splash-field");
    expect(wordmark).toContain("/brand/sherivs-app-wordmark.png");
    expect(canvas).toContain("/app-entry/splash-field.jpg");
    expect(canvas).toContain("app-entry-backdrop");
    expect(canvas).toContain('tone === "login"');
    expect(splash).toMatch(/<AppEntryCanvas tone="login">\s*<BrandBlock \/>/);
    expect(css).toContain(".app-entry-login .app-entry-wordmark::after");
    expect(css).toContain(".app-entry-login-card");
    expect(css).toContain("#1848fd");
    expect(css).toContain("#eef2f8");
    expect(css).not.toContain(".app-entry-login-chrome");
    expect(canvas).not.toMatch(/className="app-entry-field"/);
    expect(css).toContain(".app-entry-backdrop");
    expect(existsSync(join(ROOT, "public/app-entry/splash-field.jpg"))).toBe(true);
    expect(existsSync(join(ROOT, "public/brand/sherivs-app-wordmark.png"))).toBe(true);
  });
});

describe("app-entry wiring", () => {
  it("renders the splash on the app host index and the Internal Console on the console host", () => {
    const index = read("frontend/src/routes/index.tsx");
    expect(index).toContain("AppEntryScreen");
    expect(index).toContain("isAppEntryKind");
    expect(index).toContain("isRetiredApplicationHostname");
    expect(index).toContain("ApplicationUnavailable");
    expect(index).toContain("ConsoleGate");
    expect(index).toContain("<SherivsHome />");
    expect(index).not.toContain("signUp");
  });

  it("does not restore deleted workspace shells", () => {
    const splash = read("frontend/src/components/app-entry/app-entry-screen.tsx");
    expect(splash).not.toContain("_authenticated");
    expect(splash).not.toContain("command-centre");
    expect(splash).not.toContain("portal-shell");
    expect(splash).toContain("signInWithPassword");
    expect(splash).toContain("signInWithOAuth");
    expect(splash).not.toContain("signUp");
    expect(splash).toContain("EnterpriseLoginFields");
    expect(splash).toContain("Welcome back");
    expect(splash).toContain("Sign in with Google");
    const fields = read("frontend/src/components/auth/enterprise-login-fields.tsx");
    expect(fields).toContain("Forgot password");
    expect(fields).toContain("Remember for 30 days");
    expect(splash).not.toContain("Use the username, email, or phone number");
    expect(splash).not.toContain("Create Account");
    expect(splash).not.toContain("/onboarding");
    expect(splash).toContain("app-entry-glass-icon");
    expect(splash).toContain("size={68}");
    expect(splash).not.toContain("SherivsLockup");
    expect(splash).not.toContain("app-entry-login-chrome");
    expect(splash).toContain("SignInLoading");
    expect(splash).toContain("onSigningChange");
  });

  it("keeps Sherivs-team onboarding as a mailto, never Auth sign-up", () => {
    const onboarding = read("frontend/src/components/app-entry/app-onboarding-screen.tsx");
    expect(onboarding).toContain("buildOnboardingMailto");
    expect(onboarding).not.toContain("signUp");
    expect(onboarding).toContain("Bring your school into Sherivs.");
    expect(onboarding).toContain("window.location.href = href");
    expect(onboarding).not.toContain("submitted successfully");
    expect(onboarding).not.toContain("self-service sign-up");
    const route = read("frontend/src/routes/onboarding.tsx");
    expect(route).toContain('createFileRoute("/onboarding")');
    expect(route).toContain("AppOnboardingScreen");
  });
});

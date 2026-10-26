/**
 * SHERIVS EXPERIENCE REFOUNDATION — public boundary verification.
 *
 * Verifies the architectural correction from "Sherivs Scholar public shell"
 * to the four-plane Sherivs experience model:
 *
 *   1. The public company site presents SHERIVS, never a runtime brand.
 *   2. The public homepage does NOT render the internal command centre or
 *      expose internal architecture (phases, kernel contracts, registries).
 *   3. The public authentication surface exposes NO demo credentials or demo
 *      provisioning entry points.
 *   4. Internal engineering surfaces (/platform, /platform/org) are
 *      session-gated and noindex — never public product navigation.
 *   5. The tenant resolver treats sherivs.com hosts as platform hosts.
 *   6. The Lovable marketing prototype is gone; `/` is a blank canvas.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PLATFORM_NAME, PLATFORM_TAGLINE, PLATFORM_DOMAIN } from "@/lib/platform";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (ref: string) => readFileSync(join(ROOT, ref), "utf8");

const INDEX = "frontend/src/routes/index.tsx";
const AUTH = "frontend/src/routes/auth.tsx";
const SITE_LAYOUT = "frontend/src/routes/(site)/route.tsx";
const SHERIVS_HOME = "frontend/src/components/public/sherivs-home.tsx";
const PLATFORM_PAGE = "frontend/src/routes/platform.tsx";
const PLATFORM_ORG_PAGE = "frontend/src/routes/platform.org.tsx";
const COMMAND_CENTRE = "frontend/src/routes/_authenticated/command-centre/index.tsx";

describe("Platform identity", () => {
  it("presents the company as Sherivs", () => {
    expect(PLATFORM_NAME).toBe("Sherivs");
    expect(PLATFORM_TAGLINE).toMatch(/operating intelligence/i);
    expect(PLATFORM_DOMAIN).toBe("sherivs.com");
  });
});

describe("Public company homepage (plane 1)", () => {
  const index = read(INDEX);
  const home = read(SHERIVS_HOME);

  it("renders the Sherivs public homepage — not the command centre", () => {
    expect(index).toContain("<SherivsHome />");
    expect(index).not.toContain("CommandCentre");
    expect(index).not.toContain("command-centre/command-centre");
  });

  it("carries sherivs.com canonical/OG metadata, not legacy domains", () => {
    expect(index).toContain("PLATFORM_URL");
    expect(index).toMatch(/rel: "canonical"/);
    expect(index).not.toContain("universalschoolos.com");
  });

  it("is a blank canvas: brand + sign-in only, no prototype marketing story", () => {
    expect(home).toContain("PLATFORM_NAME");
    expect(home).toContain('to="/auth"');
    expect(home).not.toMatch(/Request a demo/);
    expect(home).not.toMatch(/Industry solutions|AI workforce|Organizational reality/i);
    expect(home).not.toMatch(/phase/i);
    expect(home).not.toMatch(/kernel/i);
    expect(home).not.toMatch(/runtime binding/i);
    expect(home).not.toMatch(/contract/i);
  });

  it("never claims fabricated social proof", () => {
    expect(home).not.toMatch(/customers|testimonials|case stud|awards|trusted by/i);
  });
});

describe("Lovable marketing prototype removed", () => {
  it("deletes the leftover marketing modules and unused platform-home", () => {
    expect(existsSync(join(ROOT, "frontend/src/components/public/platform-home.tsx"))).toBe(false);
    expect(existsSync(join(ROOT, "frontend/src/routes/(site)/-content/site-content.ts"))).toBe(
      false,
    );
    expect(existsSync(join(ROOT, "frontend/src/routes/(site)/-content/pricing-tiers.ts"))).toBe(
      false,
    );
  });

  it("redirects former marketing paths to the company root", () => {
    for (const ref of [
      "frontend/src/routes/(site)/sherivs.tsx",
      "frontend/src/routes/(site)/about.tsx",
      "frontend/src/routes/(site)/coregrid.tsx",
    ]) {
      const source = read(ref);
      expect(source).toContain("redirect");
      expect(source).toContain('to: "/"');
    }
  });
});

describe("Public authentication surface", () => {
  const auth = read(AUTH);

  it("exposes no demo credentials or demo provisioning entry point", () => {
    expect(auth).not.toMatch(/Enterprise demo|demo provisioning|Sign in as Enterprise demo/i);
    expect(auth).not.toContain("provisionDemoEnterprise");
    expect(auth).not.toContain("handleDemoLogin");
  });

  it("signs in to Sherivs, not to a Scholar runtime portal", () => {
    const experience = read("frontend/src/lib/experience/auth-page-experience.ts");
    expect(auth).toContain("authPageExperience(");
    expect(experience).toMatch(/Sign in to \$\{PLATFORM_NAME\}/);
    expect(experience).not.toContain("SCHOLAR_RUNTIME_NAME");
    expect(auth).not.toContain("SCHOLAR_RUNTIME_NAME");
  });
});

describe("Internal architecture stays off the public surface", () => {
  it("/platform and /platform/org are session-gated", () => {
    for (const ref of [PLATFORM_PAGE, PLATFORM_ORG_PAGE]) {
      const source = read(ref);
      expect(source).toContain("beforeLoad");
      expect(source).toContain('redirect({ to: "/auth" })');
      expect(source).toContain("supabase.auth.getUser");
      expect(source).toContain('"noindex, nofollow"');
    }
  });

  it("the internal control surface presents as Sherivs Control", () => {
    const commandCentre = read(COMMAND_CENTRE);
    expect(commandCentre).toContain("Sherivs Control");
    expect(commandCentre).not.toContain("CoreGrid Command Centre");
  });
});

describe("Public site engagement paths", () => {
  const layout = read(SITE_LAYOUT);

  it("keeps Sign in as the real engagement route", () => {
    expect(layout).toContain('to="/auth"');
    expect(layout).not.toMatch(/Request a demo/);
    expect(layout).not.toContain('to="/sherivs"');
  });
});

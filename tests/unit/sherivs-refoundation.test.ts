/**
 * SHERIVS EXPERIENCE REFOUNDATION — public boundary verification.
 *
 * Verifies the architectural correction from "Sherivs Scholar public shell"
 * to the four-plane Sherivs experience model:
 *
 *   1. The public company site presents SHERIVS, never Sherivs branding.
 *   2. The public homepage does NOT render the internal command centre or
 *      expose internal architecture (phases, kernel contracts, registries).
 *   3. The public authentication surface exposes NO demo credentials or demo
 *      provisioning entry points.
 *   4. Internal engineering surfaces (/platform, /platform/org) are
 *      session-gated and noindex — never public product navigation.
 *   5. The tenant resolver treats sherivs.com hosts as platform hosts.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { PLATFORM_NAME, PLATFORM_TAGLINE, PLATFORM_DOMAIN } from "@/lib/platform";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (ref: string) => readFileSync(join(ROOT, ref), "utf8");

const INDEX = "frontend/src/routes/index.tsx";
const AUTH = "frontend/src/routes/auth.tsx";
const SITE_LAYOUT = "frontend/src/routes/(site)/route.tsx";
const SITE_PAGE = "frontend/src/routes/(site)/sherivs.tsx";
const SHERIVS_HOME = "frontend/src/components/public/sherivs-home.tsx";

describe("Platform identity", () => {
  it("presents the company as Sherivs", () => {
    expect(PLATFORM_NAME).toBe("Sherivs");
    expect(PLATFORM_TAGLINE).toMatch(/intelligence infrastructure/i);
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

  it("communicates the category without internal architecture", () => {
    expect(home).toContain("{PLATFORM_TAGLINE}");
    expect(home).toMatch(/The intelligence layer for a world that works together/);
    expect(home).toMatch(/Request a demo/);
    expect(home).not.toMatch(/phase/i);
    expect(home).not.toMatch(/kernel/i);
    expect(home).not.toMatch(/runtime binding/i);
    expect(home).not.toMatch(/contract/i);
  });

  it("never claims fabricated social proof", () => {
    expect(home).not.toMatch(/customers|testimonials|case stud|awards|trusted by/i);
  });

  it("positions runtimes honestly — Education available, others marked in development", () => {
    expect(home).toMatch(/In development/);
    expect(home).toMatch(/Scholar/);
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
    // Copy lives in the per-host auth experience (console vs organization app).
    const experience = read("frontend/src/lib/experience/auth-page-experience.ts");
    expect(auth).toContain("authPageExperience(");
    expect(experience).toMatch(/Sign in to \$\{PLATFORM_NAME\}/);
    expect(experience).not.toContain("SCHOLAR_RUNTIME_NAME");
    expect(auth).not.toContain("SCHOLAR_RUNTIME_NAME");
  });
});

describe("Internal architecture stays off the public surface", () => {
  it("hardcoded /platform, /platform/org, and command-centre shells are gone", () => {
    for (const ref of [
      "frontend/src/routes/platform.tsx",
      "frontend/src/routes/platform.org.tsx",
      "frontend/src/routes/_authenticated/command-centre/index.tsx",
    ]) {
      expect(() => read(ref)).toThrow();
    }
  });
});

describe("Public site engagement paths", () => {
  const layout = read(SITE_LAYOUT);
  const header = read("frontend/src/components/public/site-header.tsx");
  const footer = read("frontend/src/components/public/site-footer.tsx");

  it("offers Request a demo as the primary CTA and links the real routes", () => {
    expect(header).toMatch(/Request a demo/);
    expect(header).toContain('to="/request-demo"');
    expect(header).toContain('to="/auth"');
    expect(layout).toContain("<SiteHeader />");
    expect(layout).toContain("<SiteFooter />");
    expect(footer).toContain("PUBLIC_CONTACTS");
  });
});

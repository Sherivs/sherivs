/**
 * CoreGrid — V1-007 platform public site (`(site)` route group) tests.
 *
 * The vitest environment here is `node` (no jsdom/RTL in this repository), so
 * route surfaces are validated the way existing structural tests validate
 * surfaces (tests/unit/platform-neutrality.test.ts): typed view-model imports
 * plus structural file assertions for the laws the public site must not break.
 *
 * Laws under test:
 *  - every interactive element links to a REAL route (/auth), never a fake form;
 *  - pricing data comes from one typed module, not scattered JSX;
 *  - semantic landmarks and section anchors exist for accessibility;
 *  - the site narrates an INSTALLED runtime, never the platform as a runtime
 *    (platform-neutrality LAW 3 / LAW 5).
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { MARKETING_TIERS, formatTierPrice } from "@/routes/(site)/-content/pricing-tiers";
import {
  INSTALLED_RUNTIME_PROOFS,
  SECURITY_GUARANTEES,
  SITE_CAPABILITIES,
} from "@/routes/(site)/-content/site-content";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (ref: string) => readFileSync(join(ROOT, ref), "utf8");

const SITE_LAYOUT = "frontend/src/routes/(site)/route.tsx";
const SITE_PAGE = "frontend/src/routes/(site)/coregrid.tsx";
const SITE_HEADER = "frontend/src/components/public/site-header.tsx";

describe("Pricing tier catalog (typed module)", () => {
  it("exposes the five commercial tiers by stable id", () => {
    expect(MARKETING_TIERS.map((tier) => tier.id)).toEqual([
      "trial",
      "starter",
      "growth",
      "professional",
      "enterprise",
    ]);
  });

  it("carries well-formed prices; only Enterprise is quoted as a custom contract", () => {
    const priced = MARKETING_TIERS.filter((tier) => tier.monthlyPrice !== null);
    const custom = MARKETING_TIERS.filter((tier) => tier.monthlyPrice === null);
    expect(custom.map((tier) => tier.id)).toEqual(["enterprise"]);
    for (const tier of priced) {
      expect(tier.monthlyPrice as number, `${tier.id} monthly`).toBeGreaterThanOrEqual(0);
      expect(tier.annualPrice as number, `${tier.id} annual`).toBeGreaterThanOrEqual(0);
      expect(tier.monthlyPrice as number).toBeLessThanOrEqual(tier.annualPrice as number);
    }
  });

  it("mirrors the commercial catalog prices in ₦", () => {
    const byId = new Map(MARKETING_TIERS.map((tier) => [tier.id, tier]));
    expect(byId.get("trial")?.monthlyPrice).toBe(0);
    expect(byId.get("starter")?.monthlyPrice).toBe(15_000);
    expect(byId.get("growth")?.monthlyPrice).toBe(35_000);
    expect(byId.get("professional")?.monthlyPrice).toBe(75_000);
    expect(formatTierPrice(15_000)).toBe("₦15,000");
    expect(formatTierPrice(null)).toBe("Custom");
  });

  it("marks exactly one tier as recommended and gives every tier a CTA", () => {
    expect(MARKETING_TIERS.filter((tier) => tier.featured).map((tier) => tier.id)).toEqual([
      "growth",
    ]);
    for (const tier of MARKETING_TIERS) {
      expect(tier.ctaLabel.length).toBeGreaterThan(0);
      expect(tier.highlights.length).toBeGreaterThan(0);
    }
  });
});

describe("Site content view-models", () => {
  it("presents the six platform capabilities", () => {
    expect(SITE_CAPABILITIES.map((capability) => capability.id)).toEqual([
      "reality-model",
      "missions",
      "ai-workforce",
      "evidence",
      "governance",
      "workspace",
    ]);
    for (const capability of SITE_CAPABILITIES) {
      expect(capability.title.length).toBeGreaterThan(0);
      expect(capability.description.length).toBeGreaterThan(0);
    }
  });

  it("presents the security and governance guarantees", () => {
    expect(SECURITY_GUARANTEES.length).toBeGreaterThanOrEqual(6);
    for (const guarantee of SECURITY_GUARANTEES) {
      expect(guarantee.title.length).toBeGreaterThan(0);
      expect(guarantee.description.length).toBeGreaterThan(0);
    }
  });

  it("names the first installed runtime as a runtime, never as the platform", () => {
    expect(INSTALLED_RUNTIME_PROOFS).toHaveLength(1);
    const [runtime] = INSTALLED_RUNTIME_PROOFS;
    expect(runtime.manifestId).toBe("runtime:scholar");
    expect(runtime.name).toBe("Scholar");
    expect(runtime.proof).toContain("Runtime-001");
    expect(runtime.proof).toMatch(/kernel stays fully valid/);
  });
});

describe("Route modules — real links, no fake submissions, landmarks", () => {
  const layout = read(SITE_LAYOUT);
  const page = read(SITE_PAGE);
  // The header is a shared component (used by the (site) layout AND the
  // homepage component, which renders outside the layout group).
  const header = read(SITE_HEADER);

  it("registers the (site) layout group and the /coregrid page in the generated tree", () => {
    const tree = read("frontend/src/routeTree.gen.ts");
    expect(tree).toContain("'/(site)'");
    expect(tree).toContain("'/(site)/coregrid'");
  });

  it("declares the expected file route ids", () => {
    expect(layout).toContain('createFileRoute("/(site)")');
    expect(page).toContain('createFileRoute("/(site)/coregrid")');
  });

  it("links sign-up and sign-in to the real auth surface at /auth", () => {
    for (const source of [layout, page]) {
      expect(source).toContain('to="/auth"');
    }
    // No dead platform sign-up route is invented.
    expect(layout).not.toContain('to="/signup"');
    expect(page).not.toContain('to="/signup"');
  });

  it("contains no form and no fake submission — every CTA is a route link", () => {
    for (const source of [layout, page]) {
      expect(source).not.toMatch(/<form\b/);
      expect(source).not.toMatch(/onSubmit/);
      expect(source).not.toMatch(/<button\b/);
    }
  });

  it("renders semantic landmarks; sections anchor between layout and pages", () => {
    // Header landmarks live in the shared SiteHeader component.
    expect(header).toContain("<header");
    expect(header).toMatch(/aria-label="Site"/);
    // The header's section navigation anchors into the public homepage
    // (the company experience at /), not into this page.
    for (const anchor of ["platform", "ai-workforce", "solutions", "enterprise", "security"]) {
      expect(header).toContain(`"/#${anchor}"`);
    }
    expect(layout).toContain("<SiteHeader />");
    expect(layout).toContain("<main");
    expect(layout).toContain("<footer");
    for (const anchor of ["capabilities", "runtimes", "security", "pricing"]) {
      expect(page).toContain(`id="${anchor}"`);
    }
  });

  it("keeps every heading labelled for assistive technology", () => {
    expect(page).toMatch(/aria-labelledby="coregrid-hero"/);
    for (const anchor of ["capabilities", "runtimes", "security", "pricing"]) {
      expect(page).toMatch(new RegExp(`aria-labelledby="${anchor}-heading"`));
      expect(page).toContain(`id="${anchor}-heading"`);
    }
  });

  it("uses no raster images, so no missing alt text is possible", () => {
    expect(layout).not.toMatch(/<img\b/);
    expect(page).not.toMatch(/<img\b/);
  });
});

describe("Platform narration neutrality (LAW 3 / LAW 5)", () => {
  const RUNTIME_NARRATION =
    /CoreGrid Scholar|Scholar's|Scholar is|Scholar consumes|Scholar binds|Scholar resolves|Scholar remains|Scholar-only|Scholar-flavored|Scholar catalog|Scholar runtime \(runtime-001\)/;
  const SELF_IDENTIFICATION = /^\s*(?:\/\*|\*|\/\/)\s*CoreGrid Scholar\b/m;

  const sources = [
    "-content/pricing-tiers.ts",
    "-content/site-content.ts",
    "route.tsx",
    "coregrid.tsx",
  ].map((ref) => read(`frontend/src/routes/(site)/${ref}`));

  it("never narrates a runtime as the platform", () => {
    for (const source of sources) {
      expect(source).not.toMatch(RUNTIME_NARRATION);
      expect(source).not.toMatch(SELF_IDENTIFICATION);
    }
  });

  it("keeps hand-written role lists off the public surface", () => {
    for (const source of sources) {
      expect(source).not.toMatch(/allow=\{\[\s*"|const\s+\w*ROLES?\w*\s*(?::[^=]+)?=\s*\[/);
    }
  });
});

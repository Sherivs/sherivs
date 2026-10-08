/**
 * Sherivs — V1-007 platform public site (`(site)` route group) tests.
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
  const legacy = read(SITE_PAGE);
  const shell = read("frontend/src/components/sherivs/public-shell.tsx");
  const publicPages = [
    "platform/index.tsx",
    "platform/$capability.tsx",
    "solutions/index.tsx",
    "solutions/$audience.tsx",
    "security.tsx",
    "pricing.tsx",
    "status.tsx",
    "legal/index.tsx",
    "legal/accessibility.tsx",
    "resources/index.tsx",
    "resources/$section/index.tsx",
    "resources/$section/$slug.tsx",
  ].map((ref) => ({ ref, source: read(`frontend/src/routes/(site)/${ref}`) }));

  it("registers the (site) layout group and the public pages in the generated tree", () => {
    const tree = read("frontend/src/routeTree.gen.ts");
    expect(tree).toContain("'/(site)'");
    for (const id of ["coregrid", "pricing", "security", "status", "platform/", "resources/", "legal/accessibility"]) {
      expect(tree, id).toContain(`'/(site)/${id}'`);
    }
  });

  it("declares the expected file route ids", () => {
    expect(layout).toContain('createFileRoute("/(site)")');
    expect(legacy).toContain('createFileRoute("/(site)/coregrid")');
    expect(read("frontend/src/routes/(site)/pricing.tsx")).toContain('createFileRoute("/(site)/pricing")');
  });

  it("retires /coregrid as a permanent redirect to the Sherivs home", () => {
    expect(legacy).toContain("redirect");
    expect(legacy).toContain("301");
    expect(legacy).not.toMatch(/PLATFORM_NAME|<main/);
  });

  it("links sign-up and sign-in to the real auth surface at /auth", () => {
    expect(shell).toContain('to="/auth"');
    expect(read("frontend/src/routes/(site)/pricing.tsx")).toContain('to="/auth"');
    for (const source of [shell, layout, ...publicPages.map((p) => p.source)]) {
      expect(source).not.toContain('to="/signup"');
    }
  });

  it("contains no fake submission — the only form is a real search that navigates", () => {
    for (const { ref, source } of publicPages) {
      if (ref === "resources/index.tsx") {
        expect(source).toContain('role="search"');
        expect(source).toContain("navigate(");
        continue;
      }
      expect(source, ref).not.toMatch(/<form\b/);
      expect(source, ref).not.toMatch(/onSubmit/);
    }
    expect(shell).not.toMatch(/<form\b/);
  });

  it("renders semantic landmarks with labelled navigation and a single main landmark", () => {
    expect(shell).toContain("<header");
    expect(shell).toContain("<main");
    expect(shell).toContain("<footer");
    expect(shell).toMatch(/aria-label="Primary"/);
    expect(shell).toMatch(/aria-label="Footer"/);
    expect(shell).toMatch(/aria-label="Breadcrumb"/);
    expect(shell).toContain('id="main-content"');
    expect(layout).not.toContain("<main");
  });

  it("keeps every section heading labelled for assistive technology", () => {
    expect(shell).toMatch(/aria-labelledby=\{headingId\}/);
    expect(shell).toMatch(/id=\{headingId\}/);
  });

  it("uses no raster images, so no missing alt text is possible", () => {
    for (const source of [shell, layout, ...publicPages.map((p) => p.source)]) {
      expect(source).not.toMatch(/<img\b/);
    }
  });
});

describe("Platform narration neutrality (LAW 3 / LAW 5)", () => {
  const RUNTIME_NARRATION =
    /CoreGrid Scholar|Scholar's|Scholar is|Scholar consumes|Scholar binds|Scholar resolves|Scholar remains|Scholar-only|Scholar-flavored|Scholar catalog|Scholar runtime \(runtime-001\)/;
  const SELF_IDENTIFICATION = /^\s*(?:\/\*|\*|\/\/)\s*CoreGrid Scholar\b/m;

  const sources = ["-content/pricing-tiers.ts", "-content/site-content.ts", "route.tsx", "coregrid.tsx", "security.tsx", "pricing.tsx", "solutions/$audience.tsx"].map(
    (ref) => read(`frontend/src/routes/(site)/${ref}`),
  );

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
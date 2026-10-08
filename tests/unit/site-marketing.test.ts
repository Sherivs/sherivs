/**
 * Sherivs public experience — `(site)` route group tests.
 *
 * The vitest environment here is `node` (no jsdom/RTL in this repository), so
 * route surfaces are validated the way existing structural tests validate
 * surfaces (tests/unit/platform-neutrality.test.ts): typed view-model imports
 * plus structural file assertions for the laws the public site must not break.
 *
 * Laws under test:
 *  - every interactive element links to a REAL route (/auth), never a fake form;
 *  - pricing data comes from one typed module, not scattered JSX;
 *  - the homepage carries the declared twelve-chapter narrative with landmarks;
 *  - the public chrome links only routes the route architecture declares LIVE;
 *  - no fabricated social proof (logos, testimonials, social accounts);
 *  - the site narrates an INSTALLED runtime, never the platform as a runtime
 *    (platform-neutrality LAW 3 / LAW 5).
 */
import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  HOME_CHAPTERS,
  INSTALLED_RUNTIME_PROOFS,
  MARKETING_TIERS,
  PLATFORM_PILLARS,
  SECURITY_GUARANTEES,
  SOLUTION_SEGMENTS,
  formatTierPrice,
} from "@/lib/experience/public-content";
import { linkablePublicRoutes, publicFooterGroups, publicPrimaryNav } from "@/lib/experience/route-architecture";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (ref: string) => readFileSync(join(ROOT, ref), "utf8");

const SITE_DIR = "frontend/src/routes/(site)";
const SITE_LAYOUT = `${SITE_DIR}/route.tsx`;
const HOME = "frontend/src/components/sherivs/public/home.tsx";
const SHELL = "frontend/src/components/sherivs/public/public-shell.tsx";
const INDEX = "frontend/src/routes/index.tsx";

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(join(ROOT, dir))) {
    const rel = `${dir}/${entry}`;
    if (statSync(join(ROOT, rel)).isDirectory()) out.push(...listFiles(rel));
    else out.push(rel);
  }
  return out;
}

const SITE_SOURCES = [...listFiles(SITE_DIR), HOME, SHELL, INDEX, "frontend/src/lib/experience/public-content.ts"];

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
    for (const tier of MARKETING_TIERS) {
      if (tier.id === "enterprise") {
        expect(tier.monthlyPrice).toBeNull();
        expect(tier.annualPrice).toBeNull();
        expect(formatTierPrice(tier.monthlyPrice)).toBe("Custom");
      } else {
        expect(tier.monthlyPrice).not.toBeNull();
        expect(formatTierPrice(tier.monthlyPrice)).toMatch(/^₦[\d,]+$/);
      }
    }
  });

  it("marks exactly one tier as recommended and gives every tier a CTA", () => {
    expect(MARKETING_TIERS.filter((tier) => tier.featured)).toHaveLength(1);
    for (const tier of MARKETING_TIERS) expect(tier.ctaLabel.length).toBeGreaterThan(0);
  });
});

describe("Public content view-models", () => {
  it("declares seven platform pillars, each backed by real repository modules", () => {
    expect(PLATFORM_PILLARS).toHaveLength(7);
    for (const pillar of PLATFORM_PILLARS) {
      expect(pillar.backedBy.length).toBeGreaterThan(0);
      for (const path of pillar.backedBy) {
        expect(() => statSync(join(ROOT, path)), `${pillar.slug} → ${path}`).not.toThrow();
      }
    }
  });

  it("declares solution segments backed by real repository modules", () => {
    expect(SOLUTION_SEGMENTS.length).toBeGreaterThanOrEqual(4);
    for (const segment of SOLUTION_SEGMENTS) {
      for (const path of segment.backedBy) {
        expect(() => statSync(join(ROOT, path)), `${segment.slug} → ${path}`).not.toThrow();
      }
      for (const slug of segment.pillars) {
        expect(PLATFORM_PILLARS.some((pillar) => pillar.slug === slug)).toBe(true);
      }
    }
  });

  it("presents the security and governance guarantees", () => {
    expect(SECURITY_GUARANTEES.length).toBeGreaterThanOrEqual(6);
    expect(SECURITY_GUARANTEES.map((g) => g.id)).toContain("tenant-isolation");
    expect(SECURITY_GUARANTEES.map((g) => g.id)).toContain("ai-output-trust");
  });

  it("declares exactly twelve homepage chapters in order", () => {
    expect(HOME_CHAPTERS).toHaveLength(12);
    expect(HOME_CHAPTERS.map((c) => c.index)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    expect(HOME_CHAPTERS.map((c) => c.id)).toEqual([
      "brand",
      "category",
      "reality",
      "intelligence",
      "workforce",
      "missions",
      "experiences",
      "runtimes",
      "governance",
      "architecture",
      "vision",
      "cta",
    ]);
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
  const home = read(HOME);
  const shell = read(SHELL);

  it("registers the (site) layout group and every LIVE public route in the generated tree", () => {
    const tree = read("frontend/src/routeTree.gen.ts");
    expect(tree).toContain("'/(site)'");
    for (const route of linkablePublicRoutes()) {
      if (route.path === "/") continue;
      const id = `/(site)${route.path}`;
      const indexId = `${id}/`;
      const dynamicParent = `/(site)/${route.path.slice(1).split("/").slice(0, -1).join("/")}/$`;
      expect(
        tree.includes(`'${id}'`) || tree.includes(`'${indexId}'`) || tree.includes(`'${dynamicParent}`),
        `route ${route.path} missing from generated tree`,
      ).toBe(true);
    }
  });

  it("every pillar and solution segment has a LIVE route declared in the architecture", () => {
    const livePaths = new Set(linkablePublicRoutes().map((route) => route.path));
    for (const pillar of PLATFORM_PILLARS) expect(livePaths.has(`/platform/${pillar.slug}`), pillar.slug).toBe(true);
    for (const segment of SOLUTION_SEGMENTS) expect(livePaths.has(`/solutions/${segment.slug}`), segment.slug).toBe(true);
  });

  it("redirects the legacy /coregrid landing page to the Sherivs homepage", () => {
    const legacy = read(`${SITE_DIR}/coregrid.tsx`);
    expect(legacy).toContain('redirect({ to: "/"');
  });

  it("links sign-up and sign-in to the real auth surface at /auth", () => {
    expect(shell).toContain('to="/auth"');
    expect(home).toContain('to="/auth"');
    for (const source of SITE_SOURCES) {
      expect(read(source)).not.toContain('to="/signup"');
    }
  });

  it("contains no form and no fake submission on public pages", () => {
    for (const source of SITE_SOURCES) {
      const text = read(source);
      expect(text, source).not.toMatch(/<form\b/);
      expect(text, source).not.toMatch(/onSubmit/);
    }
  });

  it("renders semantic landmarks in the shell and every homepage chapter as a labelled section", () => {
    expect(shell).toContain("<header");
    expect(shell).toContain("<main");
    expect(shell).toContain("<footer");
    expect(shell).toMatch(/aria-label="Primary"/);
    expect(layout).toContain("<PublicShell>");
    for (const chapter of HOME_CHAPTERS) {
      expect(home, chapter.id).toContain(`id="${chapter.id}"`);
    }
    expect(home).toMatch(/aria-labelledby=\{`\$\{id\}-heading`\}/);
    expect(home).toContain('id="brand-heading"');
  });

  it("uses no raster images, so no missing alt text is possible", () => {
    for (const source of SITE_SOURCES) {
      expect(read(source), source).not.toMatch(/<img\b/);
    }
  });

  it("drives the primary nav and footer from the route architecture, not hand-written lists", () => {
    expect(shell).toContain("publicPrimaryNav()");
    expect(shell).toContain("publicFooterGroups()");
    expect(publicPrimaryNav().map((r) => r.path)).toEqual(["/platform", "/solutions", "/security", "/pricing"]);
    for (const group of publicFooterGroups()) {
      for (const route of group.routes) expect(route.status).toBe("LIVE");
    }
  });

  it("fabricates no social proof: no social links, testimonials or customer logos", () => {
    for (const source of SITE_SOURCES) {
      const text = read(source);
      expect(text, source).not.toMatch(/twitter\.com|x\.com\/|linkedin\.com|facebook\.com|instagram\.com|github\.com/i);
      expect(text, source).not.toMatch(/testimonial|\btrusted by\b|customers? include|as seen in/i);
    }
  });
});

describe("Platform narration neutrality (LAW 3 / LAW 5)", () => {
  const RUNTIME_NARRATION =
    /CoreGrid Scholar|Sherivs Scholar is the platform|Scholar's|Scholar is|Scholar consumes|Scholar binds|Scholar resolves|Scholar remains|Scholar-only|Scholar-flavored|Scholar catalog|Scholar runtime \(runtime-001\)/;
  const SELF_IDENTIFICATION = /^\s*(?:\/\*|\*|\/\/)\s*(?:CoreGrid|Sherivs) Scholar\b/m;

  it("never narrates a runtime as the platform", () => {
    for (const source of SITE_SOURCES) {
      const text = read(source);
      expect(text, source).not.toMatch(RUNTIME_NARRATION);
      expect(text, source).not.toMatch(SELF_IDENTIFICATION);
    }
  });

  it("keeps hand-written role lists off the public surface", () => {
    for (const source of SITE_SOURCES) {
      expect(read(source), source).not.toMatch(/allow=\{\[\s*"|const\s+\w*ROLES?\w*\s*(?::[^=]+)?=\s*\[/);
    }
  });

  it("presents CoreGrid only as lineage, never as the customer-facing name", () => {
    for (const source of SITE_SOURCES) {
      const text = read(source);
      // JSX text nodes / string literals must not surface the legacy name.
      const userVisible = text.match(/>[^<{]*CoreGrid[^<{]*</g) ?? [];
      expect(userVisible, source).toEqual([]);
    }
  });
});

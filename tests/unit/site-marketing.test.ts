/**
 * Sherivs public site — after Lovable prototype removal.
 *
 * The vitest environment here is `node` (no jsdom/RTL). Route surfaces are
 * validated as structural file assertions:
 *  - marketing story / pricing modules are gone
 *  - leftover marketing paths redirect to `/`
 *  - remaining chrome links only to real routes
 *  - no navy-gradient prototype shell remains on tenant leftover pages
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (ref: string) => readFileSync(join(ROOT, ref), "utf8");

const SITE_LAYOUT = "frontend/src/routes/(site)/route.tsx";
const SITE_HEADER = "frontend/src/components/public/site-header.tsx";
const LOVABLE_NAVY = "linear-gradient(180deg, #0a0f1e 0%, #0d1424 100%)";

describe("Prototype marketing modules are gone", () => {
  it("does not ship the hardcoded pricing catalog or capability story", () => {
    expect(existsSync(join(ROOT, "frontend/src/routes/(site)/-content/pricing-tiers.ts"))).toBe(
      false,
    );
    expect(existsSync(join(ROOT, "frontend/src/routes/(site)/-content/site-content.ts"))).toBe(
      false,
    );
    expect(existsSync(join(ROOT, "frontend/src/components/public/platform-home.tsx"))).toBe(false);
  });
});

describe("Route modules — redirects, real links, landmarks", () => {
  const layout = read(SITE_LAYOUT);
  const header = read(SITE_HEADER);

  it("registers the (site) layout group and former marketing paths in the generated tree", () => {
    const tree = read("frontend/src/routeTree.gen.ts");
    expect(tree).toContain("'/(site)'");
    expect(tree).toContain("'/(site)/sherivs'");
    expect(tree).toContain("'/(site)/coregrid'");
    expect(tree).toContain("'/(site)/about'");
  });

  it("keeps /sherivs, /about and /coregrid as redirects to /", () => {
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

  it("declares the expected file route ids", () => {
    expect(layout).toContain('createFileRoute("/(site)")');
  });

  it("links sign-in to the real auth surface at /auth", () => {
    expect(layout).toContain('to="/auth"');
    expect(header).toContain('to="/auth"');
    expect(layout).not.toContain('to="/signup"');
    expect(header).not.toContain('to="/signup"');
  });

  it("contains no form and no fake submission — remaining CTAs are route links", () => {
    for (const source of [layout, header]) {
      expect(source).not.toMatch(/<form\b/);
      expect(source).not.toMatch(/onSubmit/);
      expect(source).not.toMatch(/<button\b/);
    }
  });

  it("renders semantic landmarks without prototype section navigation", () => {
    expect(header).toContain("<header");
    expect(header).toMatch(/aria-label="Account"/);
    expect(header).not.toContain("/#platform");
    expect(header).not.toContain("/#ai-workforce");
    expect(header).not.toContain("/#solutions");
    expect(header).not.toContain("/#enterprise");
    expect(layout).toContain("<SiteHeader />");
    expect(layout).toContain("<main");
    expect(layout).toContain("<footer");
  });

  it("uses no raster images, so no missing alt text is possible", () => {
    expect(layout).not.toMatch(/<img\b/);
    expect(header).not.toMatch(/<img\b/);
  });
});

describe("Tenant leftover pages no longer use the Lovable navy shell", () => {
  const leftovers = [
    "frontend/src/components/public/policy-shell.tsx",
    "frontend/src/routes/blog.tsx",
    "frontend/src/routes/blog.$slug.tsx",
    "frontend/src/routes/news.$id.tsx",
    "frontend/src/routes/events.$id.tsx",
    "frontend/src/routes/privacy.tsx",
    "frontend/src/routes/rules.tsx",
    "frontend/src/routes/admissions.tsx",
  ];

  it("drops the hardcoded #0a0f1e gradient and navy page backgrounds", () => {
    for (const ref of leftovers) {
      const source = read(ref);
      expect(source, ref).not.toContain(LOVABLE_NAVY);
      expect(source, ref).not.toContain("bg-[#0a0f1e]");
    }
  });
});

describe("Platform narration neutrality (LAW 3 / LAW 5)", () => {
  const RUNTIME_NARRATION =
    /CoreGrid Scholar|Scholar's|Scholar is|Scholar consumes|Scholar binds|Scholar resolves|Scholar remains|Scholar-only|Scholar-flavored|Scholar catalog|Scholar runtime \(runtime-001\)/;
  const SELF_IDENTIFICATION = /^\s*(?:\/\*|\*|\/\/)\s*CoreGrid Scholar\b/m;

  const sources = ["route.tsx", "coregrid.tsx", "sherivs.tsx", "about.tsx"].map((ref) =>
    read(`frontend/src/routes/(site)/${ref}`),
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

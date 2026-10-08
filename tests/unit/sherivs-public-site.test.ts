/**
 * Sherivs public site — registry integrity, honesty and brand tests.
 *
 * Laws under test:
 *  - every registered public page is valid (Zod), unique and served by a real route;
 *  - navigation and footer link only to registered pages;
 *  - every platform-layer claim names evidence that exists in the repository;
 *  - solutions list only installed runtimes;
 *  - public surfaces carry no fabricated proof (metrics, logos, testimonials, social
 *    profiles, raster images) and no customer-facing "CoreGrid";
 *  - SEO artifacts (sitemap, robots, canonical) point at sherivs.com.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PublicPageSchema } from "@/content/schema";
import { HOME_MOVEMENTS } from "@/content/sherivs/home";
import { PLATFORM_LAYERS, findPlatformLayer } from "@/content/sherivs/platform-layers";
import { publicPageHead, organizationJsonLd } from "@/content/sherivs/seo";
import { FOOTER_COLUMNS, PRIMARY_NAV, PUBLIC_PAGES } from "@/content/sherivs/site-map";
import { buildSitemapXml, platformSitemapEntries } from "@/content/sherivs/sitemap";
import { SOLUTION_SEGMENTS } from "@/content/sherivs/solutions";
import { HealthPayloadSchema, formatUptime, parseHealthPayload } from "@/content/sherivs/status";
import {
  PLATFORM_DOMAIN,
  PLATFORM_NAME,
  PLATFORM_ORIGIN,
  PLATFORM_TAGLINE,
  platformUrl,
} from "@/lib/platform";
import { INSTALLED_RUNTIMES, INSTALLED_RUNTIME_BRAND_NAME } from "@/lib/runtime/installed-runtimes";
import { PLATFORM_HOSTS } from "@/lib/tenant";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (ref: string) => readFileSync(join(ROOT, ref), "utf8");
const routeTree = read("frontend/src/routeTree.gen.ts");

function filesUnder(dir: string): string[] {
  return readdirSync(join(ROOT, dir), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? filesUnder(`${dir}/${entry.name}`) : [`${dir}/${entry.name}`],
  );
}

/** Customer-facing Sherivs public surfaces (source files rendered to visitors). */
const PUBLIC_SURFACES = [
  ...filesUnder("frontend/src/components/sherivs"),
  ...filesUnder("frontend/src/content/sherivs"),
  ...filesUnder("frontend/src/routes/(site)").filter((file) => !file.includes("/-content/")),
  "frontend/src/routes/(site)/-content/site-content.ts",
  "frontend/src/routes/(site)/-content/pricing-tiers.ts",
  "frontend/src/routes/index.tsx",
  "frontend/src/routes/platform.tsx",
  "frontend/src/routes/platform_.$layer.tsx",
  "frontend/src/routes/__root.tsx",
];

describe("Brand identity", () => {
  it("presents the platform as Sherivs on sherivs.com", () => {
    expect(PLATFORM_NAME).toBe("Sherivs");
    expect(PLATFORM_TAGLINE).toBe("Institutional Intelligence Infrastructure");
    expect(PLATFORM_DOMAIN).toBe("sherivs.com");
    expect(PLATFORM_ORIGIN).toBe("https://sherivs.com");
    expect(platformUrl("/security/")).toBe("https://sherivs.com/security");
    expect(platformUrl("/")).toBe("https://sherivs.com/");
  });

  it("names the education runtime Sherivs Scholar, in the runtime layer", () => {
    expect(INSTALLED_RUNTIME_BRAND_NAME).toBe("Sherivs Scholar");
  });

  it("treats sherivs.com hosts as platform hosts, never as tenant subdomains", () => {
    for (const host of ["sherivs.com", "www.sherivs.com", "app.sherivs.com"]) {
      expect(PLATFORM_HOSTS).toContain(host);
    }
  });

  it("keeps CoreGrid out of customer-facing public surfaces", () => {
    const offenders = PUBLIC_SURFACES.filter((file) => {
      if (file.endsWith("(site)/coregrid.tsx")) return false; // compatibility redirect
      return /CoreGrid/u.test(read(file));
    });
    expect(offenders).toEqual([]);
  });

  it("brands the PWA push notifications and the mobile app as Sherivs", () => {
    expect(read("public/sw.js")).toMatch(/title:\s*"Sherivs"|"Sherivs"/u);
    const app = JSON.parse(read("mobile/app.json")) as { expo: { name: string; slug: string } };
    expect(app.expo.name).toBe("Sherivs");
    // The slug is a store/build identifier — a compatibility contract, not copy.
    expect(app.expo.slug.length).toBeGreaterThan(0);
  });
});

describe("Public page registry", () => {
  it("parses every page through the schema and has unique paths", () => {
    for (const page of PUBLIC_PAGES) expect(() => PublicPageSchema.parse(page)).not.toThrow();
    const paths = PUBLIC_PAGES.map((page) => page.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("serves every registered page from a real route in the generated tree", () => {
    const missing = PUBLIC_PAGES.filter((page) => {
      const layer = page.path.match(/^\/platform\/([a-z-]+)$/u);
      if (layer) return !findPlatformLayer(layer[1]) || !routeTree.includes("'/platform/$layer'");
      const segment = page.path.match(/^\/solutions\/([a-z-]+)$/u);
      if (segment) return !routeTree.includes("'/solutions/$segment'");
      return !routeTree.includes(`'${page.path}'`) && !routeTree.includes(`'${page.path}/'`);
    });
    expect(missing.map((page) => page.path)).toEqual([]);
  });

  it("links navigation and footer only to registered pages", () => {
    const registered = new Set(PUBLIC_PAGES.map((page) => page.path));
    const hrefs = [
      ...PRIMARY_NAV.flatMap((group) => [
        group.href,
        ...(group.links ?? []).map((link) => link.href),
      ]),
      ...FOOTER_COLUMNS.flatMap((column) => column.links.map((link) => link.href)),
    ];
    expect(hrefs.filter((href) => !registered.has(href))).toEqual([]);
  });

  it("does not register pages the platform cannot back yet", () => {
    for (const absent of [
      "/contact",
      "/request-demo",
      "/blog",
      "/customers",
      "/legal/privacy",
      "/legal/terms",
    ]) {
      expect(
        PUBLIC_PAGES.some((page) => page.path === absent),
        absent,
      ).toBe(false);
    }
  });

  it("derives head metadata and canonical URLs from the registry", () => {
    const head = publicPageHead("/security");
    expect(head.links).toEqual([{ rel: "canonical", href: "https://sherivs.com/security" }]);
    expect(head.meta).toContainEqual({ title: "Security — Sherivs" });
    expect(() => publicPageHead("/not-registered")).toThrow();
  });

  it("emits a factual Organization record with no ratings or counts", () => {
    const record = JSON.parse(organizationJsonLd()) as Record<string, unknown>;
    expect(record["@type"]).toBe("Organization");
    expect(record.url).toBe("https://sherivs.com/");
    expect(record).not.toHaveProperty("aggregateRating");
    expect(record).not.toHaveProperty("sameAs");
  });
});

describe("Platform layers and solutions are traceable to the system", () => {
  it("has seven layers, numbered 01..07, each with capabilities and guarantees", () => {
    expect(PLATFORM_LAYERS.map((layer) => layer.index)).toEqual([
      "01",
      "02",
      "03",
      "04",
      "05",
      "06",
      "07",
    ]);
    for (const layer of PLATFORM_LAYERS) {
      expect(layer.capabilities.length).toBeGreaterThan(0);
      expect(layer.guarantees.length).toBeGreaterThan(0);
    }
  });

  it("names repository evidence that exists for every layer claim", () => {
    const missing = PLATFORM_LAYERS.flatMap((layer) =>
      layer.evidence
        .filter((ref) => !existsSync(join(ROOT, ref)))
        .map((ref) => `${layer.slug}: ${ref}`),
    );
    expect(missing).toEqual([]);
  });

  it("lists a sector runtime only when it is installed", () => {
    const installed = new Set(INSTALLED_RUNTIMES.map((runtime) => runtime.id));
    for (const segment of SOLUTION_SEGMENTS) {
      if (segment.runtimeId) expect(installed.has(segment.runtimeId)).toBe(true);
      for (const slug of segment.layers) expect(findPlatformLayer(slug), slug).toBeDefined();
    }
  });
});

describe("Homepage narrative", () => {
  const home = read("frontend/src/components/sherivs/home.tsx");
  const movements = Object.values(HOME_MOVEMENTS);

  it("has twelve movements numbered 01..12", () => {
    expect(movements.map((movement) => movement.index)).toEqual(
      Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, "0")),
    );
  });

  it("renders a labelled heading for every movement and exactly one h1", () => {
    for (const movement of movements) {
      expect(home).toContain(`id="${movement.id}-heading"`);
    }
    expect(home.match(/<h1\b/gu)?.length).toBe(1);
  });

  it("is rendered for anonymous visitors on the platform host", () => {
    const index = read("frontend/src/routes/index.tsx");
    expect(index).toContain("<SherivsHome />");
    expect(index).toContain("<PublicSchoolSite");
    expect(index).not.toContain("CommandCentre");
  });
});

describe("No fabricated proof on public surfaces", () => {
  const FABRICATION = [
    { name: "percentage metric", pattern: />[^<{]*\b\d{1,3}(?:\.\d+)?%/u },
    {
      name: "inflated count",
      pattern: /\b\d[\d,]*\+\s+(?:schools|users|customers|organizations|institutions)/iu,
    },
    {
      name: "social proof",
      pattern: /\btrusted by|testimonial|case stud|customers love|as seen in/iu,
    },
    {
      name: "social profile",
      pattern: /(?:twitter|x|linkedin|facebook|instagram|youtube|tiktok)\.com\//iu,
    },
    { name: "raster image", pattern: /<img\b/u },
    { name: "fake activity", pattern: /AI is thinking|live activity|real-time feed/iu },
  ];

  /** Rendered strings only: doc comments may name what the page refuses to show. */
  const withoutComments = (source: string) =>
    source.replace(/\/\*[\s\S]*?\*\//gu, "").replace(/^\s*\/\/.*$/gmu, "");

  for (const file of PUBLIC_SURFACES) {
    it(`${file.replace("frontend/src/", "")} carries no fabricated proof`, () => {
      const source = withoutComments(read(file));
      for (const { name, pattern } of FABRICATION) {
        expect(source, `${name} in ${file}`).not.toMatch(pattern);
      }
    });
  }

  it("never submits a form from the public shell or pages", () => {
    for (const file of PUBLIC_SURFACES) {
      expect(read(file), file).not.toMatch(/<form\b|onSubmit/u);
    }
  });
});

describe("SEO artifacts", () => {
  it("builds a sitemap of indexable registry pages on sherivs.com", () => {
    const xml = buildSitemapXml(platformSitemapEntries());
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/gu)].map((match) => match[1]);
    expect(locs.length).toBe(PUBLIC_PAGES.filter((page) => page.indexable).length);
    for (const loc of locs) expect(loc.startsWith("https://sherivs.com/")).toBe(true);
  });

  it("escapes tenant query strings in sitemap locations", () => {
    const xml = buildSitemapXml([{ path: "/?school=a&b" }]);
    expect(xml).toContain("<loc>https://sherivs.com/?school=a&amp;b</loc>");
  });

  it("points robots.txt at the sherivs.com sitemap", () => {
    const robots = read("public/robots.txt");
    expect(robots).toMatch(/^Sitemap: https:\/\/sherivs\.com\/sitemap\.xml$/mu);
    expect(robots).not.toMatch(/universalschoolos|CoreGrid/u);
  });

  it("uses no legacy domain in public metadata", () => {
    for (const file of [
      "frontend/src/routes/__root.tsx",
      "frontend/src/routes/index.tsx",
      "frontend/src/routes/sitemap[.]xml.ts",
    ]) {
      expect(read(file), file).not.toMatch(/universalschoolos/u);
    }
  });
});

describe("Status page reads the real health endpoint, schema-validated", () => {
  const valid = {
    status: "degraded",
    ts: "2026-10-08T22:00:00.000Z",
    uptime_s: 3_725,
    memory: { rss_mb: 1, heap_used_mb: 1 },
    version: null,
    checks: [{ name: "database", status: "degraded" }],
  };

  it("accepts the health report shape and strips fields it does not render", () => {
    const reading = parseHealthPayload(valid);
    expect(reading.kind).toBe("reading");
    if (reading.kind === "reading") {
      expect(reading.payload.status).toBe("degraded");
      expect(reading.payload).not.toHaveProperty("memory");
    }
  });

  it("refuses malformed payloads instead of rendering them as healthy", () => {
    expect(parseHealthPayload({ ...valid, status: "fine" }).kind).toBe("invalid");
    expect(parseHealthPayload(null).kind).toBe("invalid");
    expect(parseHealthPayload("<html>").kind).toBe("invalid");
    expect(HealthPayloadSchema.safeParse({ ...valid, ts: "yesterday" }).success).toBe(false);
  });

  it("formats uptime coarsely", () => {
    expect(formatUptime(42)).toBe("0 min");
    expect(formatUptime(3_725)).toBe("1 h 2 min");
    expect(formatUptime(2 * 86_400 + 3_600)).toBe("2 d 1 h");
  });

  it("is client-rendered from /health.json with no hand-set status", () => {
    const page = read("frontend/src/routes/(site)/status.tsx");
    expect(page).toContain('fetch("/health.json"');
    expect(page).toContain("parseHealthPayload");
    expect(page).not.toMatch(/status:\s*"ok"/u);
  });
});

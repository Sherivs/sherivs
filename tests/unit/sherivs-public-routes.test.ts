/**
 * Sherivs public route registry — conformance with the file route tree,
 * truthful navigation, sitemap derivation, no fabricated claims, V1 scope.
 */
import { describe, expect, it } from "vitest";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DEFERRED_PUBLIC_ROUTES,
  LIVE_PUBLIC_ROUTES,
  PUBLIC_ROUTES,
  liveRoutesIn,
  publicBreadcrumbs,
} from "@/lib/experience-system/public-routes";
import { PLATFORM_PAGES } from "@/lib/experience-system/public-content";
import { buildPublicSitemapEntries } from "@/lib/experience-system/sitemap";
import { publicHead } from "@/lib/experience-system/seo";
import { canonicalUrl } from "@/lib/experience-system/sherivs-brand";
import type { ContentItem } from "@/lib/experience-system/content";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const read = (ref: string) => readFileSync(join(ROOT, ref), "utf8");
const SITE_DIR = join(ROOT, "frontend/src/routes/(site)");

function walk(dir: string, acc: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== "-content") walk(full, acc);
    } else acc.push(full);
  }
  return acc;
}

/** Route ids declared by the (site) group's files, e.g. "/(site)/platform/$slug". */
function declaredSiteRoutes(): string[] {
  return walk(SITE_DIR)
    .map((f) => readFileSync(f, "utf8").match(/createFileRoute\("([^"]+)"\)/)?.[1])
    .filter((v): v is string => typeof v === "string");
}

/** Convert a registry path to the candidate route ids that may serve it. */
function routeIdsServing(path: string): string[] {
  if (path === "/") return [];
  const ids = [`/(site)${path}`, `/(site)${path}/`];
  const segs = path.split("/").filter(Boolean);
  if (segs.length > 1) ids.push(`/(site)/${segs.slice(0, -1).join("/")}/$slug`);
  return ids;
}

describe("registry integrity", () => {
  it("has unique paths", () => {
    const paths = PUBLIC_ROUTES.map((r) => r.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("every LIVE entry has a description and a sitemap priority", () => {
    for (const r of LIVE_PUBLIC_ROUTES) {
      expect(r.description.length, r.path).toBeGreaterThan(30);
      expect(r.priority, r.path).toBeGreaterThan(0);
    }
  });

  it("every DEFERRED entry records why it does not exist", () => {
    expect(DEFERRED_PUBLIC_ROUTES.length).toBeGreaterThan(0);
    for (const r of DEFERRED_PUBLIC_ROUTES) expect(r.deferredReason?.length, r.path).toBeGreaterThan(20);
  });
});

describe("registry <-> file route tree", () => {
  const declared = declaredSiteRoutes();
  const tree = read("frontend/src/routeTree.gen.ts");

  it("backs every LIVE route with a real route module", () => {
    const missing: string[] = [];
    for (const r of LIVE_PUBLIC_ROUTES) {
      if (r.path === "/") {
        expect(existsSync(join(ROOT, "frontend/src/routes/index.tsx"))).toBe(true);
        continue;
      }
      const ids = routeIdsServing(r.path);
      if (!declared.some((d) => ids.includes(d))) missing.push(r.path);
    }
    expect(missing).toEqual([]);
  });

  it("backs every platform part with registry content and a registry route", () => {
    const livePlatform = liveRoutesIn("platform").map((r) => r.path).filter((p) => p !== "/platform");
    expect(livePlatform.sort()).toEqual(PLATFORM_PAGES.map((p) => `/platform/${p.slug}`).sort());
  });

  it("builds NO route module for a DEFERRED entry (no stub pages)", () => {
    for (const r of DEFERRED_PUBLIC_ROUTES) {
      const ids = routeIdsServing(r.path).filter((id) => !id.endsWith("/$slug"));
      expect(declared.filter((d) => ids.includes(d)), r.path).toEqual([]);
    }
  });

  it("registers the pages in the generated route tree", () => {
    for (const id of ["/(site)/pricing", "/(site)/security", "/(site)/status", "/(site)/platform/$slug"]) {
      expect(tree).toContain(`'${id}'`);
    }
  });

  it("keeps operator surfaces out of the public tree", () => {
    expect(existsSync(join(ROOT, "frontend/src/routes/platform.tsx"))).toBe(false);
    expect(existsSync(join(ROOT, "frontend/src/routes/platform.org.tsx"))).toBe(false);
    for (const f of ["architecture.tsx", "organization.tsx"]) {
      expect(existsSync(join(ROOT, "frontend/src/routes/_authenticated/super-admin", f))).toBe(true);
    }
    expect(read("frontend/src/routes/_authenticated/super-admin/route.tsx")).toContain("super_admin");
    expect(read("frontend/src/routes/_authenticated/command-centre/route.tsx")).toContain("super_admin");
  });

  it("no longer renders the provisioning wizard from the public root", () => {
    expect(read("frontend/src/routes/index.tsx")).not.toContain("CommandCentre");
    expect(read("frontend/src/routes/_authenticated/command-centre/provision.tsx")).toContain("CommandCentre");
  });
});

describe("navigation truthfulness", () => {
  it("derives navigation and footer from LIVE routes only", () => {
    const shell = read("frontend/src/components/sherivs/public-shell.tsx");
    expect(shell).toContain("liveRoutesIn");
    for (const r of DEFERRED_PUBLIC_ROUTES) expect(shell, r.path).not.toContain(`"${r.path}"`);
  });

  it("contains no social links because no verified accounts exist", () => {
    const shell = read("frontend/src/components/sherivs/public-shell.tsx");
    expect(shell).not.toMatch(/twitter\.com|x\.com|linkedin\.com|facebook\.com|instagram\.com|youtube\.com|github\.com/i);
  });

  it("builds breadcrumbs from registry titles", () => {
    expect(publicBreadcrumbs("/platform/missions").map((c) => c.label)).toEqual(["Home", "Platform", "Missions"]);
    expect(publicBreadcrumbs("/")).toEqual([{ label: "Home", path: "/" }]);
  });
});

describe("sitemap", () => {
  const published: ContentItem = {
    kind: "guides",
    slug: "first-guide",
    title: "First guide",
    description: "A real guide.",
    body: ["Body."],
    author: { name: "Sherivs" },
    status: "published",
    publishedAt: "2026-01-01T00:00:00Z",
    tags: [],
    categories: [],
    locale: "en",
    accessLevel: "public",
    seo: {},
    related: [],
  };
  const now = new Date("2026-06-01T00:00:00Z");

  it("lists only LIVE routes and omits /resources while nothing is published", () => {
    const paths = buildPublicSitemapEntries([], now).map((e) => e.path);
    expect(paths).toContain("/platform/reality");
    expect(paths).not.toContain("/resources");
    for (const r of DEFERRED_PUBLIC_ROUTES) expect(paths).not.toContain(r.path);
  });

  it("adds /resources and each published item once content exists", () => {
    const paths = buildPublicSitemapEntries([published], now).map((e) => e.path);
    expect(paths).toContain("/resources");
    expect(paths).toContain("/resources/guides/first-guide");
  });

  it("never lists unpublished or future content", () => {
    const draft = { ...published, slug: "draft", status: "draft" as const };
    const future = { ...published, slug: "future", publishedAt: "2027-01-01T00:00:00Z" };
    const paths = buildPublicSitemapEntries([draft, future], now).map((e) => e.path);
    expect(paths.some((p) => p.includes("draft") || p.includes("future"))).toBe(false);
  });

  it("serves the sitemap and robots on the canonical Sherivs origin", () => {
    expect(read("frontend/src/routes/sitemap[.]xml.ts")).toContain("SHERIVS_BRAND.canonicalOrigin");
    const robots = read("public/robots.txt");
    expect(robots).toContain("Sitemap: https://sherivs.com/sitemap.xml");
    expect(robots).toContain("Disallow: /super-admin/");
  });
});

describe("seo head", () => {
  it("emits canonical, og and twitter tags from the registry", () => {
    const head = publicHead({ path: "/security" });
    expect(head.links).toEqual([{ rel: "canonical", href: canonicalUrl("/security") }]);
    const names = head.meta.map((m) => m.property ?? m.name ?? (m.title ? "title" : ""));
    for (const k of ["title", "description", "og:title", "og:description", "og:url", "twitter:card"]) {
      expect(names).toContain(k);
    }
  });

  it("marks noindex only on request", () => {
    expect(publicHead({ path: "/resources" }).meta.some((m) => m.name === "robots")).toBe(false);
    expect(publicHead({ path: "/resources", noindex: true }).meta).toContainEqual({
      name: "robots",
      content: "noindex",
    });
  });
});

describe("honesty and V1 scope on the public surface", () => {
  const files = [
    ...walk(SITE_DIR),
    join(ROOT, "frontend/src/components/sherivs/home-page.tsx"),
    join(ROOT, "frontend/src/lib/experience-system/public-content.ts"),
    join(ROOT, "frontend/src/lib/experience-system/public-routes.ts"),
  ];
  /** Scan shipped copy and code, not the comments that explain what is deliberately absent. */
  const text = (f: string) =>
    readFileSync(f, "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");
  const rel = (f: string) => relative(ROOT, f).split(sep).join("/");

  it("makes no customer, metric, testimonial or uptime claim", () => {
    const FORBIDDEN = [
      /\btrusted by\b/i,
      /\b\d[\d,]*\+?\s+(customers|schools|organizations|institutions|users)\b/i,
      /testimonial/i,
      /99\.\d+\s*%/,
      /as seen (in|on)/i,
      /award[- ]winning/i,
    ];
    const offenders: string[] = [];
    for (const f of files) for (const p of FORBIDDEN) if (p.test(text(f))) offenders.push(`${rel(f)}: ${p}`);
    expect(offenders).toEqual([]);
  });

  it("does not describe frozen V2/V3 capability (devices, IoT, digital twins, reality intelligence)", () => {
    const FROZEN = [/digital twin/i, /\biot\b/i, /smart building/i, /sensor/i, /reality intelligence/i];
    const offenders: string[] = [];
    for (const f of files) for (const p of FROZEN) if (p.test(text(f))) offenders.push(`${rel(f)}: ${p}`);
    expect(offenders).toEqual([]);
  });

  it("never presents the legacy brand to visitors", () => {
    for (const f of files) expect(text(f), rel(f)).not.toMatch(/CoreGrid/);
  });
});

/**
 * Sherivs route architecture — the declaration is a consumed contract.
 *
 *  - every LIVE route has a route file (or is a wildcard family with a parent);
 *  - PLANNED routes have NO route file and are never linked from chrome;
 *  - sitemap routes are LIVE, indexable and static;
 *  - the system routes exist (health, sitemap, manifest, robots).
 */
import { describe, expect, it } from "vitest";
import { existsSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  EXPERIENCE_ROUTES,
  linkablePublicRoutes,
  publicFooterGroups,
  publicPrimaryNav,
  routeFileCandidates,
  routesForPlane,
  sitemapRoutes,
} from "@/lib/experience/route-architecture";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const ROUTES_DIR = join(ROOT, "frontend/src/routes");

function allRouteFiles(dir = ROUTES_DIR, prefix = ""): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const abs = join(dir, entry);
    const rel = prefix ? `${prefix}/${entry}` : entry;
    if (statSync(abs).isDirectory()) out.push(...allRouteFiles(abs, rel));
    else out.push(rel);
  }
  return out;
}

const ROUTE_FILES = allRouteFiles();

/** Strip layout-group and pathless-layout prefixes to compare against URL paths. */
function normalize(file: string): string {
  return file
    .replace(/^\(site\)\//, "")
    .replace(/^_authenticated\//, "")
    .replace(/\[\.\]/g, ".");
}

const NORMALIZED_FILES = new Set(ROUTE_FILES.map(normalize));

function hasRouteFile(path: string, { allowDynamic = true } = {}): boolean {
  const candidates = routeFileCandidates(path).map((c) => c.replace(/\[\.\]/g, "."));
  if (candidates.some((c) => NORMALIZED_FILES.has(c))) return true;
  // Static system files are served from public/.
  if (existsSync(join(ROOT, "public", path.slice(1)))) return true;
  // Static paths served by a sibling dynamic route (/platform/reality ← platform.$pillar.tsx).
  const segments = path.slice(1).split("/");
  if (allowDynamic && segments.length >= 2) {
    const parent = segments.slice(0, -1).join(".");
    if ([...NORMALIZED_FILES].some((f) => new RegExp(`^${parent.replace(/[.$]/g, "\\$&")}\\.\\$[^./]+\\.tsx$`).test(f))) return true;
  }
  // Wildcard families (/admin/*) are satisfied by any file under that folder or flat prefix.
  if (path.endsWith("/*")) {
    const base = path.slice(1, -2);
    return [...NORMALIZED_FILES].some((f) => f.startsWith(`${base}/`) || f.startsWith(`${base}.`));
  }
  return false;
}

describe("Route architecture — declaration integrity", () => {
  it("declares every route with a plane, label, status and owning mission", () => {
    for (const route of EXPERIENCE_ROUTES) {
      expect(route.path.startsWith("/"), route.path).toBe(true);
      expect(route.label.length, route.path).toBeGreaterThan(0);
      expect(["LIVE", "LEGACY", "PLANNED"]).toContain(route.status);
      expect(route.mission, route.path).toMatch(/^SX-\d+$/);
    }
  });

  it("has no duplicate path within a plane", () => {
    const seen = new Set<string>();
    for (const route of EXPERIENCE_ROUTES) {
      const key = `${route.plane}:${route.path}`;
      expect(seen.has(key), key).toBe(false);
      seen.add(key);
    }
  });

  it("only LIVE public routes carry primaryNav / footerGroup / indexable flags", () => {
    for (const route of EXPERIENCE_ROUTES) {
      if (route.primaryNav || route.footerGroup || route.indexable) {
        expect(route.plane, route.path).toBe("public");
        expect(route.status, route.path).toBe("LIVE");
      }
    }
  });
});

describe("Route architecture — implementation truth", () => {
  it("every LIVE or LEGACY public/auth/shell route has a route file", () => {
    const planes = ["public", "auth", "shell", "org-public", "org-workspace", "internal", "system"] as const;
    for (const plane of planes) {
      for (const route of routesForPlane(plane)) {
        if (route.status === "PLANNED") continue;
        expect(hasRouteFile(route.path), `${plane} ${route.path} (${route.status}) has no route file`).toBe(true);
      }
    }
  });

  it("no PLANNED route has a route file (status must be upgraded when implemented)", () => {
    for (const route of EXPERIENCE_ROUTES) {
      if (route.status !== "PLANNED") continue;
      expect(hasRouteFile(route.path, { allowDynamic: false }), `${route.path} is PLANNED but a route file exists`).toBe(false);
    }
  });

  it("chrome never links a PLANNED route", () => {
    const linked = [...publicPrimaryNav(), ...publicFooterGroups().flatMap((g) => g.routes)];
    for (const route of linked) expect(route.status, route.path).toBe("LIVE");
    expect(linkablePublicRoutes().every((route) => route.status === "LIVE")).toBe(true);
  });

  it("sitemap routes are LIVE, indexable, static, and exclude /status", () => {
    const paths = sitemapRoutes().map((route) => route.path);
    expect(paths).toContain("/");
    expect(paths).toContain("/platform");
    expect(paths).not.toContain("/status");
    for (const route of sitemapRoutes()) {
      expect(route.status).toBe("LIVE");
      expect(route.indexable).toBe(true);
      expect(route.path).not.toMatch(/[$*]/);
    }
  });

  it("system endpoints exist", () => {
    expect(existsSync(join(ROUTES_DIR, "health[.]json.ts"))).toBe(true);
    expect(existsSync(join(ROUTES_DIR, "sitemap[.]xml.ts"))).toBe(true);
    expect(existsSync(join(ROUTES_DIR, "manifest[.]webmanifest.ts"))).toBe(true);
    expect(existsSync(join(ROOT, "public/robots.txt"))).toBe(true);
  });
});

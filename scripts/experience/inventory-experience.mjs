#!/usr/bin/env node
/**
 * Sherivs Experience Program — Phase A reconnaissance.
 *
 * Deterministically inventories every experience surface in the repository so
 * the experience architecture is derived from verified state, not assumption:
 * routes, layouts, components, tokens, accessibility signals, responsive
 * signals, PWA/mobile surfaces, server functions and brand references.
 *
 * Output (stable ordering, no timestamps, safe to diff):
 *   architecture/experience/SHERIVS_EXPERIENCE_INVENTORY.json
 *
 * Usage:
 *   node scripts/experience/inventory-experience.mjs          # write
 *   node scripts/experience/inventory-experience.mjs --check  # fail if stale
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyBrandLine } from "./brand-classifier.mjs";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const FRONTEND = join(ROOT, "frontend/src");
const OUT = join(ROOT, "architecture/experience/SHERIVS_EXPERIENCE_INVENTORY.json");

const posix = (p) => p.split(sep).join("/");
const rel = (p) => posix(relative(ROOT, p));

function walk(dir, filter = () => true, acc = []) {
  if (!existsSync(dir)) return acc;
  for (const name of readdirSync(dir).sort()) {
    if (name === "node_modules" || name === ".git") continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, filter, acc);
    else if (filter(full)) acc.push(full);
  }
  return acc;
}

const read = (p) => readFileSync(p, "utf8");
const count = (text, re) => (text.match(re) ?? []).length;

// ── Routes ────────────────────────────────────────────────────────────────
function routeUrlFromFile(file) {
  let r = posix(relative(join(FRONTEND, "routes"), file)).replace(/\.(tsx|ts)$/, "");
  const segments = r.split("/").flatMap((seg) => seg.split("."));
  const out = [];
  for (const seg of segments) {
    if (seg === "route" || seg === "index") continue;
    if (/^\(.*\)$/.test(seg)) continue; // pathless group
    if (seg.startsWith("_")) continue; // pathless layout
    if (seg.startsWith("-")) return null; // co-located non-route
    if (seg.startsWith("$")) out.push(`:${seg.slice(1)}`);
    else out.push(seg.replace(/\[\.\]/g, "."));
  }
  return "/" + out.join("/");
}

const routeFiles = walk(
  join(FRONTEND, "routes"),
  (f) => /\.(tsx|ts)$/.test(f) && !posix(f).includes("/-content/"),
);

const routes = routeFiles.map((file) => {
  const text = read(file);
  const r = rel(file);
  const isLayout = /\/route\.tsx$/.test(r) || /__root\.tsx$/.test(r);
  const isApi = /\/api\//.test(r) || /server:\s*\{\s*handlers/.test(text);
  const authenticated = r.includes("/_authenticated/");
  const guardMatch = text.match(/<RoleGuard\s+allow=\{\[([^\]]*)\]\}/);
  return {
    file: r,
    url: routeUrlFromFile(file),
    kind: isApi ? "api" : isLayout ? "layout" : "page",
    group: authenticated
      ? "authenticated"
      : r.includes("/(site)/")
        ? "public-site"
        : "public",
    roleGuard: guardMatch ? guardMatch[1].replace(/["'\s]/g, "") : null,
    hasHeadMeta: /head:\s*\(/.test(text),
    hasCanonical: /rel:\s*"canonical"/.test(text),
    ssrDisabled: /ssr:\s*false/.test(text),
    lines: text.split("\n").length,
  };
});

// ── Components ────────────────────────────────────────────────────────────
const componentFiles = walk(join(FRONTEND, "components"), (f) => /\.(tsx|ts)$/.test(f));
const components = componentFiles.map((file) => {
  const r = rel(file);
  const sub = posix(relative(join(FRONTEND, "components"), file)).split("/");
  const family = sub.length > 1 ? sub[0] : "root";
  return { file: r, family, lines: read(file).split("\n").length };
});
const componentFamilies = {};
for (const c of components) componentFamilies[c.family] = (componentFamilies[c.family] ?? 0) + 1;

// ── Tokens, accessibility, responsive ─────────────────────────────────────
const css = read(join(FRONTEND, "styles.css"));
const customProps = [...new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]))].sort();

const uiSources = walk(FRONTEND, (f) => /\.(tsx)$/.test(f));
let ariaAttrs = 0, roleAttrs = 0, srOnly = 0, focusVisible = 0, motionSafe = 0, reducedMotionCss = 0;
const responsivePrefix = { xs: 0, sm: 0, md: 0, lg: 0, xl: 0, "2xl": 0 };
let hardcodedHex = 0;
for (const f of uiSources) {
  const t = read(f);
  ariaAttrs += count(t, /\baria-[a-z]+=/g);
  roleAttrs += count(t, /\brole=/g);
  srOnly += count(t, /\bsr-only\b/g);
  focusVisible += count(t, /focus-visible:/g);
  motionSafe += count(t, /motion-(reduce|safe):/g);
  for (const bp of Object.keys(responsivePrefix)) {
    responsivePrefix[bp] += count(t, new RegExp(`[\\s"'\`:]${bp}:[a-z\\[]`, "g"));
  }
  hardcodedHex += count(t, /#[0-9a-fA-F]{6}\b/g);
}
reducedMotionCss = count(css, /prefers-reduced-motion/g);

// ── PWA / mobile ──────────────────────────────────────────────────────────
const sw = existsSync(join(ROOT, "public/sw.js")) ? read(join(ROOT, "public/sw.js")) : "";
const mobileScreens = walk(join(ROOT, "mobile/app"), (f) => /\.(tsx)$/.test(f)).map(rel);

// ── Server functions (APIs powering experiences) ──────────────────────────
const serverFunctionFiles = walk(
  FRONTEND,
  (f) => /\.functions\.ts$/.test(f) || /\.server\.ts$/.test(f),
).map(rel);

// ── Scholar assumptions in the experience layer ───────────────────────────
const scholarSignals = [];
for (const f of routeFiles.concat(componentFiles)) {
  const r = rel(f);
  const t = read(f);
  const n =
    count(t, /\bschool(s|_id|Id)?\b/gi) +
    count(t, /\bstudent(s)?\b/gi) +
    count(t, /\bteacher(s)?\b/gi) +
    count(t, /\bparent(s)?\b/gi);
  if (n > 0) scholarSignals.push({ file: r, mentions: n });
}
scholarSignals.sort((a, b) => b.mentions - a.mentions || a.file.localeCompare(b.file));
const scholarRouteGroups = {
  scholarPortals: routes.filter((x) => /\/_authenticated\/(admin|teacher|student|parent|bursar|driver|hq)\//.test(x.file) && x.kind === "page").length,
  platformInternal: routes.filter((x) => /\/_authenticated\/super-admin\//.test(x.file) && x.kind === "page").length,
  commandCentre: routes.filter((x) => /command-centre/.test(x.file) && x.kind === "page").length,
};

// ── CoreGrid brand references ─────────────────────────────────────────────
const BRAND_SCAN_ROOTS = [
  ["frontend/src", /\.(ts|tsx|css)$/],
  ["mobile/src", /\.(ts|tsx)$/],
  ["mobile/app", /\.(ts|tsx)$/],
  ["public", /\.(js|txt|webmanifest|json)$/],
  ["packages", /\.(ts|json)$/],
  ["scripts", /\.(mjs|ts|sh)$/],
  ["tests", /\.(ts|tsx)$/],
  ["database", /\.(sql|md)$/],
  ["infrastructure", /\.(tf|yaml|yml|md|json|sh)$/],
];
const brand = { byClass: {}, byZone: {}, customerFacingFiles: {} };
for (const [dirRel, re] of BRAND_SCAN_ROOTS) {
  for (const f of walk(join(ROOT, dirRel), (p) => re.test(p))) {
    const r = rel(f);
    if (r.includes("node_modules") || r.endsWith("routeTree.gen.ts")) continue;
    const lines = read(f).split("\n");
    lines.forEach((line, i) => {
      if (!/coregrid/i.test(line)) return;
      const cls = classifyBrandLine(line, r);
      brand.byClass[cls] = (brand.byClass[cls] ?? 0) + 1;
      brand.byZone[dirRel] = brand.byZone[dirRel] ?? {};
      brand.byZone[dirRel][cls] = (brand.byZone[dirRel][cls] ?? 0) + 1;
      if (cls === "CUSTOMER_FACING") {
        brand.customerFacingFiles[r] = (brand.customerFacingFiles[r] ?? 0) + 1;
      }
    });
  }
}
const rootDocs = readdirSync(ROOT).filter((n) => n.endsWith(".md") || n.endsWith(".json"));
let docRefs = 0;
for (const n of rootDocs) docRefs += count(read(join(ROOT, n)), /coregrid/gi);
brand.byZone["repository-root-docs"] = { GOVERNANCE_DOC: docRefs };

// ── Assemble ──────────────────────────────────────────────────────────────
const pagesByGroup = {};
for (const r of routes.filter((x) => x.kind === "page")) {
  pagesByGroup[r.group] = (pagesByGroup[r.group] ?? 0) + 1;
}

const inventory = {
  artifact: "SHERIVS_EXPERIENCE_INVENTORY",
  generatedBy: "scripts/experience/inventory-experience.mjs",
  versionTarget: "V1",
  totals: {
    routeFiles: routes.length,
    pages: routes.filter((r) => r.kind === "page").length,
    layouts: routes.filter((r) => r.kind === "layout").length,
    apiRoutes: routes.filter((r) => r.kind === "api").length,
    pagesByGroup,
    pagesWithHeadMeta: routes.filter((r) => r.kind === "page" && r.hasHeadMeta).length,
    pagesWithCanonical: routes.filter((r) => r.kind === "page" && r.hasCanonical).length,
    components: components.length,
    componentFamilies,
    serverFunctionFiles: serverFunctionFiles.length,
    mobileScreens: mobileScreens.length,
  },
  tokens: {
    cssCustomProperties: customProps.length,
    names: customProps,
    hardcodedHexInTsx: hardcodedHex,
  },
  accessibility: {
    ariaAttributes: ariaAttrs,
    roleAttributes: roleAttrs,
    srOnlyUses: srOnly,
    focusVisibleUtilities: focusVisible,
    motionSafeReduceUtilities: motionSafe,
    reducedMotionMediaQueriesInCss: reducedMotionCss,
  },
  responsive: { tailwindPrefixUsage: responsivePrefix },
  pwa: {
    serviceWorker: sw.length > 0,
    serviceWorkerCaches: [...sw.matchAll(/const\s+([A-Z_]+_CACHE)\s*=\s*"([^"]+)"/g)].map((m) => m[2]),
    manifestRoute: existsSync(join(FRONTEND, "routes/manifest[.]webmanifest.ts")),
    icons: existsSync(join(ROOT, "public/icons")) ? readdirSync(join(ROOT, "public/icons")).sort() : [],
  },
  mobile: { screens: mobileScreens },
  scholarAssumptions: { routeGroups: scholarRouteGroups, topFiles: scholarSignals.slice(0, 25) },
  serverFunctionFiles,
  brand,
  routes: routes.sort((a, b) => a.file.localeCompare(b.file)),
  components: components.sort((a, b) => a.file.localeCompare(b.file)),
};

const serialized = JSON.stringify(inventory, null, 2) + "\n";
if (process.argv.includes("--check")) {
  const current = existsSync(OUT) ? read(OUT) : "";
  if (current !== serialized) {
    console.error("SHERIVS_EXPERIENCE_INVENTORY.json is stale. Run: node scripts/experience/inventory-experience.mjs");
    process.exit(1);
  }
  console.log("SHERIVS_EXPERIENCE_INVENTORY.json is current.");
} else {
  mkdirSync(dirname(OUT), { recursive: true });
  writeFileSync(OUT, serialized);
  console.log(`Wrote ${rel(OUT)}`);
  console.log(JSON.stringify(inventory.totals, null, 2));
  console.log("brand:", JSON.stringify(inventory.brand.byClass));
}

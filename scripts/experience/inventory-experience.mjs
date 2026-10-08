#!/usr/bin/env node
/**
 * Sherivs Experience program — Phase A reconnaissance.
 *
 * Produces a deterministic, evidence-backed inventory of every experience
 * surface in the repository and a CLASSIFIED audit of every legacy
 * "CoreGrid" reference. Nothing here rewrites source: classification decides
 * what the brand migration may touch (customer-facing) and what it must
 * preserve (technical / database / migration / package compatibility).
 *
 *   node scripts/experience/inventory-experience.mjs          # write artifacts
 *   node scripts/experience/inventory-experience.mjs --check  # fail on drift
 *
 * Outputs (architecture/sherivs-experience/):
 *   SURFACE_INVENTORY.json   routes, layouts, components, tokens, a11y signals
 *   BRAND_REFERENCE_AUDIT.json  per-class counts + every actionable reference
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from "node:fs";
import { join, relative, sep, extname, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const OUT_DIR = join(ROOT, "architecture/sherivs-experience");
const CHECK = process.argv.includes("--check");

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".output",
  ".nitro",
  ".tanstack",
  "dist",
  "dist-ssr",
  ".vinxi",
  ".expo",
]);
const TEXT_EXT = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".css",
  ".sql",
  ".yaml",
  ".yml",
  ".html",
  ".txt",
  ".toml",
  ".sh",
  ".svg",
  ".webmanifest",
]);

function walk(dir, visit) {
  for (const name of readdirSync(dir).sort()) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, visit);
    else visit(full, st);
  }
}
const rel = (p) => relative(ROOT, p).split(sep).join("/");

/* ─────────── routes ─────────── */

function routePathFromFile(file) {
  let p = file.replace(/^frontend\/src\/routes\//, "").replace(/\.(tsx|ts)$/, "");
  const segments = p.split("/").map((seg) => seg.replace(/\[\.\]/g, "."));
  const out = [];
  for (const seg of segments) {
    if (seg === "route" || seg === "index") continue;
    if (/^\(.+\)$/.test(seg)) continue; // pathless group
    if (seg.startsWith("_") && seg !== "__root") continue; // pathless layout
    if (seg.startsWith("-")) continue; // co-located non-route
    for (const part of seg.split(".")) {
      if (!part) continue;
      out.push(part.startsWith("$") ? `:${part.slice(1)}` : part);
    }
  }
  return "/" + out.join("/");
}

function inventoryRoutes() {
  const base = join(ROOT, "frontend/src/routes");
  const routes = [];
  walk(base, (full) => {
    const file = rel(full);
    if (!/\.(tsx|ts)$/.test(file)) return;
    if (file.includes("/-content/")) return;
    const src = readFileSync(full, "utf8");
    const isLayout = /\/route\.tsx$/.test(file) || file.endsWith("__root.tsx");
    const isApi = file.includes("/api/") || /server:\s*\{/.test(src);
    const group = file.includes("/_authenticated/")
      ? "authenticated"
      : file.includes("/(site)/")
        ? "public-site"
        : isApi
          ? "api"
          : "root-public";
    routes.push({
      file,
      path: routePathFromFile(file),
      kind: isLayout ? "layout" : isApi ? "api-or-resource" : "page",
      group,
      hasHead: /head:\s*\(/.test(src),
      clientOnly: /ssr:\s*false/.test(src),
      lines: src.split("\n").length,
    });
  });
  return routes;
}

/* ─────────── components ─────────── */

function inventoryComponents() {
  const base = join(ROOT, "frontend/src/components");
  const rows = [];
  walk(base, (full) => {
    const file = rel(full);
    if (!/\.(tsx|ts)$/.test(file)) return;
    const area = file.replace("frontend/src/components/", "").split("/")[0].replace(/\.(tsx|ts)$/, "");
    rows.push({ file, area: file.split("/").length > 4 ? area : "(root)" });
  });
  const byArea = {};
  for (const r of rows) byArea[r.area] = (byArea[r.area] ?? 0) + 1;
  return { total: rows.length, byArea, files: rows.map((r) => r.file) };
}

/* ─────────── tokens / a11y / responsive signals ─────────── */

function inventoryStyles() {
  const css = readFileSync(join(ROOT, "frontend/src/styles.css"), "utf8");
  const customProps = new Set([...css.matchAll(/(--[a-z0-9-]+)\s*:/gi)].map((m) => m[1]));
  return {
    file: "frontend/src/styles.css",
    lines: css.split("\n").length,
    customProperties: customProps.size,
    hasReducedMotion: /prefers-reduced-motion/.test(css),
    hasHighContrast: /prefers-contrast|\.hc\b|high-contrast/.test(css),
    hasDarkVariant: /@custom-variant dark/.test(css),
    keyframes: [...css.matchAll(/@keyframes\s+([a-z0-9-]+)/gi)].map((m) => m[1]),
  };
}

function inventorySignals() {
  let aria = 0;
  let srOnly = 0;
  let focusVisible = 0;
  let responsivePrefixes = 0;
  let tsxFiles = 0;
  walk(join(ROOT, "frontend/src"), (full) => {
    if (!full.endsWith(".tsx")) return;
    tsxFiles++;
    const src = readFileSync(full, "utf8");
    aria += (src.match(/\baria-[a-z]+=/g) ?? []).length;
    srOnly += (src.match(/\bsr-only\b/g) ?? []).length;
    focusVisible += (src.match(/focus-visible:/g) ?? []).length;
    responsivePrefixes += (src.match(/\b(sm|md|lg|xl|2xl):/g) ?? []).length;
  });
  return { tsxFiles, aria, srOnly, focusVisible, responsivePrefixes };
}

function inventoryMobilePwa() {
  const mobileApp = join(ROOT, "mobile/app");
  const screens = [];
  if (existsSync(mobileApp)) walk(mobileApp, (f) => screens.push(rel(f)));
  const icons = existsSync(join(ROOT, "public/icons")) ? readdirSync(join(ROOT, "public/icons")) : [];
  return {
    nativeApp: { dir: "mobile/", screens },
    pwa: {
      manifestRoute: "frontend/src/routes/manifest[.]webmanifest.ts",
      serviceWorker: existsSync(join(ROOT, "public/sw.js")) ? "public/sw.js" : null,
      icons,
    },
  };
}

/* ─────────── CoreGrid reference classification ─────────── */

const IDENTIFIER_RE =
  /(CoreGrid[A-Z_]|COREGRID_|coregrid[_\-./]|[_\-./]coregrid|coregrid[A-Z]|@coregrid|\bcoregrid\b(?=["'`:,\s]*[:=]))/;
const PROSE_RE = /\b(CoreGrid|COREGRID)\b(?![A-Z_])/;
const COMMENT_LINE = /^\s*(\*|\/\/|\/\*|#|<!--)/;

function classifyReference(file, line) {
  if (file.startsWith("database/")) return "PRESERVE_DATABASE";
  if (file.startsWith("infrastructure/") || file === "Dockerfile") return "PRESERVE_INFRASTRUCTURE";
  if (file.startsWith("packages/") || file.endsWith("package.json") || file.endsWith("package-lock.json"))
    return "PRESERVE_PACKAGE_IDENTITY";
  if (file.startsWith("tests/")) return "FOLLOW_TEST_FIXTURE";
  if (file.startsWith("scripts/")) return "PRESERVE_TOOLING";
  if (file.startsWith("architecture/sherivs-experience/")) return "PRESERVE_GOVERNANCE_RECORD";
  if (/\.(md|txt)$/.test(file) || /^(architecture|progress|docs|agents|\.claude|\.cursor)\//.test(file))
    return "PRESERVE_GOVERNANCE_RECORD";
  if (/^architecture\//.test(file) || file.endsWith(".json") && !file.startsWith("mobile/") && !file.startsWith("public/"))
    return "PRESERVE_GOVERNANCE_RECORD";
  const isSource = /^(frontend|mobile|public|api|backend)\//.test(file);
  if (!isSource) return "PRESERVE_OTHER";
  if (file === "frontend/src/routeTree.gen.ts") return "GENERATED";
  if (COMMENT_LINE.test(line)) return "CODE_COMMENT";
  // Stable identifiers that read like prose but are governed keys: registry phase
  // names (lockstep with REGISTRY.md/PROGRESS.md), evidence mission ids, deep-link scheme.
  if (
    /name:\s*"CoreGrid Integration"/.test(line) ||
    /SCHOLAR_FOUNDATION_MISSION_ID/.test(line) ||
    /"scheme"\s*:/.test(line)
  )
    return "PRESERVE_STABLE_IDENTIFIER";
  if (IDENTIFIER_RE.test(line) && !PROSE_RE.test(line)) return "PRESERVE_TECHNICAL_IDENTIFIER";
  if (PROSE_RE.test(line)) {
    const surface =
      /^(frontend\/src\/(routes|components)|public|mobile\/(app|src\/(screens|components)))/.test(file) ||
      file === "mobile/app.json";
    return surface ? "CUSTOMER_FACING_SURFACE" : "CUSTOMER_FACING_COPY_OR_PROMPT";
  }
  if (/coregrid/i.test(line) && (file === "mobile/app.json" || file.startsWith("public/")))
    return "CUSTOMER_FACING_SURFACE";
  return "PRESERVE_TECHNICAL_IDENTIFIER";
}

function auditBrandReferences() {
  const byClass = {};
  const actionable = [];
  const perFile = {};
  walk(ROOT, (full, st) => {
    if (st.size > 2_000_000) return;
    if (!TEXT_EXT.has(extname(full)) && !full.endsWith("Dockerfile")) return;
    const file = rel(full);
    if (file.startsWith("architecture/sherivs-experience/")) return;
    const text = readFileSync(full, "utf8");
    if (!/coregrid/i.test(text)) return;
    const lines = text.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!/coregrid/i.test(lines[i])) continue;
      const cls = classifyReference(file, lines[i]);
      byClass[cls] = (byClass[cls] ?? 0) + 1;
      perFile[file] = perFile[file] ?? {};
      perFile[file][cls] = (perFile[file][cls] ?? 0) + 1;
      if (cls.startsWith("CUSTOMER_FACING") || cls === "FOLLOW_TEST_FIXTURE" && /Sherivs|CoreGrid ·/.test(lines[i])) {
        actionable.push({ file, line: i + 1, class: cls, text: lines[i].trim().slice(0, 220) });
      }
    }
  });
  const topFiles = Object.entries(perFile)
    .map(([file, c]) => ({ file, total: Object.values(c).reduce((a, b) => a + b, 0), classes: c }))
    .sort((a, b) => b.total - a.total || a.file.localeCompare(b.file))
    .slice(0, 25);
  return {
    total: Object.values(byClass).reduce((a, b) => a + b, 0),
    byClass: Object.fromEntries(Object.entries(byClass).sort()),
    actionable,
    topFiles,
  };
}

/* ─────────── assemble ─────────── */

const routes = inventoryRoutes();
const surface = {
  schema: "sherivs.experience.surface-inventory/v1",
  versionTarget: "V1-ACTIVE",
  routes: {
    total: routes.length,
    byGroup: routes.reduce((a, r) => ((a[r.group] = (a[r.group] ?? 0) + 1), a), {}),
    layouts: routes.filter((r) => r.kind === "layout").map((r) => ({ file: r.file, path: r.path })),
    entries: routes.map(({ file, path, kind, group, hasHead, clientOnly }) => ({
      file,
      path,
      kind,
      group,
      hasHead,
      clientOnly,
    })),
  },
  components: inventoryComponents(),
  styles: inventoryStyles(),
  signals: inventorySignals(),
  mobileAndPwa: inventoryMobilePwa(),
};
const brand = { schema: "sherivs.experience.brand-reference-audit/v1", ...auditBrandReferences() };

const outputs = {
  "SURFACE_INVENTORY.json": surface,
  "BRAND_REFERENCE_AUDIT.json": brand,
};

mkdirSync(OUT_DIR, { recursive: true });
let drift = false;
for (const [name, data] of Object.entries(outputs)) {
  const body = JSON.stringify(data, null, 2) + "\n";
  const target = join(OUT_DIR, name);
  if (CHECK) {
    const current = existsSync(target) ? readFileSync(target, "utf8") : "";
    if (current !== body) {
      drift = true;
      console.error(`DRIFT: ${rel(target)} is stale — run: node scripts/experience/inventory-experience.mjs`);
    }
  } else {
    writeFileSync(target, body);
    console.log(`wrote ${rel(target)}`);
  }
}
console.log(
  `routes=${surface.routes.total} components=${surface.components.total} brandRefs=${brand.total} actionable=${brand.actionable.length}`,
);
console.log(JSON.stringify(brand.byClass, null, 2));
if (drift) process.exit(1);

#!/usr/bin/env node
/**
 * Sherivs — module reachability tracer (mission M1b / E-005).
 *
 * WHAT: for each named module under `frontend/src/lib` (a `<name>.ts(x)` file
 * or a `<name>/` folder) builds the real import graph of the repository and
 * prints REACHABLE (with one example chain) or UNREACHABLE.
 *
 * "Reachable" means: some chain of imports starts at a product entry file and
 * ends at a file of the module. Entry files are everything under
 * `frontend/src/routes` and `frontend/src/components`, plus the server and
 * router entries (`frontend/src/{server,start,router,routeTree.gen}.ts(x)`,
 * `vite.config.ts`, and any source file under `api/`, `backend/`, `mobile/`,
 * `packages/`). Tests and scripts are scanned and reported as importers, but
 * they are NOT entries: a module that only a test imports is UNREACHABLE.
 *
 * Every import form the TypeScript scanner recognises counts as an edge:
 * static `import`, `import type`, `export ... from` (re-exports and barrels),
 * dynamic `import()`, `require()` and `import("...")` type queries. Type-only
 * edges are deliberately NOT discounted: the answer errs towards REACHABLE.
 *
 * LIMIT (say it plainly): only module specifiers are traced. A file that reads
 * another file by path at run time (`readFileSync("frontend/src/lib/x.ts")`)
 * or a JSON registry that lists a path is not an import and is not seen here.
 *
 * Usage:
 *   node scripts/trace-module-reachability.mjs                  # the M1b candidates
 *   node scripts/trace-module-reachability.mjs name-a name-b    # any lib modules
 *   node scripts/trace-module-reachability.mjs --json
 *   node scripts/trace-module-reachability.mjs --require-unreachable name-a
 *       # exit 1 if a named module is REACHABLE
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

export const DEFAULT_MODULES = [
  "planetary-infrastructure",
  "autonomous-economy",
  "twin-civilization",
  "multi-agent-society",
  "simulation-engine",
  "hardware-core",
  "cognitive-architecture",
  "reality-os-kernel",
  "evolution-engine",
  "marketplace-core",
];

export const LIB_DIR = "frontend/src/lib";
export const QUARANTINE_DIR = "frontend/src/lib/_quarantine";

const SOURCE_EXTENSIONS = [".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs"];
const SCAN_ROOTS = ["frontend/src", "tests", "scripts", "api", "backend", "mobile", "packages"];
const ROOT_FILES = ["vite.config.ts", "vitest.config.ts", "playwright.config.ts"];
const SKIP_DIRS = new Set(["node_modules", ".git", "dist", "build", ".output", ".vercel", ".expo"]);

const ENTRY_DIRS = ["frontend/src/routes/", "frontend/src/components/"];
const ENTRY_FILES = new Set([
  "frontend/src/server.ts",
  "frontend/src/start.ts",
  "frontend/src/router.tsx",
  "frontend/src/routeTree.gen.ts",
  "vite.config.ts",
]);
const ENTRY_ROOTS = ["api/", "backend/", "mobile/", "packages/"];

const toPosix = (p) => p.split(path.sep).join("/");

/** Every module specifier a source text imports, in source order, deduplicated. */
export function extractSpecifiers(source) {
  const info = ts.preProcessFile(source, true, true);
  return [...new Set(info.importedFiles.map((f) => f.fileName))];
}

/** A test file is an importer but never an entry. */
export function isTestFile(file) {
  return (
    file.startsWith("tests/") ||
    /\.(test|spec)\.[cm]?[jt]sx?$/.test(file) ||
    file.includes("/__tests__/")
  );
}

/** True for a product entry: a route, a component, or a server/router entry. */
export function isEntryFile(file) {
  if (isTestFile(file)) return false;
  if (ENTRY_FILES.has(file)) return true;
  if (ENTRY_DIRS.some((d) => file.startsWith(d))) return true;
  return ENTRY_ROOTS.some((d) => file.startsWith(d));
}

/**
 * Resolves a specifier to a repo-relative file from `fileSet`, or null when it
 * is a package or does not exist. Handles relative paths, the `@/` alias,
 * explicit extensions, `.js` written for a `.ts` file, and folder `index`.
 */
export function resolveSpecifier(fromFile, specifier, fileSet) {
  let base;
  if (specifier.startsWith("@/")) {
    base = path.posix.join("frontend/src", specifier.slice(2));
  } else if (specifier.startsWith(".")) {
    base = path.posix.join(path.posix.dirname(fromFile), specifier);
  } else {
    return null;
  }
  base = path.posix.normalize(base.split("?")[0]);
  if (fileSet.has(base)) return base;
  for (const ext of SOURCE_EXTENSIONS) {
    if (fileSet.has(base + ext)) return base + ext;
  }
  const withoutJs = base.replace(/\.[cm]?jsx?$/, "");
  if (withoutJs !== base) {
    for (const ext of SOURCE_EXTENSIONS) {
      if (fileSet.has(withoutJs + ext)) return withoutJs + ext;
    }
  }
  for (const ext of SOURCE_EXTENSIONS) {
    const index = `${base}/index${ext}`;
    if (fileSet.has(index)) return index;
  }
  return null;
}

/** Builds `file -> [imported files]` from a `{ path: sourceText }` map. */
export function buildGraph(sources) {
  const fileSet = new Set(Object.keys(sources));
  const imports = new Map();
  for (const file of fileSet) {
    const targets = new Set();
    for (const specifier of extractSpecifiers(sources[file])) {
      const resolved = resolveSpecifier(file, specifier, fileSet);
      if (resolved && resolved !== file) targets.add(resolved);
    }
    imports.set(file, [...targets].sort());
  }
  return imports;
}

/** The files of a lib module: `<lib>/<name>.<ext>` and everything in `<lib>/<name>/`. */
export function moduleFiles(name, files, libDir = LIB_DIR) {
  const folder = `${libDir}/${name}/`;
  const single = new Set(SOURCE_EXTENSIONS.map((ext) => `${libDir}/${name}${ext}`));
  return files.filter((f) => f.startsWith(folder) || single.has(f)).sort();
}

/**
 * Walks importers of the module breadth-first. Returns the shortest chain from
 * an entry file to a module file when one exists.
 */
export function traceModule(name, imports, options = {}) {
  const isEntry = options.isEntry ?? isEntryFile;
  const files = [...imports.keys()];
  const own = moduleFiles(name, files, options.libDir ?? LIB_DIR);
  const ownSet = new Set(own);

  const importedBy = new Map();
  for (const [file, targets] of imports) {
    for (const target of targets) {
      if (!importedBy.has(target)) importedBy.set(target, []);
      importedBy.get(target).push(file);
    }
  }
  for (const list of importedBy.values()) list.sort();

  const direct = new Set();
  for (const file of own) {
    for (const importer of importedBy.get(file) ?? []) {
      if (!ownSet.has(importer)) direct.add(importer);
    }
  }

  // next.get(x) is the file x imports on the way to the module.
  const next = new Map();
  const queue = [...own];
  for (const file of own) next.set(file, null);
  const transitive = new Set();
  let chain = null;
  // A module file that is itself an entry is reachable by definition.
  const ownEntry = own.find((f) => isEntry(f));
  if (ownEntry) chain = [ownEntry];
  while (queue.length > 0) {
    const current = queue.shift();
    for (const importer of importedBy.get(current) ?? []) {
      if (next.has(importer)) continue;
      next.set(importer, current);
      transitive.add(importer);
      queue.push(importer);
      if (!chain && isEntry(importer)) {
        chain = [];
        for (let at = importer; at !== null; at = next.get(at)) chain.push(at);
      }
    }
  }

  const importers = [...transitive].sort();
  return {
    module: name,
    exists: own.length > 0,
    files: own,
    status: own.length === 0 ? "MISSING" : chain ? "REACHABLE" : "UNREACHABLE",
    chain,
    directImporters: [...direct].filter((f) => !isTestFile(f)).sort(),
    directTestImporters: [...direct].filter((f) => isTestFile(f)).sort(),
    transitiveImporters: importers.filter((f) => !isTestFile(f)),
    transitiveTestImporters: importers.filter((f) => isTestFile(f)),
  };
}

/** Every file outside `quarantineDir` that imports a file inside it. */
export function findQuarantineImporters(imports, quarantineDir = QUARANTINE_DIR) {
  const prefix = `${quarantineDir}/`;
  const offenders = [];
  for (const [file, targets] of imports) {
    if (file.startsWith(prefix)) continue;
    for (const target of targets) {
      if (target.startsWith(prefix)) offenders.push({ file, imports: target });
    }
  }
  return offenders.sort((a, b) => a.file.localeCompare(b.file));
}

/** Reads every source file under the scan roots into `{ path: text }`. */
export function readRepositorySources(root) {
  const sources = {};
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) walk(path.join(dir, entry.name));
      } else if (entry.isFile() && SOURCE_EXTENSIONS.includes(path.extname(entry.name))) {
        const abs = path.join(dir, entry.name);
        sources[toPosix(path.relative(root, abs))] = fs.readFileSync(abs, "utf8");
      }
    }
  };
  for (const scanRoot of SCAN_ROOTS) {
    const abs = path.join(root, scanRoot);
    if (fs.existsSync(abs)) walk(abs);
  }
  for (const file of ROOT_FILES) {
    const abs = path.join(root, file);
    if (fs.existsSync(abs)) sources[file] = fs.readFileSync(abs, "utf8");
  }
  return sources;
}

export function formatResult(result) {
  const lines = [];
  if (result.status === "MISSING") {
    lines.push(`${result.module}: MISSING (no file or folder of that name under the lib root)`);
    return lines.join("\n");
  }
  lines.push(`${result.module}: ${result.status}`);
  lines.push(`  files: ${result.files.join(", ")}`);
  if (result.chain) lines.push(`  chain: ${result.chain.join(" -> ")}`);
  lines.push(
    `  direct importers (non-test): ${result.directImporters.length}` +
      (result.directImporters.length ? ` [${result.directImporters.join(", ")}]` : ""),
  );
  lines.push(
    `  transitive importers (non-test): ${result.transitiveImporters.length}; ` +
      `test files that import it directly: ${result.directTestImporters.length}`,
  );
  return lines.join("\n");
}

function main(argv) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const flags = new Set(argv.filter((a) => a.startsWith("--")));
  const names = argv.filter((a) => !a.startsWith("--"));
  const modules = names.length > 0 ? names : DEFAULT_MODULES;

  const sources = readRepositorySources(root);
  const imports = buildGraph(sources);
  const results = modules.map((name) => {
    const libDirs = [LIB_DIR, QUARANTINE_DIR];
    for (const libDir of libDirs) {
      const result = traceModule(name, imports, { libDir });
      if (result.exists) return { ...result, location: libDir };
    }
    return { ...traceModule(name, imports), location: null };
  });

  if (flags.has("--json")) {
    console.log(JSON.stringify(results, null, 2));
  } else {
    console.log(`files scanned: ${imports.size}`);
    for (const result of results) {
      console.log(formatResult(result));
      if (result.location === QUARANTINE_DIR) console.log(`  location: ${QUARANTINE_DIR}`);
    }
    const count = (status) => results.filter((r) => r.status === status).length;
    console.log(
      `SUMMARY reachable=${count("REACHABLE")} unreachable=${count("UNREACHABLE")} missing=${count("MISSING")}`,
    );
  }

  if (flags.has("--require-unreachable") && results.some((r) => r.status !== "UNREACHABLE")) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main(process.argv.slice(2));
}

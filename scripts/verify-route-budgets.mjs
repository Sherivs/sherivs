#!/usr/bin/env node
/**
 * Sherivs route JavaScript budgets (mission M23, ADR-110).
 *
 * Reads the Vite client build manifest (the same file scripts/verify-home-bundle.mjs reads,
 * `.output/public/.vite/manifest.json`, produced by `npm run build -- --manifest`) and measures
 * gzip sizes (level 9, the same as verify-home-bundle) of:
 *
 *   1. The shell: the client entry plus the /home route chunks and everything they import
 *      statically. Reported against the design target (170 KiB, master brief §13.1) and enforced
 *      against the existing /home budget (250 KiB, the limit verify-home-bundle already enforces).
 *      Going over the target is reported, never failed.
 *   2. Every lazily loaded chunk (manifest `isDynamicEntry`): the JavaScript a user downloads when
 *      that chunk loads after the shell, i.e. its own file plus its static imports that are not
 *      already part of the shell. Enforced against 60 KiB per chunk, except for chunks listed in
 *      the reviewed allowlist (scripts/verification/route-budget-allowlist.json), which are held to
 *      their recorded ceiling instead so they cannot grow unnoticed.
 *
 * Units: KiB (1024 bytes), matching the existing 250 KiB /home budget.
 *
 * This script never deletes the manifest (verify-home-bundle does), so run it first when chaining.
 * It is not part of `npm run verify` until the allowlist has been reviewed (ADR-110).
 *
 * Usage: node scripts/verify-route-budgets.mjs [--manifest <file>] [--public-dir <dir>]
 *                                              [--allowlist <file>] [--json]
 * Exit codes: 0 PASS (warnings allowed) · 1 FAIL (a budget broken) · 2 BLOCKED (no manifest).
 */
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { gzipSync } from "node:zlib";

export const KIB = 1024;
export const SHELL_TARGET_BYTES = 170 * KIB;
export const SHELL_LIMIT_BYTES = 250 * KIB;
export const SCREEN_LIMIT_BYTES = 60 * KIB;

/** The shell roots: identical to the /home roots in scripts/verify-home-bundle.mjs. */
export const SHELL_ROOTS = Object.freeze([
  "node_modules/@tanstack/react-start/dist/plugin/default-entry/client.tsx",
  "frontend/src/routes/home/route.tsx?tsr-split=component",
  "frontend/src/routes/home/index.tsx?tsr-split=component",
]);

const isJs = (file) => typeof file === "string" && file.endsWith(".js");

/** Every manifest key reachable from `roots` through static `imports` (roots included). */
export function staticClosure(manifest, roots) {
  const visited = new Set();
  const visit = (key) => {
    if (visited.has(key)) return;
    const entry = manifest[key];
    if (!entry) throw new Error(`Missing bundle entry in manifest: ${key}`);
    visited.add(key);
    for (const dependency of entry.imports ?? []) visit(dependency);
  };
  for (const root of roots) visit(root);
  return visited;
}

/** The distinct JavaScript files behind a set of manifest keys. */
export function jsFilesOf(manifest, keys) {
  return new Set([...keys].map((key) => manifest[key]?.file).filter(isJs));
}

/**
 * Validate the allowlist file's shape. Each entry names a manifest key, its reviewed ceiling in
 * bytes, the size measured when it was listed, and a reason. Anything else is rejected.
 */
export function parseAllowlist(raw) {
  if (typeof raw !== "object" || raw === null || !Array.isArray(raw.entries)) {
    throw new Error("route budget allowlist must be an object with an `entries` array");
  }
  const byKey = new Map();
  for (const entry of raw.entries) {
    const ok =
      typeof entry === "object" &&
      entry !== null &&
      typeof entry.key === "string" &&
      entry.key.length > 0 &&
      Number.isInteger(entry.maxGzipBytes) &&
      entry.maxGzipBytes > 0 &&
      typeof entry.reason === "string" &&
      entry.reason.trim().length > 0;
    if (!ok) throw new Error(`invalid allowlist entry: ${JSON.stringify(entry)}`);
    if (byKey.has(entry.key)) throw new Error(`duplicate allowlist entry: ${entry.key}`);
    byKey.set(entry.key, entry);
  }
  return byKey;
}

/**
 * Pure budget evaluation. `gzipSize(file)` returns the gzip size in bytes of one built file.
 * Returns the shell result, one result per lazily loaded chunk, failures and warnings.
 */
export function evaluateBudgets({
  manifest,
  gzipSize,
  allowlist = new Map(),
  roots = SHELL_ROOTS,
  shellTargetBytes = SHELL_TARGET_BYTES,
  shellLimitBytes = SHELL_LIMIT_BYTES,
  screenLimitBytes = SCREEN_LIMIT_BYTES,
}) {
  for (const root of roots) {
    if (!manifest[root]) throw new Error(`Missing shell bundle entry: ${root}`);
  }
  const sizeCache = new Map();
  const sizeOf = (file) => {
    if (!sizeCache.has(file)) sizeCache.set(file, gzipSize(file));
    return sizeCache.get(file);
  };
  const sum = (files) => [...files].reduce((total, file) => total + sizeOf(file), 0);

  const shellFiles = jsFilesOf(manifest, staticClosure(manifest, roots));
  const shellBytes = sum(shellFiles);
  const failures = [];
  const warnings = [];
  const shell = {
    bytes: shellBytes,
    files: shellFiles.size,
    targetBytes: shellTargetBytes,
    limitBytes: shellLimitBytes,
    overTarget: shellBytes > shellTargetBytes,
    overLimit: shellBytes > shellLimitBytes,
  };
  if (shell.overLimit)
    failures.push(`shell: ${kib(shellBytes)} KiB exceeds the ${kib(shellLimitBytes)} KiB limit`);
  if (shell.overTarget) {
    warnings.push(
      `shell: ${kib(shellBytes)} KiB is over the ${kib(shellTargetBytes)} KiB target (reported, not enforced)`,
    );
  }

  const dynamicKeys = Object.keys(manifest)
    .filter((key) => manifest[key]?.isDynamicEntry === true && isJs(manifest[key].file))
    .sort();
  const chunks = [];
  for (const key of dynamicKeys) {
    const own = manifest[key].file;
    const files = [...jsFilesOf(manifest, staticClosure(manifest, [key]))].filter(
      (file) => !shellFiles.has(file),
    );
    const bytes = sum(files);
    const allowed = allowlist.get(key);
    const ceiling = allowed ? allowed.maxGzipBytes : screenLimitBytes;
    let status = "ok";
    if (bytes > ceiling) {
      status = "fail";
      failures.push(
        allowed
          ? `${key}: ${kib(bytes)} KiB exceeds its allowlisted ceiling of ${kib(ceiling)} KiB`
          : `${key}: ${kib(bytes)} KiB exceeds the ${kib(screenLimitBytes)} KiB per-chunk limit (not allowlisted)`,
      );
    } else if (allowed) {
      status = bytes > screenLimitBytes ? "allowlisted" : "ok";
      if (bytes <= screenLimitBytes) {
        warnings.push(
          `${key}: now ${kib(bytes)} KiB, under the limit; remove it from the allowlist`,
        );
      }
    }
    chunks.push({
      key,
      bytes,
      ownBytes: sizeOf(own),
      files: files.length,
      ceilingBytes: ceiling,
      allowlisted: Boolean(allowed),
      status,
    });
  }
  const present = new Set(dynamicKeys);
  for (const key of allowlist.keys()) {
    if (!present.has(key))
      warnings.push(`${key}: allowlisted but not in the manifest; remove it from the allowlist`);
  }
  return { shell, chunks, failures, warnings, ok: failures.length === 0 };
}

export function kib(bytes) {
  return (bytes / KIB).toFixed(2);
}

export function formatReport(result) {
  const lines = [];
  const { shell } = result;
  lines.push(
    `shell initial JavaScript: ${kib(shell.bytes)} KiB gzip (${shell.files} files; target ${kib(shell.targetBytes)} KiB, limit ${kib(shell.limitBytes)} KiB)`,
  );
  const over = result.chunks.filter(
    (chunk) => chunk.bytes > SCREEN_LIMIT_BYTES || chunk.status !== "ok",
  );
  lines.push(
    `lazily loaded chunks: ${result.chunks.length}; at or over the per-chunk limit: ${over.length}`,
  );
  for (const chunk of over) {
    lines.push(
      `  [${chunk.status}] ${kib(chunk.bytes)} KiB (ceiling ${kib(chunk.ceilingBytes)} KiB) ${chunk.key}`,
    );
  }
  for (const warning of result.warnings) lines.push(`WARN ${warning}`);
  for (const failure of result.failures) lines.push(`FAIL ${failure}`);
  lines.push(`STATUS=${result.ok ? "PASS" : "FAIL"}`);
  return lines.join("\n");
}

function argValue(argv, flag) {
  const index = argv.indexOf(flag);
  return index >= 0 ? argv[index + 1] : undefined;
}

function main(argv) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const publicDir = resolve(argValue(argv, "--public-dir") ?? join(root, ".output/public"));
  const manifestPath = resolve(
    argValue(argv, "--manifest") ?? join(publicDir, ".vite/manifest.json"),
  );
  const allowlistPath = resolve(
    argValue(argv, "--allowlist") ?? join(root, "scripts/verification/route-budget-allowlist.json"),
  );
  if (!existsSync(manifestPath)) {
    console.log(
      `STATUS=BLOCKED no build manifest at ${manifestPath}; run: npm run build -- --manifest`,
    );
    return 2;
  }
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const allowlist = existsSync(allowlistPath)
    ? parseAllowlist(JSON.parse(readFileSync(allowlistPath, "utf8")))
    : new Map();
  const gzipSize = (file) => {
    const assetPath = resolve(publicDir, file);
    if (!assetPath.startsWith(`${publicDir}${sep}`)) {
      throw new Error(`Bundle asset is outside the public directory: ${file}`);
    }
    return gzipSync(readFileSync(assetPath), { level: 9 }).byteLength;
  };
  const result = evaluateBudgets({ manifest, gzipSize, allowlist });
  console.log(argv.includes("--json") ? JSON.stringify(result, null, 2) : formatReport(result));
  return result.ok ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  process.exitCode = main(process.argv.slice(2));
}

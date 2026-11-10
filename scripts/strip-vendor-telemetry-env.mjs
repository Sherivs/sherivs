#!/usr/bin/env node
/**
 * Strip Sentry/PostHog credentials from dotenv files unless the file's
 * explicit APP_ENV and VITE_APP_ENV agree on staging.
 *
 * Never prints values. Reports removed names only.
 *
 * Usage:
 *   node scripts/strip-vendor-telemetry-env.mjs [--force-app-env=production] <file>...
 *
 * Missing files are skipped (exit 0) so a preview pull that did not write
 * an env file does not fail the job.
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import {
  STRIPPED_VENDOR_ENV_NAMES,
  vendorTelemetryEnabled,
} from "../frontend/src/lib/observability/vendor-telemetry.ts";

const STRIPPED = new Set(STRIPPED_VENDOR_ENV_NAMES);
const FORCE_VALUES = new Set(["production", "development", "staging"]);

function assignmentKey(line) {
  const match = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/.exec(line);
  return match ? match[1] : null;
}

function unquote(raw) {
  const value = raw.trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

export function readEnvAssignments(text) {
  const out = {};
  for (const line of String(text).split("\n")) {
    const key = assignmentKey(line);
    if (!key) continue;
    const eq = line.indexOf("=");
    out[key] = unquote(line.slice(eq + 1));
  }
  return out;
}

/**
 * @param {string} text
 * @param {{ forceAppEnv?: string, vercelEnv?: string }} [options]
 * @returns {{ text: string, removed: string[], vendorTelemetry: boolean }}
 */
export function stripVendorTelemetryEnvText(text, options = {}) {
  const force = options.forceAppEnv ? String(options.forceAppEnv).trim().toLowerCase() : "";
  if (force && !FORCE_VALUES.has(force)) {
    throw new Error("force-app-env must be production, development, or staging");
  }
  const parsed = readEnvAssignments(text);
  const appEnv = force || parsed.APP_ENV;
  const viteAppEnv = force || parsed.VITE_APP_ENV;
  const allow = vendorTelemetryEnabled({
    appEnv,
    viteAppEnv,
    vercelEnv: options.vercelEnv,
  });
  const removed = [];
  const next = [];
  let sawApp = false;
  let sawVite = false;
  for (const line of String(text).split("\n")) {
    const key = assignmentKey(line);
    if (!key) {
      next.push(line);
      continue;
    }
    if (force && (key === "APP_ENV" || key === "VITE_APP_ENV")) {
      if (key === "APP_ENV") sawApp = true;
      if (key === "VITE_APP_ENV") sawVite = true;
      next.push(`${key}=${force}`);
      continue;
    }
    if (!allow && STRIPPED.has(key)) {
      removed.push(key);
      continue;
    }
    next.push(line);
  }
  if (force && !sawApp) next.push(`APP_ENV=${force}`);
  if (force && !sawVite) next.push(`VITE_APP_ENV=${force}`);
  return { text: next.join("\n"), removed, vendorTelemetry: allow };
}

function parseArgs(argv) {
  let forceAppEnv = "";
  const files = [];
  for (const arg of argv) {
    if (arg.startsWith("--force-app-env=")) {
      forceAppEnv = arg.slice("--force-app-env=".length);
    } else if (arg === "--help" || arg === "-h") {
      return { help: true, forceAppEnv, files };
    } else {
      files.push(arg);
    }
  }
  return { help: false, forceAppEnv, files };
}

function main(argv) {
  const { help, forceAppEnv, files } = parseArgs(argv);
  if (help || files.length === 0) {
    console.log(
      "usage: node scripts/strip-vendor-telemetry-env.mjs [--force-app-env=production] <file>...",
    );
    return files.length === 0 && !help ? 1 : 0;
  }
  for (const file of files) {
    if (!existsSync(file)) {
      console.log(`skip missing ${file}`);
      continue;
    }
    const original = readFileSync(file, "utf8");
    const result = stripVendorTelemetryEnvText(original, { forceAppEnv });
    if (result.text !== original) writeFileSync(file, result.text);
    const removed = result.removed.length > 0 ? result.removed.join(",") : "none";
    console.log(
      `vendor-telemetry file=${file} enabled=${result.vendorTelemetry ? "staging" : "off"} removed=${removed}`,
    );
  }
  return 0;
}

const invokedDirectly = process.argv[1]?.endsWith("strip-vendor-telemetry-env.mjs");
if (invokedDirectly) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    const message = error instanceof Error ? error.message : "strip-vendor-telemetry-env failed";
    console.error(message);
    process.exitCode = 1;
  }
}

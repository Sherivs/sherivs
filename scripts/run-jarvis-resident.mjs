#!/usr/bin/env node
/**
 * CoreGrid — Jarvis resident supervisor (ACTIVE-V1).
 *
 * A SEPARATE process supervisor that repeatedly invokes the existing
 * library-form one-shot (`scripts/run-jarvis-enterprise-cycle.mjs`).
 * Each tick is one WAKE → library cycle → SLEEP. This is not a god-agent
 * and not 50 standing agents. The library itself remains library-form.
 *
 * Modes:
 *   --rehearse   ONE offline tick: spawn the one-shot with --rehearse,
 *                exit 0, no network.
 *   --once       ONE live tick: spawn the one-shot (same as current script).
 *   (default)    loop until SIGINT/SIGTERM. Interval from
 *                COREGRID_RESIDENT_INTERVAL_MS (default 300000 = 5 minutes).
 *                Never busy-spin. Stop on nonzero. Credential failure (exit 2)
 *                is not retried — the supervisor exits 2.
 *
 * Credential law: live/loop without COREGRID_CYCLE_TENANT_ID exits 2
 * BLOCKED_NO_CREDENTIAL and does not start the loop. Secret VALUES are
 * never printed (AGENTS §30).
 *
 * HUMAN AUTHORIZATION 2026-10-13: apply resident for Hermes and Jarvis.
 * Version-target classification: ACTIVE-V1 (AGENTS.md §45).
 */

/* eslint-disable no-console */

import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const ONE_SHOT = join(ROOT, "scripts", "run-jarvis-enterprise-cycle.mjs");
const TENANT_ENV_NAME = "COREGRID_CYCLE_TENANT_ID";
const INTERVAL_ENV_NAME = "COREGRID_RESIDENT_INTERVAL_MS";
const DEFAULT_INTERVAL_MS = 300_000;

const argv = process.argv.slice(2);
const flags = argv.filter((a) => a.startsWith("--"));
const positionals = argv.filter((a) => !a.startsWith("--"));
const KNOWN_FLAGS = new Set(["--rehearse", "--once", "--night"]);
const unknownFlags = flags.filter((f) => !KNOWN_FLAGS.has(f));
const REHEARSE = flags.includes("--rehearse");
const ONCE = flags.includes("--once");
const NIGHT = flags.includes("--night");

if (unknownFlags.length > 0 || positionals.length > 0) {
  console.error(
    `BLOCKED_USAGE unknown argument(s): ${[...unknownFlags, ...positionals].join(" ")}. ` +
      `Supported: --rehearse (offline one tick); --once (one live tick); --night; no arguments for the resident loop.`,
  );
  process.exit(2);
}

function isNonBlank(value) {
  return typeof value === "string" && value.trim() !== "";
}

function residentIntervalMs() {
  const raw = process.env[INTERVAL_ENV_NAME];
  if (!isNonBlank(raw)) return DEFAULT_INTERVAL_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_INTERVAL_MS;
  return Math.floor(parsed);
}

function requireLiveCredential() {
  if (isNonBlank(process.env[TENANT_ENV_NAME])) return;
  console.error(
    `BLOCKED_NO_CREDENTIAL ${TENANT_ENV_NAME} is not set (or empty). ` +
      `The Jarvis resident loop was not started — no one-shot spawn, no library cycle.`,
  );
  process.exit(2);
}

function spawnOneShot(extraFlags) {
  const result = spawnSync(process.execPath, [ONE_SHOT, ...extraFlags], {
    cwd: ROOT,
    env: process.env,
    stdio: "inherit",
  });
  if (result.error) {
    console.error(`jarvis resident failed to spawn one-shot: ${result.error.message}`);
    return 1;
  }
  return typeof result.status === "number" ? result.status : 1;
}

let stopping = false;
function requestStop() {
  stopping = true;
}
process.on("SIGINT", requestStop);
process.on("SIGTERM", requestStop);

function sleepMs(ms) {
  return new Promise((resolve) => {
    if (stopping) {
      resolve();
      return;
    }
    const timer = setTimeout(() => resolve(), ms);
    const onStop = () => {
      clearTimeout(timer);
      resolve();
    };
    process.once("SIGINT", onStop);
    process.once("SIGTERM", onStop);
  });
}

if (REHEARSE) {
  const code = spawnOneShot(NIGHT ? ["--rehearse", "--night"] : ["--rehearse"]);
  process.exit(code);
}

requireLiveCredential();

if (ONCE) {
  const code = spawnOneShot(NIGHT ? ["--night"] : []);
  process.exit(code);
}

const intervalMs = residentIntervalMs();
const oneShotFlags = NIGHT ? ["--night"] : [];

while (true) {
  if (stopping) process.exit(0);
  const code = spawnOneShot(oneShotFlags);
  if (code === 2) process.exit(2);
  if (code !== 0) process.exit(code);
  if (stopping) process.exit(0);
  await sleepMs(intervalMs);
}

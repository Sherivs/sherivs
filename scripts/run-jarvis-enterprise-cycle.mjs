#!/usr/bin/env node
/**
 * CoreGrid — Jarvis enterprise-cycle wake (library, then sleep).
 *
 * A cron/queue trigger for ONE Jarvis WAKE → library cycle → SLEEP. Hermes
 * and Jarvis remain libraries. This script is not a resident process and
 * does not start one.
 *
 * Modes:
 *   --rehearse   fully OFFLINE rehearsal: loads `enterprise-loop.ts` via
 *                jiti, runs `runJarvisEnterpriseCycle` with empty
 *                observations and tenant "rehearsal-tenant". NO network.
 *                Does NOT import provider-health.server and does NOT jiti
 *                hermes-findings-list.server (no findings-list DB calls).
 *                Exit 0.
 *   --night      night-mode cycle (MONITOR / MAINTAIN / ANALYZE / PREPARE).
 *   (default)    live library wake. Requires COREGRID_CYCLE_TENANT_ID
 *                (non-blank) else exit 2 BLOCKED_NO_CREDENTIAL. Calls
 *                `runEnterpriseCycleLibrary` only (no session). Script wake
 *                is observation+cycle; §27 audit is the server-function
 *                path. Live health uses `runProviderHealthBattery(process.env)`.
 *                Live Hermes ingest is skipped unless
 *                HERMES_OBSERVATION_BACKEND=db AND a supabase admin env
 *                exists; this script does not invent a client. Live findings
 *                list is injected only when SUPABASE_URL and
 *                SUPABASE_SERVICE_ROLE_KEY are non-blank: jiti
 *                `hermes-findings-list.server.ts` plus `supabaseAdmin` from
 *                `client.server.ts`, catch failure and leave the port unset
 *                (typed skip). --rehearse does NOT jiti the findings-list
 *                server module and makes no findings-list DB calls.
 *                AI_API_KEY is NOT required (no model call). The list port
 *                OBSERVES/ASSESSES only; it does not ACT.
 *
 * Credential law (AGENTS §30): secret NAMES are declared; secret VALUES are
 * never printed, logged, or written to any artifact — including error paths.
 *
 * Artifacts (directory from COREGRID_ARTIFACTS_DIR, default
 * /opt/cursor/artifacts — secret-free by construction):
 *   jarvis-enterprise-cycle-rehearsal.json  (offline rehearsal)
 *   jarvis-enterprise-cycle-live.json       (live library wake)
 *
 * Usage:
 *   node scripts/run-jarvis-enterprise-cycle.mjs --rehearse
 *   node scripts/run-jarvis-enterprise-cycle.mjs --rehearse --night
 *   node scripts/run-jarvis-enterprise-cycle.mjs
 * Exit codes: 0 completed cycle (including zero detections)
 *             1 unexpected library throw
 *             2 BLOCKED_NO_CREDENTIAL / BLOCKED_USAGE.
 *
 * Version-target classification: ACTIVE-V1 (AGENTS.md §45). Phase 52 is not
 * authorized by this wake.
 */

/* eslint-disable no-console */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { createJiti } from "jiti";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const DEFAULT_ARTIFACTS_DIR = "/opt/cursor/artifacts";
const ARTIFACTS_DIR = process.env.COREGRID_ARTIFACTS_DIR ?? DEFAULT_ARTIFACTS_DIR;

const TENANT_ENV_NAME = "COREGRID_CYCLE_TENANT_ID";
const HERMES_BACKEND_ENV_NAME = "HERMES_OBSERVATION_BACKEND";
const SUPABASE_URL_ENV_NAME = "SUPABASE_URL";
const SUPABASE_SERVICE_ROLE_ENV_NAME = "SUPABASE_SERVICE_ROLE_KEY";
const REHEARSAL_TENANT = "rehearsal-tenant";
const REHEARSAL_NOW = "2026-10-13T05:41:00.000Z";

const argv = process.argv.slice(2);
const flags = argv.filter((a) => a.startsWith("--"));
const positionals = argv.filter((a) => !a.startsWith("--"));
const KNOWN_FLAGS = new Set(["--rehearse", "--night"]);
const unknownFlags = flags.filter((f) => !KNOWN_FLAGS.has(f));
const REHEARSE = flags.includes("--rehearse");
const NIGHT = flags.includes("--night");

if (unknownFlags.length > 0 || positionals.length > 0) {
  console.error(
    `BLOCKED_USAGE unknown argument(s): ${[...unknownFlags, ...positionals].join(" ")}. ` +
      `Supported: --rehearse (offline); --night (night-mode); no arguments for the credential-gated live library wake.`,
  );
  process.exit(2);
}

/** Load governed TS modules through jiti (read-only, local files only). */
const jiti = createJiti(join(ROOT, "scripts", "run-jarvis-enterprise-cycle.mjs"), {
  alias: { "@": join(ROOT, "frontend", "src") },
});

function isNonBlank(value) {
  return typeof value === "string" && value.trim() !== "";
}

function writeArtifact(baseName, payload) {
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  const jsonPath = join(ARTIFACTS_DIR, `${baseName}.json`);
  writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`artifact: ${jsonPath}`);
  return jsonPath;
}

function secretFreeCycleSummary(cycle) {
  return {
    tenantRef: cycle.tenantRef,
    nightMode: cycle.nightMode,
    phases: cycle.phases,
    detectionCount: Array.isArray(cycle.detections) ? cycle.detections.length : 0,
    detections: Array.isArray(cycle.detections)
      ? cycle.detections.map((d) => ({
          condition: d.condition,
          observationId: d.observationId,
          severity: d.severity,
        }))
      : [],
    sleep: cycle.sleep,
  };
}

if (REHEARSE) {
  try {
    const loopModule = jiti(
      join(ROOT, "frontend", "src", "lib", "jarvis", "enterprise-loop.ts"),
    );
    const contractModule = jiti(
      join(ROOT, "frontend", "src", "lib", "jarvis", "jarvis-contract.ts"),
    );
    const cycle = loopModule.runJarvisEnterpriseCycle({
      tenantRef: REHEARSAL_TENANT,
      now: REHEARSAL_NOW,
      observations: [],
      grantedCapabilities: Object.values(contractModule.JarvisCapability),
      nightMode: NIGHT,
    });
    writeArtifact("jarvis-enterprise-cycle-rehearsal", {
      mode: "rehearsal",
      summary:
        "REHEARSAL PASS — empty observations; Jarvis library cycle slept; no network contact was made.",
      nightMode: NIGHT,
      cycle: secretFreeCycleSummary(cycle),
      network: false,
    });
    console.log("REHEARSAL PASS — offline Jarvis library cycle complete; no network contact was made.");
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`enterprise cycle rehearsal threw unexpectedly: ${message}`);
    process.exit(1);
  }
}

const tenantId = process.env[TENANT_ENV_NAME];
if (!isNonBlank(tenantId)) {
  console.error(
    `BLOCKED_NO_CREDENTIAL ${TENANT_ENV_NAME} is not set (or empty). ` +
      `The live library wake was not attempted — no provider battery, no Hermes ingestion, no Jarvis cycle.`,
  );
  process.exit(2);
}

try {
  const runtime = jiti(
    join(ROOT, "frontend", "src", "lib", "jarvis", "enterprise-cycle-runtime.server.ts"),
  );
  const healthModule = jiti(
    join(ROOT, "frontend", "src", "lib", "observability", "provider-health.server.ts"),
  );
  const timeModule = jiti(
    join(ROOT, "frontend", "src", "lib", "kernel", "time-authority.ts"),
  );
  const timeAuthority = new timeModule.TimeAuthority(new timeModule.SystemClock());
  const artifactAudits = [];

  const hermesBackend = (process.env[HERMES_BACKEND_ENV_NAME] ?? "").trim();
  const supabaseAdminEnvPresent =
    isNonBlank(process.env[SUPABASE_URL_ENV_NAME]) &&
    isNonBlank(process.env[SUPABASE_SERVICE_ROLE_ENV_NAME]);
  const hermesLiveEligible = hermesBackend === "db" && supabaseAdminEnvPresent;

  /** @type {Record<string, unknown>} */
  const deps = {
    audit: async (entry) => {
      artifactAudits.push({
        action: entry.action,
        gate: entry.gate,
        outcome: entry.outcome,
        table: entry.table,
        cycle_outcome_code: entry.details?.cycle_outcome_code ?? null,
        reason: entry.details?.reason ?? null,
      });
    },
    now: () => timeAuthority.now().at,
    readEnv: (name) => process.env[name],
    runProviderHealth: async (env) => healthModule.runProviderHealthBattery(env),
  };

  if (hermesLiveEligible) {
    const hermesModule = jiti(
      join(ROOT, "frontend", "src", "lib", "hermes", "hermes-observation-trigger.server.ts"),
    );
    deps.runHermesObservation = async (step) => {
      const result = await hermesModule.runHermesEventObservationStep(step);
      return { ok: result.ok, consumed: result.consumed, reason: result.reason };
    };
  }

  /* Read-only findings list: OBSERVE/ASSESS only. Never invent credentials.
   * Construction failure leaves the port unset → typed skip. Secret values
   * are never printed. Rehearsal never reaches this path. */
  if (supabaseAdminEnvPresent) {
    try {
      const clientModule = jiti(
        join(ROOT, "frontend", "src", "integrations", "supabase", "client.server.ts"),
      );
      const findingsListModule = jiti(
        join(ROOT, "frontend", "src", "lib", "hermes", "hermes-findings-list.server.ts"),
      );
      const port = findingsListModule.createHermesFindingsListPort(clientModule.supabaseAdmin);
      deps.listHermesFindings = async ({ tenantId, now }) => {
        return port.listHermesFindings({ tenantId, now });
      };
    } catch {
      /* leave unset — runEnterpriseCycleLibrary types a skip */
    }
  }

  const library = await runtime.runEnterpriseCycleLibrary(
    { tenantId: tenantId.trim(), nightMode: NIGHT },
    deps,
  );

  writeArtifact("jarvis-enterprise-cycle-live", {
    mode: "live",
    summary:
      "LIVE library wake complete. Script wake is observation+cycle; §27 audit is the server-function path.",
    nightMode: NIGHT,
    cycle: secretFreeCycleSummary(library.cycle),
    health: library.health,
    hermes: library.hermes,
    hermesPortInjected: hermesLiveEligible,
    hermesSkipEnvNames: hermesLiveEligible
      ? []
      : [HERMES_BACKEND_ENV_NAME, SUPABASE_URL_ENV_NAME, SUPABASE_SERVICE_ROLE_ENV_NAME],
    artifactAudits,
    note: "script wake is observation+cycle; §27 audit is the server-function path",
  });
  console.log(
    `JARVIS ENTERPRISE CYCLE complete — detections=${library.cycle.detections.length} health_ran=${library.health.ran} hermes_consumed=${library.hermes.consumed}.`,
  );
  process.exit(0);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`enterprise cycle library threw unexpectedly: ${message}`);
  process.exit(1);
}

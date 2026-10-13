#!/usr/bin/env node
/**
 * CoreGrid — Hermes resident supervisor (ACTIVE-V1).
 *
 * A SEPARATE process supervisor that repeatedly invokes the existing
 * library `runHermesCycle` (WAKE → one cycle → SLEEP). This is not a
 * god-agent and not 50 standing agents. `hermes-cycle.ts` remains
 * library-form — the loop lives only here.
 *
 * Modes:
 *   --rehearse   ONE offline tick: jiti `runHermesCycle` with in-memory
 *                empty observations/missions/memory and a minimal governed
 *                Hermes identity constructed locally (not imported from
 *                tests). Exit 0. No network.
 *   --once       ONE live tick. Requires COREGRID_CYCLE_TENANT_ID +
 *                supabase admin env. Missing identity → exit 2
 *                BLOCKED_NO_CREDENTIAL (does not mint grants, AGENTS §6).
 *   (default)    loop until SIGINT/SIGTERM. Interval from
 *                COREGRID_RESIDENT_INTERVAL_MS (default 300000 = 5 minutes).
 *                Never busy-spin. Stop on nonzero. Credential failure
 *                (exit 2) is not retried.
 *
 * Live observations: `loadHermesObservationSnapshot` is used when Missions
 * exported it from hermes-findings-list.server.ts; otherwise skip-observe
 * with empty lists and record honesty in the artifact (do not invent
 * executions). Memory is `createInMemoryMemoryTierAdapter`. Missions live
 * path uses `createDbMissionExecutionPorts` recordIntent/assignExecution.
 *
 * Credential law: live/loop without COREGRID_CYCLE_TENANT_ID exits 2
 * BLOCKED_NO_CREDENTIAL and does not start the loop. Secret VALUES are
 * never printed (AGENTS §30).
 *
 * HUMAN AUTHORIZATION 2026-10-13: apply resident for Hermes and Jarvis.
 * Version-target classification: ACTIVE-V1 (AGENTS.md §45).
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
const INTERVAL_ENV_NAME = "COREGRID_RESIDENT_INTERVAL_MS";
const HERMES_WORKER_ENV_NAME = "HERMES_WORKER_ID";
const SUPABASE_URL_ENV_NAME = "SUPABASE_URL";
const SUPABASE_SERVICE_ROLE_ENV_NAME = "SUPABASE_SERVICE_ROLE_KEY";
const DEFAULT_INTERVAL_MS = 300_000;
const REHEARSAL_TENANT = "rehearsal-tenant";
const REHEARSAL_NOW = "2026-10-13T05:41:00.000Z";
const REHEARSAL_IDENTITY_REF = "31313131-3131-4311-8311-313131313131";
const SECRET_ENV_NAMES = [
  SUPABASE_SERVICE_ROLE_ENV_NAME,
  "SUPABASE_ANON_KEY",
  "SUPABASE_ACCESS_TOKEN",
  "AI_API_KEY",
];

const argv = process.argv.slice(2);
const flags = argv.filter((a) => a.startsWith("--"));
const positionals = argv.filter((a) => !a.startsWith("--"));
const KNOWN_FLAGS = new Set(["--rehearse", "--once"]);
const unknownFlags = flags.filter((f) => !KNOWN_FLAGS.has(f));
const REHEARSE = flags.includes("--rehearse");
const ONCE = flags.includes("--once");

if (unknownFlags.length > 0 || positionals.length > 0) {
  console.error(
    `BLOCKED_USAGE unknown argument(s): ${[...unknownFlags, ...positionals].join(" ")}. ` +
      `Supported: --rehearse (offline one tick); --once (one live tick); no arguments for the resident loop.`,
  );
  process.exit(2);
}

const jiti = createJiti(join(ROOT, "scripts", "run-hermes-resident.mjs"), {
  alias: { "@": join(ROOT, "frontend", "src") },
});

function isNonBlank(value) {
  return typeof value === "string" && value.trim() !== "";
}

function redact(text) {
  let out = String(text);
  for (const name of SECRET_ENV_NAMES) {
    const value = process.env[name];
    if (isNonBlank(value) && value.length >= 4) {
      out = out.split(value).join(`[${name}]`);
    }
  }
  return out;
}

function secretFreeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  return redact(message);
}

function residentIntervalMs() {
  const raw = process.env[INTERVAL_ENV_NAME];
  if (!isNonBlank(raw)) return DEFAULT_INTERVAL_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 1) return DEFAULT_INTERVAL_MS;
  return Math.floor(parsed);
}

function writeArtifact(baseName, payload) {
  mkdirSync(ARTIFACTS_DIR, { recursive: true });
  const jsonPath = join(ARTIFACTS_DIR, `${baseName}.json`);
  writeFileSync(jsonPath, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`artifact: ${jsonPath}`);
  return jsonPath;
}

function emptyObservations() {
  return {
    backend: "db",
    async listExecutions() {
      return [];
    },
    async listWorkerPostures() {
      return [];
    },
    async listVerificationRecords() {
      return [];
    },
  };
}

function requireLiveCredential() {
  const tenantId = process.env[TENANT_ENV_NAME];
  const supabaseUrl = process.env[SUPABASE_URL_ENV_NAME];
  const supabaseKey = process.env[SUPABASE_SERVICE_ROLE_ENV_NAME];
  const missing = [];
  if (!isNonBlank(tenantId)) missing.push(TENANT_ENV_NAME);
  if (!isNonBlank(supabaseUrl)) missing.push(SUPABASE_URL_ENV_NAME);
  if (!isNonBlank(supabaseKey)) missing.push(SUPABASE_SERVICE_ROLE_ENV_NAME);
  if (missing.length === 0) return tenantId.trim();
  console.error(
    `BLOCKED_NO_CREDENTIAL ${missing.join(", ")} is not set (or empty). ` +
      `The Hermes resident loop was not started — no library cycle, no grants minted.`,
  );
  process.exit(2);
}

/** Minimal governed Hermes identity for offline rehearsal. Empty grants — do not mint. */
function rehearsalHermesIdentity(tenantId) {
  const registry = jiti(join(ROOT, "frontend", "src", "lib", "workforce", "worker-registry.ts"));
  const validated = registry.validateWorkerRegistration({
    tenantId,
    definitionId: "hermes-rehearsal",
    identityRef: REHEARSAL_IDENTITY_REF,
    classification: "ai",
    capabilities: [
      { capabilityId: "mission:create:*", description: "declare repair intents" },
      { capabilityId: "mission:execute:*", description: "assign repair work" },
    ],
    maxRiskClass: "medium",
    resourceScopes: ["mission"],
    createdBy: "registrar-rehearsal",
    traceId: "trace-hermes-rehearsal",
    correlationId: "correlation-hermes-rehearsal",
  });
  if (!validated.ok) {
    throw new Error(`rehearsal hermes identity rejected: ${validated.errors.join("; ")}`);
  }
  return { definition: validated.definition, grants: [] };
}

function secretFreeReport(result) {
  const report = result?.report;
  if (report === undefined || report === null) return null;
  return {
    cycleId: report.cycleId,
    tenantId: report.tenantId,
    actorRef: report.actorRef,
    observed: report.observed,
    findingCount: Array.isArray(report.findings) ? report.findings.length : 0,
    decisionCount: Array.isArray(report.decisions) ? report.decisions.length : 0,
    sleep: report.sleep,
  };
}

async function runRehearse() {
  const cycleModule = jiti(join(ROOT, "frontend", "src", "lib", "hermes", "hermes-cycle.ts"));
  const memoryModule = jiti(join(ROOT, "frontend", "src", "lib", "memory", "memory-adapter.ts"));
  const storeModule = jiti(
    join(ROOT, "frontend", "src", "lib", "missions", "mission-execution-store.ts"),
  );
  const store = storeModule.createInMemoryMissionExecutionStore();
  const result = await cycleModule.runHermesCycle(
    {
      missions: {
        recordIntent: (input) => store.recordIntent(input),
        assignExecution: (input) => store.assignExecution(input),
      },
      observations: emptyObservations(),
      memory: memoryModule.createInMemoryMemoryTierAdapter(),
    },
    rehearsalHermesIdentity(REHEARSAL_TENANT),
    { tenantId: REHEARSAL_TENANT, now: REHEARSAL_NOW },
  );
  writeArtifact("hermes-cycle-rehearsal", {
    mode: "rehearsal",
    summary:
      "REHEARSAL PASS — empty observations/missions/memory; Hermes library cycle slept; no network contact was made.",
    cycle: secretFreeReport(result),
    phases: Array.isArray(result.phases)
      ? result.phases.map((p) => ({ phase: p.phase, ok: p.ok }))
      : [],
    network: false,
  });
  console.log("REHEARSAL PASS — offline Hermes library cycle complete; no network contact was made.");
  return 0;
}

async function loadLiveHermesIdentity(tenantId, admin) {
  const workerId = (process.env[HERMES_WORKER_ENV_NAME] ?? "").trim() || "hermes";
  const definitionResult = await admin
    .from("cg_worker_definition")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("id", workerId)
    .maybeSingle();
  if (definitionResult.error) {
    throw new Error(`hermes worker definition load failed: ${definitionResult.error.message}`);
  }
  let row = definitionResult.data;
  if (row === null) {
    const listed = await admin.from("cg_worker_definition").select("*").eq("tenant_id", tenantId);
    if (listed.error) {
      throw new Error(`hermes worker definition list failed: ${listed.error.message}`);
    }
    const rows = Array.isArray(listed.data) ? listed.data : [];
    row =
      rows.find(
        (candidate) =>
          candidate?.classification === "ai" &&
          typeof candidate?.id === "string" &&
          candidate.id.toLowerCase().includes("hermes"),
      ) ?? null;
  }
  if (row === null) {
    return {
      ok: false,
      reason: `hermes worker definition ${workerId} is not registered in the tenant — BLOCKED_NO_CREDENTIAL (grants were not minted)`,
    };
  }
  const capabilityResult = await admin
    .from("cg_worker_capability")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("definition_id", row.id);
  if (capabilityResult.error) {
    throw new Error(`hermes worker capability load failed: ${capabilityResult.error.message}`);
  }
  const grantResult = await admin
    .from("cg_worker_delegation_grant")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("definition_id", row.id);
  if (grantResult.error) {
    throw new Error(`hermes worker grant load failed: ${grantResult.error.message}`);
  }
  const definition = {
    id: row.id,
    tenantScope: row.tenant_id,
    identityRef: row.identity_id,
    classification: row.classification,
    capabilities: (Array.isArray(capabilityResult.data) ? capabilityResult.data : []).map(
      (cap) => ({
        capabilityId: cap.capability_id,
        description: cap.description,
      }),
    ),
    authorityBounds: {
      maxRiskClass: row.max_risk_class,
      resourceScopes: row.resource_scopes,
    },
    delegationHistoryRefs: row.delegation_history_refs ?? [],
    lifecycle: row.lifecycle_state,
  };
  const grants = (Array.isArray(grantResult.data) ? grantResult.data : []).map((grant) => ({
    grantId: grant.id,
    definitionId: grant.definition_id,
    delegationRef: grant.delegation_ref,
    delegatedCapabilities: grant.delegated_capabilities,
    maxGrantedRiskClass: grant.max_granted_risk_class,
    state: grant.state,
  }));
  return { ok: true, identity: { definition, grants } };
}

async function loadLiveObservations(findingsListModule, admin, tenantId, now) {
  if (typeof findingsListModule.loadHermesObservationSnapshot === "function") {
    const snapshot = await findingsListModule.loadHermesObservationSnapshot(
      admin,
      tenantId,
      now,
    );
    return {
      observations: {
        backend: "db",
        async listExecutions() {
          return snapshot.executions ?? [];
        },
        async listWorkerPostures() {
          return snapshot.workerPostures ?? [];
        },
        async listVerificationRecords() {
          return snapshot.verificationRecords ?? [];
        },
      },
      honesty:
        "observations loaded via loadHermesObservationSnapshot exported from hermes-findings-list.server.ts",
    };
  }
  return {
    observations: emptyObservations(),
    honesty:
      "loadHermesObservationSnapshot is not exported from hermes-findings-list.server.ts; live tick skip-observed with empty lists; no executions invented",
  };
}

async function runLiveTick(tenantId) {
  const cycleModule = jiti(join(ROOT, "frontend", "src", "lib", "hermes", "hermes-cycle.ts"));
  const memoryModule = jiti(join(ROOT, "frontend", "src", "lib", "memory", "memory-adapter.ts"));
  const timeModule = jiti(join(ROOT, "frontend", "src", "lib", "kernel", "time-authority.ts"));
  const clientModule = jiti(
    join(ROOT, "frontend", "src", "integrations", "supabase", "client.server.ts"),
  );
  const missionDb = jiti(
    join(ROOT, "frontend", "src", "lib", "missions", "mission-execution-db.server.ts"),
  );
  const findingsListModule = jiti(
    join(ROOT, "frontend", "src", "lib", "hermes", "hermes-findings-list.server.ts"),
  );

  const admin = clientModule.supabaseAdmin;
  const timeAuthority = new timeModule.TimeAuthority(new timeModule.SystemClock());
  const now = timeAuthority.now().at;

  const loaded = await loadLiveHermesIdentity(tenantId, admin);
  if (!loaded.ok) {
    writeArtifact("hermes-cycle-live", {
      mode: "live",
      outcome: "BLOCKED_NO_CREDENTIAL",
      reason: loaded.reason,
      network: true,
    });
    console.error(`BLOCKED_NO_CREDENTIAL ${loaded.reason}`);
    return 2;
  }

  const dbPorts = missionDb.createDbMissionExecutionPorts(admin);
  const observed = await loadLiveObservations(findingsListModule, admin, tenantId, now);
  const result = await cycleModule.runHermesCycle(
    {
      missions: {
        recordIntent: (input) => dbPorts.records.recordIntent(input),
        assignExecution: (input) => dbPorts.records.assignExecution(input),
      },
      observations: observed.observations,
      memory: memoryModule.createInMemoryMemoryTierAdapter(),
    },
    loaded.identity,
    { tenantId, now },
  );

  writeArtifact("hermes-cycle-live", {
    mode: "live",
    summary: "LIVE Hermes library wake complete. Supervisor tick is one cycle then sleep.",
    observationHonesty: observed.honesty,
    cycle: secretFreeReport(result),
    phases: Array.isArray(result.phases)
      ? result.phases.map((p) => ({ phase: p.phase, ok: p.ok }))
      : [],
  });
  console.log(
    `HERMES CYCLE complete — findings=${result.report.findings.length} sleep=${result.report.sleep.state}.`,
  );
  return 0;
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
  try {
    const code = await runRehearse();
    process.exit(code);
  } catch (error) {
    console.error(`hermes cycle rehearsal threw unexpectedly: ${secretFreeError(error)}`);
    process.exit(1);
  }
}

const tenantId = requireLiveCredential();

if (ONCE) {
  try {
    const code = await runLiveTick(tenantId);
    process.exit(code);
  } catch (error) {
    const reason = secretFreeError(error);
    writeArtifact("hermes-cycle-live", {
      mode: "live",
      outcome: "BLOCKED_NO_CREDENTIAL",
      reason,
    });
    console.error(`BLOCKED_NO_CREDENTIAL live Hermes tick failed: ${reason}`);
    process.exit(2);
  }
}

const intervalMs = residentIntervalMs();
let firstTick = true;

while (true) {
  if (stopping) process.exit(0);
  let code = 1;
  try {
    code = await runLiveTick(tenantId);
  } catch (error) {
    const reason = secretFreeError(error);
    writeArtifact("hermes-cycle-live", {
      mode: "live",
      outcome: firstTick ? "BLOCKED_NO_CREDENTIAL" : "tick_failed",
      reason,
    });
    console.error(
      firstTick
        ? `BLOCKED_NO_CREDENTIAL first Hermes tick failed: ${reason}`
        : `hermes resident tick threw unexpectedly: ${reason}`,
    );
    code = firstTick ? 2 : 1;
  }
  firstTick = false;
  if (code === 2) process.exit(2);
  if (code !== 0) process.exit(code);
  if (stopping) process.exit(0);
  await sleepMs(intervalMs);
}

/**
 * CoreGrid — four-eyes SECURITY+QUALITY invariants for the production
 * Hermes findings list (ACTIVE-V1). This suite VERIFIES; it does not
 * implement `hermes-findings-list` or the Jarvis runtime.
 *
 * Proof style: readFileSync source pins against the paths other teams
 * land, plus behavioral imports of the pure list when that module loads
 * cleanly. Missing production files fail closed (`mustExist`). A violating
 * mapping is never accommodated: if Runtime still leaves
 * `listHermesFindings` undefined, that pin MUST fail until they wire it.
 * Listing findings is OBSERVE/ASSESS only — it is not `runHermesCycle`.
 *
 * Specified list contract (do not guess arity):
 *   listHermesFindingsFromState({ tenantId, now, executions, workers, verificationRecords })
 *
 * Version-target classification: ACTIVE-V1 (AGENTS.md §45).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { HermesWorkerPosture } from "@/lib/hermes/hermes-contract";
import type { MissionExecutionState } from "@/lib/missions/mission-execution";
import { isWorkerActivatable } from "@/lib/workforce/v1-workforce-lock";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

const PATHS = {
  findingsList: "frontend/src/lib/hermes/hermes-findings-list.ts",
  findingsListServer: "frontend/src/lib/hermes/hermes-findings-list.server.ts",
  cycleRuntime: "frontend/src/lib/jarvis/enterprise-cycle-runtime.server.ts",
  hermesCycle: "frontend/src/lib/hermes/hermes-cycle.ts",
  phase52Ts: "frontend/src/lib/workforce/phase52-attachment.ts",
  phase52Json: "architecture/COREGRID_V1_WORKFORCE_PHASE52_ATTACHMENT.json",
  cycleScript: "scripts/run-jarvis-enterprise-cycle.mjs",
  cycleWorkflow: ".github/workflows/jarvis-enterprise-cycle.yml",
} as const;

const TENANT_SCOPED_TABLES = [
  "cg_execution_record",
  "cg_verification_result",
  "cg_worker_definition",
  "cg_worker_quarantine",
] as const;

const FROZEN_WORKER_IDS = [
  "sdk_engineer",
  "ml_engineer",
  "knowledge_engineer",
  "intelligence_research_agent",
  "growth_intelligence_agent",
  "customer_success_agent",
] as const;

const TENANT = "tenant-alpha";
const NOW = "2026-10-13T08:00:00.000Z";
const STALE_ASSIGNED_AT = "2026-01-01T00:00:00.000Z";

const SECRET_VALUE =
  /(?:sk_live_|sk_test_|whsec_|phc_|xox[baprs]-)[A-Za-z0-9]+|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|AKIA[0-9A-Z]{16}/;

const RESIDENT_PROCESS = [
  /\bsetInterval\s*\(/,
  /\bwhile\s*\(\s*true\s*\)/,
  /\bnew\s+Worker\s*\(/,
  /\bkind:\s*Deployment\b/,
] as const;

type ListHermesFindingsFromState = (input: {
  tenantId: string;
  now: string;
  executions?: readonly MissionExecutionState[];
  workers?: readonly HermesWorkerPosture[];
  workerPostures?: readonly HermesWorkerPosture[];
  verificationRecords?: readonly unknown[];
}) => unknown;

function abs(rel: string): string {
  return join(ROOT, rel);
}

function mustExist(rel: string): string {
  const path = abs(rel);
  expect(existsSync(path), `four-eyes fail-closed: missing production module ${rel}`).toBe(true);
  return path;
}

function mustRead(rel: string): string {
  return readFileSync(mustExist(rel), "utf8");
}

/** Strip comments so a documented ban on resident-process tokens is not a false finding. */
function stripComments(source: string, kind: "code" | "yaml"): string {
  const withoutBlock = source.replace(/\/\*[\s\S]*?\*\//g, "");
  if (kind === "yaml") {
    return withoutBlock.replace(/^\s*#.*$/gm, "");
  }
  return withoutBlock.replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function extractExportedFunction(source: string, name: string): string {
  const start = source.search(new RegExp(`export async function ${name}\\b`));
  expect(start, `export async function ${name} must exist`).toBeGreaterThanOrEqual(0);
  const header = source.slice(start);
  // Skip the parameter list / return type so the first `{` of `input: { ... }`
  // is not mistaken for the function body.
  const bodyRel = header.search(/\)\s*(?::[^{]+)?\{/);
  expect(bodyRel, `${name} body`).toBeGreaterThan(0);
  const brace = start + bodyRel + header.slice(bodyRel).indexOf("{");
  let depth = 0;
  for (let i = brace; i < source.length; i++) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return source.slice(start, i + 1);
    }
  }
  return source.slice(start);
}

function findingRecords(result: unknown): Record<string, unknown>[] {
  if (!Array.isArray(result)) return [];
  const records: Record<string, unknown>[] = [];
  for (const item of result) {
    if (item !== null && typeof item === "object") records.push(item as Record<string, unknown>);
  }
  return records;
}

function findingKinds(result: unknown): string[] {
  const kinds: string[] = [];
  for (const record of findingRecords(result)) {
    if (typeof record.kind === "string") kinds.push(record.kind);
  }
  return kinds;
}

function assignedAdmittedNoLease(executionId: string): MissionExecutionState {
  return {
    executionId,
    tenantId: TENANT,
    missionId: `MISSION-${executionId}`,
    missionVersion: "1.0",
    assignedBy: "operator-1",
    lastWorkerId: null,
    action: "record-observation",
    idempotencyKey: `idem-${executionId}`,
    realityRef: "cg_entity:22222222-2222-4222-8222-222222222222",
    stage: "assigned",
    attempt: 1,
    failureCount: 0,
    retryScheduledAt: null,
    lease: null,
    evidenceIds: [],
    verificationDecision: null,
    denyReason: null,
    assignedAt: STALE_ASSIGNED_AT,
    updatedAt: STALE_ASSIGNED_AT,
  };
}

function deniedExecution(executionId: string): MissionExecutionState {
  return {
    ...assignedAdmittedNoLease(executionId),
    stage: "denied",
    denyReason: "admission denied",
    assignedAt: NOW,
    updatedAt: NOW,
  };
}

function quarantinedWorker(workerId: string): HermesWorkerPosture {
  return {
    workerId,
    tenantId: TENANT,
    lifecycle: "active",
    quarantined: true,
    failureCount: 2,
    observedAt: NOW,
  };
}

async function callList(
  fn: ListHermesFindingsFromState,
  input: {
    tenantId: string;
    now?: string;
    executions?: readonly MissionExecutionState[];
    workers?: readonly HermesWorkerPosture[];
    verificationRecords?: readonly unknown[];
  },
): Promise<unknown> {
  // Specified list contract: object form with tenantId. Do not guess arity.
  const workers = input.workers ?? [];
  // Landed contract names the worker bag `workerPostures`; pass both so a
  // rename cannot silently skip the quarantined-worker honesty check.
  return await Promise.resolve(
    fn({
      tenantId: input.tenantId,
      now: input.now ?? NOW,
      executions: input.executions ?? [],
      workers,
      workerPostures: workers,
      verificationRecords: input.verificationRecords ?? [],
    }),
  );
}

/* ─────────────────────────────────────────────────────────────
 * A. No resident process
 * ───────────────────────────────────────────────────────────── */

describe("A. no resident Jarvis/Hermes process", () => {
  const pins = [
    PATHS.cycleRuntime,
    PATHS.findingsList,
    PATHS.findingsListServer,
    PATHS.hermesCycle,
    PATHS.cycleScript,
    PATHS.cycleWorkflow,
  ] as const;

  it.each(pins)("%s must exist and must not start a resident process", (rel) => {
    const source = stripComments(mustRead(rel), rel.endsWith(".yml") ? "yaml" : "code");
    for (const pattern of RESIDENT_PROCESS) {
      expect(source, `${rel} must not contain ${pattern}`).not.toMatch(pattern);
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * B. Honest findings list (OBSERVE/ASSESS only)
 * ───────────────────────────────────────────────────────────── */

describe("B. honest listHermesFindingsFromState (OBSERVE/ASSESS, not ACT)", () => {
  it("pure list module exists and exports listHermesFindingsFromState (fail-closed if missing)", () => {
    const source = mustRead(PATHS.findingsList);
    expect(source).toMatch(/\blistHermesFindingsFromState\b/);
    expect(source).toMatch(
      /export\s+(?:async\s+)?function\s+listHermesFindingsFromState\b|export\s+\{[^}]*\blistHermesFindingsFromState\b/,
    );
  });

  it("server list module exists and exports listHermesFindings (fail-closed if missing)", () => {
    const source = mustRead(PATHS.findingsListServer);
    expect(source).toMatch(/\blistHermesFindings\b/);
    expect(source).toMatch(
      /export\s+(?:async\s+)?function\s+(?:listHermesFindings|createHermesFindingsListPort)\b|export\s+\{[^}]*\blistHermesFindings\b/,
    );
    expect(source).toMatch(/\blistHermesFindings\s*\(/);
  });

  it("findings-list.ts and findings-list.server.ts must NOT call runHermesCycle(", () => {
    for (const rel of [PATHS.findingsList, PATHS.findingsListServer] as const) {
      const stripped = stripComments(mustRead(rel), "code");
      expect(
        /\brunHermesCycle\s*\(/.test(stripped),
        `${rel} must not call runHermesCycle( (listing is OBSERVE/ASSESS, not ACT)`,
      ).toBe(false);
    }
  });

  it("findings-list modules MAY import assessExecutions/assessWorkers (observe/assess, not a ban)", () => {
    const source = mustRead(PATHS.findingsList);
    // Allowed; not required. Pin that a call to assess* is not treated as ACT.
    if (/\bassessExecutions\b/.test(source) || /\bassessWorkers\b/.test(source)) {
      const stripped = stripComments(source, "code");
      expect(stripped).not.toMatch(/\brunHermesCycle\s*\(/);
    }
  });

  it("runtime must NOT import hermes-cycle or call runHermesCycle", () => {
    const stripped = stripComments(mustRead(PATHS.cycleRuntime), "code");
    expect(
      /\brunHermesCycle\b/.test(stripped),
      "runHermesCycle MUST NOT appear on the Jarvis runtime (listing findings ≠ running the repair cycle)",
    ).toBe(false);
    expect(
      /(?:from|import\(\s*)["'][^"']*hermes-cycle["']/.test(stripped),
      "Runtime must not import hermes-cycle",
    ).toBe(false);
  });

  it("runtime buildEnterpriseCycleDeps must dynamic-import hermes-findings-list.server and assign listHermesFindings", () => {
    const stripped = stripComments(mustRead(PATHS.cycleRuntime), "code");
    const depsFn = extractExportedFunction(stripped, "buildEnterpriseCycleDeps");
    expect(
      /import\(\s*["'][^"']*hermes-findings-list\.server["']/.test(depsFn),
      "buildEnterpriseCycleDeps must dynamic-import hermes-findings-list.server (must fail while the port is left undefined)",
    ).toBe(true);
    expect(
      /listHermesFindings\s*:\s*(?:async\s*)?(?:function\b|\(|[A-Za-z_$])/.test(depsFn),
      "buildEnterpriseCycleDeps must assign listHermesFindings to a live binding — do not weaken this pin while Runtime leaves it undefined",
    ).toBe(true);
    expect(depsFn).not.toMatch(/listHermesFindings\s*:\s*undefined\b/);
    expect(stripped).not.toMatch(/^import\s+(?!type\b).*hermes-findings-list\.server/m);
  });

  it("does not invent numeric latency/error-rate constants", () => {
    for (const rel of [PATHS.findingsList, PATHS.findingsListServer] as const) {
      const source = mustRead(rel);
      expect(source, `${rel} must not invent error-rate constants`).not.toMatch(
        /\berror[_-]?rate\s*[:=]\s*\d/i,
      );
      expect(source, `${rel} must not invent latency constants`).not.toMatch(
        /\blatency(?:Ms|_ms)?\s*[:=]\s*\d+/i,
      );
      expect(source, `${rel} must not invent p99 constants`).not.toMatch(
        /\bp99(?:Latency)?\s*[:=]\s*\d/i,
      );
      expect(source, `${rel} must not invent errorRate/latencyMs literals`).not.toMatch(
        /\b(?:errorRate|latencyMs)\s*:\s*\d+(?:\.\d+)?/,
      );
    }
  });

  it("behavioral: empty state → []; lease-gap assigned must not invent mission_stuck; denied/quarantined MAY emit honest kinds", async () => {
    mustExist(PATHS.findingsList);
    const mod = (await import("@/lib/hermes/hermes-findings-list")) as {
      listHermesFindingsFromState?: ListHermesFindingsFromState;
    };
    expect(mod.listHermesFindingsFromState, "list module must export listHermesFindingsFromState").toEqual(
      expect.any(Function),
    );
    const list = mod.listHermesFindingsFromState as ListHermesFindingsFromState;

    const empty = await callList(list, { tenantId: TENANT, executions: [], workers: [] });
    expect(empty, "listHermesFindingsFromState empty → []").toEqual([]);

    const leaseGap = await callList(list, {
      tenantId: TENANT,
      executions: [assignedAdmittedNoLease("exec-assigned-no-lease")],
      workers: [],
    });
    expect(
      findingKinds(leaseGap),
      "admitted assigned + lease null MUST NOT produce mission_stuck (lease-gap; would invent timeouts)",
    ).not.toContain("mission_stuck");
    for (const record of findingRecords(leaseGap)) {
      expect(record.kind, "lease-gap must not be stamped as a stuck/timeout finding").not.toBe(
        "mission_stuck",
      );
    }

    const denied = await callList(list, {
      tenantId: TENANT,
      executions: [deniedExecution("exec-denied")],
      workers: [],
    });
    const deniedKinds = findingKinds(denied);
    for (const kind of deniedKinds) {
      expect(
        kind,
        "denied execution MAY produce mission_denied and must not invent other kinds",
      ).toBe("mission_denied");
    }

    const quarantined = await callList(list, {
      tenantId: TENANT,
      executions: [],
      workers: [quarantinedWorker("worker-q")],
    });
    const quarantinedKinds = findingKinds(quarantined);
    for (const kind of quarantinedKinds) {
      expect(
        kind,
        "quarantined worker MAY produce worker_quarantined and must not invent other kinds",
      ).toBe("worker_quarantined");
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * C. Phase 52 classified attachment — not implementation authorization
 * ───────────────────────────────────────────────────────────── */

describe("C. Phase 52 attachment is locked, not authorized", () => {
  it("PHASE52_IMPLEMENTATION_AUTHORIZED === false in the architecture JSON", () => {
    const jsonText = mustRead(PATHS.phase52Json);
    expect(jsonText).toMatch(/PHASE52_IMPLEMENTATION_AUTHORIZED/);
    const json = JSON.parse(jsonText) as { PHASE52_IMPLEMENTATION_AUTHORIZED?: unknown };
    expect(json.PHASE52_IMPLEMENTATION_AUTHORIZED).toBe(false);
  });

  it("PHASE52_IMPLEMENTATION_AUTHORIZED === false in the attachment TypeScript module", () => {
    const ts = mustRead(PATHS.phase52Ts);
    expect(ts).toMatch(/PHASE52_IMPLEMENTATION_AUTHORIZED/);
    expect(ts).toMatch(/PHASE52_IMPLEMENTATION_AUTHORIZED\s*=\s*false/);
  });

  it("frozen worker ids are not implementable", () => {
    const ts = mustRead(PATHS.phase52Ts);
    for (const workerId of FROZEN_WORKER_IDS) {
      expect(ts, `phase52 attachment must name frozen worker ${workerId}`).toContain(workerId);
      expect(isWorkerActivatable(workerId), `${workerId} must not be activatable on the V1 lock`).toBe(
        false,
      );
    }
    expect(ts).toMatch(/implementable|do_not_implement|not implementable|FREEZE/i);
  });
});

/* ─────────────────────────────────────────────────────────────
 * D. Secrets hygiene
 * ───────────────────────────────────────────────────────────── */

describe("D. secrets hygiene on the new findings-list modules", () => {
  it("findings-list.ts and findings-list.server.ts carry no secret VALUES", () => {
    const rels = [PATHS.findingsList, PATHS.findingsListServer] as const;
    for (const rel of rels) {
      const source = mustRead(rel);
      expect(source, `${rel} must not embed secret values`).not.toMatch(SECRET_VALUE);
      expect(source, `${rel} must not assign a password literal`).not.toMatch(
        /\bpassword\s*[:=]\s*["'][^"']{4,}["']/i,
      );
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * E. Tenant isolation
 * ───────────────────────────────────────────────────────────── */

describe("E. tenant isolation on the findings list", () => {
  it("list functions require tenantId (source pin)", () => {
    const listTs = mustRead(PATHS.findingsList);
    expect(listTs).toMatch(/tenantId/);
    expect(listTs).toMatch(/listHermesFindingsFromState/);

    const listServer = mustRead(PATHS.findingsListServer);
    expect(listServer).toMatch(/tenantId/);
    expect(listServer).toMatch(/listHermesFindings/);
  });

  it("server queries must eq tenant_id on tenant-scoped tables", () => {
    const stripped = stripComments(mustRead(PATHS.findingsListServer), "code");
    for (const table of TENANT_SCOPED_TABLES) {
      expect(stripped, `server must read tenant-scoped ${table}`).toMatch(
        new RegExp(`["']${table}["']`),
      );
    }
    const tenantEq =
      /\.eq\(\s*["']tenant_id["']/.test(stripped) ||
      /\[["']tenant_id["']\s*,\s*tenantId\]/.test(stripped);
    expect(tenantEq, "server queries must eq tenant_id (source pin tenant_id)").toBe(true);
    expect(stripped).toMatch(/\btenant_id\b/);
  });

  it("behavioral: listHermesFindingsFromState requires tenantId and does not emit cross-tenant findings", async () => {
    mustExist(PATHS.findingsList);
    const mod = (await import("@/lib/hermes/hermes-findings-list")) as {
      listHermesFindingsFromState?: ListHermesFindingsFromState;
    };
    expect(mod.listHermesFindingsFromState).toEqual(expect.any(Function));
    const list = mod.listHermesFindingsFromState as ListHermesFindingsFromState;

    let blank: unknown;
    try {
      blank = await callList(list, {
        tenantId: "",
        executions: [deniedExecution("exec-denied-blank-tenant")],
        workers: [quarantinedWorker("worker-blank-tenant")],
      });
    } catch {
      blank = [];
    }
    expect(findingKinds(blank), "blank tenantId must not invent findings").toEqual([]);

    const foreignWorker: HermesWorkerPosture = {
      ...quarantinedWorker("worker-foreign"),
      tenantId: "tenant-bravo",
    };
    const scoped = await callList(list, {
      tenantId: TENANT,
      executions: [],
      workers: [foreignWorker],
    });
    for (const record of findingRecords(scoped)) {
      expect(record.tenantId, "must not leak a foreign tenant onto listed findings").not.toBe(
        "tenant-bravo",
      );
      expect(record.subjectRef, "must not list a foreign-tenant worker as a finding").not.toBe(
        "worker-foreign",
      );
    }
  });
});

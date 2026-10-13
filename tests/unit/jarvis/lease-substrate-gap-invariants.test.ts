/**
 * CoreGrid — four-eyes SECURITY+QUALITY invariants for the lease-substrate
 * schema gap (ACTIVE-V1). This suite VERIFIES; it does not implement the
 * lock module or the Jarvis runtime.
 *
 * Proof style: readFileSync source pins against the paths other teams land,
 * plus behavioral imports when those modules load cleanly. Missing production
 * files fail closed (`mustExist`). A violating mapping is never accommodated:
 * if Runtime still omits `assertLeaseSubstrateGapRemainsUnauthorized`, that
 * pin MUST fail until they wire it. Closing the gap (apply 20261003000019,
 * invent `cg_mission_lease` into Jarvis/Hermes, treat assigned+lease-null as
 * `mission_stuck`) is NOT authorized.
 *
 * Version-target classification: ACTIVE-V1 (AGENTS.md §45).
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { HermesWorkerPosture } from "@/lib/hermes/hermes-contract";
import type { MissionExecutionState } from "@/lib/missions/mission-execution";
import { isWorkerActivatable } from "@/lib/workforce/v1-workforce-lock";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

const PATHS = {
  lockTs: "frontend/src/lib/missions/lease-substrate-gap-lock.ts",
  lockJson: "architecture/COREGRID_LEASE_SUBSTRATE_GAP_CLASSIFICATION.json",
  cycleRuntime: "frontend/src/lib/jarvis/enterprise-cycle-runtime.server.ts",
  findingsList: "frontend/src/lib/hermes/hermes-findings-list.ts",
  findingsListServer: "frontend/src/lib/hermes/hermes-findings-list.server.ts",
  hermesCycle: "frontend/src/lib/hermes/hermes-cycle.ts",
  cycleScript: "scripts/run-jarvis-enterprise-cycle.mjs",
  cycleWorkflow: ".github/workflows/jarvis-enterprise-cycle.yml",
  missionExecutionDb: "frontend/src/lib/missions/mission-execution-db.server.ts",
  phase52Ts: "frontend/src/lib/workforce/phase52-attachment.ts",
  phase52Json: "architecture/COREGRID_V1_WORKFORCE_PHASE52_ATTACHMENT.json",
  authoredLeaseMigration:
    "database/supabase/migrations/20261003000019_coregrid_v1_mission_lease.sql",
  migrationsDir: "database/supabase/migrations",
} as const;

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

const FORBIDDEN_CLOSE_THE_GAP_ON_RUNTIME = [
  "mission-lease-db",
  "createDbMissionLeasePort",
  "cg_mission_lease",
  "runHermesCycle",
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
  const workers = input.workers ?? [];
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

/** Glob dated migration prefixes via readdir (existsSync of each hit must also be false). */
function globDatedMigrations(prefix: string): string[] {
  const dir = abs(PATHS.migrationsDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.startsWith(prefix));
}

/* ─────────────────────────────────────────────────────────────
 * A. No resident process
 * ───────────────────────────────────────────────────────────── */

describe("A. no resident Jarvis/Hermes/lock process", () => {
  const pins = [
    PATHS.cycleRuntime,
    PATHS.findingsList,
    PATHS.findingsListServer,
    PATHS.lockTs,
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
 * B. Lease-gap honesty (classified, not closed)
 * ───────────────────────────────────────────────────────────── */

describe("B. lease-substrate gap remains classified not-authorized", () => {
  it("LEASE_SUBSTRATE_GAP_CLOSE_AUTHORIZED === false in the lock TypeScript module", () => {
    const ts = mustRead(PATHS.lockTs);
    expect(ts).toMatch(/LEASE_SUBSTRATE_GAP_CLOSE_AUTHORIZED/);
    expect(ts).toMatch(/LEASE_SUBSTRATE_GAP_CLOSE_AUTHORIZED\s*=\s*false/);
  });

  it("LEASE_SUBSTRATE_IMPLEMENTATION_AUTHORIZED === false in the lock TypeScript module", () => {
    const ts = mustRead(PATHS.lockTs);
    expect(ts).toMatch(/LEASE_SUBSTRATE_IMPLEMENTATION_AUTHORIZED/);
    expect(ts).toMatch(/LEASE_SUBSTRATE_IMPLEMENTATION_AUTHORIZED\s*=\s*false/);
  });

  it("LEASE_SUBSTRATE_GAP_CLOSE_AUTHORIZED === false and implementationAuthorized false in the classification JSON", () => {
    const jsonText = mustRead(PATHS.lockJson);
    expect(jsonText).toMatch(/LEASE_SUBSTRATE_GAP_CLOSE_AUTHORIZED/);
    expect(jsonText).toMatch(/LEASE_SUBSTRATE_IMPLEMENTATION_AUTHORIZED/);
    const json = JSON.parse(jsonText) as {
      LEASE_SUBSTRATE_GAP_CLOSE_AUTHORIZED?: unknown;
      LEASE_SUBSTRATE_IMPLEMENTATION_AUTHORIZED?: unknown;
      implementationAuthorized?: unknown;
    };
    expect(json.LEASE_SUBSTRATE_GAP_CLOSE_AUTHORIZED).toBe(false);
    expect(json.LEASE_SUBSTRATE_IMPLEMENTATION_AUTHORIZED).toBe(false);
    expect(json.implementationAuthorized).toBe(false);
  });

  it("mission-execution-db.server.ts still contains lease_substrate_missing", () => {
    const source = mustRead(PATHS.missionExecutionDb);
    expect(source).toMatch(/lease_substrate_missing/);
  });

  it("hermes-findings-list.ts and hermes-findings-list.server.ts MUST NOT contain cg_mission_lease", () => {
    for (const rel of [PATHS.findingsList, PATHS.findingsListServer] as const) {
      const stripped = stripComments(mustRead(rel), "code");
      expect(stripped, `${rel} executable source MUST NOT contain cg_mission_lease`).not.toMatch(
        /cg_mission_lease/,
      );
    }
  });

  it("enterprise-cycle-runtime.server.ts MUST NOT contain mission-lease-db, createDbMissionLeasePort, cg_mission_lease, runHermesCycle", () => {
    // Strip comments so a documented ban ("does not query cg_mission_lease")
    // is not a false finding. Executable code still MUST NOT contain the tokens.
    const stripped = stripComments(mustRead(PATHS.cycleRuntime), "code");
    for (const token of FORBIDDEN_CLOSE_THE_GAP_ON_RUNTIME) {
      expect(stripped, `runtime executable source MUST NOT contain ${token}`).not.toMatch(
        new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      );
    }
    expect(stripped).not.toMatch(/(?:from|import\(\s*)["'][^"']*mission-lease-db["']/);
    expect(stripped).not.toMatch(/\bcreateDbMissionLeasePort\s*\(/);
    expect(stripped).not.toMatch(/\brunHermesCycle\s*\(/);
  });

  it("runtime MUST contain assertLeaseSubstrateGapRemainsUnauthorized and lease-substrate-gap-lock (must fail until Runtime wires it)", () => {
    const source = mustRead(PATHS.cycleRuntime);
    const stripped = stripComments(source, "code");
    expect(
      /lease-substrate-gap-lock/.test(source),
      "enterprise-cycle-runtime.server.ts MUST contain lease-substrate-gap-lock — do not weaken this pin while Runtime has not imported the assert",
    ).toBe(true);
    expect(
      /\bassertLeaseSubstrateGapRemainsUnauthorized\s*\(/.test(stripped),
      "enterprise-cycle-runtime.server.ts MUST call assertLeaseSubstrateGapRemainsUnauthorized( — do not weaken this pin while Runtime has not imported the assert",
    ).toBe(true);
  });

  it("behavioral: listHermesFindingsFromState assigned + lease null MUST NOT produce mission_stuck", async () => {
    mustExist(PATHS.findingsList);
    const mod = (await import("@/lib/hermes/hermes-findings-list")) as {
      listHermesFindingsFromState?: ListHermesFindingsFromState;
    };
    expect(mod.listHermesFindingsFromState, "list module must export listHermesFindingsFromState").toEqual(
      expect.any(Function),
    );
    const list = mod.listHermesFindingsFromState as ListHermesFindingsFromState;

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
  });

  it("no new file matching database/supabase/migrations/20261013* or 20261014* (glob + existsSync are false)", () => {
    const dir = abs(PATHS.migrationsDir);
    expect(existsSync(dir), "migrations directory must exist").toBe(true);

    for (const prefix of ["20261013", "20261014"] as const) {
      const globbed = globDatedMigrations(prefix);
      expect(
        globbed,
        `glob database/supabase/migrations/${prefix}* must be empty — this mission does not author a close-the-gap migration`,
      ).toEqual([]);
      expect(globbed.length === 0, `glob of dated prefix ${prefix}* is false`).toBe(true);
      expect(existsSync(join(dir, prefix)), `existsSync(${prefix}) is false`).toBe(false);
      for (const name of globbed) {
        expect(existsSync(join(dir, name)), `existsSync(${prefix}* hit ${name}) is false`).toBe(
          false,
        );
      }
    }
  });

  it("20261003000019 remains AUTHORED NOT APPLIED in its header comment", () => {
    const source = mustRead(PATHS.authoredLeaseMigration);
    const header = source.slice(0, 4000);
    expect(header).toMatch(/AUTHORED[,\s]+NOT APPLIED/i);
    expect(header).toMatch(/Status:\s*AUTHORED,\s*NOT APPLIED/);
  });

  it("behavioral: lock module refuses gap-close and implementation authorization", async () => {
    mustExist(PATHS.lockTs);
    const mod = (await import("@/lib/missions/lease-substrate-gap-lock")) as Record<string, unknown>;
    expect(mod.LEASE_SUBSTRATE_GAP_CLOSE_AUTHORIZED).toBe(false);
    expect(mod.LEASE_SUBSTRATE_IMPLEMENTATION_AUTHORIZED).toBe(false);
    if ("implementationAuthorized" in mod) {
      expect(mod.implementationAuthorized).toBe(false);
    }
    expect(
      mod.assertLeaseSubstrateGapRemainsUnauthorized,
      "lock module must export assertLeaseSubstrateGapRemainsUnauthorized",
    ).toEqual(expect.any(Function));
    expect(() => (mod.assertLeaseSubstrateGapRemainsUnauthorized as () => void)()).not.toThrow();
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

describe("D. secrets hygiene on the lease-substrate gap lock", () => {
  it("lease-substrate-gap-lock.ts carries no sk_live / private-key VALUES", () => {
    const source = mustRead(PATHS.lockTs);
    expect(source, `${PATHS.lockTs} must not embed secret values`).not.toMatch(SECRET_VALUE);
    expect(source, `${PATHS.lockTs} must not embed sk_live values`).not.toMatch(/sk_live_/);
    expect(source, `${PATHS.lockTs} must not embed private keys`).not.toMatch(
      /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
    );
  });
});

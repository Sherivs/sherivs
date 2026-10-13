/**
 * CoreGrid — four-eyes SECURITY+QUALITY invariants for the lease-substrate
 * remaining-work after HUMAN AUTHORIZATION 2026-10-13:
 *   status widen, V1-004 lease writes, Phase 52 RELATED extract
 *   (not engine implementation), governed Jarvis/Hermes residents.
 *
 * This suite VERIFIES; it does not implement the projector, the V1-004
 * rewrite, the Phase 52 extract, or the resident supervisors. Proof style:
 * readFileSync source pins against the paths other teams land, plus
 * behavioral imports when those modules load cleanly. Missing production
 * files fail closed (`mustExist`). A violating mapping is never accommodated.
 *
 * Authorized remaining-work honesty (NEW WORLD):
 *   LEASE_SUBSTRATE_APPLY_AUTHORIZED true
 *   LEASE_SUBSTRATE_GAP_CLOSE_AUTHORIZED true
 *   LEASE_SUBSTRATE_IMPLEMENTATION_AUTHORIZED true
 *   EXECUTION_STATUS_WIDEN_AUTHORIZED / LEASE_SUBSTRATE_EXECUTION_STATUS_WIDEN_AUTHORIZED true
 *   PHASE52_IMPLEMENTATION_AUTHORIZED false (do not weaken)
 *   Libraries still MUST NOT contain setInterval(, while (true), new Worker(
 *   enterprise-cycle-runtime.server.ts still MUST NOT call runHermesCycle
 *     (listing ≠ repair). Hermes resident MAY jiti hermes-cycle.
 *   Migration 20261013000050 MUST exist. 20261003000019 SQL sha256 still
 *     matches the hardening checksum (file unmodified).
 *   V1-004 mission-execution-db.server.ts MUST import/createDbMissionLeasePort
 *     and MUST NOT still return leaseOperation stub as the only lease API.
 *     lease_substrate_missing MAY remain as a string export.
 *   Extract JSON architecture/COREGRID_PHASE52_JARVIS_HERMES_LEASE_EXTRACT.json
 *     has phase52ImplementationAuthorized false and relatedRequirementIds
 *     including G-092 and G-057.
 *   Assigned + lease null MUST still NOT produce mission_stuck.
 *   Leased + expired lease MUST be allowed to produce mission_stuck (real orphan).
 *
 * Governed residents are pinned in
 * tests/unit/jarvis/resident-supervisor-invariants.test.ts.
 *
 * Version-target classification: ACTIVE-V1 (AGENTS.md §45).
 */
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { HermesWorkerPosture } from "@/lib/hermes/hermes-contract";
import type { MissionExecutionState, MissionLease } from "@/lib/missions/mission-execution";
import { isWorkerActivatable } from "@/lib/workforce/v1-workforce-lock";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

const PATHS = {
  lockTs: "frontend/src/lib/missions/lease-substrate-gap-lock.ts",
  lockJson: "architecture/COREGRID_LEASE_SUBSTRATE_GAP_CLASSIFICATION.json",
  cycleRuntime: "frontend/src/lib/jarvis/enterprise-cycle-runtime.server.ts",
  findingsList: "frontend/src/lib/hermes/hermes-findings-list.ts",
  findingsListServer: "frontend/src/lib/hermes/hermes-findings-list.server.ts",
  hermesCycle: "frontend/src/lib/hermes/hermes-cycle.ts",
  enterpriseLoop: "frontend/src/lib/jarvis/enterprise-loop.ts",
  missionExecutionDb: "frontend/src/lib/missions/mission-execution-db.server.ts",
  phase52Ts: "frontend/src/lib/workforce/phase52-attachment.ts",
  phase52Json: "architecture/COREGRID_V1_WORKFORCE_PHASE52_ATTACHMENT.json",
  phase52Extract: "architecture/COREGRID_PHASE52_JARVIS_HERMES_LEASE_EXTRACT.json",
  authoredLeaseMigration:
    "database/supabase/migrations/20261003000019_coregrid_v1_mission_lease.sql",
  migrationsDir: "database/supabase/migrations",
  hardeningJson: "architecture/proofs/CANONICAL_APPLY_RECORD_HARDENING.json",
} as const;

const LIBRARY_NO_DAEMON = [
  PATHS.cycleRuntime,
  PATHS.hermesCycle,
  PATHS.enterpriseLoop,
  PATHS.findingsList,
  PATHS.lockTs,
] as const;

const LEASE_MIGRATION_FILE = "20261003000019_coregrid_v1_mission_lease.sql";
const NEW_MIGRATION_PREFIX = "20261013000050";

const FROZEN_WORKER_IDS = [
  "sdk_engineer",
  "ml_engineer",
  "knowledge_engineer",
  "intelligence_research_agent",
  "growth_intelligence_agent",
  "customer_success_agent",
] as const;

const TENANT = "tenant-alpha";
const FOREIGN_TENANT = "tenant-bravo";
const NOW = "2026-10-13T08:00:00.000Z";
const STALE_ASSIGNED_AT = "2026-01-01T00:00:00.000Z";
const EXPIRED_LEASE_AT = "2026-01-01T00:00:30.000Z";

const SECRET_VALUE =
  /(?:sk_live_|sk_test_|whsec_|phc_|xox[baprs]-)[A-Za-z0-9]+|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|AKIA[0-9A-Z]{16}/;

const LIBRARY_DAEMON_PRIMITIVES = [
  /\bsetInterval\s*\(/,
  /\bwhile\s*\(\s*true\s*\)/,
  /\bnew\s+Worker\s*\(/,
] as const;

const FORBIDDEN_ON_RUNTIME = [
  "mission-lease-db",
  "createDbMissionLeasePort",
  "cg_mission_lease",
  "runHermesCycle",
] as const;

const LEASE_OPERATION_STUB = /leaseOperation\s*:\s*\(\s*\)\s*=>\s*leaseGap\s*\(\s*\)/;

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

function mustReadBytes(rel: string): Buffer {
  return readFileSync(mustExist(rel));
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

function expiredLease(executionId: string): MissionLease {
  return {
    leaseId: `lease-${executionId}`,
    workerId: "worker-1",
    acquiredAt: STALE_ASSIGNED_AT,
    heartbeatAt: STALE_ASSIGNED_AT,
    leaseExpiresAt: EXPIRED_LEASE_AT,
  };
}

function leasedExpiredOrphan(executionId: string): MissionExecutionState {
  return {
    ...assignedAdmittedNoLease(executionId),
    stage: "leased",
    lastWorkerId: "worker-1",
    lease: expiredLease(executionId),
  };
}

function quarantinedWorker(workerId: string, tenantId = TENANT): HermesWorkerPosture {
  return {
    workerId,
    tenantId,
    lifecycle: "active",
    quarantined: true,
    failureCount: 1,
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

async function loadList(): Promise<ListHermesFindingsFromState> {
  mustExist(PATHS.findingsList);
  const mod = (await import("@/lib/hermes/hermes-findings-list")) as {
    listHermesFindingsFromState?: ListHermesFindingsFromState;
  };
  expect(mod.listHermesFindingsFromState, "list module must export listHermesFindingsFromState").toEqual(
    expect.any(Function),
  );
  return mod.listHermesFindingsFromState as ListHermesFindingsFromState;
}

/** Glob dated migration prefixes via readdir (mustExist each hit). */
function globDatedMigrations(prefix: string): string[] {
  const dir = abs(PATHS.migrationsDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((name) => name.startsWith(prefix));
}

function canonicalLeaseMigrationChecksum(): string {
  const hardening = JSON.parse(mustRead(PATHS.hardeningJson)) as {
    declaredVsApplied?: ReadonlyArray<{ file?: unknown; checksum?: unknown }>;
  };
  const entry = (hardening.declaredVsApplied ?? []).find(
    (row) => row.file === LEASE_MIGRATION_FILE,
  );
  expect(entry, `hardening record must include ${LEASE_MIGRATION_FILE}`).toBeTruthy();
  expect(typeof entry?.checksum, "hardening checksum must be a sha256 hex string").toBe("string");
  expect(entry?.checksum, "hardening checksum shape").toMatch(/^[0-9a-f]{64}$/);
  return entry!.checksum as string;
}

function widenAuthorizedToken(source: Record<string, unknown>): unknown {
  return (
    source.LEASE_SUBSTRATE_EXECUTION_STATUS_WIDEN_AUTHORIZED ??
    source.EXECUTION_STATUS_WIDEN_AUTHORIZED
  );
}

/* ─────────────────────────────────────────────────────────────
 * A. Libraries still have NO daemon primitives
 * ───────────────────────────────────────────────────────────── */

describe("A. libraries still have no setInterval / while(true) / new Worker(", () => {
  it.each(LIBRARY_NO_DAEMON)("%s must exist and must not start a resident process", (rel) => {
    const source = stripComments(mustRead(rel), "code");
    for (const pattern of LIBRARY_DAEMON_PRIMITIVES) {
      expect(source, `${rel} must not contain ${pattern}`).not.toMatch(pattern);
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * C. listing ≠ repair (runtime still MUST NOT call runHermesCycle)
 * ───────────────────────────────────────────────────────────── */

describe("C. enterprise-cycle-runtime.server.ts still MUST NOT call runHermesCycle", () => {
  it("runtime executable source MUST NOT import mission-lease-db, query cg_mission_lease, or call runHermesCycle", () => {
    const stripped = stripComments(mustRead(PATHS.cycleRuntime), "code");
    for (const token of FORBIDDEN_ON_RUNTIME) {
      expect(stripped, `runtime executable source MUST NOT contain ${token}`).not.toMatch(
        new RegExp(token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      );
    }
    expect(stripped).not.toMatch(/(?:from|import\(\s*)["'][^"']*mission-lease-db["']/);
    expect(stripped).not.toMatch(/\bcreateDbMissionLeasePort\s*\(/);
    expect(stripped).not.toMatch(/\brunHermesCycle\s*\(/);
  });
});

/* ─────────────────────────────────────────────────────────────
 * D. Lock tokens: WIDEN / IMPLEMENTATION / APPLY / GAP_CLOSE true
 *    Phase 52 PHASE52_IMPLEMENTATION_AUTHORIZED remains false
 * ───────────────────────────────────────────────────────────── */

describe("D. lease-substrate lock tokens after HUMAN AUTHORIZATION 2026-10-13", () => {
  it("LEASE_SUBSTRATE_APPLY_AUTHORIZED === true in the lock TypeScript module", () => {
    const ts = mustRead(PATHS.lockTs);
    expect(ts).toMatch(/LEASE_SUBSTRATE_APPLY_AUTHORIZED/);
    expect(ts).toMatch(/LEASE_SUBSTRATE_APPLY_AUTHORIZED\s*=\s*true/);
  });

  it("LEASE_SUBSTRATE_GAP_CLOSE_AUTHORIZED === true in the lock TypeScript module", () => {
    const ts = mustRead(PATHS.lockTs);
    expect(ts).toMatch(/LEASE_SUBSTRATE_GAP_CLOSE_AUTHORIZED/);
    expect(ts).toMatch(/LEASE_SUBSTRATE_GAP_CLOSE_AUTHORIZED\s*=\s*true/);
  });

  it("LEASE_SUBSTRATE_IMPLEMENTATION_AUTHORIZED === true in the lock TypeScript module", () => {
    const ts = mustRead(PATHS.lockTs);
    expect(ts).toMatch(/LEASE_SUBSTRATE_IMPLEMENTATION_AUTHORIZED/);
    expect(ts).toMatch(/LEASE_SUBSTRATE_IMPLEMENTATION_AUTHORIZED\s*=\s*true/);
  });

  it("EXECUTION_STATUS_WIDEN_AUTHORIZED === true in the lock TypeScript module", () => {
    const ts = mustRead(PATHS.lockTs);
    expect(ts).toMatch(/(?:LEASE_SUBSTRATE_)?EXECUTION_STATUS_WIDEN_AUTHORIZED/);
    expect(ts).toMatch(/(?:LEASE_SUBSTRATE_)?EXECUTION_STATUS_WIDEN_AUTHORIZED\s*=\s*true/);
  });

  it("authorized tokens in the classification JSON (WIDEN/IMPLEMENTATION/APPLY/GAP_CLOSE true)", () => {
    const jsonText = mustRead(PATHS.lockJson);
    expect(jsonText).toMatch(/LEASE_SUBSTRATE_APPLY_AUTHORIZED/);
    expect(jsonText).toMatch(/LEASE_SUBSTRATE_GAP_CLOSE_AUTHORIZED/);
    expect(jsonText).toMatch(/LEASE_SUBSTRATE_IMPLEMENTATION_AUTHORIZED/);
    expect(jsonText).toMatch(/(?:LEASE_SUBSTRATE_)?EXECUTION_STATUS_WIDEN_AUTHORIZED/);
    const json = JSON.parse(jsonText) as Record<string, unknown>;
    expect(json.LEASE_SUBSTRATE_APPLY_AUTHORIZED).toBe(true);
    expect(json.LEASE_SUBSTRATE_GAP_CLOSE_AUTHORIZED).toBe(true);
    expect(json.LEASE_SUBSTRATE_IMPLEMENTATION_AUTHORIZED).toBe(true);
    expect(widenAuthorizedToken(json)).toBe(true);
    if ("implementationAuthorized" in json) {
      expect(json.implementationAuthorized).toBe(true);
    }
  });

  it("PHASE52_IMPLEMENTATION_AUTHORIZED === false in the architecture JSON (do not weaken)", () => {
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

  it("behavioral: lock module exports APPLY/GAP_CLOSE/IMPLEMENTATION/WIDEN true", async () => {
    mustExist(PATHS.lockTs);
    const mod = (await import("@/lib/missions/lease-substrate-gap-lock")) as Record<string, unknown>;
    expect(mod.LEASE_SUBSTRATE_APPLY_AUTHORIZED).toBe(true);
    expect(mod.LEASE_SUBSTRATE_GAP_CLOSE_AUTHORIZED).toBe(true);
    expect(mod.LEASE_SUBSTRATE_IMPLEMENTATION_AUTHORIZED).toBe(true);
    expect(widenAuthorizedToken(mod)).toBe(true);
    if ("implementationAuthorized" in mod) {
      expect(mod.implementationAuthorized).toBe(true);
    }
  });

  it("behavioral: Phase 52 attachment module still refuses implementation authorization", async () => {
    mustExist(PATHS.phase52Ts);
    const mod = (await import("@/lib/workforce/phase52-attachment")) as Record<string, unknown>;
    expect(mod.PHASE52_IMPLEMENTATION_AUTHORIZED).toBe(false);
    if ("phase52Registered" in mod) {
      expect(mod.phase52Registered).toBe(false);
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * E. New migration 20261013000050 exists; 20261003000019 unmodified
 * ───────────────────────────────────────────────────────────── */

describe("E. migration 20261013000050 exists; 20261003000019 checksum bound", () => {
  it("new file matching database/supabase/migrations/20261013000050* mustExist", () => {
    const dir = abs(PATHS.migrationsDir);
    expect(existsSync(dir), "migrations directory must exist").toBe(true);
    const globbed = globDatedMigrations(NEW_MIGRATION_PREFIX);
    expect(
      globbed.length,
      `four-eyes fail-closed: missing production migration ${NEW_MIGRATION_PREFIX}*`,
    ).toBeGreaterThan(0);
    for (const name of globbed) {
      mustExist(`${PATHS.migrationsDir}/${name}`);
    }
  });

  it("20261003000019 SQL bytes match the canonical hardening checksum (file unmodified)", () => {
    const expected = canonicalLeaseMigrationChecksum();
    const digest = createHash("sha256").update(mustReadBytes(PATHS.authoredLeaseMigration)).digest("hex");
    expect(
      digest,
      "on-disk 20261003000019 bytes must equal architecture/proofs/CANONICAL_APPLY_RECORD_HARDENING.json checksum — do not rewrite the SQL",
    ).toBe(expected);
  });
});

/* ─────────────────────────────────────────────────────────────
 * F. V1-004 must compose createDbMissionLeasePort (lease writes)
 * ───────────────────────────────────────────────────────────── */

describe("F. V1-004 mission-execution-db.server.ts composes createDbMissionLeasePort", () => {
  it("MUST import/createDbMissionLeasePort and MUST NOT return leaseOperation stub as the only lease API", () => {
    const source = mustRead(PATHS.missionExecutionDb);
    expect(source, "V1-004 must name createDbMissionLeasePort").toMatch(/\bcreateDbMissionLeasePort\b/);
    expect(source, "V1-004 must import createDbMissionLeasePort").toMatch(
      /createDbMissionLeasePort/,
    );
    const stripped = stripComments(source, "code");
    expect(stripped, "V1-004 must call createDbMissionLeasePort").toMatch(
      /\bcreateDbMissionLeasePort\s*\(/,
    );
    expect(
      stripped,
      "V1-004 MUST NOT still return leaseOperation stub as the only lease API (pin createDbMissionLeasePort)",
    ).not.toMatch(LEASE_OPERATION_STUB);
  });
});

/* ─────────────────────────────────────────────────────────────
 * G. Phase 52 RELATED extract (not engine implementation)
 * ───────────────────────────────────────────────────────────── */

describe("G. Phase 52 Jarvis/Hermes lease RELATED extract is not implementation authorization", () => {
  it("extract JSON mustExist with phase52ImplementationAuthorized false and relatedRequirementIds G-092 G-057", () => {
    const jsonText = mustRead(PATHS.phase52Extract);
    const json = JSON.parse(jsonText) as {
      phase52ImplementationAuthorized?: unknown;
      PHASE52_IMPLEMENTATION_AUTHORIZED?: unknown;
      relatedRequirementIds?: unknown;
    };
    expect(json.phase52ImplementationAuthorized, "phase52ImplementationAuthorized must be false").toBe(
      false,
    );
    if ("PHASE52_IMPLEMENTATION_AUTHORIZED" in json) {
      expect(json.PHASE52_IMPLEMENTATION_AUTHORIZED).toBe(false);
    }
    expect(Array.isArray(json.relatedRequirementIds), "relatedRequirementIds must be an array").toBe(
      true,
    );
    expect(json.relatedRequirementIds).toEqual(expect.arrayContaining(["G-092", "G-057"]));
  });
});

/* ─────────────────────────────────────────────────────────────
 * Findings honesty (do not invent assigned-without-lease as stuck)
 * ───────────────────────────────────────────────────────────── */

describe("findings honesty after status widen / V1-004 lease writes", () => {
  it("pure hermes-findings-list.ts must not query cg_mission_lease", () => {
    const stripped = stripComments(mustRead(PATHS.findingsList), "code");
    expect(
      stripped,
      "pure findings-list.ts must not query cg_mission_lease (projection is the server adapter)",
    ).not.toMatch(/cg_mission_lease/);
  });

  it("hermes-findings-list.server.ts MUST contain cg_mission_lease AND tenant_id", () => {
    const stripped = stripComments(mustRead(PATHS.findingsListServer), "code");
    expect(
      stripped,
      "findings-list SERVER MUST query cg_mission_lease after HUMAN AUTHORIZATION 2026-10-13 apply",
    ).toMatch(/cg_mission_lease/);
    expect(
      stripped,
      "findings-list SERVER MUST keep tenant_id (lease query is tenant-scoped)",
    ).toMatch(/\btenant_id\b/);
    const tenantEq =
      /\.eq\(\s*["']tenant_id["']/.test(stripped) ||
      /\[["']tenant_id["']\s*,\s*[A-Za-z_][\w]*\]/.test(stripped);
    expect(tenantEq, "server queries must eq tenant_id (source pin tenant_id)").toBe(true);
  });

  it("behavioral: listHermesFindingsFromState assigned + lease null MUST NOT produce mission_stuck", async () => {
    const list = await loadList();
    const leaseGap = await callList(list, {
      tenantId: TENANT,
      executions: [assignedAdmittedNoLease("exec-assigned-no-lease")],
      workers: [],
    });
    expect(
      findingKinds(leaseGap),
      "admitted assigned + lease null MUST NOT produce mission_stuck (would invent timeouts)",
    ).not.toContain("mission_stuck");
    for (const record of findingRecords(leaseGap)) {
      expect(record.kind, "assigned+lease-null must not be stamped as a stuck/timeout finding").not.toBe(
        "mission_stuck",
      );
    }
  });

  it("behavioral: leased + expired lease MUST be allowed to produce mission_stuck (real orphan)", async () => {
    const list = await loadList();
    const orphan = await callList(list, {
      tenantId: TENANT,
      executions: [leasedExpiredOrphan("exec-leased-expired")],
      workers: [],
    });
    expect(
      findingKinds(orphan),
      "leased + expired lease is a real orphan and MUST be allowed to produce mission_stuck",
    ).toContain("mission_stuck");
  });
});

/* ─────────────────────────────────────────────────────────────
 * Secrets hygiene
 * ───────────────────────────────────────────────────────────── */

describe("secrets hygiene on the lease-substrate lock and extract", () => {
  it.each([PATHS.lockTs, PATHS.lockJson, PATHS.phase52Extract] as const)(
    "%s carries no sk_live / private-key VALUES",
    (rel) => {
      const source = mustRead(rel);
      expect(source, `${rel} must not embed secret values`).not.toMatch(SECRET_VALUE);
      expect(source, `${rel} must not embed sk_live values`).not.toMatch(/sk_live_/);
      expect(source, `${rel} must not embed private keys`).not.toMatch(
        /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
      );
    },
  );
});

/* ─────────────────────────────────────────────────────────────
 * Tenant isolation (do not weaken)
 * ───────────────────────────────────────────────────────────── */

describe("tenant isolation on the findings list", () => {
  it("list functions require tenantId (source pin)", () => {
    const listTs = mustRead(PATHS.findingsList);
    expect(listTs).toMatch(/tenantId/);
    expect(listTs).toMatch(/listHermesFindingsFromState/);

    const listServer = mustRead(PATHS.findingsListServer);
    expect(listServer).toMatch(/tenantId/);
    expect(listServer).toMatch(/listHermesFindings/);
    expect(listServer).toMatch(/\btenant_id\b/);
  });

  it("server cg_mission_lease query is tenant-scoped", () => {
    const stripped = stripComments(mustRead(PATHS.findingsListServer), "code");
    expect(stripped, "server MUST name cg_mission_lease").toMatch(/["']cg_mission_lease["']/);
    const tenantEq =
      /\.eq\(\s*["']tenant_id["']/.test(stripped) ||
      /\[["']tenant_id["']\s*,\s*[A-Za-z_][\w]*\]/.test(stripped);
    expect(tenantEq, "server queries must eq tenant_id on tenant-scoped tables including cg_mission_lease").toBe(
      true,
    );
  });

  it("behavioral: listHermesFindingsFromState requires tenantId and does not emit cross-tenant findings", async () => {
    const list = await loadList();

    let blank: unknown;
    try {
      blank = await callList(list, {
        tenantId: "",
        executions: [leasedExpiredOrphan("exec-blank-tenant")],
        workers: [quarantinedWorker("worker-blank-tenant")],
      });
    } catch {
      blank = [];
    }
    expect(findingKinds(blank), "blank tenantId must not invent findings").toEqual([]);

    const scoped = await callList(list, {
      tenantId: TENANT,
      executions: [{ ...leasedExpiredOrphan("exec-foreign"), tenantId: FOREIGN_TENANT }],
      workers: [quarantinedWorker("worker-foreign", FOREIGN_TENANT)],
    });
    for (const record of findingRecords(scoped)) {
      expect(record.tenantId, "must not leak a foreign tenant onto listed findings").not.toBe(
        FOREIGN_TENANT,
      );
      expect(record.subjectRef, "must not list a foreign-tenant execution as a finding").not.toBe(
        "exec-foreign",
      );
      expect(record.subjectRef, "must not list a foreign-tenant worker as a finding").not.toBe(
        "worker-foreign",
      );
    }
  });
});

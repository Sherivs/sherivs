/**
 * CoreGrid — four-eyes SECURITY+QUALITY invariants for Hermes finding
 * stamps into Jarvis (ACTIVE-V1). This suite VERIFIES; it does not
 * implement the Observability translator or the Runtime cycle wake.
 *
 * Proof style: readFileSync source pins against the paths other teams
 * land, plus behavioral imports when those modules load cleanly. Missing
 * production files fail closed (`mustExist`). A violating mapping is
 * never accommodated: if Runtime calls `runHermesCycle` from the Jarvis
 * wake, that pin MUST fail. Listing findings ≠ running the repair cycle.
 *
 * Version-target classification: ACTIVE-V1 (AGENTS.md §45).
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DETECTABLE_CONDITIONS } from "@/lib/jarvis/enterprise-loop";
import { hermesClaim, type HermesFinding, type HermesFindingKind } from "@/lib/hermes/hermes-contract";
import { isWorkerActivatable } from "@/lib/workforce/v1-workforce-lock";

const ROOT = fileURLToPath(new URL("../../..", import.meta.url));

const PATHS = {
  findingObservation: "frontend/src/lib/hermes/hermes-finding-observation.ts",
  cycleRuntime: "frontend/src/lib/jarvis/enterprise-cycle-runtime.server.ts",
  enterpriseLoop: "frontend/src/lib/jarvis/enterprise-loop.ts",
  hermesCycle: "frontend/src/lib/hermes/hermes-cycle.ts",
  phase52Ts: "frontend/src/lib/workforce/phase52-attachment.ts",
  phase52Json: "architecture/COREGRID_V1_WORKFORCE_PHASE52_ATTACHMENT.json",
  cycleScript: "scripts/run-jarvis-enterprise-cycle.mjs",
  cycleWorkflow: ".github/workflows/jarvis-enterprise-cycle.yml",
} as const;

const FROZEN_WORKER_IDS = [
  "sdk_engineer",
  "ml_engineer",
  "knowledge_engineer",
  "intelligence_research_agent",
  "growth_intelligence_agent",
  "customer_success_agent",
] as const;

const BRIEF_ONLY_KINDS = [
  "mission_failed",
  "evidence_unverified",
  "mission_denied",
  "worker_suspended",
] as const satisfies readonly HermesFindingKind[];

const FORBIDDEN_BRIEF_DETECTABLE = [
  "provider_outage",
  "redis_failure",
  "test_regression",
  "api_failure",
] as const;

const TENANT = "tenant-alpha";
const OTHER_TENANT = "tenant-bravo";
const NOW = "2026-10-13T08:00:00.000Z";

const SECRET_VALUE =
  /(?:sk_live_|sk_test_|whsec_|phc_|xox[baprs]-)[A-Za-z0-9]+|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|AKIA[0-9A-Z]{16}/;

const RESIDENT_PROCESS = [
  /\bsetInterval\s*\(/,
  /\bwhile\s*\(\s*true\s*\)/,
  /\bnew\s+Worker\s*\(/,
  /\bkind:\s*Deployment\b/,
] as const;

type StampHermesFindings = (input: {
  tenantRef: string;
  findings: readonly unknown[];
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

function workflowOnKeys(yaml: string): string[] {
  const stripped = stripComments(yaml, "yaml");
  const match = stripped.match(/^on:\s*(?:\[([^\]]+)\]|\n((?:[ \t]+.*\n)*))/m);
  if (!match) return [];
  if (match[1]) {
    return match[1]
      .split(",")
      .map((item) => item.trim().replace(/['"]/g, ""))
      .filter(Boolean);
  }
  const block = match[2] ?? "";
  const keys: string[] = [];
  for (const line of block.split("\n")) {
    const key = line.match(/^[ \t]{2}([A-Za-z_][\w]*)\s*:/);
    if (key) keys.push(key[1]);
  }
  return keys;
}

function observationRecords(result: unknown): Record<string, unknown>[] {
  if (!Array.isArray(result)) return [];
  const records: Record<string, unknown>[] = [];
  for (const item of result) {
    if (item !== null && typeof item === "object") records.push(item as Record<string, unknown>);
  }
  return records;
}

function observationKinds(result: unknown): string[] {
  const kinds: string[] = [];
  for (const record of observationRecords(result)) {
    if (typeof record.kind === "string") kinds.push(record.kind);
    else if (typeof record.condition === "string") kinds.push(record.condition);
  }
  return kinds;
}

function observationClaimClasses(result: unknown): string[] {
  const classes: string[] = [];
  for (const record of observationRecords(result)) {
    if (typeof record.claimClass === "string") classes.push(record.claimClass);
  }
  return classes;
}

function hermesFinding(
  partial: Partial<HermesFinding> & Pick<HermesFinding, "kind">,
): HermesFinding {
  const kind = partial.kind;
  const subjectRef = partial.subjectRef ?? `subject-${kind}`;
  const tenantId = partial.tenantId ?? TENANT;
  const observedAt = partial.observedAt ?? NOW;
  return {
    findingId: partial.findingId ?? `${kind}:${subjectRef}`,
    kind,
    tenantId,
    subjectRef,
    severity: partial.severity ?? "warning",
    summary: partial.summary ?? `${kind} on ${subjectRef}`,
    evidenceRefs: partial.evidenceRefs ?? [`cg_execution_record:${subjectRef}`],
    observedAt,
    claim:
      partial.claim ??
      hermesClaim("mission_record_port", `cg_execution_record:${subjectRef}`, observedAt, `${kind}`),
  };
}

function callStamp(fn: StampHermesFindings, findings: readonly unknown[], tenantRef: string = TENANT): unknown {
  // Specified Observability contract: stampHermesFindings({ tenantRef, findings }).
  // Do not guess arity — a findings-only call would look like a missing tenant and stamp nothing.
  return fn({ tenantRef, findings });
}

/* ─────────────────────────────────────────────────────────────
 * A. No resident process
 * ───────────────────────────────────────────────────────────── */

describe("A. no resident Jarvis/Hermes process", () => {
  const pins = [
    PATHS.cycleRuntime,
    PATHS.enterpriseLoop,
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

  it("workflow triggers are schedule + workflow_dispatch only", () => {
    const yaml = mustRead(PATHS.cycleWorkflow);
    const keys = workflowOnKeys(yaml);
    expect(keys, "workflow on: keys").toEqual(expect.arrayContaining(["schedule", "workflow_dispatch"]));
    expect(keys.sort()).toEqual(["schedule", "workflow_dispatch"].sort());
    expect(keys).not.toContain("push");
    expect(keys).not.toContain("pull_request");
  });
});

/* ─────────────────────────────────────────────────────────────
 * B. Honest Hermes finding stamps
 * ───────────────────────────────────────────────────────────── */

describe("B. honest Hermes finding observation stamps", () => {
  it("translator module exists and exports stampHermesFindings (fail-closed if missing)", () => {
    const source = mustRead(PATHS.findingObservation);
    expect(source).toMatch(/\bstampHermesFindings\b/);
    expect(source).toMatch(/export\s+(?:async\s+)?function\s+stampHermesFindings\b|export\s+\{[^}]*\bstampHermesFindings\b/);
  });

  it("maps mission_stuck → mission_timeout (detectable); never an invented outage", () => {
    const source = mustRead(PATHS.findingObservation);
    expect(source).toMatch(/mission_stuck/);
    expect(source).toMatch(/mission_timeout/);
    expect(source).not.toMatch(/["']mission_stuck["']\s*:\s*["']provider_outage["']/);
    expect(source).not.toMatch(/["']mission_stuck["']\s*:\s*["']api_failure["']/);
  });

  it("maps worker_quarantined → worker_failure (detectable)", () => {
    const source = mustRead(PATHS.findingObservation);
    expect(source).toMatch(/worker_quarantined/);
    expect(source).toMatch(/worker_failure/);
    expect(source).not.toMatch(/["']worker_quarantined["']\s*:\s*["']provider_outage["']/);
  });

  it("brief-only kinds must not map onto provider_outage / redis_failure / test_regression / api_failure", () => {
    const source = mustRead(PATHS.findingObservation);
    for (const kind of BRIEF_ONLY_KINDS) {
      for (const forbidden of FORBIDDEN_BRIEF_DETECTABLE) {
        expect(source, `${kind} must not map to ${forbidden}`).not.toMatch(
          new RegExp(`["']${kind}["']\\s*:\\s*["']${forbidden}["']`),
        );
      }
    }
  });

  it("claimClass is never assigned VERIFIED or EXECUTED; hermes_memory is INFERRED", () => {
    const source = mustRead(PATHS.findingObservation);
    expect(source).toMatch(/hermes_memory/);
    expect(source).toMatch(/INFERRED/);
    expect(source).not.toMatch(/claimClass\s*:\s*["']VERIFIED["']/);
    expect(source).not.toMatch(/claimClass\s*:\s*["']EXECUTED["']/);
  });

  it("does not invent numeric latency/error-rate observations", () => {
    const source = mustRead(PATHS.findingObservation);
    expect(source).not.toMatch(/\berror[_-]?rate\s*[:=]\s*\d/i);
    expect(source).not.toMatch(/\blatency(?:Ms|_ms)?\s*[:=]\s*\d+/i);
    expect(source).not.toMatch(/\bp99(?:Latency)?\s*[:=]\s*\d/i);
    expect(source).not.toMatch(/\b(?:errorRate|latencyMs)\s*:\s*\d+(?:\.\d+)?/);
  });

  it("runtime source pin: runHermesCycle is not called from the Jarvis wake", () => {
    const stripped = stripComments(mustRead(PATHS.cycleRuntime), "code");
    expect(
      /\brunHermesCycle\b/.test(stripped),
      "runHermesCycle MUST NOT be called from the Jarvis wake (listing findings ≠ running the repair cycle)",
    ).toBe(false);
    expect(
      /(?:from|import\(\s*)["'][^"']*hermes-cycle["']/.test(stripped),
      "Runtime must not value-import hermes-cycle (Hermes is not replaced)",
    ).toBe(false);
  });

  it("runtime source pin: stampHermesFindings is called (Hermes findings are consumed, not repaired)", () => {
    const stripped = stripComments(mustRead(PATHS.cycleRuntime), "code");
    expect(
      /\bstampHermesFindings\s*\(/.test(stripped),
      "Runtime must call stampHermesFindings (listing findings ≠ running repair)",
    ).toBe(true);
    expect(
      /hermes-finding-observation/.test(stripped),
      "Runtime must import the Hermes finding translator",
    ).toBe(true);
  });

  it("behavioral: empty / missing evidence / unknown kind / cross-tenant stamp nothing; honest maps", async () => {
    mustExist(PATHS.findingObservation);
    const mod = (await import("@/lib/hermes/hermes-finding-observation")) as {
      stampHermesFindings?: StampHermesFindings;
    };
    expect(mod.stampHermesFindings, "Observability must export stampHermesFindings").toEqual(expect.any(Function));
    const stamp = mod.stampHermesFindings as StampHermesFindings;

    expect(callStamp(stamp, [])).toEqual([]);

    const missingEvidence = observationKinds(
      callStamp(stamp, [hermesFinding({ kind: "mission_stuck", evidenceRefs: [] })]),
    );
    expect(missingEvidence, "empty evidenceRefs must not stamp an observation").toEqual([]);

    const blankEvidence = observationKinds(
      callStamp(stamp, [hermesFinding({ kind: "worker_quarantined", evidenceRefs: ["", "   "] })]),
    );
    expect(blankEvidence, "blank evidence refs must not stamp an observation").toEqual([]);

    const unknownKind = observationKinds(
      callStamp(stamp, [{ ...hermesFinding({ kind: "mission_stuck" }), kind: "invented_kind" }]),
    );
    expect(unknownKind, "unknown kind must not stamp an observation").toEqual([]);

    const crossTenant = callStamp(stamp, [hermesFinding({ kind: "mission_stuck", tenantId: OTHER_TENANT })]);
    expect(observationKinds(crossTenant), "cross-tenant findings must not stamp").toEqual([]);
    for (const record of observationRecords(crossTenant)) {
      expect(record.tenantRef, "must not leak the foreign tenant onto Jarvis").not.toBe(OTHER_TENANT);
    }

    const stuck = callStamp(stamp, [hermesFinding({ kind: "mission_stuck", subjectRef: "exec-stuck" })]);
    const stuckKinds = observationKinds(stuck);
    expect(stuckKinds).toContain("mission_timeout");
    expect(DETECTABLE_CONDITIONS, "mission_timeout must remain detectable").toContain("mission_timeout");
    expect(stuckKinds).not.toContain("provider_outage");

    const quarantined = callStamp(
      stamp,
      [hermesFinding({ kind: "worker_quarantined", subjectRef: "worker-q", severity: "warning" })],
    );
    const quarantinedKinds = observationKinds(quarantined);
    expect(quarantinedKinds).toContain("worker_failure");
    expect(DETECTABLE_CONDITIONS, "worker_failure must remain detectable").toContain("worker_failure");

    for (const kind of BRIEF_ONLY_KINDS) {
      const stamped = callStamp(stamp, [hermesFinding({ kind, subjectRef: `brief-${kind}` })]);
      const kinds = observationKinds(stamped);
      for (const forbidden of FORBIDDEN_BRIEF_DETECTABLE) {
        expect(kinds, `${kind} must not map to ${forbidden}`).not.toContain(forbidden);
      }
      for (const mapped of kinds) {
        expect(
          DETECTABLE_CONDITIONS,
          `${kind} is brief-only and must not become detectable ${mapped}`,
        ).not.toContain(mapped);
      }
    }

    const allClaimClasses = [
      ...observationClaimClasses(stuck),
      ...observationClaimClasses(quarantined),
      ...BRIEF_ONLY_KINDS.flatMap((kind) =>
        observationClaimClasses(callStamp(stamp, [hermesFinding({ kind, subjectRef: `claim-${kind}` })])),
      ),
    ];
    for (const claimClass of allClaimClasses) {
      expect(claimClass, "claimClass never VERIFIED").not.toBe("VERIFIED");
      expect(claimClass, "claimClass never EXECUTED").not.toBe("EXECUTED");
    }

    const memoryFinding = hermesFinding({
      kind: "mission_stuck",
      subjectRef: "mem-stuck",
      claim: hermesClaim("hermes_memory", "hermes:memory:mem-stuck", NOW, "prior decision"),
    });
    const memoryStamped = callStamp(stamp, [memoryFinding]);
    expect(observationKinds(memoryStamped)).toContain("mission_timeout");
    const memoryClasses = observationClaimClasses(memoryStamped);
    expect(memoryClasses).toContain("INFERRED");
    expect(memoryClasses).not.toContain("VERIFIED");
    expect(memoryClasses).not.toContain("EXECUTED");
    expect(memoryClasses).not.toContain("OBSERVED");

    for (const record of observationRecords(stuck)) {
      expect(record.tenantRef).toBe(TENANT);
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

  it("phase52Registered is false", () => {
    const ts = mustRead(PATHS.phase52Ts);
    expect(ts).toMatch(/phase52Registered/);
    expect(ts).toMatch(/phase52Registered\s*(?:=|:)\s*false/);
  });

  it("frozen worker ids are not implementable", () => {
    const ts = mustRead(PATHS.phase52Ts);
    for (const workerId of FROZEN_WORKER_IDS) {
      expect(ts, `phase52 attachment must name frozen worker ${workerId}`).toContain(workerId);
      expect(isWorkerActivatable(workerId), `${workerId} must not be activatable on the V1 lock`).toBe(false);
    }
    expect(ts).toMatch(/implementable|do_not_implement|not implementable|FREEZE/i);
  });

  it("behavioral: attachment module refuses implementation authorization", async () => {
    mustExist(PATHS.phase52Ts);
    const mod = (await import("@/lib/workforce/phase52-attachment")) as Record<string, unknown>;
    if ("PHASE52_IMPLEMENTATION_AUTHORIZED" in mod) {
      expect(mod.PHASE52_IMPLEMENTATION_AUTHORIZED).toBe(false);
    }
    if ("phase52Registered" in mod) {
      expect(mod.phase52Registered).toBe(false);
    }
    const implementable = mod.isPhase52WorkerImplementable ?? mod.isWorkerImplementable;
    if (typeof implementable === "function") {
      for (const workerId of FROZEN_WORKER_IDS) {
        expect((implementable as (id: string) => unknown)(workerId)).toBe(false);
      }
    }
  });
});

/* ─────────────────────────────────────────────────────────────
 * D. Secrets hygiene
 * ───────────────────────────────────────────────────────────── */

describe("D. secrets hygiene on Hermes finding translator and runtime", () => {
  it("hermes-finding-observation.ts and enterprise-cycle-runtime.server.ts carry no secret VALUES", () => {
    const rels = [PATHS.findingObservation, PATHS.cycleRuntime] as const;
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

describe("E. tenant isolation on Hermes finding stamps", () => {
  it("stampHermesFindings requires tenantRef (source pin)", () => {
    const source = mustRead(PATHS.findingObservation);
    expect(source).toMatch(/tenantRef/);
    expect(source).toMatch(/stampHermesFindings/);
  });

  it("runtime passes request.tenantId into stampHermesFindings as tenantRef", () => {
    const stripped = stripComments(mustRead(PATHS.cycleRuntime), "code");
    const called = /\bstampHermesFindings\s*\(/.test(stripped);
    expect(called, "Runtime must call stampHermesFindings with tenantRef from request.tenantId").toBe(true);
    const call = stripped.match(/stampHermesFindings\s*\(\s*\{[\s\S]{0,500}?\}/);
    expect(call, "stampHermesFindings must be invoked with an object carrying tenantRef").toBeTruthy();
    expect(call![0]).toMatch(/tenantRef\s*:/);
    expect(call![0]).toMatch(/\btenantId\b/);
  });

  it("behavioral: missing/blank tenantRef stamps nothing even with evidenced findings", async () => {
    mustExist(PATHS.findingObservation);
    const mod = (await import("@/lib/hermes/hermes-finding-observation")) as {
      stampHermesFindings?: StampHermesFindings;
    };
    expect(mod.stampHermesFindings).toEqual(expect.any(Function));
    const stamp = mod.stampHermesFindings as StampHermesFindings;
    const evidenced = [hermesFinding({ kind: "mission_stuck", subjectRef: "exec-tenant" })];
    expect(callStamp(stamp, evidenced, "")).toEqual([]);
    expect(callStamp(stamp, evidenced, "   ")).toEqual([]);
  });
});

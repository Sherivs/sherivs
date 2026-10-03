/**
 * CoreGrid — H3-049 dependency health inventory contract tests (mission F-049).
 * Proves: bounded, provenance-carrying inventory declarations; fail-closed
 * posture aggregation (dead checks, unknown checks, invalid results and
 * duplicates all force `failing`); critical-tier escalation of `degraded`;
 * and read-only composition with the `./health` report contract. Pure
 * offline: no network, no database, no secrets.
 */
import { describe, expect, it } from "vitest";
import type { DependencyCheckResult, NamedDependencyCheck } from "../../frontend/src/lib/observability/health";
import {
  buildMapHealthReport,
  dependencyHealthInventorySchema,
  CRITICAL_TIER,
  evaluateHealthMapPosture,
  parseDependencyHealthMap,
  type DependencyHealthEntry,
  type DependencyHealthInventory,
} from "../../frontend/src/lib/observability/health-map";

/* ─────────────────────────────────────────────────────────────
 * Fixtures
 * ────────────────────────────────────────────────────────────*/

const PROVENANCE = {
  declaredBy: "role:health-map-engineer",
  authority: "AGENTS.md §42 / H3 wave mission F-049",
  declaredAt: "2026-10-03T00:00:00.000Z",
};

function entry(overrides: Partial<DependencyHealthEntry> = {}): DependencyHealthEntry {
  return {
    name: "primary_store",
    criticalityTier: "critical",
    checkContractRef: "observability/health#dependency-check",
    provenance: PROVENANCE,
    ...overrides,
  };
}

function inventory(...entries: DependencyHealthEntry[]): DependencyHealthInventory {
  return parseDependencyHealthMap({ entries });
}

function result(overrides: Partial<DependencyCheckResult> = {}): DependencyCheckResult {
  return { name: "primary_store", status: "ok", ...overrides };
}

function postureStatus(entries: DependencyHealthEntry[], results: readonly unknown[]) {
  return evaluateHealthMapPosture(inventory(...entries), results).status;
}

/* ─────────────────────────────────────────────────────────────
 * Inventory parsing (fail-closed declarations)
 * ────────────────────────────────────────────────────────────*/

describe("dependency health inventory parsing", () => {
  it("accepts a bounded, provenance-carrying inventory", () => {
    const map = inventory(
      entry(),
      entry({
        name: "message_queue",
        criticalityTier: "major",
        checkContractRef: "observability/health#dependency-check",
      }),
    );
    expect(map.entries).toHaveLength(2);
    expect(map.entries[0]?.name).toBe("primary_store");
    expect(map.entries[0]?.criticalityTier).toBe(CRITICAL_TIER);
  });

  it("rejects an empty inventory — an empty map cannot claim healthy", () => {
    expect(() => parseDependencyHealthMap({ entries: [] })).toThrow();
  });

  it("rejects duplicate dependency names — no silent override", () => {
    expect(() => inventory(entry(), entry())).toThrow(/duplicate dependency name/);
  });

  it("rejects an unknown criticality tier", () => {
    expect(() =>
      inventory(entry({ criticalityTier: "cosmic" as "critical" })),
    ).toThrow();
  });

  it("rejects malformed names and contract references", () => {
    expect(() => inventory(entry({ name: "Primary Store" }))).toThrow();
    expect(() => inventory(entry({ checkContractRef: "" }))).toThrow();
    expect(() => inventory(entry({ name: "0starts_with_digit" }))).toThrow();
  });

  it("rejects entries without provenance or with a non-UTC instant", () => {
    const missing = { ...entry(), provenance: undefined };
    expect(() => inventory(missing as unknown as DependencyHealthEntry)).toThrow();
    expect(() =>
      inventory(entry({ provenance: { ...PROVENANCE, declaredAt: "not-a-date" } })),
    ).toThrow();
  });

  it("rejects unknown extra keys (strict) and non-object input", () => {
    const withExtraKey = { ...entry(), unexpectedField: "surprise" };
    expect(() => inventory(withExtraKey as unknown as DependencyHealthEntry)).toThrow();
    expect(() => dependencyHealthInventorySchema.parse("health-map")).toThrow();
    expect(() => dependencyHealthInventorySchema.parse(null)).toThrow();
  });
});

/* ─────────────────────────────────────────────────────────────
 * Posture aggregation (fail-closed on unknown/dead checks)
 * ────────────────────────────────────────────────────────────*/

describe("health map posture aggregation", () => {
  it("resolves ok when every declared dependency is observed ok", () => {
    expect(postureStatus([entry(), entry({ name: "message_queue", criticalityTier: "minor" })], [
      result(),
      result({ name: "message_queue" }),
    ])).toBe("ok");
  });

  it("resolves degraded when a major/minor dependency is degraded", () => {
    expect(postureStatus([entry({ criticalityTier: "major" })], [
      result({ status: "degraded" }),
    ])).toBe("degraded");
    expect(postureStatus([entry({ criticalityTier: "minor" })], [
      result({ status: "degraded" }),
    ])).toBe("degraded");
  });

  it("escalates a degraded CRITICAL dependency to failing", () => {
    expect(postureStatus([entry({ criticalityTier: "critical" })], [
      result({ status: "degraded" }),
    ])).toBe("failing");
  });

  it("resolves failing when any dependency is failing", () => {
    expect(postureStatus([entry({ criticalityTier: "minor" })], [
      result({ status: "failing", error: "Store: connection refused" }),
    ])).toBe("failing");
  });

  it("fails closed on a DEAD check — declared but never observed", () => {
    const posture = evaluateHealthMapPosture(
      inventory(entry(), entry({ name: "message_queue" })),
      [result()],
    );
    expect(posture.status).toBe("failing");
    expect(posture.findings).toContainEqual({
      kind: "dead_check",
      name: "message_queue",
      criticalityTier: "critical",
      status: "failing",
    });
  });

  it("fails closed on an UNKNOWN check — observed but never declared", () => {
    const posture = evaluateHealthMapPosture(inventory(entry()), [
      result(),
      result({ name: "undeclared_probe", status: "ok" }),
    ]);
    expect(posture.status).toBe("failing");
    expect(posture.findings).toContainEqual({
      kind: "unknown_check",
      name: "undeclared_probe",
      criticalityTier: null,
      status: "failing",
    });
  });

  it("fails closed on an unnameable result (non-object or empty name)", () => {
    expect(postureStatus([entry()], [result(), "not-a-check-result"])).toBe("failing");
    expect(postureStatus([entry()], [result(), { status: "ok", detail: "no name" }])).toBe("failing");
    const posture = evaluateHealthMapPosture(inventory(entry()), [null]);
    expect(posture.findings).toContainEqual({
      kind: "invalid_result",
      name: "<unnameable>",
      criticalityTier: null,
      status: "failing",
    });
  });

  it("fails closed on a declared result whose status is out of contract", () => {
    const posture = evaluateHealthMapPosture(inventory(entry()), [
      { name: "primary_store", status: "resplendent" },
    ]);
    expect(posture.status).toBe("failing");
    expect(posture.findings.filter((f) => f.kind === "observed")[0]?.status).toBe("failing");
  });

  it("fails closed on duplicate results for the same declared name", () => {
    const posture = evaluateHealthMapPosture(inventory(entry()), [result(), result()]);
    expect(posture.status).toBe("failing");
    expect(posture.findings.some((f) => f.kind === "duplicate_result")).toBe(true);
  });

  it("fails closed when nothing is observed — the whole map is dead", () => {
    expect(postureStatus([entry(), entry({ name: "message_queue", criticalityTier: "minor" })], [])).toBe("failing");
  });

  it("never absorbs an unknown check even when everything declared is ok", () => {
    const posture = evaluateHealthMapPosture(
      inventory(entry(), entry({ name: "queue_a", criticalityTier: "minor" })),
      [result(), result({ name: "queue_a" }), result({ name: "ghost_check" })],
    );
    expect(posture.status).toBe("failing");
    expect(posture.findings.filter((f) => f.kind === "unknown_check")).toHaveLength(1);
  });
});

/* ─────────────────────────────────────────────────────────────
 * Composition with the /health.json contract (read-only)
 * ────────────────────────────────────────────────────────────*/

describe("composition with ./health (read-only)", () => {
  const clock = () => "2026-10-03T00:00:00.000Z";
  const snapshot = { uptime_s: 12.3, rss_mb: 64.1, heap_used_mb: 32.2 };

  function check(name: string, out: DependencyCheckResult | Promise<DependencyCheckResult>): NamedDependencyCheck {
    return { name, check: () => out };
  }

  it("produces the ./health report plus an ok map posture on the happy path", async () => {
    const { report, posture } = await buildMapHealthReport({
      inventory: inventory(entry(), entry({ name: "message_queue", criticalityTier: "minor" })),
      dependencyChecks: [
        check("primary_store", result()),
        check("message_queue", result({ name: "message_queue" })),
      ],
      snapshot,
      version: "v1.0.0-test",
      now: clock,
    });
    expect(report.status).toBe("ok");
    expect(report.version).toBe("v1.0.0-test");
    expect(report.ts).toBe("2026-10-03T00:00:00.000Z");
    expect(report.checks.map((c) => c.name).sort()).toEqual(["message_queue", "primary_store"]);
    expect(posture.status).toBe("ok");
    expect(posture.findings.filter((f) => f.kind === "observed")).toHaveLength(2);
  });

  it("keeps a throwing check failing in both the report and the posture", async () => {
    const { report, posture } = await buildMapHealthReport({
      inventory: inventory(entry()),
      dependencyChecks: [
        {
          name: "primary_store",
          check: () => {
            throw new Error("probe exploded");
          },
        },
      ],
      snapshot,
      now: clock,
    });
    expect(report.status).toBe("failing");
    expect(report.checks[0]?.status).toBe("failing");
    expect(report.checks[0]?.error).toContain("probe exploded");
    expect(posture.status).toBe("failing");
  });

  it("fails closed when a declared check is never registered as executable", async () => {
    const { report, posture } = await buildMapHealthReport({
      inventory: inventory(entry(), entry({ name: "message_queue" })),
      dependencyChecks: [check("primary_store", result())],
      snapshot,
      now: clock,
    });
    expect(report.status).toBe("ok");
    expect(posture.status).toBe("failing");
    expect(posture.findings.some((f) => f.kind === "dead_check" && f.name === "message_queue")).toBe(true);
  });

  it("fails closed when an executable check is missing from the declared map", async () => {
    const { posture } = await buildMapHealthReport({
      inventory: inventory(entry()),
      dependencyChecks: [
        check("primary_store", result()),
        check("undeclared_probe", result({ name: "undeclared_probe" })),
      ],
      snapshot,
      now: clock,
    });
    expect(posture.status).toBe("failing");
    expect(posture.findings.some((f) => f.kind === "unknown_check" && f.name === "undeclared_probe")).toBe(true);
  });

  it("escalates a degraded critical check through the composed report", async () => {
    const { report, posture } = await buildMapHealthReport({
      inventory: inventory(entry({ criticalityTier: "critical" })),
      dependencyChecks: [check("primary_store", result({ status: "degraded" }))],
      snapshot,
      now: clock,
    });
    expect(report.status).toBe("degraded");
    expect(posture.status).toBe("failing");
  });

  it("keeps every dependency dead when no checks are wired", async () => {
    const { posture } = await buildMapHealthReport({
      inventory: inventory(entry()),
      snapshot,
      now: clock,
    });
    expect(posture.status).toBe("failing");
    expect(posture.findings.filter((f) => f.kind === "dead_check")).toHaveLength(1);
  });
});
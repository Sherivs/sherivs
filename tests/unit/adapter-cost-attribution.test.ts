/**
 * Team 1 (batch B) — substrate persistence tests for the cost-attribution
 * contract (J-043 / V1CAP-078 / MISSION-R-70).
 *
 * Covers: contract<->row round-trip mapping, failure-policy semantics
 * exercised through the adapter (bounded timeout, breaker, degraded mode —
 * deterministic AdapterClock), migration/rollback file integrity pinning for
 * 20261002000010, and a LIVE-GATED connectivity probe (skips cleanly without
 * DATABASE_URL; never touches the authored cg_usage_attribution_* tables —
 * the migration is AUTHORED, NOT APPLIED).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createCostAttributionStore,
  COST_ATTRIBUTION_BUCKET_TABLE,
  COST_ATTRIBUTION_ROLLUP_TABLE,
  rollUpToRows,
  rowsToRollUp,
  type CostAttributionDbClient,
} from "../../frontend/src/lib/adapters/cost-attribution-store.adapter";
import {
  createAdapterFailurePolicy,
  type AdapterClock,
  type AdapterPolicyEvent,
} from "../../frontend/src/lib/adapters/failure-policy";
import { rollUpCosts, type AttributableUsageRecord } from "../../frontend/src/lib/metering/cost-attribution";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MIGRATION = readFileSync(
  join(ROOT, "database/supabase/migrations/20261002000010_coregrid_v1_cost_attribution.sql"),
  "utf8",
);
const ROLLBACK = readFileSync(
  join(ROOT, "database/supabase/rollbacks/20261002000010_coregrid_v1_cost_attribution.sql"),
  "utf8",
);

const TENANT = "tenant-alpha";
const OTHER_TENANT = "tenant-beta";
const AT = "2026-10-01T12:00:00Z";
const RECORDED_AT = "2026-10-01T12:05:00Z";

/* ── deterministic clocks (mirror of the failure-policy test pattern) ── */

function manualClock(startMs = 1_000_000) {
  let now = startMs;
  const pending: { ms: number; resolve: () => void }[] = [];
  const clock: AdapterClock = {
    nowMs: () => now,
    delay: (ms: number) =>
      new Promise<void>((resolve) => {
        pending.push({ ms, resolve });
      }),
  };
  return {
    clock,
    advance(ms: number): void {
      now += ms;
    },
    fireDelays(): void {
      const all = pending.splice(0, pending.length);
      for (const d of all) d.resolve();
    },
  };
}

function immediateClock(startMs = 1_000_000) {
  let now = startMs;
  const clock: AdapterClock = {
    nowMs: () => now,
    delay: () => Promise.resolve(),
  };
  return {
    clock,
    advance(ms: number): void {
      now += ms;
    },
  };
}

const tick = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0));

function neverSettles<T>(): Promise<T> {
  return new Promise<T>(() => {});
}

/* ── fixtures built through the pure contract ── */

function usageRecord(overrides: Partial<AttributableUsageRecord> = {}): AttributableUsageRecord {
  return {
    tenantRef: TENANT,
    actorRef: "actor-1",
    agentRef: null,
    missionRef: "mission-1",
    model: "coregrid-registry/answerer-1",
    provider: "hosted-api",
    purpose: "summarization",
    tokensIn: 100,
    tokensOut: 40,
    durationMs: 850,
    estimatedCostUsd: 0.0025,
    at: AT,
    ...overrides,
  };
}

function integralRollUpFixture() {
  return rollUpCosts([
    usageRecord(),
    usageRecord({ missionRef: "mission-2", estimatedCostUsd: null, at: "2026-10-01T13:00:00Z" }),
    usageRecord({ actorRef: "actor-2", purpose: "classification" }),
  ]);
}

/** In-memory client: INSERTs capture rows, SELECTs replay them verbatim. */
class FakeCostAttributionDb implements CostAttributionDbClient {
  readonly rollups: Record<string, unknown>[] = [];
  readonly buckets: Record<string, unknown>[] = [];
  calls = 0;

  async query(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<{ rows: readonly Record<string, unknown>[] }> {
    this.calls += 1;
    if (text.includes(`INSERT INTO public.${COST_ATTRIBUTION_ROLLUP_TABLE}`)) {
      this.rollups.push({
        id: values[0],
        tenant_id: values[1],
        period_from: values[2],
        period_to: values[3],
        recorded_from: values[4],
        recorded_to: values[5],
        grand_total: values[6],
        integrity_ok: values[7],
        integrity_conserves: values[8],
        integrity_defects: values[9],
        integrity_problems: values[10],
        recorded_at: values[11],
      });
      return { rows: [] };
    }
    if (text.includes(`INSERT INTO public.${COST_ATTRIBUTION_BUCKET_TABLE}`)) {
      this.buckets.push({
        rollup_row_id: values[0],
        tenant_id: values[1],
        dimension: values[2],
        bucket_key: values[3],
        totals: values[4],
      });
      return { rows: [] };
    }
    if (text.includes(`FROM public.${COST_ATTRIBUTION_ROLLUP_TABLE}`)) {
      return { rows: this.rollups.filter((row) => row.tenant_id === values[0]) };
    }
    if (text.includes(`FROM public.${COST_ATTRIBUTION_BUCKET_TABLE}`)) {
      return { rows: this.buckets.filter((row) => row.tenant_id === values[0]) };
    }
    return { rows: [] };
  }
}

/* ─────────────────────────────────────────────────────────────
 * 1. Round-trip: contract -> rows -> contract
 * ────────────────────────────────────────────────────────────*/

describe("cost-attribution substrate adapter — round-trip mapping", () => {
  it("maps a contract roll-up onto header + partition buckets and back", () => {
    const rollUp = integralRollUpFixture();
    const { rollup, buckets } = rollUpToRows({
      rollUp,
      id: "rollup-batch-1",
      tenantId: TENANT,
      recordedAt: RECORDED_AT,
    });
    expect(rollup.id).toBe("rollup-batch-1");
    expect(rollup.tenant_id).toBe(TENANT);
    expect(rollup.integrity_ok).toBe(true);
    expect(rollup.integrity_conserves).toBe(true);
    // Six dimensions partition the same three placed records; two records
    // share a mission and two share an actor, so those dimensions fan out.
    expect(buckets.map((bucket) => bucket.dimension)).toHaveLength(10);
    expect(new Set(buckets.map((bucket) => bucket.dimension))).toEqual(
      new Set(["actor", "mission", "model", "purpose", "tenant", "tenant_mission"]),
    );

    const restored = rowsToRollUp(
      rollup as unknown as Record<string, unknown>,
      buckets.map((bucket) => bucket as unknown as Record<string, unknown>),
    );
    expect(restored).toEqual(rollUp);
  });

  it("persists through the adapter and reloads the identical roll-up", async () => {
    const db = new FakeCostAttributionDb();
    const store = createCostAttributionStore({ client: db });
    const saved = await store.saveRollUp({
      rollUp: integralRollUpFixture(),
      id: "rollup-batch-1",
      tenantId: TENANT,
      recordedAt: RECORDED_AT,
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.value.id).toBe("rollup-batch-1");
    expect(saved.attempts).toBe(1);

    const loaded = await store.loadRollUps(TENANT);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value).toHaveLength(1);
    expect(loaded.value[0]).toEqual(integralRollUpFixture());
  });

  it("refuses a cross-tenant roll-up — cost data never lands in another tenant's substrate", async () => {
    const db = new FakeCostAttributionDb();
    const store = createCostAttributionStore({ client: db });
    // A record attributed to ANOTHER tenant: the contract buckets it under
    // that tenant key; persisting it under THIS tenant's row is refused.
    const mixed = rollUpCosts([
      usageRecord(),
      usageRecord({ tenantRef: OTHER_TENANT }),
    ]);
    const saved = await store.saveRollUp({
      rollUp: mixed,
      id: "rollup-mixed",
      tenantId: TENANT,
      recordedAt: RECORDED_AT,
    });
    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.code).toBe("invalid_input");
    expect(saved.reason).toContain("cross-tenant roll-up denied");
    expect(saved.reason).toContain(OTHER_TENANT);
    expect(db.calls).toBe(0);
  });

  it("contains malformed DB rows as structured errors, never throws", async () => {
    const broken: CostAttributionDbClient = {
      query: async (text) =>
        text.includes(`FROM public.${COST_ATTRIBUTION_ROLLUP_TABLE}`)
          ? { rows: [{ garbage: true }] }
          : { rows: [] },
    };
    const store = createCostAttributionStore({ client: broken });
    const loaded = await store.loadRollUps(TENANT);
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.code).toBe("invalid_input");
  });

  it("refuses tenant-less loads — roll-ups never cross tenants", async () => {
    const store = createCostAttributionStore({ client: new FakeCostAttributionDb() });
    const loaded = await store.loadRollUps("   ");
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.code).toBe("invalid_input");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 2. Failure-policy semantics through the adapter (J-045)
 * ────────────────────────────────────────────────────────────*/

describe("cost-attribution substrate adapter — failure policy", () => {
  it("bounds a hung client with a timeout (deterministic clock, never retried writes)", async () => {
    const clockCtl = manualClock();
    const policy = createAdapterFailurePolicy({
      provider: "cg-substrate-cost-attribution-test",
      timeoutMs: 1_000,
      maxAttempts: 1,
      backoffBaseMs: 10,
      backoffCapMs: 100,
      degradedAfterFailures: 3,
      degradedWindowMs: 10_000,
      breakerFailureThreshold: 5,
      breakerResetMs: 15_000,
      clock: clockCtl.clock,
    });
    const hung: CostAttributionDbClient = {
      query: () => neverSettles<{ rows: readonly Record<string, unknown>[] }>(),
    };
    const store = createCostAttributionStore({ client: hung, failurePolicy: policy });
    const pending = store.loadRollUps(TENANT);
    await tick();
    clockCtl.fireDelays();
    const result = await pending;
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("timeout");
    expect(result.attempts).toBe(1);
  });

  it("opens the breaker after consecutive failures and denies without provider contact", async () => {
    const clockCtl = immediateClock();
    const events: AdapterPolicyEvent[] = [];
    const policy = createAdapterFailurePolicy({
      provider: "cg-substrate-cost-attribution-test",
      timeoutMs: 1_000,
      maxAttempts: 2,
      backoffBaseMs: 10,
      backoffCapMs: 100,
      degradedAfterFailures: 2,
      degradedWindowMs: 10_000,
      breakerFailureThreshold: 2,
      breakerResetMs: 15_000,
      clock: clockCtl.clock,
      onEvent: (event) => events.push(event),
    });
    let calls = 0;
    const failing: CostAttributionDbClient = {
      query: () => {
        calls += 1;
        throw new Error("connection refused");
      },
    };
    const store = createCostAttributionStore({ client: failing, failurePolicy: policy });
    const first = await store.loadRollUps(TENANT);
    expect(first.ok).toBe(false);
    if (!first.ok) {
      expect(first.code).toBe("provider_error");
      expect(first.attempts).toBe(2);
    }
    expect(policy.snapshot().breaker).toBe("open");
    expect(policy.snapshot().mode).toBe("isolated");
    expect(events.some((event) => event.kind === "mode_change" && event.to === "degraded")).toBe(true);
    expect(events.some((event) => event.kind === "breaker_change" && event.to === "open")).toBe(true);

    // Denied WITHOUT provider contact — reads and writes alike.
    const second = await store.loadRollUps(TENANT);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe("breaker_open");
    const third = await store.saveRollUp({
      rollUp: integralRollUpFixture(),
      id: "rollup-batch-2",
      tenantId: TENANT,
      recordedAt: RECORDED_AT,
    });
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.code).toBe("breaker_open");
  });

  it("exposes the declared policy for observability (snapshot + trust ledger)", async () => {
    const store = createCostAttributionStore({ client: new FakeCostAttributionDb() });
    expect(store.policy.snapshot().provider).toBe("cg-substrate-cost-attribution");
    expect(store.policy.currentTrustVerdict()).toBe("unproven");
    const recommendation = store.policy.recommendTrust();
    expect(recommendation.verdict).toBe("unproven");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 3. Migration / rollback integrity pinning
 * ────────────────────────────────────────────────────────────*/

describe("cost-attribution migration 20261002000010 — authored integrity", () => {
  it("carries the AUTHORED, NOT APPLIED status and rollback pointer", () => {
    expect(MIGRATION).toContain("Status: AUTHORED, NOT APPLIED");
    expect(MIGRATION).toContain(
      "database/supabase/rollbacks/20261002000010_coregrid_v1_cost_attribution.sql",
    );
    expect(ROLLBACK).toContain("Status: AUTHORED, NOT APPLIED");
  });

  it("authors both cg_usage_attribution tables with deny-by-default RLS", () => {
    for (const table of [COST_ATTRIBUTION_ROLLUP_TABLE, COST_ATTRIBUTION_BUCKET_TABLE]) {
      expect(MIGRATION).toContain(`CREATE TABLE IF NOT EXISTS public.${table} (`);
      expect(MIGRATION).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`);
      expect(MIGRATION).toContain(`REVOKE ALL ON public.${table} FROM anon, authenticated;`);
    }
  });

  it("authors ZERO RLS policies (no grant path exists yet)", () => {
    expect(MIGRATION).not.toContain("CREATE POLICY");
    expect(ROLLBACK).not.toContain("CREATE POLICY");
  });

  it("pins the half-open bi-temporal period CHECKs", () => {
    expect(MIGRATION).toContain("cg_usage_attribution_rollup_period CHECK (");
    expect(MIGRATION).toContain("cg_usage_attribution_rollup_transaction_period CHECK (");
    expect(MIGRATION).toContain("period_to > period_from");
    expect(MIGRATION).toContain("recorded_to > recorded_from");
  });

  it("pins the bucket dimension vocabulary, totals shape and same-tenant composite FK", () => {
    expect(MIGRATION).toContain(
      "('tenant','mission','actor','model','purpose','tenant_mission')",
    );
    for (const field of ["requests", "tokensIn", "tokensOut", "durationMs", "estimatedCostUsd", "unpricedRequests"]) {
      expect(MIGRATION).toContain(`totals -> '${field}'`);
    }
    expect(MIGRATION).toContain("cg_usage_attribution_bucket_rollup_fk");
    expect(MIGRATION).toContain("REFERENCES public.cg_usage_attribution_rollup (id, tenant_id)");
  });

  it("declares the financial retention family", () => {
    expect(MIGRATION).toContain("'financial'");
    expect(MIGRATION).toContain("RP-FINAN-EDU / RP-FINAN-ORG");
  });

  it("rollback reverses the DDL in reverse dependency order", () => {
    const bucketDrop = ROLLBACK.indexOf(`DROP TABLE IF EXISTS public.${COST_ATTRIBUTION_BUCKET_TABLE}`);
    const rollupDrop = ROLLBACK.indexOf(`DROP TABLE IF EXISTS public.${COST_ATTRIBUTION_ROLLUP_TABLE}`);
    expect(bucketDrop).toBeGreaterThan(-1);
    expect(rollupDrop).toBeGreaterThan(bucketDrop);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 4. LIVE-gated connectivity probe (skips without credentials)
 * ────────────────────────────────────────────────────────────*/

const LIVE_ENABLED = Boolean(process.env.DATABASE_URL);

describe.skipIf(!LIVE_ENABLED)(
  "live: cost-attribution substrate connectivity probe (authored, NOT applied)",
  () => {
    it(
      "connects through scripts/lib/pg-connect.mjs and answers SELECT 1 — never touching cg_usage_attribution_*",
      { timeout: 60_000 },
      async () => {
        const pgSpec = "pg";
        const connectSpec = "../../scripts/lib/pg-connect.mjs";
        const pgModule = (await import(pgSpec)) as unknown as {
          default: { Client: new (config: { connectionString: string; ssl?: unknown }) => unknown };
        };
        const connectModule = (await import(connectSpec)) as unknown as {
          connectCoregridPostgres: (
            connectionString: string,
            pgModule: unknown,
            log?: (line: string) => void,
          ) => Promise<{ query: (text: string) => Promise<{ rows: unknown[] }>; end: () => Promise<void> }>;
        };
        const client = await connectModule.connectCoregridPostgres(
          process.env.DATABASE_URL as string,
          pgModule,
          () => {},
        );
        try {
          const result = await client.query("SELECT 1 AS ok");
          expect(result.rows).toHaveLength(1);
        } finally {
          await client.end();
        }
      },
    );
  },
);

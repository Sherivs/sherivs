/**
 * Team 1 (batch B) — substrate persistence tests for the knowledge-currency
 * contract (J-019 / V1CAP-040 / MISSION-R-71, wave 3).
 *
 * Covers: contract<->row round-trip mapping for all four record families
 * (sources, freshness contracts, invalidation acts, downgrade acts),
 * failure-policy semantics exercised through the adapter (bounded timeout,
 * breaker, degraded mode — deterministic AdapterClock), migration/rollback
 * file integrity pinning for 20261002000011, and a LIVE-GATED connectivity
 * probe (skips cleanly without DATABASE_URL; never touches the authored
 * cg_knowledge_* tables — the migration is AUTHORED, NOT APPLIED).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  contractToRow,
  createKnowledgeCurrencyDbStore,
  downgradeToRow,
  invalidationToRow,
  KNOWLEDGE_CONTRACT_COLUMNS,
  KNOWLEDGE_CONTRACT_TABLE,
  KNOWLEDGE_DOWNGRADE_COLUMNS,
  KNOWLEDGE_DOWNGRADE_TABLE,
  KNOWLEDGE_INVALIDATION_COLUMNS,
  KNOWLEDGE_INVALIDATION_TABLE,
  KNOWLEDGE_SOURCE_COLUMNS,
  KNOWLEDGE_SOURCE_TABLE,
  rowToContract,
  rowToDowngrade,
  rowToInvalidation,
  rowToSource,
  sourceToRow,
  type KnowledgeCurrencyDbClient,
} from "../../frontend/src/lib/adapters/knowledge-currency-store.adapter";
import {
  createAdapterFailurePolicy,
  type AdapterClock,
  type AdapterPolicyEvent,
} from "../../frontend/src/lib/adapters/failure-policy";
import {
  createKnowledgeCurrencyStore,
  declareSource,
  downgradeSourceReliability,
  type FreshnessContract,
  type InvalidationAct,
} from "../../frontend/src/lib/memory/knowledge-currency";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MIGRATION = readFileSync(
  join(ROOT, "database/supabase/migrations/20261002000011_coregrid_v1_knowledge_currency.sql"),
  "utf8",
);
const ROLLBACK = readFileSync(
  join(ROOT, "database/supabase/rollbacks/20261002000011_coregrid_v1_knowledge_currency.sql"),
  "utf8",
);

const TENANT = "tenant-alpha";
const AT = "2026-10-01T12:00:00Z";
const FRESH_UNTIL = "2026-10-08T12:00:00Z";

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

function sourceFixture() {
  const declared = declareSource(createKnowledgeCurrencyStore(), {
    sourceId: "source-handbook-1",
    tenantId: TENANT,
    tier: "verified",
    description: "Reviewed operational handbook, second edition",
    evidenceRef: "evidence-handbook-review-1",
    declaredBy: "governance-actor-1",
    declaredAt: AT,
  });
  expect(declared.ok).toBe(true);
  if (!declared.ok) throw new Error("fixture source must declare cleanly");
  return declared.source;
}

function contractFixture(): FreshnessContract {
  return {
    recordId: "record-handbook-note-1",
    tenantId: TENANT,
    sourceId: "source-handbook-1",
    freshUntil: FRESH_UNTIL,
    revalidation: "periodic",
    revalidateAfterSeconds: 86_400,
    registeredAt: AT,
    tierAtRegistration: "verified",
  };
}

function invalidationFixture(): InvalidationAct {
  return {
    invalidationId: "invalidation-1",
    recordId: "record-handbook-note-1",
    tenantId: TENANT,
    invalidatedBy: "governance-actor-2",
    reason: "superseded by the third edition",
    evidenceRef: "evidence-edition-3",
    invalidatedAt: "2026-10-02T09:00:00Z",
  };
}

function downgradeFixture() {
  const source = sourceFixture();
  const result = downgradeSourceReliability(
    {
      memory: createKnowledgeCurrencyStore().memory,
      sources: [source],
      contracts: [],
      invalidations: [],
      downgrades: [],
    },
    {
      downgradeId: "downgrade-1",
      sourceId: source.sourceId,
      tenantId: TENANT,
      fromTier: "verified",
      toTier: "provisional",
      downgradedBy: "governance-actor-2",
      reason: "editorial defects surfaced in review",
      evidenceRef: "evidence-defect-review-1",
      downgradedAt: "2026-10-02T09:00:00Z",
    },
  );
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error("fixture downgrade must apply cleanly");
  return result.act;
}

/** In-memory client: INSERTs capture rows, SELECTs replay them verbatim. */
class FakeKnowledgeDb implements KnowledgeCurrencyDbClient {
  readonly sources: Record<string, unknown>[] = [];
  readonly contracts: Record<string, unknown>[] = [];
  readonly invalidations: Record<string, unknown>[] = [];
  readonly downgrades: Record<string, unknown>[] = [];
  calls = 0;

  async query(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<{ rows: readonly Record<string, unknown>[] }> {
    this.calls += 1;
    if (text.includes(`INSERT INTO public.${KNOWLEDGE_SOURCE_TABLE}`)) {
      this.sources.push(zipRow(KNOWLEDGE_SOURCE_COLUMNS, values));
      return { rows: [] };
    }
    if (text.includes(`INSERT INTO public.${KNOWLEDGE_CONTRACT_TABLE}`)) {
      this.contracts.push(zipRow(KNOWLEDGE_CONTRACT_COLUMNS, values));
      return { rows: [] };
    }
    if (text.includes(`INSERT INTO public.${KNOWLEDGE_INVALIDATION_TABLE}`)) {
      this.invalidations.push(zipRow(KNOWLEDGE_INVALIDATION_COLUMNS, values));
      return { rows: [] };
    }
    if (text.includes(`INSERT INTO public.${KNOWLEDGE_DOWNGRADE_TABLE}`)) {
      this.downgrades.push(zipRow(KNOWLEDGE_DOWNGRADE_COLUMNS, values));
      return { rows: [] };
    }
    if (text.includes(`FROM public.${KNOWLEDGE_SOURCE_TABLE}`)) {
      return { rows: this.sources.filter((row) => row.tenant_id === values[0]) };
    }
    if (text.includes(`FROM public.${KNOWLEDGE_CONTRACT_TABLE}`)) {
      return { rows: this.contracts.filter((row) => row.tenant_id === values[0]) };
    }
    if (text.includes(`FROM public.${KNOWLEDGE_INVALIDATION_TABLE}`)) {
      return { rows: this.invalidations.filter((row) => row.tenant_id === values[0]) };
    }
    if (text.includes(`FROM public.${KNOWLEDGE_DOWNGRADE_TABLE}`)) {
      return { rows: this.downgrades.filter((row) => row.tenant_id === values[0]) };
    }
    return { rows: [] };
  }
}

function zipRow(
  columns: readonly string[],
  values: readonly unknown[],
): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  columns.forEach((key, index) => {
    row[key] = values[index];
  });
  return row;
}

/* ─────────────────────────────────────────────────────────────
 * 1. Round-trip: contract -> row -> contract (all four families)
 * ────────────────────────────────────────────────────────────*/

describe("knowledge-currency substrate adapter — round-trip mapping", () => {
  it("maps a declared source to a substrate row and back", () => {
    const source = sourceFixture();
    const row = sourceToRow(source);
    expect(row.id).toBe("source-handbook-1");
    expect(row.tier).toBe("verified");
    expect(rowToSource(row as unknown as Record<string, unknown>)).toEqual(source);
  });

  it("maps a freshness contract to a substrate row and back", () => {
    const contract = contractFixture();
    const row = contractToRow(contract);
    expect(row.record_id).toBe("record-handbook-note-1");
    expect(row.revalidate_after_seconds).toBe(86_400);
    expect(rowToContract(row as unknown as Record<string, unknown>)).toEqual(contract);
  });

  it("maps an invalidation act to a substrate row and back", () => {
    const act = invalidationFixture();
    const row = invalidationToRow(act);
    expect(row.evidence_ref).toBe("evidence-edition-3");
    expect(rowToInvalidation(row as unknown as Record<string, unknown>)).toEqual(act);
  });

  it("maps a contract-validated downgrade act to a substrate row and back", () => {
    const act = downgradeFixture();
    const row = downgradeToRow(act);
    expect(row.from_tier).toBe("verified");
    expect(row.to_tier).toBe("provisional");
    expect(rowToDowngrade(row as unknown as Record<string, unknown>)).toEqual(act);
  });

  it("persists all four families through the adapter and reloads them", async () => {
    const db = new FakeKnowledgeDb();
    const store = createKnowledgeCurrencyDbStore({ client: db });
    const source = sourceFixture();
    const contract = contractFixture();
    const invalidation = invalidationFixture();
    const downgrade = downgradeFixture();

    const savedSource = await store.saveSource(source);
    expect(savedSource.ok).toBe(true);
    const savedContract = await store.saveContract(contract);
    expect(savedContract.ok).toBe(true);
    const savedInvalidation = await store.saveInvalidation(invalidation);
    expect(savedInvalidation.ok).toBe(true);
    const savedDowngrade = await store.saveDowngrade(downgrade);
    expect(savedDowngrade.ok).toBe(true);

    const loadedSources = await store.loadSources(TENANT);
    expect(loadedSources.ok).toBe(true);
    if (loadedSources.ok) expect(loadedSources.value).toEqual([source]);
    const loadedContracts = await store.loadContracts(TENANT);
    expect(loadedContracts.ok).toBe(true);
    if (loadedContracts.ok) expect(loadedContracts.value).toEqual([contract]);
    const loadedInvalidations = await store.loadInvalidations(TENANT);
    expect(loadedInvalidations.ok).toBe(true);
    if (loadedInvalidations.ok) expect(loadedInvalidations.value).toEqual([invalidation]);
    const loadedDowngrades = await store.loadDowngrades(TENANT);
    expect(loadedDowngrades.ok).toBe(true);
    if (loadedDowngrades.ok) expect(loadedDowngrades.value).toEqual([downgrade]);
  });

  it("contains malformed DB rows as structured errors, never throws", async () => {
    const broken: KnowledgeCurrencyDbClient = {
      query: async () => ({ rows: [{ garbage: true }] }),
    };
    const store = createKnowledgeCurrencyDbStore({ client: broken });
    const loaded = await store.loadSources(TENANT);
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.code).toBe("invalid_input");
  });

  it("refuses tenant-less loads — the registry never crosses tenants", async () => {
    const store = createKnowledgeCurrencyDbStore({ client: new FakeKnowledgeDb() });
    const loaded = await store.loadSources("   ");
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.code).toBe("invalid_input");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 2. Failure-policy semantics through the adapter (J-045)
 * ────────────────────────────────────────────────────────────*/

describe("knowledge-currency substrate adapter — failure policy", () => {
  it("bounds a hung client with a timeout (deterministic clock, never retried writes)", async () => {
    const clockCtl = manualClock();
    const policy = createAdapterFailurePolicy({
      provider: "cg-substrate-knowledge-currency-test",
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
    const hung: KnowledgeCurrencyDbClient = {
      query: () => neverSettles<{ rows: readonly Record<string, unknown>[] }>(),
    };
    const store = createKnowledgeCurrencyDbStore({ client: hung, failurePolicy: policy });
    const pending = store.loadSources(TENANT);
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
      provider: "cg-substrate-knowledge-currency-test",
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
    const failing: KnowledgeCurrencyDbClient = {
      query: () => {
        calls += 1;
        throw new Error("connection refused");
      },
    };
    const store = createKnowledgeCurrencyDbStore({ client: failing, failurePolicy: policy });
    const first = await store.loadSources(TENANT);
    expect(first.ok).toBe(false);
    if (!first.ok) {
      expect(first.code).toBe("provider_error");
      expect(first.attempts).toBe(2);
    }
    expect(calls).toBe(2);
    expect(policy.snapshot().breaker).toBe("open");
    expect(policy.snapshot().mode).toBe("isolated");
    expect(events.some((event) => event.kind === "mode_change" && event.to === "degraded")).toBe(true);
    expect(events.some((event) => event.kind === "breaker_change" && event.to === "open")).toBe(true);

    // Denied WITHOUT provider contact — reads and writes alike.
    const second = await store.loadSources(TENANT);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe("breaker_open");
    const third = await store.saveSource(sourceFixture());
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.code).toBe("breaker_open");
    expect(calls).toBe(2);
  });

  it("exposes the declared policy for observability (snapshot + trust ledger)", async () => {
    const store = createKnowledgeCurrencyDbStore({ client: new FakeKnowledgeDb() });
    expect(store.policy.snapshot().provider).toBe("cg-substrate-knowledge-currency");
    expect(store.policy.currentTrustVerdict()).toBe("unproven");
    const recommendation = store.policy.recommendTrust();
    expect(recommendation.verdict).toBe("unproven");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 3. Migration / rollback integrity pinning
 * ────────────────────────────────────────────────────────────*/

describe("knowledge-currency migration 20261002000011 — authored integrity", () => {
  it("carries the AUTHORED, NOT APPLIED status and rollback pointer", () => {
    expect(MIGRATION).toContain("Status: AUTHORED, NOT APPLIED");
    expect(MIGRATION).toContain(
      "database/supabase/rollbacks/20261002000011_coregrid_v1_knowledge_currency.sql",
    );
    expect(ROLLBACK).toContain("Status: AUTHORED, NOT APPLIED");
  });

  it("authors all four cg_knowledge tables with deny-by-default RLS", () => {
    for (const table of [
      KNOWLEDGE_SOURCE_TABLE,
      KNOWLEDGE_CONTRACT_TABLE,
      KNOWLEDGE_INVALIDATION_TABLE,
      KNOWLEDGE_DOWNGRADE_TABLE,
    ]) {
      expect(MIGRATION).toContain(`CREATE TABLE IF NOT EXISTS public.${table} (`);
      expect(MIGRATION).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`);
      expect(MIGRATION).toContain(`REVOKE ALL ON public.${table} FROM anon, authenticated;`);
    }
  });

  it("authors ZERO RLS policies (no grant path exists yet)", () => {
    expect(MIGRATION).not.toContain("CREATE POLICY");
    expect(ROLLBACK).not.toContain("CREATE POLICY");
  });

  it("pins the revalidation law, tombstone law and strict-down law", () => {
    expect(MIGRATION).toContain("cg_knowledge_freshness_contract_revalidation CHECK (");
    expect(MIGRATION).toContain("UNIQUE (tenant_id, record_id)");
    expect(MIGRATION).toContain("cg_knowledge_downgrade_strict_down CHECK (");
    expect(MIGRATION).toContain("evidence_ref        text NOT NULL");
  });

  it("pins the same-tenant composite FKs", () => {
    expect(MIGRATION).toContain("cg_knowledge_freshness_contract_source_fk");
    expect(MIGRATION).toContain("REFERENCES public.cg_knowledge_source (id, tenant_id)");
    expect(MIGRATION).toContain("cg_knowledge_invalidation_contract_fk");
    expect(MIGRATION).toContain("REFERENCES public.cg_knowledge_freshness_contract (record_id, tenant_id)");
    expect(MIGRATION).toContain("cg_knowledge_downgrade_source_fk");
  });

  it("declares the retention families (audit acts; governance-config registry rows)", () => {
    expect(MIGRATION).toContain("'audit'");
    expect(MIGRATION).toContain("RP-AUDIT-EDU");
    expect(MIGRATION).toContain("RP-AUDIT-ORG");
    expect(MIGRATION).toContain("RP-AUDIT-PLT");
    expect(MIGRATION).toContain("'governance-config'");
    expect(MIGRATION).toContain("'memory'");
  });

  it("rollback reverses the DDL in reverse dependency order", () => {
    // Rollbacks DROP in reverse dependency order: the acts reference the
    // contract, the contract references the source.
    const sourceDrop = ROLLBACK.indexOf(`DROP TABLE IF EXISTS public.${KNOWLEDGE_SOURCE_TABLE}`);
    const contractDrop = ROLLBACK.indexOf(`DROP TABLE IF EXISTS public.${KNOWLEDGE_CONTRACT_TABLE}`);
    const invalidationDrop = ROLLBACK.indexOf(`DROP TABLE IF EXISTS public.${KNOWLEDGE_INVALIDATION_TABLE}`);
    const downgradeDrop = ROLLBACK.indexOf(`DROP TABLE IF EXISTS public.${KNOWLEDGE_DOWNGRADE_TABLE}`);
    expect(sourceDrop).toBeGreaterThan(-1);
    expect(contractDrop).toBeGreaterThan(-1);
    expect(invalidationDrop).toBeGreaterThan(-1);
    expect(downgradeDrop).toBeGreaterThan(-1);
    expect(downgradeDrop).toBeLessThan(invalidationDrop);
    expect(invalidationDrop).toBeLessThan(contractDrop);
    expect(contractDrop).toBeLessThan(sourceDrop);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 4. LIVE-gated connectivity probe (skips without credentials)
 * ────────────────────────────────────────────────────────────*/

const LIVE_ENABLED = Boolean(process.env.DATABASE_URL);

describe.skipIf(!LIVE_ENABLED)(
  "live: knowledge-currency substrate connectivity probe (authored, NOT applied)",
  () => {
    it(
      "connects through scripts/lib/pg-connect.mjs and answers SELECT 1 — never touching cg_knowledge_*",
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

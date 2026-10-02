/**
 * Team 1 (batch B) — substrate persistence tests for the reasoning-provenance
 * contract (J-015 / V1CAP-029 / MISSION-R-33).
 *
 * Covers: contract<->row round-trip mapping, failure-policy semantics
 * exercised through the adapter (bounded timeout, breaker, degraded mode —
 * deterministic AdapterClock), migration/rollback file integrity pinning for
 * 20261002000009, and a LIVE-GATED connectivity probe (skips cleanly without
 * DATABASE_URL; never touches the authored cg_reasoning_provenance_* tables —
 * the migration is AUTHORED, NOT APPLIED).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createReasoningProvenanceStore,
  REASONING_PROVENANCE_SNAPSHOT_COLUMNS,
  REASONING_PROVENANCE_SNAPSHOT_TABLE,
  rowToSnapshot,
  snapshotToRow,
  type ReasoningProvenanceDbClient,
} from "../../frontend/src/lib/adapters/reasoning-provenance-store.adapter";
import {
  createAdapterFailurePolicy,
  type AdapterClock,
  type AdapterPolicyEvent,
} from "../../frontend/src/lib/adapters/failure-policy";
import {
  buildIntelligenceSnapshot,
  INTELLIGENCE_SNAPSHOT_SCHEMA_VERSION,
} from "../../frontend/src/lib/ai-gateway/reasoning-provenance";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MIGRATION = readFileSync(
  join(ROOT, "database/supabase/migrations/20261002000009_coregrid_v1_reasoning_provenance.sql"),
  "utf8",
);
const ROLLBACK = readFileSync(
  join(ROOT, "database/supabase/rollbacks/20261002000009_coregrid_v1_reasoning_provenance.sql"),
  "utf8",
);

const TENANT = "tenant-alpha";
const ACTOR = "01970000-0000-7000-8000-0000000000b1";
const AT = "2026-10-01T12:00:00Z";

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

function snapshotFixture() {
  return buildIntelligenceSnapshot({
    tenantRef: TENANT,
    actorRef: ACTOR,
    agentRef: "agent-7",
    missionRef: "mission-1",
    purpose: "summarization",
    model: { id: "coregrid-registry/answerer-1", providerClass: "hosted-api" },
    contextVersion: { traceId: "trace-ctx-1", assembledContent: "assembled context body" },
    routing: {
      routedViaRegistry: true,
      rationale: [
        { stage: "registry_route_resolved", model: "coregrid-registry/answerer-1", detail: "route resolved" },
        { stage: "provider_success", model: "coregrid-registry/answerer-1", detail: "served" },
      ],
    },
    usage: { tokensIn: 120, tokensOut: 45, estimatedCostUsd: 0.0031 },
    output: { summary: "derived intelligence output" },
    recordedAt: AT,
  });
}

function envelopeInput() {
  return {
    objectType: "core.intelligence.snapshot",
    schemaVersion: INTELLIGENCE_SNAPSHOT_SCHEMA_VERSION,
    status: "active" as const,
    createdBy: ACTOR,
    updatedBy: ACTOR,
    provenance: {
      source: "ai-gateway:model-generated",
      originTenantId: TENANT,
      generatedByAi: true,
      verified: false,
    },
    policyContext: { purpose: "summarization" },
    traceId: "trace-snap-1",
    correlationId: "corr-snap-1",
    declaredOrigin: "gateway-run-1",
  };
}

/** In-memory client: INSERTs capture rows, SELECTs replay them verbatim. */
class FakeReasoningDb implements ReasoningProvenanceDbClient {
  readonly snapshots: Record<string, unknown>[] = [];
  calls = 0;

  async query(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<{ rows: readonly Record<string, unknown>[] }> {
    this.calls += 1;
    if (text.includes(`INSERT INTO public.${REASONING_PROVENANCE_SNAPSHOT_TABLE}`)) {
      this.snapshots.push(zipRow(REASONING_PROVENANCE_SNAPSHOT_COLUMNS, values));
      return { rows: [] };
    }
    if (text.includes(`FROM public.${REASONING_PROVENANCE_SNAPSHOT_TABLE}`)) {
      return { rows: this.snapshots.filter((row) => row.tenant_id === values[0]) };
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
 * 1. Round-trip: contract -> row -> contract
 * ────────────────────────────────────────────────────────────*/

describe("reasoning-provenance substrate adapter — round-trip mapping", () => {
  it("maps a contract intelligence snapshot to a substrate row and back", () => {
    const snapshot = snapshotFixture();
    const row = snapshotToRow(snapshot, envelopeInput());
    expect(row.id).toBe(snapshot.snapshotId);
    expect(row.snapshot_id).toBe(snapshot.snapshotId);
    expect(row.object_type).toBe("core.intelligence.snapshot");
    expect(row.evidence_class).toBe("generated");
    expect(row.generated_by_ai).toBe(true);
    expect(row.verified).toBe(false);
    expect(row.tenant_id).toBe(TENANT);
    expect(row.origin_tenant_id).toBe(TENANT);
    // Minimization: the output payload is never stored, only its digest.
    expect(row.output_digest).toBe(snapshot.outputDigest);
    expect(JSON.stringify(row)).not.toContain("derived intelligence output");

    const restored = rowToSnapshot(zipRow(REASONING_PROVENANCE_SNAPSHOT_COLUMNS, [
      row.id, row.tenant_id, row.snapshot_id, row.schema_version, row.evidence_class,
      row.generated_by_ai, row.model_id, row.model_provider_class, row.context_trace_id,
      row.context_content_digest, row.routed_via_registry, row.routing_rationale,
      row.actor_ref, row.agent_ref, row.mission_ref, row.purpose, row.tokens_in,
      row.tokens_out, row.estimated_cost_usd, row.output_digest, row.provenance_source,
      row.provenance_source_ref, row.recorded_by, row.origin_tenant_id, row.verified,
      row.recorded_at, row.object_type, row.status, row.created_by, row.updated_by,
      row.provenance, row.policy_context, row.trace_id, row.correlation_id,
      row.causation_id, row.parent_event_id, row.declared_origin,
    ]));
    expect(restored).toEqual(snapshot);
  });

  it("persists through the adapter and reloads the identical snapshot", async () => {
    const db = new FakeReasoningDb();
    const store = createReasoningProvenanceStore({ client: db });
    const saved = await store.saveSnapshot({ snapshot: snapshotFixture(), envelope: envelopeInput() });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.value.id).toBe(snapshotFixture().snapshotId);
    expect(saved.attempts).toBe(1);

    const loaded = await store.loadSnapshots(TENANT);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value).toHaveLength(1);
    expect(loaded.value[0]).toEqual(snapshotFixture());
  });

  it("refuses snapshots whose envelope schema version disagrees (fail-closed)", async () => {
    const db = new FakeReasoningDb();
    const store = createReasoningProvenanceStore({ client: db });
    const saved = await store.saveSnapshot({
      snapshot: snapshotFixture(),
      envelope: { ...envelopeInput(), schemaVersion: "9.9" },
    });
    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.code).toBe("invalid_input");
    expect(saved.reason).toContain("schemaVersion");
    expect(db.calls).toBe(0);
  });

  it("refuses snapshots that fail the contract's own validation gate", async () => {
    const db = new FakeReasoningDb();
    const store = createReasoningProvenanceStore({ client: db });
    const broken = { ...snapshotFixture(), generatedByAi: false } as unknown as ReturnType<typeof snapshotFixture>;
    const saved = await store.saveSnapshot({ snapshot: broken, envelope: envelopeInput() });
    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.code).toBe("invalid_input");
    expect(db.calls).toBe(0);
  });

  it("contains malformed DB rows as structured errors, never throws", async () => {
    const broken: ReasoningProvenanceDbClient = {
      query: async () => ({ rows: [{ garbage: true }] }),
    };
    const store = createReasoningProvenanceStore({ client: broken });
    const loaded = await store.loadSnapshots(TENANT);
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.code).toBe("invalid_input");
  });

  it("refuses tenant-less loads — snapshots never cross tenants", async () => {
    const store = createReasoningProvenanceStore({ client: new FakeReasoningDb() });
    const loaded = await store.loadSnapshots("   ");
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.code).toBe("invalid_input");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 2. Failure-policy semantics through the adapter (J-045)
 * ────────────────────────────────────────────────────────────*/

describe("reasoning-provenance substrate adapter — failure policy", () => {
  it("bounds a hung client with a timeout (deterministic clock, never retried writes)", async () => {
    const clockCtl = manualClock();
    const policy = createAdapterFailurePolicy({
      provider: "cg-substrate-reasoning-provenance-test",
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
    const hung: ReasoningProvenanceDbClient = {
      query: () => neverSettles<{ rows: readonly Record<string, unknown>[] }>(),
    };
    const store = createReasoningProvenanceStore({ client: hung, failurePolicy: policy });
    const pending = store.loadSnapshots(TENANT);
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
      provider: "cg-substrate-reasoning-provenance-test",
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
    const failing: ReasoningProvenanceDbClient = {
      query: () => {
        calls += 1;
        throw new Error("connection refused");
      },
    };
    const store = createReasoningProvenanceStore({ client: failing, failurePolicy: policy });
    const first = await store.loadSnapshots(TENANT);
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
    const second = await store.loadSnapshots(TENANT);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe("breaker_open");
    const third = await store.saveSnapshot({ snapshot: snapshotFixture(), envelope: envelopeInput() });
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.code).toBe("breaker_open");
    expect(calls).toBe(2);
  });

  it("exposes the declared policy for observability (snapshot + trust ledger)", async () => {
    const store = createReasoningProvenanceStore({ client: new FakeReasoningDb() });
    expect(store.policy.snapshot().provider).toBe("cg-substrate-reasoning-provenance");
    expect(store.policy.currentTrustVerdict()).toBe("unproven");
    const recommendation = store.policy.recommendTrust();
    expect(recommendation.verdict).toBe("unproven");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 3. Migration / rollback integrity pinning
 * ────────────────────────────────────────────────────────────*/

describe("reasoning-provenance migration 20261002000009 — authored integrity", () => {
  it("carries the AUTHORED, NOT APPLIED status and rollback pointer", () => {
    expect(MIGRATION).toContain("Status: AUTHORED, NOT APPLIED");
    expect(MIGRATION).toContain(
      "database/supabase/rollbacks/20261002000009_coregrid_v1_reasoning_provenance.sql",
    );
    expect(ROLLBACK).toContain("Status: AUTHORED, NOT APPLIED");
  });

  it("authors the cg_reasoning_provenance_snapshot table with deny-by-default RLS", () => {
    expect(MIGRATION).toContain(`CREATE TABLE IF NOT EXISTS public.${REASONING_PROVENANCE_SNAPSHOT_TABLE} (`);
    expect(MIGRATION).toContain(`ALTER TABLE public.${REASONING_PROVENANCE_SNAPSHOT_TABLE} ENABLE ROW LEVEL SECURITY;`);
    expect(MIGRATION).toContain(`REVOKE ALL ON public.${REASONING_PROVENANCE_SNAPSHOT_TABLE} FROM anon, authenticated;`);
  });

  it("authors ZERO RLS policies (no grant path exists yet)", () => {
    expect(MIGRATION).not.toContain("CREATE POLICY");
    expect(ROLLBACK).not.toContain("CREATE POLICY");
  });

  it("pins the snapshot object_type, envelope atomicity, causation root and format", () => {
    expect(MIGRATION).toContain(
      "cg_reasoning_provenance_snapshot_object_type\n  CHECK (object_type = 'core.intelligence.snapshot')",
    );
    expect(MIGRATION).toContain("cg_reasoning_provenance_snapshot_envelope_atomic");
    expect(MIGRATION).toContain("cg_reasoning_provenance_snapshot_envelope_causation_root");
    expect(MIGRATION).toContain("cg_reasoning_provenance_snapshot_envelope_format");
    expect(MIGRATION).toContain("created_by          text NOT NULL");
  });

  it("pins the AI-provenance markers, digest identity and tenant agreement", () => {
    expect(MIGRATION).toContain("generated_by_ai     boolean NOT NULL CHECK (generated_by_ai = true)");
    expect(MIGRATION).toContain("verified            boolean NOT NULL CHECK (verified = false)");
    expect(MIGRATION).toContain("cg_reasoning_provenance_snapshot_id_is_digest CHECK (id = snapshot_id)");
    expect(MIGRATION).toContain("cg_reasoning_provenance_snapshot_tenant_agreement CHECK (tenant_id = origin_tenant_id)");
    expect(MIGRATION).toContain("snapshot_id         text NOT NULL CHECK (snapshot_id ~ '^sha256:[0-9a-f]{64}$')");
    expect(MIGRATION).toContain("output_digest       text NOT NULL CHECK (output_digest ~ '^sha256:[0-9a-f]{64}$')");
  });

  it("declares the ai-snapshot retention family", () => {
    expect(MIGRATION).toContain("'ai-snapshot'");
    expect(MIGRATION).toContain("RP-AISNAP-EDU/RP-AISNAP-ORG");
  });

  it("rollback reverses the DDL", () => {
    expect(ROLLBACK).toContain("DROP TABLE IF EXISTS public.cg_reasoning_provenance_snapshot");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 4. LIVE-gated connectivity probe (skips without credentials)
 * ────────────────────────────────────────────────────────────*/

const LIVE_ENABLED = Boolean(process.env.DATABASE_URL);

describe.skipIf(!LIVE_ENABLED)(
  "live: reasoning-provenance substrate connectivity probe (authored, NOT applied)",
  () => {
    it(
      "connects through scripts/lib/pg-connect.mjs and answers SELECT 1 — never touching cg_reasoning_provenance_*",
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

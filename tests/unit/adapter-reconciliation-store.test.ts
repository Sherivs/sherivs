/**
 * Team 1 (batch A) — substrate persistence tests for the reconciliation
 * contract (V1CAP-005 / J-004 / MISSION-R-14).
 *
 * Covers: contract<->row round-trip mapping, failure-policy semantics
 * exercised through the adapter (bounded timeout, breaker, degraded mode —
 * deterministic AdapterClock), migration/rollback file integrity pinning for
 * 20261002000005, and a LIVE-GATED connectivity probe (skips cleanly without
 * DATABASE_URL; never touches the authored cg_reconciliation_* tables — the
 * migration is AUTHORED, NOT APPLIED).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createReconciliationStore,
  RECONCILIATION_INPUT_TABLE,
  RECONCILIATION_INPUT_COLUMNS,
  RECONCILIATION_VERDICT_COLUMNS,
  RECONCILIATION_VERDICT_TABLE,
  rowToInput,
  rowToVerdict,
  verdictRowId,
  verdictToRows,
  type ReconciliationDbClient,
} from "../../frontend/src/lib/adapters/reconciliation-store.adapter";
import {
  createAdapterFailurePolicy,
  type AdapterClock,
  type AdapterPolicyEvent,
} from "../../frontend/src/lib/adapters/failure-policy";
import {
  RECONCILIATION_VERDICT_OBJECT_TYPE,
  reconcileObservations,
  type ReconciliationObservation,
} from "../../frontend/src/lib/kernel/reconciliation";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MIGRATION = readFileSync(
  join(ROOT, "database/supabase/migrations/20261002000005_coregrid_v1_reconciliation.sql"),
  "utf8",
);
const ROLLBACK = readFileSync(
  join(ROOT, "database/supabase/rollbacks/20261002000005_coregrid_v1_reconciliation.sql"),
  "utf8",
);

const TENANT = "tenant-alpha";
const ACTOR = "01970000-0000-7000-8000-0000000000a1";
const AT = "2026-10-01T12:00:00Z";
const RECORDED = "2026-10-01T12:05:00Z";

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

function observation(
  id: string,
  value: string,
  overrides: Partial<ReconciliationObservation> = {},
): ReconciliationObservation {
  return {
    id,
    tenant_id: TENANT,
    subject_entity_id: "entity-1",
    attribute: "state",
    value: { known: true, value },
    kind: "reported",
    evidence_class: "attested",
    reliability: "reliable",
    confidence: 0.9,
    observed_at: AT,
    recorded_at: RECORDED,
    valid_from: AT,
    valid_until: null,
    valid_time_known: true,
    supersedes: null,
    observer_identity: null,
    source_ref: null,
    ...overrides,
  };
}

function envelopeInput() {
  return {
    objectType: RECONCILIATION_VERDICT_OBJECT_TYPE,
    schemaVersion: "1.0",
    status: "active" as const,
    createdBy: ACTOR,
    updatedBy: ACTOR,
    provenance: {
      source: "kernel-reconciliation:v1",
      originTenantId: TENANT,
      generatedByAi: false,
      verified: true,
    },
    policyContext: { purpose: "reconciliation" },
    traceId: "trace-recon-1",
    correlationId: "corr-recon-1",
    declaredOrigin: "reconciliation-run-1",
  };
}

function conflictingVerdictFixture() {
  const observations = [
    observation("obs-a", "on", { confidence: 0.9 }),
    observation("obs-b", "off", { evidence_class: "derived", reliability: "provisional", confidence: 0.95 }),
  ];
  const result = reconcileObservations(observations, {
    tenantId: TENANT,
    recordedAt: RECORDED,
    at: AT,
  });
  return { observations, verdict: result.verdicts[0] };
}

/** In-memory client: INSERTs capture rows, SELECTs replay them verbatim. */
class FakeReconciliationDb implements ReconciliationDbClient {
  readonly verdicts: Record<string, unknown>[] = [];
  readonly inputs: Record<string, unknown>[] = [];
  calls = 0;

  async query(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<{ rows: readonly Record<string, unknown>[] }> {
    this.calls += 1;
    if (text.includes(`INSERT INTO public.${RECONCILIATION_VERDICT_TABLE}`)) {
      this.verdicts.push(zipRow(RECONCILIATION_VERDICT_COLUMNS, values));
      return { rows: [] };
    }
    if (text.includes(`INSERT INTO public.${RECONCILIATION_INPUT_TABLE}`)) {
      this.inputs.push(zipRow(RECONCILIATION_INPUT_COLUMNS, values));
      return { rows: [] };
    }
    if (text.includes(`FROM public.${RECONCILIATION_VERDICT_TABLE}`)) {
      return { rows: this.verdicts.filter((row) => row.tenant_id === values[0]) };
    }
    if (text.includes(`FROM public.${RECONCILIATION_INPUT_TABLE}`)) {
      return {
        rows: this.inputs.filter(
          (row) => row.verdict_row_id === values[0] && row.tenant_id === values[1],
        ),
      };
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

describe("reconciliation substrate adapter — round-trip mapping", () => {
  it("maps a contract verdict and its inputs to substrate rows and back", () => {
    const { observations, verdict } = conflictingVerdictFixture();
    expect(verdict.outcome).toBe("RESOLVED");
    const { verdict: row, inputs } = verdictToRows(verdict, observations, envelopeInput());
    expect(row.id).toBe(verdictRowId(verdict));
    expect(row.id.length).toBeLessThanOrEqual(160);
    expect(row.object_type).toBe(RECONCILIATION_VERDICT_OBJECT_TYPE);
    expect(row.value).toBe(JSON.stringify(verdict.value));
    expect(inputs).toHaveLength(verdict.inputs.length);

    const restored = rowToVerdict(row as unknown as Record<string, unknown>);
    expect(restored).toEqual(verdict);
    expect(restored.inputs).toEqual(verdict.inputs);
    expect(restored.provenance).toEqual(verdict.provenance);
    expect(restored.residual_uncertainty).toEqual(verdict.residual_uncertainty);
    for (const inputRow of inputs) {
      expect(rowToInput(inputRow as unknown as Record<string, unknown>)).toEqual(inputRow);
    }
  });

  it("persists through the adapter and reloads the identical verdict", async () => {
    const db = new FakeReconciliationDb();
    const store = createReconciliationStore({ client: db });
    const { observations, verdict } = conflictingVerdictFixture();
    const saved = await store.saveVerdict({
      verdict,
      observations,
      envelope: envelopeInput(),
      knownObjectTypes: [RECONCILIATION_VERDICT_OBJECT_TYPE],
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.value.id).toBe(verdictRowId(verdict));
    expect(saved.value.inputs).toBe(verdict.inputs.length);
    expect(saved.attempts).toBe(1);

    const loaded = await store.loadVerdicts(TENANT);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value).toHaveLength(1);
    expect(loaded.value[0]).toEqual(verdict);

    const inputs = await store.loadInputs(saved.value.id, TENANT);
    expect(inputs.ok).toBe(true);
    if (!inputs.ok) return;
    expect(inputs.value).toHaveLength(verdict.inputs.length);
    expect(inputs.value.map((entry) => entry.observation_id)).toEqual(verdict.inputs);
  });

  it("refuses verdicts whose inputs carry no matching observation (fail-closed)", async () => {
    const db = new FakeReconciliationDb();
    const store = createReconciliationStore({ client: db });
    const { verdict } = conflictingVerdictFixture();
    const saved = await store.saveVerdict({
      verdict,
      observations: [],
      envelope: envelopeInput(),
    });
    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.code).toBe("invalid_input");
    expect(saved.reason).toContain("no matching observation");
    expect(db.calls).toBe(0);
  });

  it("contains malformed DB rows as structured errors, never throws", async () => {
    const broken: ReconciliationDbClient = {
      query: async () => ({ rows: [{ garbage: true }] }),
    };
    const store = createReconciliationStore({ client: broken });
    const loaded = await store.loadVerdicts(TENANT);
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.code).toBe("invalid_input");
  });

  it("refuses tenant-less loads — reconciliation never crosses tenants", async () => {
    const store = createReconciliationStore({ client: new FakeReconciliationDb() });
    const loaded = await store.loadVerdicts("   ");
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.code).toBe("invalid_input");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 2. Failure-policy semantics through the adapter (J-045)
 * ────────────────────────────────────────────────────────────*/

describe("reconciliation substrate adapter — failure policy", () => {
  it("bounds a hung client with a timeout (deterministic clock, never retried writes)", async () => {
    const clockCtl = manualClock();
    const policy = createAdapterFailurePolicy({
      provider: "cg-substrate-reconciliation-test",
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
    const hung: ReconciliationDbClient = {
      query: () => neverSettles<{ rows: readonly Record<string, unknown>[] }>(),
    };
    const store = createReconciliationStore({ client: hung, failurePolicy: policy });
    const pending = store.loadVerdicts(TENANT);
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
      provider: "cg-substrate-reconciliation-test",
      timeoutMs: 1_000,
      // Reads are idempotent and retryable: two consecutive failed attempts
      // trip the breaker (the mapping step's containSync success must not
      // clear the I/O failure streak mid-call).
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
    const failing: ReconciliationDbClient = {
      // A synchronously throwing provider: the adapter's await wrapper still
      // yields an already-rejected call promise, so the deterministic race
      // resolves provider_error (not the timeout winner).
      query: () => {
        calls += 1;
        throw new Error("connection refused");
      },
    };
    const store = createReconciliationStore({ client: failing, failurePolicy: policy });
    const { observations, verdict } = conflictingVerdictFixture();
    const first = await store.loadVerdicts(TENANT);
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
    const second = await store.loadVerdicts(TENANT);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe("breaker_open");
    const third = await store.saveVerdict({ verdict, observations, envelope: envelopeInput() });
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.code).toBe("breaker_open");
    expect(calls).toBe(2);
  });

  it("exposes the declared policy for observability (snapshot + trust ledger)", async () => {
    const db = new FakeReconciliationDb();
    const store = createReconciliationStore({ client: db });
    expect(store.policy.snapshot().provider).toBe("cg-substrate-reconciliation");
    expect(store.policy.currentTrustVerdict()).toBe("unproven");
    const recommendation = store.policy.recommendTrust();
    expect(recommendation.verdict).toBe("unproven");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 3. Migration / rollback integrity pinning
 * ────────────────────────────────────────────────────────────*/

describe("reconciliation migration 20261002000005 — authored integrity", () => {
  it("carries the AUTHORED, NOT APPLIED status and rollback pointer", () => {
    expect(MIGRATION).toContain("Status: AUTHORED, NOT APPLIED");
    expect(MIGRATION).toContain(
      "database/supabase/rollbacks/20261002000005_coregrid_v1_reconciliation.sql",
    );
    expect(ROLLBACK).toContain("Status: AUTHORED, NOT APPLIED");
  });

  it("authors both cg_reconciliation tables with deny-by-default RLS", () => {
    for (const table of [RECONCILIATION_VERDICT_TABLE, RECONCILIATION_INPUT_TABLE]) {
      expect(MIGRATION).toContain(`CREATE TABLE IF NOT EXISTS public.${table} (`);
      expect(MIGRATION).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`);
      expect(MIGRATION).toContain(`REVOKE ALL ON public.${table} FROM anon, authenticated;`);
    }
  });

  it("authors ZERO RLS policies (no grant path exists yet)", () => {
    expect(MIGRATION).not.toContain("CREATE POLICY");
  });

  it("pins the verdict object_type, envelope atomicity, causation root and format", () => {
    expect(MIGRATION).toContain(
      "cg_reconciliation_verdict_object_type\n  CHECK (object_type = 'core.reconciliation.verdict')",
    );
    expect(MIGRATION).toContain("cg_reconciliation_verdict_envelope_atomic");
    expect(MIGRATION).toContain("cg_reconciliation_verdict_envelope_causation_root");
    expect(MIGRATION).toContain("cg_reconciliation_verdict_envelope_format");
    expect(MIGRATION).toContain("created_by          text NOT NULL");
  });

  it("pins the outcome law, bi-temporal law and vocabulary CHECKs", () => {
    expect(MIGRATION).toContain("cg_reconciliation_verdict_outcome_law");
    expect(MIGRATION).toContain("cg_reconciliation_verdict_bitemporal");
    expect(MIGRATION).toContain(
      "('CONVERGED','RESOLVED','UNKNOWN','UNRESOLVED_CONTRADICTION')",
    );
    expect(MIGRATION).toContain("cg_reconciliation_input_verdict_fk");
    expect(MIGRATION).toContain("REFERENCES public.cg_reconciliation_verdict (id, tenant_id)");
  });

  it("rollback reverses the DDL in reverse dependency order", () => {
    const inputDrop = ROLLBACK.indexOf("DROP TABLE IF EXISTS public.cg_reconciliation_input");
    const verdictDrop = ROLLBACK.indexOf(
      "DROP TABLE IF EXISTS public.cg_reconciliation_verdict",
    );
    expect(inputDrop).toBeGreaterThan(-1);
    expect(verdictDrop).toBeGreaterThan(inputDrop);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 4. LIVE-gated connectivity probe (skips without credentials)
 * ────────────────────────────────────────────────────────────*/

const LIVE_ENABLED = Boolean(process.env.DATABASE_URL);

describe.skipIf(!LIVE_ENABLED)(
  "live: reconciliation substrate connectivity probe (authored, NOT applied)",
  () => {
    it(
      "connects through scripts/lib/pg-connect.mjs and answers SELECT 1 — never touching cg_reconciliation_*",
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
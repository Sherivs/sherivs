/**
 * Team 1 (batch B) — substrate persistence tests for the tool-runtime
 * contract (J-008 / V1CAP-056 / MISSION-R-62, wave 3).
 *
 * Covers: contract<->row round-trip mapping for the registration surface and
 * the invocation audit ledger, failure-policy semantics exercised through the
 * adapter (bounded timeout, breaker, degraded mode — deterministic
 * AdapterClock), migration/rollback file integrity pinning for
 * 20261002000012, and a LIVE-GATED connectivity probe (skips cleanly without
 * DATABASE_URL; never touches the authored cg_tool_runtime_* tables — the
 * migration is AUTHORED, NOT APPLIED).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createToolRuntimeStore,
  invocationToRow,
  rowToInvocation,
  registrationToRow,
  rowToRegistration,
  TOOL_RUNTIME_INVOCATION_TABLE,
  TOOL_RUNTIME_TOOL_TABLE,
  type ToolRuntimeDbClient,
} from "../../frontend/src/lib/adapters/tool-runtime-store.adapter";
import {
  createAdapterFailurePolicy,
  type AdapterClock,
  type AdapterPolicyEvent,
} from "../../frontend/src/lib/adapters/failure-policy";
import type {
  GovernedToolDeclaration,
  ToolInvocationRecord,
} from "../../frontend/src/lib/workforce/tool-runtime";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MIGRATION = readFileSync(
  join(ROOT, "database/supabase/migrations/20261002000012_coregrid_v1_tool_runtime.sql"),
  "utf8",
);
const ROLLBACK = readFileSync(
  join(ROOT, "database/supabase/rollbacks/20261002000012_coregrid_v1_tool_runtime.sql"),
  "utf8",
);

const TENANT = "tenant-alpha";
const AT_MS = Date.parse("2026-10-01T12:00:00Z");

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

/* ── fixtures built through the pure contract's data shapes ── */

function declarationFixture(): GovernedToolDeclaration {
  return {
    toolId: "tool.report.builder",
    contract: "Builds a report summary from provided digests; no side effects.",
    requiredCapabilityIds: ["capability.report.compose"],
    riskClass: "medium",
    // The executor is code, not data: validated by the adapter, never persisted.
    executor: () => ({ ok: true, summary: "report built", evidenceRef: null }),
    credentialRequirements: [
      { credentialRef: "vault/report-store", purpose: "report-write", ttlMs: 60_000, maxUses: 3 },
    ],
    sensitiveParamKeys: ["authorNotes"],
    rateGuard: { windowMs: 60_000, maxInvocationsPerWindow: 10 },
    budgetGuard: { maxTotalInvocations: 1_000 },
  };
}

function invocationFixture(overrides: Partial<ToolInvocationRecord> = {}): ToolInvocationRecord {
  return {
    recordId: "invocation:tool.report.builder:1",
    atMs: AT_MS,
    workerId: "worker-1",
    workerIdentityRef: "identity-worker-1",
    tenantRef: TENANT,
    toolId: "tool.report.builder",
    requiredCapabilityIds: ["capability.report.compose"],
    leaseHandleRefs: ["lease-abc"],
    delegationRef: "delegation-1",
    outcome: "executed",
    reasonCode: null,
    reasonDetail: null,
    leaseInvalidated: false,
    redactedParams: { title: "Q3 summary", authorNotes: "[REDACTED]" },
    resultSummary: "report built",
    evidenceRef: "evidence-1",
    ...overrides,
  };
}

/** In-memory client: INSERTs capture rows, SELECTs replay them verbatim. */
class FakeToolRuntimeDb implements ToolRuntimeDbClient {
  readonly tools: Record<string, unknown>[] = [];
  readonly invocations: Record<string, unknown>[] = [];
  calls = 0;

  async query(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<{ rows: readonly Record<string, unknown>[] }> {
    this.calls += 1;
    if (text.includes(`INSERT INTO public.${TOOL_RUNTIME_TOOL_TABLE}`)) {
      this.tools.push({
        id: values[0],
        tenant_id: values[1],
        tool_id: values[2],
        contract: values[3],
        required_capability_ids: values[4],
        risk_class: values[5],
        credential_requirements: values[6],
        sensitive_param_keys: values[7],
        rate_guard: values[8],
        budget_guard: values[9],
        registered_at_ms: values[10],
        registered_at: values[11],
      });
      return { rows: [] };
    }
    if (text.includes(`INSERT INTO public.${TOOL_RUNTIME_INVOCATION_TABLE}`)) {
      this.invocations.push({
        record_id: values[0],
        tenant_id: values[1],
        at_ms: values[2],
        at: values[3],
        worker_id: values[4],
        worker_identity_ref: values[5],
        tool_id: values[6],
        required_capability_ids: values[7],
        lease_handle_refs: values[8],
        delegation_ref: values[9],
        outcome: values[10],
        reason_code: values[11],
        reason_detail: values[12],
        lease_invalidated: values[13],
        redacted_params: values[14],
        result_summary: values[15],
        evidence_ref: values[16],
      });
      return { rows: [] };
    }
    if (text.includes(`FROM public.${TOOL_RUNTIME_TOOL_TABLE}`)) {
      return { rows: this.tools.filter((row) => row.tenant_id === values[0]) };
    }
    if (text.includes(`FROM public.${TOOL_RUNTIME_INVOCATION_TABLE}`)) {
      return { rows: this.invocations.filter((row) => row.tenant_id === values[0]) };
    }
    return { rows: [] };
  }
}

/* ─────────────────────────────────────────────────────────────
 * 1. Round-trip: contract -> row -> contract
 * ────────────────────────────────────────────────────────────*/

describe("tool-runtime substrate adapter — round-trip mapping", () => {
  it("maps a governed-tool declaration to a registration row (executor excluded)", () => {
    const row = registrationToRow(declarationFixture(), TENANT, AT_MS);
    expect(row.id).toBe("tool.report.builder");
    expect(row.tool_id).toBe("tool.report.builder");
    expect(row.risk_class).toBe("medium");
    expect(JSON.parse(row.required_capability_ids)).toEqual(["capability.report.compose"]);
    expect(JSON.parse(row.credential_requirements)).toEqual([
      { credentialRef: "vault/report-store", purpose: "report-write", ttlMs: 60_000, maxUses: 3 },
    ]);
    expect(JSON.parse(row.sensitive_param_keys)).toEqual(["authorNotes"]);
    expect(row.registered_at_ms).toBe(AT_MS);

    const restored = rowToRegistration(row as unknown as Record<string, unknown>);
    const { executor: _executor, ...declarationData } = declarationFixture();
    expect(restored).toEqual(declarationData);
  });

  it("maps an invocation record to an audit row and back (executed path)", () => {
    const record = invocationFixture();
    const row = invocationToRow(record);
    expect(row.record_id).toBe("invocation:tool.report.builder:1");
    expect(row.outcome).toBe("executed");
    expect(row.reason_code).toBeNull();
    expect(row.lease_invalidated).toBe(false);
    expect(row.worker_id).toBe("worker-1");
    // Redacted params at rest; the sensitive value never appears in the row.
    expect(row.redacted_params).toContain("[REDACTED]");
    expect(row.redacted_params).not.toContain("secret-value");

    expect(rowToInvocation(row as unknown as Record<string, unknown>)).toEqual(record);
  });

  it("round-trips a rejected record with a pre-resolution absent worker identity", () => {
    const record = invocationFixture({
      outcome: "rejected",
      reasonCode: "invalid_invocation_input",
      reasonDetail: "worker, tenantRef, toolId, params and nowMs are required",
      workerId: "",
      workerIdentityRef: "",
      leaseHandleRefs: [],
      delegationRef: null,
      redactedParams: {},
      resultSummary: null,
      evidenceRef: null,
    });
    const row = invocationToRow(record);
    expect(row.worker_id).toBeNull();
    expect(row.worker_identity_ref).toBeNull();
    expect(row.reason_code).toBe("invalid_invocation_input");
    expect(rowToInvocation(row as unknown as Record<string, unknown>)).toEqual(record);
  });

  it("persists through the adapter and reloads identical records", async () => {
    const db = new FakeToolRuntimeDb();
    const store = createToolRuntimeStore({ client: db });
    const savedTool = await store.saveRegistration(declarationFixture(), TENANT, AT_MS);
    expect(savedTool.ok).toBe(true);
    if (savedTool.ok) expect(savedTool.value.toolId).toBe("tool.report.builder");
    const savedInvocation = await store.saveInvocation(invocationFixture());
    expect(savedInvocation.ok).toBe(true);
    if (savedInvocation.ok) expect(savedInvocation.value.recordId).toBe("invocation:tool.report.builder:1");

    const loadedTools = await store.loadRegistrations(TENANT);
    expect(loadedTools.ok).toBe(true);
    if (loadedTools.ok) {
      expect(loadedTools.value).toHaveLength(1);
      const { executor: _executor, ...declarationData } = declarationFixture();
      expect(loadedTools.value[0]).toEqual({ ...declarationData, registeredAtMs: AT_MS });
    }
    const loadedInvocations = await store.loadInvocations(TENANT);
    expect(loadedInvocations.ok).toBe(true);
    if (loadedInvocations.ok) expect(loadedInvocations.value).toEqual([invocationFixture()]);
  });

  it("refuses records that violate the outcome law (fail-closed)", async () => {
    const db = new FakeToolRuntimeDb();
    const store = createToolRuntimeStore({ client: db });
    const executedWithReason = invocationFixture({ reasonCode: "tool_not_registered" });
    const saved = await store.saveInvocation(executedWithReason);
    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.code).toBe("invalid_input");
    expect(saved.reason).toContain("outcome law");
    expect(db.calls).toBe(0);
  });

  it("contains malformed DB rows as structured errors, never throws", async () => {
    const broken: ToolRuntimeDbClient = {
      query: async () => ({ rows: [{ garbage: true }] }),
    };
    const store = createToolRuntimeStore({ client: broken });
    const loaded = await store.loadInvocations(TENANT);
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.code).toBe("invalid_input");
  });

  it("refuses tenant-less loads — invocation records never cross tenants", async () => {
    const store = createToolRuntimeStore({ client: new FakeToolRuntimeDb() });
    const loaded = await store.loadInvocations("   ");
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.code).toBe("invalid_input");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 2. Failure-policy semantics through the adapter (J-045)
 * ────────────────────────────────────────────────────────────*/

describe("tool-runtime substrate adapter — failure policy", () => {
  it("bounds a hung client with a timeout (deterministic clock, never retried writes)", async () => {
    const clockCtl = manualClock();
    const policy = createAdapterFailurePolicy({
      provider: "cg-substrate-tool-runtime-test",
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
    const hung: ToolRuntimeDbClient = {
      query: () => neverSettles<{ rows: readonly Record<string, unknown>[] }>(),
    };
    const store = createToolRuntimeStore({ client: hung, failurePolicy: policy });
    const pending = store.loadInvocations(TENANT);
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
      provider: "cg-substrate-tool-runtime-test",
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
    const failing: ToolRuntimeDbClient = {
      query: () => {
        calls += 1;
        throw new Error("connection refused");
      },
    };
    const store = createToolRuntimeStore({ client: failing, failurePolicy: policy });
    const first = await store.loadInvocations(TENANT);
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
    const second = await store.loadInvocations(TENANT);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe("breaker_open");
    const third = await store.saveInvocation(invocationFixture());
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.code).toBe("breaker_open");
    expect(calls).toBe(2);
  });

  it("exposes the declared policy for observability (snapshot + trust ledger)", async () => {
    const store = createToolRuntimeStore({ client: new FakeToolRuntimeDb() });
    expect(store.policy.snapshot().provider).toBe("cg-substrate-tool-runtime");
    expect(store.policy.currentTrustVerdict()).toBe("unproven");
    const recommendation = store.policy.recommendTrust();
    expect(recommendation.verdict).toBe("unproven");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 3. Migration / rollback integrity pinning
 * ────────────────────────────────────────────────────────────*/

describe("tool-runtime migration 20261002000012 — authored integrity", () => {
  it("carries the AUTHORED, NOT APPLIED status and rollback pointer", () => {
    expect(MIGRATION).toContain("Status: AUTHORED, NOT APPLIED");
    expect(MIGRATION).toContain(
      "database/supabase/rollbacks/20261002000012_coregrid_v1_tool_runtime.sql",
    );
    expect(ROLLBACK).toContain("Status: AUTHORED, NOT APPLIED");
  });

  it("authors both cg_tool_runtime tables with deny-by-default RLS", () => {
    for (const table of [TOOL_RUNTIME_TOOL_TABLE, TOOL_RUNTIME_INVOCATION_TABLE]) {
      expect(MIGRATION).toContain(`CREATE TABLE IF NOT EXISTS public.${table} (`);
      expect(MIGRATION).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`);
      expect(MIGRATION).toContain(`REVOKE ALL ON public.${table} FROM anon, authenticated;`);
    }
  });

  it("authors ZERO RLS policies (no grant path exists yet)", () => {
    expect(MIGRATION).not.toContain("CREATE POLICY");
    expect(ROLLBACK).not.toContain("CREATE POLICY");
  });

  it("pins the outcome law, lease law and closed reason vocabulary", () => {
    expect(MIGRATION).toContain("cg_tool_runtime_invocation_outcome_law CHECK (");
    expect(MIGRATION).toContain("cg_tool_runtime_invocation_lease_law CHECK (");
    expect(MIGRATION).toContain("'invalid_invocation_input','tool_not_registered',");
    expect(MIGRATION).toContain("'result_secret_material_detected'");
    expect(MIGRATION).toContain("reason_code        text CHECK (reason_code IS NULL OR reason_code IN");
  });

  it("pins the registration identity law, risk vocabulary and redacted-params posture", () => {
    expect(MIGRATION).toContain("cg_tool_runtime_tool_id_is_tool CHECK (id = tool_id)");
    expect(MIGRATION).toContain("risk_class          text NOT NULL CHECK (risk_class IN ('low','medium','high','critical'))");
    expect(MIGRATION).toContain("redacted_params    jsonb NOT NULL CHECK (jsonb_typeof(redacted_params) = 'object')");
    expect(MIGRATION).toContain("outcome            text NOT NULL CHECK (outcome IN ('executed','rejected','failed'))");
  });

  it("declares the retention families (audit invocations; governance-config tools)", () => {
    expect(MIGRATION).toContain("'audit'");
    expect(MIGRATION).toContain("RP-AUDIT-EDU /\n--   RP-AUDIT-ORG / RP-AUDIT-PLT");
    expect(MIGRATION).toContain("'governance-config'");
  });

  it("rollback reverses the DDL in reverse dependency order", () => {
    const invocationDrop = ROLLBACK.indexOf(`DROP TABLE IF EXISTS public.${TOOL_RUNTIME_INVOCATION_TABLE}`);
    const toolDrop = ROLLBACK.indexOf(`DROP TABLE IF EXISTS public.${TOOL_RUNTIME_TOOL_TABLE}`);
    expect(invocationDrop).toBeGreaterThan(-1);
    expect(toolDrop).toBeGreaterThan(invocationDrop);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 4. LIVE-gated connectivity probe (skips without credentials)
 * ────────────────────────────────────────────────────────────*/

const LIVE_ENABLED = Boolean(process.env.DATABASE_URL);

describe.skipIf(!LIVE_ENABLED)(
  "live: tool-runtime substrate connectivity probe (authored, NOT applied)",
  () => {
    it(
      "connects through scripts/lib/pg-connect.mjs and answers SELECT 1 — never touching cg_tool_runtime_*",
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

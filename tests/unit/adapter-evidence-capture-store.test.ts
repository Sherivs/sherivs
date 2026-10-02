/**
 * Team 1 (batch A) — substrate persistence tests for the evidence capture
 * lifecycle contract (J-034 / V1CAP-059 / MISSION-R-90 + J-033 / V1CAP-058 /
 * MISSION-R-91).
 *
 * Covers: CapturedEvidence<->row round-trip mapping (captured, promoted and
 * revoked records — the canonical-truth law at rest), lifecycle-act ledger
 * round-trip, failure-policy semantics exercised through the adapter
 * (bounded timeout, breaker — deterministic AdapterClock),
 * migration/rollback file integrity pinning for 20261002000008, and a
 * LIVE-GATED connectivity probe (skips cleanly without DATABASE_URL; never
 * touches the authored cg_evidence_* tables — the migration is AUTHORED,
 * NOT APPLIED).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createEvidenceCaptureStore,
  EVIDENCE_LIFECYCLE_ACT_TABLE,
  EVIDENCE_RECORD_TABLE,
  evidenceToRow,
  lifecycleActId,
  lifecycleActToRow,
  rowToEvidence,
  rowToLifecycleAct,
  type EvidenceDbClient,
  type LifecycleActInput,
} from "../../frontend/src/lib/adapters/evidence-capture-store.adapter";
import {
  createAdapterFailurePolicy,
  type AdapterClock,
  type AdapterPolicyEvent,
} from "../../frontend/src/lib/adapters/failure-policy";
import {
  DEFAULT_EVIDENCE_RETENTION_POLICY_ID,
  EVIDENCE_OBJECT_TYPE,
  captureEvidence,
  promoteEvidence,
  revokeEvidence,
  type CapturedEvidence,
  type EvidenceCaptureInput,
  type EvidenceClass,
} from "../../frontend/src/lib/evidence/capture";
import type { KernelObjectEnvelopeInput } from "../../frontend/src/lib/kernel/reality";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MIGRATION = readFileSync(
  join(ROOT, "database/supabase/migrations/20261002000008_coregrid_v1_evidence_lifecycle.sql"),
  "utf8",
);
const ROLLBACK = readFileSync(
  join(ROOT, "database/supabase/rollbacks/20261002000008_coregrid_v1_evidence_lifecycle.sql"),
  "utf8",
);

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

/* ── fixtures built through the pure contract (mirror of evidence-capture.test.ts) ── */

const NOW = "2026-10-01T12:00:00.000Z";
const LATER = "2026-10-01T12:05:00.000Z";
const TENANT = "tenant-alpha";
const GATEWAY = "sensor-gateway-01";

function envelopeInput(overrides?: Partial<KernelObjectEnvelopeInput>): KernelObjectEnvelopeInput {
  return {
    objectType: EVIDENCE_OBJECT_TYPE,
    schemaVersion: "1.0",
    status: "active",
    createdBy: GATEWAY,
    updatedBy: GATEWAY,
    provenance: {
      source: "field-sensor",
      sourceRef: "sensor/door-3",
      recordedBy: GATEWAY,
      originTenantId: TENANT,
      generatedByAi: false,
      verified: true,
    },
    policyContext: { purpose: "attendance" },
    traceId: "trace-1",
    correlationId: "corr-1",
    declaredOrigin: "capture-boot",
    ...overrides,
  };
}

function captureInputFor(
  evidenceClass: EvidenceClass,
  overrides?: Partial<EvidenceCaptureInput>,
): EvidenceCaptureInput {
  return {
    evidenceId: "ev-001",
    evidenceType: "door_event",
    tenantId: TENANT,
    evidenceClass,
    claim: { event: "door_opened" },
    confidence: 0.98,
    confidenceBasis: "sensor-calibration:door-3",
    observedAt: NOW,
    capturedBy: GATEWAY,
    capturedAt: NOW,
    sourceRef: "sensor/door-3",
    lineage: [],
    retentionPolicyId: DEFAULT_EVIDENCE_RETENTION_POLICY_ID,
    envelope: envelopeInput(),
    ...overrides,
  };
}

function capturedFixture(): CapturedEvidence {
  return captureEvidence(captureInputFor("direct_observation"));
}

function promotedFixture(): { retained: CapturedEvidence; promoted: CapturedEvidence } {
  const quarantined = captureEvidence(captureInputFor("derived"));
  const result = promoteEvidence(quarantined, {
    validatorId: "human-reviewer-1",
    method: "human_review",
    validatedAt: NOW,
    note: "field sensor calibration verified",
  });
  return { retained: result.retained, promoted: result.promoted };
}

function revokedFixture(): { retained: CapturedEvidence; revoked: CapturedEvidence } {
  const record = capturedFixture();
  const result = revokeEvidence(record, {
    revokedBy: "registrar-1",
    authorization: "policy:evidence.revoke",
    reason: "sensor fault invalidated the observation",
    reasonEvidenceRef: "ev-sensor-fault-report",
    revokedAt: LATER,
  });
  return { retained: result.retained, revoked: result.revoked };
}

/* ── column orders mirror the adapter's INSERT statements ── */

const EVIDENCE_ROW_COLUMNS = [
  "id",
  "tenant_id",
  "evidence_type",
  "evidence_class",
  "prior_class",
  "claim",
  "confidence",
  "confidence_basis",
  "observed_at",
  "recorded_at",
  "captured_by",
  "captured_at",
  "source_ref",
  "canonical_truth_eligible",
  "lineage",
  "supersedes",
  "promotion",
  "retention_policy_id",
  "sufficiency",
  "valid_from",
  "valid_until",
  "revocation",
  "revokes",
  "object_type",
  "schema_version",
  "status",
  "created_by",
  "updated_by",
  "provenance",
  "policy_context",
  "trace_id",
  "correlation_id",
  "causation_id",
  "parent_event_id",
  "declared_origin",
];

const ACT_COLUMNS = [
  "id",
  "tenant_id",
  "target_evidence_id",
  "act_kind",
  "actor_id",
  "act",
  "act_evidence_id",
  "recorded_at",
];

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

/** In-memory client: INSERTs capture rows idempotently, SELECTs replay them. */
class FakeEvidenceDb implements EvidenceDbClient {
  readonly records: Record<string, unknown>[] = [];
  readonly acts: Record<string, unknown>[] = [];
  calls = 0;

  async query(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<{ rows: readonly Record<string, unknown>[] }> {
    this.calls += 1;
    if (text.includes(`INSERT INTO public.${EVIDENCE_RECORD_TABLE}`)) {
      const row = zipRow(EVIDENCE_ROW_COLUMNS, values);
      const exists = this.records.some(
        (entry) => entry.id === row.id && entry.tenant_id === row.tenant_id,
      );
      if (!exists) this.records.push(row);
      return { rows: [] };
    }
    if (text.includes(`INSERT INTO public.${EVIDENCE_LIFECYCLE_ACT_TABLE}`)) {
      this.acts.push(zipRow(ACT_COLUMNS, values));
      return { rows: [] };
    }
    if (text.includes(`FROM public.${EVIDENCE_RECORD_TABLE}`) && text.includes("WHERE id = $1")) {
      return {
        rows: this.records.filter(
          (entry) => entry.id === values[0] && entry.tenant_id === values[1],
        ),
      };
    }
    if (text.includes(`FROM public.${EVIDENCE_RECORD_TABLE}`)) {
      const rows = this.records
        .filter((entry) => entry.tenant_id === values[0])
        .slice()
        .sort(
          (a, b) =>
            String(b.recorded_at).localeCompare(String(a.recorded_at)) ||
            String(a.id).localeCompare(String(b.id)),
        );
      return { rows };
    }
    if (text.includes(`FROM public.${EVIDENCE_LIFECYCLE_ACT_TABLE}`)) {
      const rows = this.acts
        .filter(
          (entry) => entry.tenant_id === values[0] && entry.target_evidence_id === values[1],
        )
        .slice()
        .sort((a, b) => String(a.recorded_at).localeCompare(String(b.recorded_at)));
      return { rows };
    }
    return { rows: [] };
  }
}

/* ─────────────────────────────────────────────────────────────
 * 1. Round-trip: contract -> row -> contract
 * ────────────────────────────────────────────────────────────*/

describe("evidence-capture substrate adapter — round-trip mapping", () => {
  it("maps a captured record onto the substrate row and back", () => {
    const record = capturedFixture();
    expect(record.canonical_truth_eligible).toBe(true);
    const row = evidenceToRow(record);
    expect(row.id).toBe("ev-001");
    expect(row.tenant_id).toBe(TENANT);
    expect(row.object_type).toBe("core.evidence");
    expect(row.evidence_class).toBe("direct_observation");
    expect(row.canonical_truth_eligible).toBe(true);
    expect(row.claim).toBe(JSON.stringify({ event: "door_opened" }));
    expect(row.provenance).toBe(JSON.stringify(record.provenance));
    expect(row.created_by).toBe(GATEWAY);
    expect(row.updated_by).toBe(GATEWAY);
    expect(row.revocation).toBeNull();
    expect(row.revokes).toBeNull();
    expect(row.prior_class).toBeNull();
    expect(row.promotion).toBeNull();

    const restored = rowToEvidence(row as unknown as Record<string, unknown>);
    expect(restored).toEqual(record);
  });

  it("round-trips a PROMOTED record — prior_class and the recorded act survive", () => {
    const { retained, promoted } = promotedFixture();
    expect(retained.prior_class).toBeNull();
    expect(promoted.evidence_class).toBe("direct_observation");
    expect(promoted.prior_class).toBe("derived");
    expect(promoted.promotion).not.toBeNull();
    expect(promoted.canonical_truth_eligible).toBe(true);

    const restored = rowToEvidence(evidenceToRow(promoted) as unknown as Record<string, unknown>);
    expect(restored).toEqual(promoted);
    expect(restored.promotion).toEqual(promoted.promotion);
  });

  it("round-trips a REVOKED record — canonical truth is forfeited at rest", () => {
    const { retained, revoked } = revokedFixture();
    expect(retained.revocation).toBeNull();
    expect(revoked.revocation).not.toBeNull();
    expect(revoked.revokes).toBe(retained.evidence_id);
    expect(revoked.canonical_truth_eligible).toBe(false);

    const row = evidenceToRow(revoked);
    expect(row.revokes).toBe("ev-001");
    const restored = rowToEvidence(row as unknown as Record<string, unknown>);
    expect(restored).toEqual(revoked);
    expect(restored.revocation).toEqual(revoked.revocation);
    expect(restored.canonical_truth_eligible).toBe(false);
  });

  it("persists through the adapter and reloads the identical record", async () => {
    const db = new FakeEvidenceDb();
    const store = createEvidenceCaptureStore({ client: db });
    const record = capturedFixture();
    const saved = await store.saveCapturedEvidence(record);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.value.evidenceId).toBe("ev-001");
    expect(saved.attempts).toBe(1);

    const loaded = await store.loadCapturedEvidence(TENANT, "ev-001");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value).toEqual(record);

    const tenantWide = await store.loadTenantEvidence(TENANT);
    expect(tenantWide.ok).toBe(true);
    if (!tenantWide.ok) return;
    expect(tenantWide.value).toHaveLength(1);
    expect(tenantWide.value[0]).toEqual(record);

    const again = await store.saveCapturedEvidence(record);
    expect(again.ok).toBe(true);
    expect(db.records).toHaveLength(1);
  });

  it("round-trips a lifecycle act through the append-only ledger", async () => {
    const db = new FakeEvidenceDb();
    const store = createEvidenceCaptureStore({ client: db });
    const act: LifecycleActInput = {
      targetEvidenceId: "ev-001",
      tenantId: TENANT,
      actKind: "promotion",
      actorId: "human-reviewer-1",
      act: { method: "human_review", validatedAt: NOW },
      actEvidenceId: null,
      recordedAt: NOW,
    };
    const row = lifecycleActToRow(act);
    expect(row.id).toBe(lifecycleActId(act));
    expect(row.id).toMatch(/^elact:[0-9a-f]{32}$/);
    expect(row.act).toBe(JSON.stringify(act.act));
    expect(rowToLifecycleAct(row as unknown as Record<string, unknown>)).toEqual(row);

    const saved = await store.saveLifecycleAct(act);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.value.id).toBe(row.id);

    const loaded = await store.loadLifecycleActs(TENANT, "ev-001");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value).toHaveLength(1);
    expect(loaded.value[0]).toEqual(row);
  });

  it("refuses tenant-less or id-less loads (evidence never crosses tenants)", async () => {
    const store = createEvidenceCaptureStore({ client: new FakeEvidenceDb() });
    const noTenant = await store.loadCapturedEvidence("  ", "ev-001");
    expect(noTenant.ok).toBe(false);
    if (!noTenant.ok) expect(noTenant.code).toBe("invalid_input");
    const noId = await store.loadCapturedEvidence(TENANT, "");
    expect(noId.ok).toBe(false);
    if (!noId.ok) expect(noId.code).toBe("invalid_input");
    const noTenantWide = await store.loadTenantEvidence("");
    expect(noTenantWide.ok).toBe(false);
    if (!noTenantWide.ok) expect(noTenantWide.code).toBe("invalid_input");
  });

  it("contains malformed DB rows as structured errors, never throws", async () => {
    const broken: EvidenceDbClient = {
      query: async () => ({ rows: [{ garbage: true }] }),
    };
    const store = createEvidenceCaptureStore({ client: broken });
    const loaded = await store.loadCapturedEvidence(TENANT, "ev-001");
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.code).toBe("invalid_input");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 2. Failure-policy semantics through the adapter (J-045)
 * ────────────────────────────────────────────────────────────*/

describe("evidence-capture substrate adapter — failure policy", () => {
  it("bounds a hung client with a timeout (deterministic clock)", async () => {
    const clockCtl = manualClock();
    const policy = createAdapterFailurePolicy({
      provider: "cg-substrate-evidence-test",
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
    const hung: EvidenceDbClient = {
      query: () => neverSettles<{ rows: readonly Record<string, unknown>[] }>(),
    };
    const store = createEvidenceCaptureStore({ client: hung, failurePolicy: policy });
    const pending = store.loadTenantEvidence(TENANT);
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
      provider: "cg-substrate-evidence-test",
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
    const failing: EvidenceDbClient = {
      // Synchronously throwing provider: the adapter's await wrapper still
      // yields an already-rejected call promise, so the deterministic race
      // resolves provider_error (not the timeout winner).
      query: () => {
        calls += 1;
        throw new Error("connection refused");
      },
    };
    const store = createEvidenceCaptureStore({ client: failing, failurePolicy: policy });
    const record = capturedFixture();
    const first = await store.loadTenantEvidence(TENANT);
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
    const second = await store.loadTenantEvidence(TENANT);
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe("breaker_open");
    const third = await store.saveCapturedEvidence(record);
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.code).toBe("breaker_open");
    expect(calls).toBe(2);
  });

  it("exposes the declared policy for observability (snapshot + trust ledger)", async () => {
    const db = new FakeEvidenceDb();
    const store = createEvidenceCaptureStore({ client: db });
    expect(store.policy.snapshot().provider).toBe("cg-substrate-evidence");
    expect(store.policy.currentTrustVerdict()).toBe("unproven");
    const recommendation = store.policy.recommendTrust();
    expect(recommendation.verdict).toBe("unproven");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 3. Migration / rollback integrity pinning
 * ────────────────────────────────────────────────────────────*/

describe("evidence-lifecycle migration 20261002000008 — authored integrity", () => {
  it("carries the AUTHORED, NOT APPLIED status and rollback pointer", () => {
    expect(MIGRATION).toContain("Status: AUTHORED, NOT APPLIED");
    expect(MIGRATION).toContain(
      "database/supabase/rollbacks/20261002000008_coregrid_v1_evidence_lifecycle.sql",
    );
    expect(ROLLBACK).toContain("Status: AUTHORED, NOT APPLIED");
  });

  it("authors both tables with deny-by-default RLS", () => {
    for (const table of [EVIDENCE_RECORD_TABLE, EVIDENCE_LIFECYCLE_ACT_TABLE]) {
      expect(MIGRATION).toContain(`CREATE TABLE IF NOT EXISTS public.${table} (`);
      expect(MIGRATION).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`);
      expect(MIGRATION).toContain(`REVOKE ALL ON public.${table} FROM anon, authenticated;`);
    }
  });

  it("authors ZERO RLS policies (no grant path exists yet)", () => {
    expect(MIGRATION).not.toContain("CREATE POLICY");
  });

  it("pins the tenant posture and the canonical envelope (no anonymous evidence)", () => {
    expect(MIGRATION).toContain(
      "tenant_id           text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 128)",
    );
    expect(MIGRATION).toContain(
      "ADD CONSTRAINT cg_evidence_record_object_type CHECK (object_type = 'core.evidence')",
    );
    expect(MIGRATION).toContain("cg_evidence_record_envelope_atomic");
    expect(MIGRATION).toContain("cg_evidence_record_envelope_causation_root");
    expect(MIGRATION).toContain("cg_evidence_record_envelope_format");
    expect(MIGRATION).toContain("created_by          text NOT NULL");
    expect(MIGRATION).toContain("updated_by          text NOT NULL");
  });

  it("pins the canonical-truth law, lifecycle FKs and posture CHECKs", () => {
    expect(MIGRATION).toContain("cg_evidence_record_canonical_truth");
    expect(MIGRATION).toContain(
      "canonical_truth_eligible = (evidence_class = 'direct_observation' AND revocation IS NULL)",
    );
    expect(MIGRATION).toContain("cg_evidence_record_supersedes_fk");
    expect(MIGRATION).toContain("cg_evidence_record_revokes_fk");
    expect(MIGRATION).toContain("REFERENCES public.cg_evidence_record (id, tenant_id)");
    expect(MIGRATION).toContain("ON DELETE RESTRICT");
    expect(MIGRATION).toContain("cg_evidence_record_no_self_supersede");
    expect(MIGRATION).toContain("cg_evidence_record_no_self_revoke");
    expect(MIGRATION).toContain("cg_evidence_record_revocation_pair");
    expect(MIGRATION).toContain("cg_evidence_record_promotion_posture");
    expect(MIGRATION).toContain("cg_evidence_record_validity_window");
    expect(MIGRATION).toContain("cg_evidence_lifecycle_act_target_fk");
    expect(MIGRATION).toContain("act_kind            text NOT NULL CHECK (act_kind IN");
  });

  it("rollback reverses the DDL in reverse dependency order", () => {
    const actDrop = ROLLBACK.indexOf(
      "DROP TABLE IF EXISTS public.cg_evidence_lifecycle_act",
    );
    const recordDrop = ROLLBACK.indexOf(
      "DROP TABLE IF EXISTS public.cg_evidence_record",
    );
    expect(actDrop).toBeGreaterThan(-1);
    expect(recordDrop).toBeGreaterThan(actDrop);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 4. LIVE-gated connectivity probe (skips without credentials)
 * ────────────────────────────────────────────────────────────*/

const LIVE_ENABLED = Boolean(process.env.DATABASE_URL);

describe.skipIf(!LIVE_ENABLED)(
  "live: evidence-capture substrate connectivity probe (authored, NOT applied)",
  () => {
    it(
      "connects through scripts/lib/pg-connect.mjs and answers SELECT 1 — never touching cg_evidence_*",
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
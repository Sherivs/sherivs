/**
 * Team 1 (batch A) — substrate persistence tests for the per-event security
 * contract (V1CAP-044 / J-022 / MISSION-R-81).
 *
 * Covers: contract<->row round-trip mapping (security contract, denial audit,
 * redaction audit), failure-policy semantics exercised through the adapter
 * (bounded timeout, breaker, degraded mode — deterministic AdapterClock),
 * migration/rollback file integrity pinning for 20261002000006, and a
 * LIVE-GATED connectivity probe (skips cleanly without DATABASE_URL; never
 * touches the authored cg_event_security* tables — the migration is AUTHORED,
 * NOT APPLIED).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createEventSecurityStore,
  EVENT_SECURITY_DENIAL_TABLE,
  EVENT_SECURITY_REDACTION_TABLE,
  EVENT_SECURITY_TABLE,
  denialToRow,
  eventRefOf,
  redactionToRow,
  rowToEventSecurity,
  securityToRow,
  type EventSecurityDbClient,
} from "../../frontend/src/lib/adapters/event-security-store.adapter";
import {
  createAdapterFailurePolicy,
  type AdapterClock,
  type AdapterPolicyEvent,
} from "../../frontend/src/lib/adapters/failure-policy";
import {
  deliverEvent,
  secureEvent,
  type EventConsumptionCandidate,
  type EventDenialRecord,
  type EventSubscriber,
} from "../../frontend/src/lib/kernel/event-security";
import type { KernelEventRecord } from "../../frontend/src/lib/kernel/event-semantics";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MIGRATION = readFileSync(
  join(ROOT, "database/supabase/migrations/20261002000006_coregrid_v1_event_security.sql"),
  "utf8",
);
const ROLLBACK = readFileSync(
  join(ROOT, "database/supabase/rollbacks/20261002000006_coregrid_v1_event_security.sql"),
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

/* ── fixtures built through the pure contract ── */

const BASE_MS = Date.parse("2026-10-01T00:00:00.000Z");
const NOW = new Date(BASE_MS + 60_000).toISOString();
const iso = (ms: number) => new Date(ms).toISOString();

let nextEventId = 0;

function makeEvent(overrides: Partial<KernelEventRecord> = {}): KernelEventRecord {
  nextEventId += 1;
  const atMs = BASE_MS + nextEventId;
  return {
    id: `evt-${nextEventId}`,
    event_type: "core.state.changed",
    tenant_id: "tenant-1",
    aggregate_type: "core.aggregate",
    aggregate_id: "aggregate-1",
    payload: { state: "on" },
    occurred_at: iso(atMs),
    recorded_at: iso(atMs),
    sequence: nextEventId,
    issuer: "time-authority:clock:fixed",
    causation_id: `cause-root-${nextEventId}`,
    ...overrides,
  };
}

interface SecureOverrides {
  issuerId?: string;
  visibility?: "public" | "tenant" | "restricted" | "direct-observation";
  emissionAuthority?: string;
  sensitivity?: "public" | "internal" | "restricted";
  subjectRefs?: string[];
  redactableFields?: string[];
  evidenceClass?: "observed" | "reported" | "inferred" | "predicted" | "simulated";
  source?: string;
  previousDigest?: string | null;
}

function secure(overrides: SecureOverrides = {}, event: KernelEventRecord = makeEvent()) {
  return secureEvent({
    event,
    issuerId: overrides.issuerId ?? "agent:fixture-emitter",
    visibility: overrides.visibility ?? "tenant",
    emissionAuthority: overrides.emissionAuthority ?? "policy:event.emit",
    sensitivity: overrides.sensitivity ?? "internal",
    subjectRefs: overrides.subjectRefs ?? [],
    redactableFields: overrides.redactableFields ?? [],
    evidenceClass: overrides.evidenceClass ?? "observed",
    source: overrides.source ?? "fixture:source",
    previousDigest: overrides.previousDigest ?? null,
  });
}

const subscriber: EventSubscriber = {
  subscriberId: "subscriber-1",
  tenantId: "tenant-1",
  visibilityScopes: ["public", "tenant"],
  maxSensitivity: "internal",
};

function securedFixture() {
  return secure({ subjectRefs: ["person-1"], redactableFields: ["state"] });
}

/** In-memory client: INSERTs capture rows, SELECTs replay them verbatim. */
class FakeEventSecurityDb implements EventSecurityDbClient {
  readonly contracts: Record<string, unknown>[] = [];
  readonly denials: Record<string, unknown>[] = [];
  readonly redactions: Record<string, unknown>[] = [];
  calls = 0;

  async query(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<{ rows: readonly Record<string, unknown>[] }> {
    this.calls += 1;
    // Longest table names first: cg_event_security is a prefix of the audit
    // tables, so the audit branches must match before the contract branch.
    if (text.includes(`INSERT INTO public.${EVENT_SECURITY_REDACTION_TABLE}`)) {
      this.redactions.push(zipRow(REDACTION_COLUMNS, values));
      return { rows: [] };
    }
    if (text.includes(`INSERT INTO public.${EVENT_SECURITY_DENIAL_TABLE}`)) {
      this.denials.push(zipRow(DENIAL_COLUMNS, values));
      return { rows: [] };
    }
    if (text.includes(`INSERT INTO public.${EVENT_SECURITY_TABLE}`)) {
      this.contracts.push(zipRow(EVENT_SECURITY_ROW_COLUMNS, values));
      return { rows: [] };
    }
    if (text.includes(`FROM public.${EVENT_SECURITY_REDACTION_TABLE}`)) {
      const rows = this.redactions
        .filter((row) => row.tenant_id === values[0])
        .slice()
        .sort((a, b) => String(b.recorded_at).localeCompare(String(a.recorded_at)));
      return { rows };
    }
    if (text.includes(`FROM public.${EVENT_SECURITY_DENIAL_TABLE}`)) {
      const scoped = values[0] == null || values[0] === "" ? null : values[0];
      const rows = this.denials
        .filter((row) => scoped === null || row.tenant_id === scoped)
        .slice()
        .sort((a, b) => String(b.recorded_at).localeCompare(String(a.recorded_at)));
      return { rows };
    }
    if (text.includes(`FROM public.${EVENT_SECURITY_TABLE}`)) {
      return {
        rows: this.contracts.filter(
          (row) => row.tenant_id === values[0] && row.event_ref === values[1],
        ),
      };
    }
    return { rows: [] };
  }
}

const EVENT_SECURITY_ROW_COLUMNS = [
  "id",
  "tenant_id",
  "event_ref",
  "issuer_id",
  "issuance_at",
  "issuance_at_ms",
  "issuance_sequence",
  "issuance_issuer",
  "digest",
  "previous_digest",
  "visibility",
  "emission_authority",
  "sensitivity",
  "subject_refs",
  "redactable_fields",
  "evidence_class",
  "source",
  "recorded_at",
];

const DENIAL_COLUMNS = [
  "id",
  "tenant_id",
  "event_ref",
  "subscriber_id",
  "reason",
  "detail",
  "recorded_at",
];

const REDACTION_COLUMNS = [
  "id",
  "tenant_id",
  "event_ref",
  "subscriber_id",
  "reason",
  "withheld_fields",
  "withheld_subject_refs",
  "detail",
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

/* ─────────────────────────────────────────────────────────────
 * 1. Round-trip: contract -> row -> contract view
 * ────────────────────────────────────────────────────────────*/

describe("event-security substrate adapter — round-trip mapping", () => {
  it("maps a secured event onto the substrate row and back", () => {
    const secured = securedFixture();
    const row = securityToRow(secured, NOW);
    expect(row.id).toBe(`esec:${secured.security.authenticity.digest}`);
    expect(row.tenant_id).toBe("tenant-1");
    expect(row.event_ref).toBe(eventRefOf(secured.event));
    expect(row.digest).toMatch(/^[0-9a-f]{64}$/);
    expect(row.previous_digest).toBeNull();
    expect(row.subject_refs).toBe(JSON.stringify(["person-1"]));
    expect(row.redactable_fields).toBe(JSON.stringify(["state"]));
    expect(row.visibility).toBe("tenant");
    expect(row.sensitivity).toBe("internal");
    expect(row.evidence_class).toBe("observed");
    expect(row.recorded_at).toBe(NOW);

    const restored = rowToEventSecurity(row as unknown as Record<string, unknown>);
    expect(restored.tenant_id).toBe("tenant-1");
    expect(restored.event_ref).toBe(eventRefOf(secured.event));
    expect(restored.issuer_id).toBe("agent:fixture-emitter");
    expect(restored.issuance).toEqual(secured.security.authenticity.issuance);
    expect(restored.digest).toBe(secured.security.authenticity.digest);
    expect(restored.visibility).toBe("tenant");
    expect(restored.emission_authority).toBe("policy:event.emit");
    expect(restored.sensitivity).toBe("internal");
    expect(restored.subject_refs).toEqual(["person-1"]);
    expect(restored.redactable_fields).toEqual(["state"]);
    expect(restored.evidence_class).toBe("observed");
    expect(restored.source).toBe("fixture:source");
    expect(restored.recorded_at).toBe(NOW);
  });

  it("persists through the adapter and reloads the identical contract", async () => {
    const db = new FakeEventSecurityDb();
    const store = createEventSecurityStore({ client: db });
    const secured = securedFixture();
    const saved = await store.saveEventSecurity({ secured, recordedAt: NOW });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.value.id).toBe(`esec:${secured.security.authenticity.digest}`);
    expect(saved.value.event_ref).toBe(eventRefOf(secured.event));
    expect(saved.attempts).toBe(1);

    const loaded = await store.loadEventSecurity("tenant-1", eventRefOf(secured.event));
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value).not.toBeNull();
    if (loaded.value == null) return;
    expect(loaded.value.digest).toBe(secured.security.authenticity.digest);
    expect(loaded.value.subject_refs).toEqual(["person-1"]);
  });

  it("refuses to persist a tenant-less event (tenancy boundary, fail-closed)", async () => {
    const db = new FakeEventSecurityDb();
    const store = createEventSecurityStore({ client: db });
    const anonymous = secure({}, makeEvent({ tenant_id: null }));
    const saved = await store.saveEventSecurity({ secured: anonymous, recordedAt: NOW });
    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.code).toBe("tenant_required");
    expect(saved.reason).toContain("tenancy boundary");
    expect(db.calls).toBe(0);
  });

  it("persists gate denial audit rows with deterministic ids", async () => {
    const db = new FakeEventSecurityDb();
    const store = createEventSecurityStore({ client: db });
    const candidate: EventConsumptionCandidate = { event: makeEvent(), security: null };
    const delivery = deliverEvent(candidate, subscriber, { now: NOW });
    expect(delivery.decision).toBe("DENY");
    expect(delivery.denial).not.toBeNull();
    if (delivery.denial == null) return;

    const denial: EventDenialRecord = delivery.denial;
    const row = denialToRow(denial);
    expect(row.id).toMatch(/^eden:[0-9a-f]{32}$/);
    expect(row.tenant_id).toBe("tenant-1");
    expect(row.event_ref).toBe(denial.eventId);
    expect(row.subscriber_id).toBe("subscriber-1");
    expect(row.reason).toBe("missing_security_contract");
    expect(row.recorded_at).toBe(NOW);

    const saved = await store.saveEventSecurityDenial(denial);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.value.id).toBe(row.id);

    const loaded = await store.loadDenials("tenant-1");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value).toHaveLength(1);
    expect(loaded.value[0].reason).toBe("missing_security_contract");
  });

  it("persists gate redaction audit rows naming the withheld privacy content", async () => {
    const db = new FakeEventSecurityDb();
    const store = createEventSecurityStore({ client: db });
    const secured = secure({
      sensitivity: "restricted",
      subjectRefs: ["person-1"],
      redactableFields: ["state"],
    });
    const delivery = deliverEvent(
      { event: secured.event, security: secured.security },
      { ...subscriber, maxSensitivity: "internal" },
      { now: NOW },
    );
    expect(delivery.decision).toBe("REDACT");
    expect(delivery.redactions).toHaveLength(1);
    const redaction = delivery.redactions[0];
    expect(redaction.withheldFields).toEqual(["state"]);
    expect(redaction.withheldSubjectRefs).toEqual(["person-1"]);

    const row = redactionToRow(redaction, "tenant-1");
    expect(row.id).toMatch(/^ered:[0-9a-f]{32}$/);
    expect(row.tenant_id).toBe("tenant-1");
    expect(row.reason).toBe("sensitivity_above_ceiling");
    expect(row.withheld_fields).toBe(JSON.stringify(["state"]));
    expect(row.withheld_subject_refs).toBe(JSON.stringify(["person-1"]));

    const saved = await store.saveEventSecurityRedaction({ redaction, tenantId: "tenant-1" });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.value.id).toBe(row.id);

    const loaded = await store.loadRedactions("tenant-1");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value).toHaveLength(1);
    expect(loaded.value[0].withheld_fields).toBe(JSON.stringify(["state"]));
  });

  it("refuses tenant-less redaction audit (redaction audit is tenant-bound)", async () => {
    const store = createEventSecurityStore({ client: new FakeEventSecurityDb() });
    const secured = secure({ sensitivity: "restricted", redactableFields: ["state"] });
    const delivery = deliverEvent(
      { event: secured.event, security: secured.security },
      { ...subscriber, maxSensitivity: "internal" },
      { now: NOW },
    );
    expect(delivery.decision).toBe("REDACT");
    const saved = await store.saveEventSecurityRedaction({
      redaction: delivery.redactions[0],
      tenantId: "   ",
    });
    expect(saved.ok).toBe(false);
    if (saved.ok) return;
    expect(saved.code).toBe("invalid_input");
  });

  it("contains malformed DB rows as structured errors, never throws", async () => {
    const broken: EventSecurityDbClient = {
      query: async () => ({ rows: [{ garbage: true }] }),
    };
    const store = createEventSecurityStore({ client: broken });
    const loaded = await store.loadEventSecurity("tenant-1", "evt-1");
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.code).toBe("invalid_input");
  });

  it("refuses tenant-less or ref-less loads", async () => {
    const store = createEventSecurityStore({ client: new FakeEventSecurityDb() });
    const noTenant = await store.loadEventSecurity("  ", "evt-1");
    expect(noTenant.ok).toBe(false);
    if (!noTenant.ok) expect(noTenant.code).toBe("invalid_input");
    const noRef = await store.loadEventSecurity("tenant-1", "");
    expect(noRef.ok).toBe(false);
    if (!noRef.ok) expect(noRef.code).toBe("invalid_input");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 2. Failure-policy semantics through the adapter (J-045)
 * ────────────────────────────────────────────────────────────*/

describe("event-security substrate adapter — failure policy", () => {
  it("bounds a hung client with a timeout (deterministic clock)", async () => {
    const clockCtl = manualClock();
    const policy = createAdapterFailurePolicy({
      provider: "cg-substrate-event-security-test",
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
    const hung: EventSecurityDbClient = {
      query: () => neverSettles<{ rows: readonly Record<string, unknown>[] }>(),
    };
    const store = createEventSecurityStore({ client: hung, failurePolicy: policy });
    const pending = store.loadDenials("tenant-1");
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
      provider: "cg-substrate-event-security-test",
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
    const failing: EventSecurityDbClient = {
      // Synchronously throwing provider: the adapter's await wrapper still
      // yields an already-rejected call promise, so the deterministic race
      // resolves provider_error (not the timeout winner).
      query: () => {
        calls += 1;
        throw new Error("connection refused");
      },
    };
    const store = createEventSecurityStore({ client: failing, failurePolicy: policy });
    const secured = securedFixture();
    const first = await store.loadDenials("tenant-1");
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
    const second = await store.loadDenials("tenant-1");
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe("breaker_open");
    const third = await store.saveEventSecurity({ secured, recordedAt: NOW });
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.code).toBe("breaker_open");
    expect(calls).toBe(2);
  });

  it("exposes the declared policy for observability (snapshot + trust ledger)", async () => {
    const db = new FakeEventSecurityDb();
    const store = createEventSecurityStore({ client: db });
    expect(store.policy.snapshot().provider).toBe("cg-substrate-event-security");
    expect(store.policy.currentTrustVerdict()).toBe("unproven");
    const recommendation = store.policy.recommendTrust();
    expect(recommendation.verdict).toBe("unproven");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 3. Migration / rollback integrity pinning
 * ────────────────────────────────────────────────────────────*/

describe("event-security migration 20261002000006 — authored integrity", () => {
  it("carries the AUTHORED, NOT APPLIED status and rollback pointer", () => {
    expect(MIGRATION).toContain("Status: AUTHORED, NOT APPLIED");
    expect(MIGRATION).toContain(
      "database/supabase/rollbacks/20261002000006_coregrid_v1_event_security.sql",
    );
    expect(ROLLBACK).toContain("Status: AUTHORED, NOT APPLIED");
  });

  it("authors all three tables with deny-by-default RLS", () => {
    for (const table of [EVENT_SECURITY_TABLE, EVENT_SECURITY_DENIAL_TABLE, EVENT_SECURITY_REDACTION_TABLE]) {
      expect(MIGRATION).toContain(`CREATE TABLE IF NOT EXISTS public.${table} (`);
      expect(MIGRATION).toContain(`ALTER TABLE public.${table} ENABLE ROW LEVEL SECURITY;`);
      expect(MIGRATION).toContain(`REVOKE ALL ON public.${table} FROM anon, authenticated;`);
    }
  });

  it("authors ZERO RLS policies (no grant path exists yet)", () => {
    expect(MIGRATION).not.toContain("CREATE POLICY");
  });

  it("pins the tenant posture and per-table integrity constraints", () => {
    expect(MIGRATION).toContain(
      "tenant_id           text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 128)",
    );
    expect(MIGRATION).toContain("UNIQUE (tenant_id, event_ref)");
    expect(MIGRATION).toContain("digest              text NOT NULL CHECK (digest ~ '^[0-9a-f]{64}$')");
    expect(MIGRATION).toContain(
      "previous_digest     text CHECK (previous_digest IS NULL OR previous_digest ~ '^[0-9a-f]{64}$')",
    );
    expect(MIGRATION).toContain("cg_event_security_observation_scope");
    expect(MIGRATION).toContain("visibility <> 'direct-observation' OR evidence_class = 'observed'");
    expect(MIGRATION).toContain(
      "reason                  text NOT NULL CHECK (reason = 'sensitivity_above_ceiling')",
    );
  });

  it("rollback reverses the DDL in reverse dependency order", () => {
    // Trailing semicolons: cg_event_security is a prefix of the audit tables.
    const redactionDrop = ROLLBACK.indexOf(
      "DROP TABLE IF EXISTS public.cg_event_security_redaction;",
    );
    const denialDrop = ROLLBACK.indexOf(
      "DROP TABLE IF EXISTS public.cg_event_security_denial;",
    );
    const securityDrop = ROLLBACK.indexOf(
      "DROP TABLE IF EXISTS public.cg_event_security;",
    );
    expect(redactionDrop).toBeGreaterThan(-1);
    expect(denialDrop).toBeGreaterThan(redactionDrop);
    expect(securityDrop).toBeGreaterThan(denialDrop);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 4. LIVE-gated connectivity probe (skips without credentials)
 * ────────────────────────────────────────────────────────────*/

const LIVE_ENABLED = Boolean(process.env.DATABASE_URL);

describe.skipIf(!LIVE_ENABLED)(
  "live: event-security substrate connectivity probe (authored, NOT applied)",
  () => {
    it(
      "connects through scripts/lib/pg-connect.mjs and answers SELECT 1 — never touching cg_event_security*",
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
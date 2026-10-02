/**
 * Team 1 (batch A) — substrate persistence tests for the event routing
 * contract (V1CAP-043 / J-021 / MISSION-R-63).
 *
 * Covers: declaration<->row round-trip mapping, the declaration-immutability
 * law exercised through the adapter (identical re-declaration no-op,
 * conflict refusal, suspension lift), queue/cursor/outcome persistence,
 * failure-policy semantics through the adapter (bounded timeout, breaker —
 * deterministic AdapterClock), migration/rollback file integrity pinning for
 * 20261002000007, and a LIVE-GATED connectivity probe (skips cleanly without
 * DATABASE_URL; never touches the authored cg_event_route_* tables — the
 * migration is AUTHORED, NOT APPLIED).
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  createEventRoutingStore,
  declarationFingerprint,
  EVENT_ROUTE_CURSOR_TABLE,
  EVENT_ROUTE_OUTCOME_TABLE,
  EVENT_ROUTE_QUEUE_TABLE,
  EVENT_ROUTE_SUBSCRIPTION_TABLE,
  queueEntryToRow,
  rowToCursor,
  rowToSubscription,
  subscriptionToRow,
  type EventRoutingDbClient,
} from "../../frontend/src/lib/adapters/event-routing-store.adapter";
import {
  createAdapterFailurePolicy,
  type AdapterClock,
  type AdapterPolicyEvent,
} from "../../frontend/src/lib/adapters/failure-policy";
import {
  EventRouter,
  type EventRouteOutcome,
  type EventRoutingResult,
  type EventSubscription,
} from "../../frontend/src/lib/kernel/event-routing";
import {
  secureEvent,
  type EventConsumptionCandidate,
} from "../../frontend/src/lib/kernel/event-security";
import { eventDedupDigest, type KernelEventRecord } from "../../frontend/src/lib/kernel/event-semantics";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const MIGRATION = readFileSync(
  join(ROOT, "database/supabase/migrations/20261002000007_coregrid_v1_event_routing.sql"),
  "utf8",
);
const ROLLBACK = readFileSync(
  join(ROOT, "database/supabase/rollbacks/20261002000007_coregrid_v1_event_routing.sql"),
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
const TENANT = "tenant-1";

let nextEventId = 0;

function makeEvent(overrides: Partial<KernelEventRecord> = {}): KernelEventRecord {
  nextEventId += 1;
  const atMs = BASE_MS + nextEventId;
  return {
    id: `evt-${nextEventId}`,
    event_type: "core.state.changed",
    tenant_id: TENANT,
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

function securedCandidate(overrides: Partial<KernelEventRecord> = {}): EventConsumptionCandidate {
  const event = makeEvent(overrides);
  const secured = secureEvent({
    event,
    issuerId: "agent:fixture-emitter",
    visibility: "tenant",
    emissionAuthority: "policy:event.emit",
    sensitivity: "internal",
    subjectRefs: ["person-1"],
    redactableFields: ["state"],
    evidenceClass: "observed",
    source: "fixture:source",
    previousDigest: null,
  });
  return { event: secured.event, security: secured.security };
}

function declaration(overrides: Partial<EventSubscription> = {}): EventSubscription {
  return {
    subscriptionId: "sub-1",
    subscriberId: "subscriber-1",
    tenantId: TENANT,
    eventTypes: [],
    visibilityScopes: ["tenant"],
    maxSensitivity: "internal",
    delivery: { ordering: "tenant-total-order", dedup: "collapse-duplicates", maxUndelivered: 2 },
    ...overrides,
  };
}

/** Route one event to one subscription through the pure router. */
function routedResult(sub: EventSubscription, candidate: EventConsumptionCandidate): EventRoutingResult {
  const router = new EventRouter();
  router.subscribe(sub);
  return router.routeEvent(candidate, { now: NOW });
}

function firstQueuedOutcome(result: EventRoutingResult): EventRouteOutcome {
  const outcome = result.outcomes.find((entry) => entry.kind === "queued");
  if (outcome == null) throw new Error("fixture produced no queued outcome");
  return outcome;
}

/* ── column orders mirror the adapter's INSERT statements ── */

const SUBSCRIPTION_COLUMNS = [
  "id",
  "tenant_id",
  "subscriber_id",
  "event_types",
  "visibility_scopes",
  "max_sensitivity",
  "ordering",
  "dedup",
  "max_undelivered",
  "status",
  "declared_at",
];

const QUEUE_COLUMNS = [
  "subscription_id",
  "tenant_id",
  "event_digest",
  "event_ref",
  "delivery_decision",
  "delivery",
  "enqueued_at",
];

const CURSOR_COLUMNS = [
  "subscription_id",
  "tenant_id",
  "last_event_ref",
  "delivered_count",
  "updated_at",
];

const OUTCOME_COLUMNS = [
  "id",
  "tenant_id",
  "subscription_id",
  "subscriber_id",
  "event_ref",
  "kind",
  "denial_reason",
  "delivery",
  "backpressure",
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

/** In-memory client: INSERTs capture rows, SELECTs/UPDATEs replay them. */
class FakeEventRoutingDb implements EventRoutingDbClient {
  readonly subscriptions: Record<string, unknown>[] = [];
  readonly queue: Record<string, unknown>[] = [];
  readonly cursors: Record<string, unknown>[] = [];
  readonly outcomes: Record<string, unknown>[] = [];
  calls = 0;

  async query(
    text: string,
    values: readonly unknown[] = [],
  ): Promise<{ rows: readonly Record<string, unknown>[]; rowCount?: number | null }> {
    this.calls += 1;
    if (text.includes(`INSERT INTO public.${EVENT_ROUTE_SUBSCRIPTION_TABLE}`)) {
      this.subscriptions.push(zipRow(SUBSCRIPTION_COLUMNS, values));
      return { rows: [] };
    }
    if (text.includes(`UPDATE public.${EVENT_ROUTE_SUBSCRIPTION_TABLE}`)) {
      const row = this.subscriptions.find(
        (entry) => entry.id === values[0] && entry.tenant_id === values[1],
      );
      if (row != null && row.status === "suspended") {
        row.status = "active";
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
    if (text.includes(`FROM public.${EVENT_ROUTE_SUBSCRIPTION_TABLE}`)) {
      return {
        rows: this.subscriptions.filter(
          (entry) => entry.id === values[0] && entry.tenant_id === values[1],
        ),
      };
    }
    if (text.includes(`INSERT INTO public.${EVENT_ROUTE_QUEUE_TABLE}`)) {
      const row = zipRow(QUEUE_COLUMNS, values);
      row.state = "pending";
      this.queue.push(row);
      return { rows: [] };
    }
    if (text.includes(`UPDATE public.${EVENT_ROUTE_QUEUE_TABLE}`)) {
      const row = this.queue.find(
        (entry) =>
          entry.subscription_id === values[0] &&
          entry.tenant_id === values[1] &&
          entry.event_digest === values[3] &&
          entry.state === "pending",
      );
      if (row != null) {
        row.state = "delivered";
        return { rows: [], rowCount: 1 };
      }
      return { rows: [], rowCount: 0 };
    }
    if (text.includes(`FROM public.${EVENT_ROUTE_QUEUE_TABLE}`)) {
      return { rows: this.queue.slice() };
    }
    if (text.includes(`INSERT INTO public.${EVENT_ROUTE_CURSOR_TABLE}`)) {
      const row = zipRow(CURSOR_COLUMNS, values);
      const existingIndex = this.cursors.findIndex(
        (entry) => entry.subscription_id === row.subscription_id,
      );
      if (existingIndex >= 0) this.cursors[existingIndex] = row;
      else this.cursors.push(row);
      return { rows: [] };
    }
    if (text.includes(`FROM public.${EVENT_ROUTE_CURSOR_TABLE}`)) {
      return {
        rows: this.cursors.filter(
          (entry) =>
            entry.subscription_id === values[0] && entry.tenant_id === values[1],
        ),
      };
    }
    if (text.includes(`INSERT INTO public.${EVENT_ROUTE_OUTCOME_TABLE}`)) {
      this.outcomes.push(zipRow(OUTCOME_COLUMNS, values));
      return { rows: [] };
    }
    if (text.includes(`FROM public.${EVENT_ROUTE_OUTCOME_TABLE}`)) {
      const rows = this.outcomes
        .filter((entry) => entry.subscription_id === values[0])
        .slice()
        .sort((a, b) => String(b.recorded_at).localeCompare(String(a.recorded_at)));
      return { rows };
    }
    return { rows: [] };
  }
}

/* ─────────────────────────────────────────────────────────────
 * 1. Round-trip: contract -> row -> contract view
 * ────────────────────────────────────────────────────────────*/

describe("event-routing substrate adapter — round-trip mapping", () => {
  it("maps a declaration onto the substrate row and back", () => {
    const sub = declaration();
    const row = subscriptionToRow(sub, NOW);
    expect(row.id).toBe("sub-1");
    expect(row.tenant_id).toBe(TENANT);
    expect(row.event_types).toBe("[]");
    expect(row.visibility_scopes).toBe(JSON.stringify(["tenant"]));
    expect(row.max_sensitivity).toBe("internal");
    expect(row.ordering).toBe("tenant-total-order");
    expect(row.dedup).toBe("collapse-duplicates");
    expect(row.max_undelivered).toBe(2);
    expect(row.status).toBe("active");
    expect(row.declared_at).toBe(NOW);

    const restored = rowToSubscription(row as unknown as Record<string, unknown>);
    expect(restored.subscriptionId).toBe("sub-1");
    expect(restored.subscriberId).toBe("subscriber-1");
    expect(restored.tenantId).toBe(TENANT);
    expect(restored.eventTypes).toEqual([]);
    expect(restored.visibilityScopes).toEqual(["tenant"]);
    expect(restored.maxSensitivity).toBe("internal");
    expect(restored.delivery.ordering).toBe("tenant-total-order");
    expect(restored.delivery.dedup).toBe("collapse-duplicates");
    expect(restored.delivery.maxUndelivered).toBe(2);
    expect(restored.status).toBe("active");
    expect(restored.declaredAt).toBe(NOW);
  });

  it("fingerprints identical declarations identically and different ones differently", () => {
    const sub = declaration();
    expect(declarationFingerprint(sub)).toBe(declarationFingerprint(declaration()));
    expect(declarationFingerprint(sub)).not.toBe(
      declarationFingerprint(declaration({ maxSensitivity: "restricted" })),
    );
  });

  it("maps a gated queue entry onto the substrate row (DENY is never enqueued)", () => {
    const candidate = securedCandidate();
    const result = routedResult(declaration(), candidate);
    const outcome = firstQueuedOutcome(result);
    expect(outcome.delivery).not.toBeNull();
    if (outcome.delivery == null) return;
    const row = queueEntryToRow({
      subscriptionId: "sub-1",
      tenantId: TENANT,
      event: candidate.event,
      delivery: outcome.delivery,
      recordedAt: NOW,
    });
    expect(row.subscription_id).toBe("sub-1");
    expect(row.tenant_id).toBe(TENANT);
    expect(row.event_digest).toBe(eventDedupDigest(candidate.event));
    expect(row.event_ref).toBe("evt-1");
    expect(row.delivery_decision).toBe("ALLOW");
    expect(JSON.parse(row.delivery)).toEqual(outcome.delivery);
    expect(row.enqueued_at).toBe(NOW);

    expect(() =>
      queueEntryToRow({
        subscriptionId: "sub-1",
        tenantId: TENANT,
        event: candidate.event,
        delivery: { decision: "DENY", event: null, security: null, denial: null, redactions: [] },
        recordedAt: NOW,
      }),
    ).toThrow(/never enqueued/);
  });

  it("maps the delivery cursor onto the substrate row and back", () => {
    const row = {
      subscription_id: "sub-1",
      tenant_id: TENANT,
      last_event_ref: "evt-1",
      delivered_count: 3,
      updated_at: NOW,
    };
    const restored = rowToCursor(row);
    expect(restored).toEqual({
      subscriptionId: "sub-1",
      tenantId: TENANT,
      lastEventRef: "evt-1",
      deliveredCount: 3,
      updatedAt: NOW,
    });
  });

  it("refuses a non-instant declaredAt (fail-closed)", () => {
    expect(() => subscriptionToRow(declaration(), "not-an-instant")).toThrow(/declaredAt/);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 2. Adapter flows: subscription immutability, queue, cursor, outcomes
 * ────────────────────────────────────────────────────────────*/

describe("event-routing substrate adapter — persistence flows", () => {
  it("persists a declaration, refuses a conflicting one, and lifts suspension on identical re-declaration", async () => {
    const db = new FakeEventRoutingDb();
    const store = createEventRoutingStore({ client: db });
    const sub = declaration();

    const first = await store.saveSubscription({ declaration: sub, declaredAt: NOW });
    expect(first.ok).toBe(true);
    if (first.ok) {
      expect(first.value.status).toBe("active");
      expect(first.value.resumedFromSuspension).toBe(false);
    }
    expect(db.subscriptions).toHaveLength(1);

    const identical = await store.saveSubscription({ declaration: sub, declaredAt: NOW });
    expect(identical.ok).toBe(true);
    if (identical.ok) expect(identical.value.resumedFromSuspension).toBe(false);
    expect(db.subscriptions).toHaveLength(1);

    const conflicting = await store.saveSubscription({
      declaration: declaration({ maxSensitivity: "restricted" }),
      declaredAt: NOW,
    });
    expect(conflicting.ok).toBe(false);
    if (!conflicting.ok) {
      expect(conflicting.code).toBe("declaration_conflict");
      expect(conflicting.reason).toContain("immutable");
    }

    const suspended = db.subscriptions[0];
    suspended.status = "suspended";
    const resumed = await store.saveSubscription({ declaration: sub, declaredAt: NOW });
    expect(resumed.ok).toBe(true);
    if (resumed.ok) expect(resumed.value.resumedFromSuspension).toBe(true);
    expect(suspended.status).toBe("active");

    const loaded = await store.loadSubscription("sub-1", TENANT);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value?.subscriptionId).toBe("sub-1");
    expect(loaded.value?.status).toBe("active");
  });

  it("queues a gated delivery, marks it delivered exactly once, and persists the cursor", async () => {
    const db = new FakeEventRoutingDb();
    const store = createEventRoutingStore({ client: db });
    const candidate = securedCandidate();
    const result = routedResult(declaration(), candidate);
    const outcome = firstQueuedOutcome(result);
    if (outcome.delivery == null) return;
    const digest = eventDedupDigest(candidate.event);

    const saved = await store.saveQueueEntry({
      subscriptionId: "sub-1",
      tenantId: TENANT,
      event: candidate.event,
      delivery: outcome.delivery,
      recordedAt: NOW,
    });
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.value.eventDigest).toBe(digest);
    expect(db.queue).toHaveLength(1);
    expect(db.queue[0].state).toBe("pending");

    const marked = await store.markDelivered({
      subscriptionId: "sub-1",
      tenantId: TENANT,
      eventDigest: digest,
      deliveredAt: NOW,
    });
    expect(marked.ok).toBe(true);
    if (marked.ok) expect(marked.value.delivered).toBe(true);
    expect(db.queue[0].state).toBe("delivered");

    const markedAgain = await store.markDelivered({
      subscriptionId: "sub-1",
      tenantId: TENANT,
      eventDigest: digest,
      deliveredAt: NOW,
    });
    expect(markedAgain.ok).toBe(true);
    if (markedAgain.ok) expect(markedAgain.value.delivered).toBe(false);

    const cursor = await store.saveCursor({
      subscriptionId: "sub-1",
      tenantId: TENANT,
      lastEventRef: "evt-1",
      deliveredCount: 1,
      updatedAt: NOW,
    });
    expect(cursor.ok).toBe(true);
    if (!cursor.ok) return;
    expect(cursor.value.delivered_count).toBe(1);

    const loaded = await store.loadCursor("sub-1", TENANT);
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value).toEqual({
      subscriptionId: "sub-1",
      tenantId: TENANT,
      lastEventRef: "evt-1",
      deliveredCount: 1,
      updatedAt: NOW,
    });
  });

  it("persists the routing outcome audit (append-only, FK-free) and reloads it", async () => {
    const db = new FakeEventRoutingDb();
    const store = createEventRoutingStore({ client: db });
    const result = routedResult(declaration(), securedCandidate());
    expect(result.outcomes).toHaveLength(1);

    const saved = await store.saveOutcomes(result);
    expect(saved.ok).toBe(true);
    if (!saved.ok) return;
    expect(saved.value.outcomes).toBe(1);
    expect(db.outcomes).toHaveLength(1);
    expect(db.outcomes[0].id).toMatch(/^eout:[0-9a-f]{32}$/);
    expect(db.outcomes[0].kind).toBe("queued");
    expect(db.outcomes[0].tenant_id).toBeNull();
    expect(JSON.parse(String(db.outcomes[0].delivery))).toEqual(firstQueuedOutcome(result).delivery);

    const loaded = await store.loadOutcomes("sub-1");
    expect(loaded.ok).toBe(true);
    if (!loaded.ok) return;
    expect(loaded.value).toHaveLength(1);
    expect(loaded.value[0].kind).toBe("queued");
  });

  it("refuses tenant-less or id-less loads", async () => {
    const store = createEventRoutingStore({ client: new FakeEventRoutingDb() });
    const noId = await store.loadSubscription("  ", TENANT);
    expect(noId.ok).toBe(false);
    if (!noId.ok) expect(noId.code).toBe("invalid_input");
    const noTenant = await store.loadSubscription("sub-1", "");
    expect(noTenant.ok).toBe(false);
    if (!noTenant.ok) expect(noTenant.code).toBe("invalid_input");
  });

  it("contains malformed DB rows as structured errors, never throws", async () => {
    const broken: EventRoutingDbClient = {
      query: async () => ({ rows: [{ garbage: true }] }),
    };
    const store = createEventRoutingStore({ client: broken });
    const loaded = await store.loadSubscription("sub-1", TENANT);
    expect(loaded.ok).toBe(false);
    if (loaded.ok) return;
    expect(loaded.code).toBe("invalid_input");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 3. Failure-policy semantics through the adapter (J-045)
 * ────────────────────────────────────────────────────────────*/

describe("event-routing substrate adapter — failure policy", () => {
  it("bounds a hung client with a timeout (deterministic clock)", async () => {
    const clockCtl = manualClock();
    const policy = createAdapterFailurePolicy({
      provider: "cg-substrate-event-routing-test",
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
    const hung: EventRoutingDbClient = {
      query: () => neverSettles<{ rows: readonly Record<string, unknown>[]; rowCount?: number | null }>(),
    };
    const store = createEventRoutingStore({ client: hung, failurePolicy: policy });
    const pending = store.loadOutcomes("sub-1");
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
      provider: "cg-substrate-event-routing-test",
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
    const failing: EventRoutingDbClient = {
      // Synchronously throwing provider: the adapter's await wrapper still
      // yields an already-rejected call promise, so the deterministic race
      // resolves provider_error (not the timeout winner).
      query: () => {
        calls += 1;
        throw new Error("connection refused");
      },
    };
    const store = createEventRoutingStore({ client: failing, failurePolicy: policy });
    const first = await store.loadOutcomes("sub-1");
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
    const second = await store.loadOutcomes("sub-1");
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe("breaker_open");
    const third = await store.saveSubscription({ declaration: declaration(), declaredAt: NOW });
    expect(third.ok).toBe(false);
    if (!third.ok) expect(third.code).toBe("breaker_open");
    expect(calls).toBe(2);
  });

  it("exposes the declared policy for observability (snapshot + trust ledger)", async () => {
    const db = new FakeEventRoutingDb();
    const store = createEventRoutingStore({ client: db });
    expect(store.policy.snapshot().provider).toBe("cg-substrate-event-routing");
    expect(store.policy.currentTrustVerdict()).toBe("unproven");
    const recommendation = store.policy.recommendTrust();
    expect(recommendation.verdict).toBe("unproven");
  });
});

/* ─────────────────────────────────────────────────────────────
 * 4. Migration / rollback integrity pinning
 * ────────────────────────────────────────────────────────────*/

describe("event-routing migration 20261002000007 — authored integrity", () => {
  it("carries the AUTHORED, NOT APPLIED status and rollback pointer", () => {
    expect(MIGRATION).toContain("Status: AUTHORED, NOT APPLIED");
    expect(MIGRATION).toContain(
      "database/supabase/rollbacks/20261002000007_coregrid_v1_event_routing.sql",
    );
    expect(ROLLBACK).toContain("Status: AUTHORED, NOT APPLIED");
  });

  it("authors all four tables with deny-by-default RLS", () => {
    for (const table of [
      EVENT_ROUTE_SUBSCRIPTION_TABLE,
      EVENT_ROUTE_QUEUE_TABLE,
      EVENT_ROUTE_CURSOR_TABLE,
      EVENT_ROUTE_OUTCOME_TABLE,
    ]) {
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
      "tenant_id         text NOT NULL CHECK (length(tenant_id) BETWEEN 1 AND 128)",
    );
    expect(MIGRATION).toContain("UNIQUE (id, tenant_id)");
    expect(MIGRATION).toContain("CHECK (ordering = 'tenant-total-order')");
    expect(MIGRATION).toContain("CHECK (dedup = 'collapse-duplicates')");
    expect(MIGRATION).toContain("max_undelivered   integer NOT NULL CHECK (max_undelivered > 0)");
    expect(MIGRATION).toContain("delivery_decision text NOT NULL CHECK (delivery_decision IN ('ALLOW','REDACT'))");
    expect(MIGRATION).toContain("cg_event_route_queue_subscription_fk");
    expect(MIGRATION).toContain("cg_event_route_cursor_subscription_fk");
    expect(MIGRATION).toContain(
      "REFERENCES public.cg_event_route_subscription (id, tenant_id)",
    );
  });

  it("leaves the outcome audit deliberately FK-free (it survives unsubscribe)", () => {
    const outcomeSection = MIGRATION.slice(
      MIGRATION.indexOf("CREATE TABLE IF NOT EXISTS public.cg_event_route_outcome"),
      MIGRATION.indexOf("CREATE INDEX IF NOT EXISTS cg_event_route_outcome_tenant_idx"),
    );
    expect(outcomeSection).not.toContain("REFERENCES");
  });

  it("rollback reverses the DDL in reverse dependency order", () => {
    const outcomeDrop = ROLLBACK.indexOf(
      "DROP TABLE IF EXISTS public.cg_event_route_outcome",
    );
    const cursorDrop = ROLLBACK.indexOf(
      "DROP TABLE IF EXISTS public.cg_event_route_cursor",
    );
    const queueDrop = ROLLBACK.indexOf(
      "DROP TABLE IF EXISTS public.cg_event_route_queue",
    );
    const subscriptionDrop = ROLLBACK.indexOf(
      "DROP TABLE IF EXISTS public.cg_event_route_subscription",
    );
    expect(outcomeDrop).toBeGreaterThan(-1);
    expect(cursorDrop).toBeGreaterThan(outcomeDrop);
    expect(queueDrop).toBeGreaterThan(cursorDrop);
    expect(subscriptionDrop).toBeGreaterThan(queueDrop);
  });
});

/* ─────────────────────────────────────────────────────────────
 * 5. LIVE-gated connectivity probe (skips without credentials)
 * ────────────────────────────────────────────────────────────*/

const LIVE_ENABLED = Boolean(process.env.DATABASE_URL);

describe.skipIf(!LIVE_ENABLED)(
  "live: event-routing substrate connectivity probe (authored, NOT applied)",
  () => {
    it(
      "connects through scripts/lib/pg-connect.mjs and answers SELECT 1 — never touching cg_event_route_*",
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
/**
 * CoreGrid — MH-30 consolidated failure-injection battery (AGENTS §31
 * "failure tests" pillar; J-045 failure-semantics contract).
 *
 * The per-adapter suites (tests/unit/adapter-*.test.ts,
 * tests/unit/files-storage-adapter.test.ts,
 * tests/unit/notifications-email-adapter.test.ts) each prove one adapter's
 * behavior in depth. THIS suite proves the CROSS-ADAPTER invariant: every
 * external adapter that declares a J-045 failure policy — the 8 substrate
 * stores, the storage adapter and the email adapter — passes the SAME
 * failure matrix on a deterministic clock, so no single adapter can:
 *
 *   1. hang the host loop (hung provider → bounded timeout containment),
 *   2. open the breaker and keep dialing (open breaker → zero provider
 *      contact),
 *   3. skip the half-open probe discipline (single probe; failure re-opens,
 *      success closes),
 *   4. degrade silently (degraded episode announced on the event sink and
 *      time-bounded),
 *   5. retry past its cap (provider contact count pinned per row; the
 *      non-idempotent email send is never transport-retried),
 *   6. crash the host loop (hostile provider throw/rejection is always a
 *      structured result, never a thrown exception).
 *
 * The payment adapters (Stripe, Paystack) are included as local-surface
 * rows: under BLK-4 they perform no network I/O, so the timeout/breaker
 * matrix cannot bind yet — their public call boundary routes through
 * `policy.containSync`, and the battery drives hostile provider inputs
 * through that boundary and pins the declared policy posture instead.
 *
 * Zero per-adapter fixture duplication: every row drives a trivially
 * invocable I/O operation (a tenant-scoped read) through the adapter's
 * public API with a scripted provider probe. The adapter's own suite keeps
 * ownership of its deep contract.
 */
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  createAdapterFailurePolicy,
  type AdapterClock,
  type AdapterFailurePolicy,
  type AdapterFailurePolicyConfig,
  type AdapterPolicyEvent,
} from "../../frontend/src/lib/adapters/failure-policy";
import { createCostAttributionStore } from "../../frontend/src/lib/adapters/cost-attribution-store.adapter";
import { createEventRoutingStore } from "../../frontend/src/lib/adapters/event-routing-store.adapter";
import { createEventSecurityStore } from "../../frontend/src/lib/adapters/event-security-store.adapter";
import { createEvidenceCaptureStore } from "../../frontend/src/lib/adapters/evidence-capture-store.adapter";
import { createKnowledgeCurrencyDbStore } from "../../frontend/src/lib/adapters/knowledge-currency-store.adapter";
import { createReasoningProvenanceStore } from "../../frontend/src/lib/adapters/reasoning-provenance-store.adapter";
import { createReconciliationStore } from "../../frontend/src/lib/adapters/reconciliation-store.adapter";
import { createToolRuntimeStore } from "../../frontend/src/lib/adapters/tool-runtime-store.adapter";
import {
  getTenantObject,
  type FileStorageClient,
} from "../../frontend/src/lib/files/storage-adapter.server";
import {
  createRecordOnlyEmailAdapter,
  isEmailDeliveryReceipt,
  withEmailFailurePolicy,
  type EmailAdapter,
  type EmailDeliveryReceipt,
  type EmailDeliveryResult,
  type EmailProviderRegistry,
  type EmailSendCommand,
} from "../../frontend/src/lib/notifications/email-adapter-contract";
import type { Notification } from "../../frontend/src/lib/notifications/notification-contract";
import { createStripeAdapter } from "../../frontend/src/lib/payments/stripe-adapter";
import { createPaystackAdapter } from "../../frontend/src/lib/payments/paystack-adapter";
import type { WebhookRequest } from "../../frontend/src/lib/payments/payment-contract";

/* ─────────────────────────────────────────────────────────────
 * Deterministic clocks (the battery's instrument)
 * ────────────────────────────────────────────────────────────*/

const START_MS = 1_000_000;

interface ManualClockControl {
  clock: AdapterClock;
  advance(ms: number): void;
  fireDelays(): void;
  pendingDelays(): number[];
  at(): number;
}

/** Deferred-delay clock: time only passes when the test fires the delays. */
function manualClock(startMs = START_MS): ManualClockControl {
  let now = startMs;
  const pending: (() => void)[] = [];
  const clock: AdapterClock = {
    nowMs: () => now,
    delay: () =>
      new Promise<void>((resolve) => {
        pending.push(resolve);
      }),
  };
  return {
    clock,
    advance(ms: number): void {
      now += ms;
    },
    fireDelays(): void {
      for (const fire of pending.splice(0, pending.length)) fire();
    },
    pendingDelays(): number[] {
      return pending.map(() => 0);
    },
    at(): number {
      return now;
    },
  };
}

interface ImmediateClockControl {
  clock: AdapterClock;
  requestedDelays(): readonly number[];
  advance(ms: number): void;
  at(): number;
}

/** Resolves delays instantly and records the requested backoff values. */
function immediateClock(startMs = START_MS): ImmediateClockControl {
  let now = startMs;
  const requested: number[] = [];
  const clock: AdapterClock = {
    nowMs: () => now,
    delay: (ms: number) => {
      requested.push(ms);
      return Promise.resolve();
    },
  };
  return {
    clock,
    requestedDelays: () => [...requested],
    advance(ms: number): void {
      now += ms;
    },
    at: () => now,
  };
}

/** Flush queued microtasks so the policy has registered its delay. */
const tick = (): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, 0));

/**
 * Drive a pending adapter call to settlement on the manual clock: fire
 * whatever delays the policy requests (backoffs, and the stale attempt
 * timeouts of already-settled races) until the call resolves. A call that
 * never settles fails the test via the Vitest timeout — which is exactly
 * the "adapter hung the loop" verdict the battery exists to catch.
 */
async function settleOnClock<T>(pending: Promise<T>, clockCtl: ManualClockControl): Promise<T> {
  let settled = false;
  const tracked = pending.then(
    (value: T) => {
      settled = true;
      return value;
    },
    (err: unknown) => {
      settled = true;
      throw err;
    },
  );
  for (let guard = 0; guard < 100 && !settled; guard += 1) {
    await tick();
    clockCtl.fireDelays();
  }
  return tracked;
}

/* ─────────────────────────────────────────────────────────────
 * Scripted provider probe (shared by every I/O row)
 * ────────────────────────────────────────────────────────────*/

type ProviderBehavior =
  | { mode: "resolve" }
  | { mode: "reject"; with: unknown }
  | { mode: "throwSync"; with: unknown }
  | { mode: "hang" };

interface ProbeState {
  behavior: ProviderBehavior;
  /** Every provider contact the adapter made (the no-secret-dialing meter). */
  contacts: number;
}

function probeCall<T>(probe: ProbeState, resolveValue: () => T): Promise<T> {
  probe.contacts += 1;
  switch (probe.behavior.mode) {
    case "throwSync":
      throw probe.behavior.with;
    case "reject":
      return Promise.reject(probe.behavior.with);
    case "hang":
      return new Promise<T>(() => {});
    case "resolve":
      return Promise.resolve(resolveValue());
  }
}

function freshProbe(): ProbeState {
  return { behavior: { mode: "reject", with: new Error("provider down") }, contacts: 0 };
}

/* ─────────────────────────────────────────────────────────────
 * Normalized battery outcomes
 * ────────────────────────────────────────────────────────────*/

type BatteryOutcome =
  | { thrown: false; ok: true }
  | { thrown: false; ok: false; code: string; reason: string; attempts?: number }
  | { thrown: true; reason: string };

/** Every substrate store result shares this structural shape. */
type SubstrateResult =
  { ok: true; value: unknown } | { ok: false; code: string; reason: string; attempts: number };

function mapSubstrateResult(result: SubstrateResult): BatteryOutcome {
  if (result.ok) return { thrown: false, ok: true };
  return {
    thrown: false,
    ok: false,
    code: result.code,
    reason: result.reason,
    attempts: result.attempts,
  };
}

function mapStorageResult(
  result: { ok: true; data: unknown } | { ok: false; code: string; reason: string },
): BatteryOutcome {
  if (result.ok) return { thrown: false, ok: true };
  return { thrown: false, ok: false, code: result.code, reason: result.reason };
}

function mapEmailResult(result: EmailDeliveryResult): BatteryOutcome {
  if (isEmailDeliveryReceipt(result)) return { thrown: false, ok: true };
  const failure = result;
  if (failure.outcome === "failed") {
    // The email contract wraps the policy code inside the structured reason
    // (e.g. "…(code=breaker_open): …"); extract it for the common matrix.
    const wrapped = failure.reason.match(/code=([a-z_]+)/);
    return {
      thrown: false,
      ok: false,
      code: wrapped?.[1] ?? failure.code,
      reason: failure.reason,
      attempts: 1,
    };
  }
  return { thrown: false, ok: false, code: failure.code, reason: failure.reason, attempts: 0 };
}

/* ─────────────────────────────────────────────────────────────
 * The battery table
 * ────────────────────────────────────────────────────────────*/

const TENANT = "tenant-battery";
const TIMEOUT_MS = 1_000;

/** Uniform J-045 policy every I/O row inherits (thresholds tuned to trip fast). */
function batteryPolicy(
  provider: string,
  clock: AdapterClock,
  events: AdapterPolicyEvent[],
  overrides: Partial<AdapterFailurePolicyConfig> = {},
): AdapterFailurePolicy {
  return createAdapterFailurePolicy({
    provider,
    timeoutMs: TIMEOUT_MS,
    maxAttempts: 2,
    backoffBaseMs: 100,
    backoffCapMs: 1_000,
    degradedAfterFailures: 2,
    degradedWindowMs: 10_000,
    breakerFailureThreshold: 2,
    breakerResetMs: 5_000,
    clock,
    onEvent: (event) => events.push(event),
    ...overrides,
  });
}

interface IoHarness {
  invoke(): Promise<BatteryOutcome>;
  probe: ProbeState;
  policy: AdapterFailurePolicy;
}

interface IoRow {
  name: string;
  /** The public adapter operation the row drives through the matrix. */
  readOperation: string;
  /** Provider contacts a persistently failing invocation must cap at. */
  maxProviderContacts: number;
  /** Every delay one capped invocation must request: per-attempt timeout
   * races plus inter-attempt backoffs, in order (deterministic). */
  expectedDelays: readonly number[];
  /**
   * Adapter-vocabulary translation of the policy error code. Identity by
   * default; the storage adapter collapses every policy code into its own
   * `storage_error` vocabulary, for example.
   */
  mapCode?: (policyCode: string) => string;
  make(
    clock: AdapterClock,
    events: AdapterPolicyEvent[],
    overrides?: Partial<AdapterFailurePolicyConfig>,
  ): IoHarness;
}

function codeFor(row: IoRow, policyCode: string): string {
  return row.mapCode ? row.mapCode(policyCode) : policyCode;
}

interface SubstrateClientShape {
  query(
    text: string,
    values?: readonly unknown[],
  ): Promise<{ rows: readonly Record<string, unknown>[] }>;
}

/** Build a battery row for a substrate store driven through a scripted DB client. */
function substrateRow<S extends { policy: AdapterFailurePolicy }>(
  name: string,
  provider: string,
  create: (client: SubstrateClientShape, policy: AdapterFailurePolicy) => S,
  invoke: (store: S) => Promise<SubstrateResult>,
  readOperation: string,
): IoRow {
  return {
    name,
    readOperation,
    maxProviderContacts: 2,
    // [attempt-1 timeout race, backoff, attempt-2 timeout race]
    expectedDelays: [TIMEOUT_MS, 100, TIMEOUT_MS],
    make(clock, events, overrides = {}) {
      const probe = freshProbe();
      const policy = batteryPolicy(provider, clock, events, overrides);
      // Non-async on purpose: a sync-throwing provider must surface as an
      // already-rejected call promise so the deterministic race resolves
      // provider_error, never the (instantly available) timeout winner.
      const client: SubstrateClientShape = {
        query: () => probeCall(probe, () => ({ rows: [] })),
      };
      const store = create(client, policy);
      return {
        invoke: async () => mapSubstrateResult(await invoke(store)),
        probe,
        policy: store.policy,
      };
    },
  };
}

const ioRows: IoRow[] = [
  substrateRow(
    "cost-attribution substrate adapter",
    "cg-substrate-cost-attribution",
    (client, policy) => createCostAttributionStore({ client, failurePolicy: policy }),
    (store) => store.loadRollUps(TENANT),
    "loadRollUps (read)",
  ),
  substrateRow(
    "event-routing substrate adapter",
    "cg-substrate-event-routing",
    (client, policy) => createEventRoutingStore({ client, failurePolicy: policy }),
    (store) => store.loadSubscription("sub-battery", TENANT),
    "loadSubscription (read)",
  ),
  substrateRow(
    "event-security substrate adapter",
    "cg-substrate-event-security",
    (client, policy) => createEventSecurityStore({ client, failurePolicy: policy }),
    (store) => store.loadDenials(TENANT),
    "loadDenials (read)",
  ),
  substrateRow(
    "evidence-capture substrate adapter",
    "cg-substrate-evidence",
    (client, policy) => createEvidenceCaptureStore({ client, failurePolicy: policy }),
    (store) => store.loadTenantEvidence(TENANT),
    "loadTenantEvidence (read)",
  ),
  substrateRow(
    "knowledge-currency substrate adapter",
    "cg-substrate-knowledge-currency",
    (client, policy) => createKnowledgeCurrencyDbStore({ client, failurePolicy: policy }),
    (store) => store.loadSources(TENANT),
    "loadSources (read)",
  ),
  substrateRow(
    "reasoning-provenance substrate adapter",
    "cg-substrate-reasoning-provenance",
    (client, policy) => createReasoningProvenanceStore({ client, failurePolicy: policy }),
    (store) => store.loadSnapshots(TENANT),
    "loadSnapshots (read)",
  ),
  substrateRow(
    "reconciliation substrate adapter",
    "cg-substrate-reconciliation",
    (client, policy) => createReconciliationStore({ client, failurePolicy: policy }),
    (store) => store.loadVerdicts(TENANT),
    "loadVerdicts (read)",
  ),
  substrateRow(
    "tool-runtime substrate adapter",
    "cg-substrate-tool-runtime",
    (client, policy) => createToolRuntimeStore({ client, failurePolicy: policy }),
    (store) => store.loadRegistrations(TENANT),
    "loadRegistrations (read)",
  ),
  {
    name: "supabase storage adapter",
    readOperation: "getTenantObject (read)",
    maxProviderContacts: 2,
    expectedDelays: [TIMEOUT_MS, 100, TIMEOUT_MS],
    mapCode: () => "storage_error",
    make(clock, events, overrides = {}) {
      const probe = freshProbe();
      const policy = batteryPolicy("supabase-storage", clock, events, overrides);
      // Non-async: a sync-throwing provider surfaces as an already-rejected
      // call promise (see the substrate-row note).
      const download = () => probeCall(probe, () => ({ data: new Blob(["probe"]), error: null }));
      const deps: FileStorageClient = {
        client: {
          storage: {
            from: () => ({ download }),
          },
        } as unknown as SupabaseClient,
        failurePolicy: policy,
      };
      return {
        invoke: async () =>
          mapStorageResult(await getTenantObject(deps, TENANT, `${TENANT}/battery/probe.bin`)),
        probe,
        policy,
      };
    },
  },
  {
    name: "email adapter (withEmailFailurePolicy)",
    readOperation: "send (non-idempotent, single transport attempt)",
    // A send is non-idempotent: the wrapper forces a single transport
    // attempt even though the declared policy would allow two. The only
    // delay requested is the single attempt's timeout race.
    maxProviderContacts: 1,
    expectedDelays: [TIMEOUT_MS],
    make(clock, events, overrides = {}) {
      const probe = freshProbe();
      const policy = batteryPolicy("email-battery", clock, events, overrides);
      const inner: EmailAdapter = {
        providerId: "resend-battery",
        send: (command) =>
          probeCall(probe, (): EmailDeliveryReceipt => ({
            notificationId: command.notification.id,
            channel: "email",
            providerId: "resend-battery",
            providerMessageId: `provider-msg-${command.notification.id}`,
            confirmedAt: "2026-10-01T00:00:00.000Z",
          })),
      };
      const wrapped = withEmailFailurePolicy(inner, policy);
      const registry: EmailProviderRegistry = {
        isProviderConfigured: () => true,
        credentialReferenceFor: () => "secret://email/resend",
      };
      const command: EmailSendCommand = {
        notification: makeNotification(),
        recipientAddress: "parent@example.edu",
        subject: "Battery probe",
        body: "Failure-battery probe send.",
      };
      return {
        invoke: async () => mapEmailResult(await wrapped.send(command, registry)),
        probe,
        policy,
      };
    },
  },
];

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: "notif-battery",
    tenantRef: TENANT,
    recipientRef: "user-1",
    audienceKind: "user",
    category: "general",
    subject: "Battery probe",
    body: "Failure-battery probe notification.",
    actionRef: null,
    state: "queued",
    createdAt: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Shared scenario drivers
 * ────────────────────────────────────────────────────────────*/

/** Fail through the provider until the breaker opens. Never rejects. */
async function driveBreakerOpen(harness: IoHarness): Promise<void> {
  for (let guard = 0; guard < 10; guard += 1) {
    if (harness.policy.snapshot().breaker === "open") return;
    const result = await harness.invoke();
    expect(result.thrown).toBe(false);
  }
  // Unreachable when the matrix holds: the breaker must have opened.
  expect(harness.policy.snapshot().breaker).toBe("open");
}

/** Fail through the provider until a degraded episode is armed. */
async function driveToDegraded(harness: IoHarness): Promise<void> {
  for (let guard = 0; guard < 10; guard += 1) {
    if (harness.policy.snapshot().degradedActive) return;
    const result = await harness.invoke();
    expect(result.thrown).toBe(false);
  }
  expect(harness.policy.snapshot().degradedActive).toBe(true);
}

function expectStructuredFailure(row: IoRow, result: BatteryOutcome, policyCode: string): void {
  expect(result.thrown).toBe(false);
  expect(result).toMatchObject({ thrown: false, ok: false, code: codeFor(row, policyCode) });
}

/* ─────────────────────────────────────────────────────────────
 * The battery — one table-driven suite, per-adapter rows
 * ────────────────────────────────────────────────────────────*/

describe("MH-30 failure battery — every J-045 adapter passes the common failure matrix", () => {
  const rowList = (rows: readonly IoRow[]): [string, IoRow][] => rows.map((row) => [row.name, row]);

  describe("hung provider → timeout containment", () => {
    it.each(rowList(ioRows))(
      "%s: a provider that never settles is abandoned at the bounded deadline",
      async (_name, row) => {
        const clockCtl = manualClock();
        const harness = row.make(clockCtl.clock, [], { maxAttempts: 1 });
        harness.probe.behavior = { mode: "hang" };

        const pending = harness.invoke();
        await tick();
        expect(harness.probe.contacts).toBe(1);

        clockCtl.advance(TIMEOUT_MS);
        clockCtl.fireDelays();
        const result = await pending;

        expectStructuredFailure(row, result, "timeout");
        // The losing provider promise is still pending — the call boundary
        // resolved without it, so nothing can hang the host loop.
        expect(harness.probe.contacts).toBe(1);
        expect(clockCtl.at()).toBe(START_MS + TIMEOUT_MS);
      },
    );
  });

  describe("repeated failure → breaker opens (no provider contact while open)", () => {
    it.each(rowList(ioRows))(
      "%s: consecutive failures isolate the adapter; the open breaker dials nothing",
      async (_name, row) => {
        const clockCtl = immediateClock();
        const events: AdapterPolicyEvent[] = [];
        const harness = row.make(clockCtl.clock, events);
        harness.probe.behavior = { mode: "throwSync", with: "battery-hostile-failure" };

        const first = await harness.invoke();
        expectStructuredFailure(row, first, "provider_error");
        expect(first.thrown === false && !first.ok && first.reason).toContain(
          "battery-hostile-failure",
        );

        await driveBreakerOpen(harness);
        expect(harness.policy.snapshot().breaker).toBe("open");
        expect(harness.policy.snapshot().mode).toBe("isolated");
        expect(events.some((event) => event.kind === "breaker_change" && event.to === "open")).toBe(
          true,
        );

        const contactsWhenOpened = harness.probe.contacts;
        const denied = await harness.invoke();
        expectStructuredFailure(row, denied, "breaker_open");
        expect(denied.thrown === false && !denied.ok && denied.reason).toContain(
          "without provider contact",
        );
        expect(harness.probe.contacts).toBe(contactsWhenOpened);
      },
    );
  });

  describe("half-open probe discipline", () => {
    it.each(rowList(ioRows))(
      "%s: exactly one probe after the reset window; failure re-opens, success closes",
      async (_name, row) => {
        const clockCtl = manualClock();
        const harness = row.make(clockCtl.clock, []);
        harness.probe.behavior = { mode: "reject", with: new Error("provider down") };
        await settleOnClock(driveBreakerOpen(harness), clockCtl);
        const contactsWhenOpened = harness.probe.contacts;

        clockCtl.advance(5_000);
        harness.probe.behavior = { mode: "hang" };
        const probeCallPending = harness.invoke();
        await tick();
        expect(harness.probe.contacts).toBe(contactsWhenOpened + 1);

        // Concurrent half-open probes are denied without provider contact.
        const concurrent = await harness.invoke();
        expectStructuredFailure(row, concurrent, "breaker_open");
        expect(harness.probe.contacts).toBe(contactsWhenOpened + 1);

        clockCtl.advance(TIMEOUT_MS);
        clockCtl.fireDelays();
        const probeOutcome = await probeCallPending;
        expectStructuredFailure(row, probeOutcome, "timeout");
        expect(harness.policy.snapshot().breaker).toBe("open");

        clockCtl.advance(5_000);
        harness.probe.behavior = { mode: "resolve" };
        const recovered = await harness.invoke();
        if (recovered.thrown || !recovered.ok) {
          throw new Error(
            `probe recovery must resolve to a structured success: ${JSON.stringify(recovered)}`,
          );
        }
        expect(harness.policy.snapshot().breaker).toBe("closed");
      },
    );
  });

  describe("degraded episode announced", () => {
    it.each(rowList(ioRows))(
      "%s: degraded mode is announced on the event sink and time-bounded",
      async (_name, row) => {
        const clockCtl = immediateClock();
        const events: AdapterPolicyEvent[] = [];
        const harness = row.make(clockCtl.clock, events);
        harness.probe.behavior = { mode: "reject", with: new Error("provider down") };

        await driveToDegraded(harness);

        const degradedChange = events.find(
          (event) => event.kind === "mode_change" && event.to === "degraded",
        );
        expect(degradedChange).toBeDefined();

        const snap = harness.policy.snapshot();
        expect(snap.degradedActive).toBe(true);
        expect(snap.degradedSinceMs).not.toBeNull();
        expect(snap.degradedUntilMs).not.toBeNull();
        expect((snap.degradedUntilMs ?? 0) - (snap.degradedSinceMs ?? 0)).toBe(10_000);
        // Every failure was observable (never silent).
        expect(
          events.filter((event) => event.kind === "call_failed").length,
        ).toBeGreaterThanOrEqual(row.maxProviderContacts);
        // The episode expires: time-bounded, re-armed only by further failures.
        expect(harness.policy.snapshot(START_MS + 20_000).degradedExpired).toBe(true);
      },
    );
  });

  describe("retryability respected", () => {
    it.each(rowList(ioRows))(
      "%s: provider contact is capped and backoff is deterministic",
      async (_name, row) => {
        const clockCtl = immediateClock();
        const events: AdapterPolicyEvent[] = [];
        const harness = row.make(clockCtl.clock, events);
        // A synchronously throwing provider settles each race with
        // provider_error before the instantly-resolved delay clock can win;
        // an async rejection loses that microtask race by construction and
        // is covered by the containment and timeout scenarios instead.
        harness.probe.behavior = { mode: "throwSync", with: new Error("still down") };

        const result = await harness.invoke();

        expectStructuredFailure(row, result, "provider_error");
        expect(harness.probe.contacts).toBe(row.maxProviderContacts);
        expect(clockCtl.requestedDelays()).toEqual(row.expectedDelays);
        expect(events.filter((event) => event.kind === "call_failed")).toHaveLength(
          row.maxProviderContacts,
        );
      },
    );
  });

  describe("structured failure never escapes as a thrown exception", () => {
    it.each(rowList(ioRows))(
      "%s: hostile non-Error throws and Error rejections are both contained",
      async (_name, row) => {
        const clockCtl = immediateClock();
        const harness = row.make(clockCtl.clock, []);

        harness.probe.behavior = { mode: "throwSync", with: "battery-non-error-hostile-value" };
        const fromHostileValue = await harness.invoke();
        if (fromHostileValue.thrown) {
          throw new Error(
            `hostile non-Error throw escaped the boundary: ${fromHostileValue.reason}`,
          );
        }
        expect(fromHostileValue.ok).toBe(false);

        harness.probe.behavior = { mode: "reject", with: new Error("battery Error rejection") };
        const fromError = await harness.invoke();
        if (fromError.thrown) {
          throw new Error(`hostile Error rejection escaped the boundary: ${fromError.reason}`);
        }
        expect(fromError.ok).toBe(false);

        // Containment holds in every adapter mode the matrix produced.
        const snap = harness.policy.snapshot();
        expect(["healthy", "degraded", "isolated"]).toContain(snap.mode);
      },
    );
  });
});

/* ─────────────────────────────────────────────────────────────
 * Local-surface rows (BLK-4): payment adapters
 *
 * Under BLK-4 the payment adapters perform no network I/O — every public
 * operation routes through `policy.containSync` at the local call boundary,
 * so the timeout/breaker matrix cannot bind yet. The battery still pins the
 * cross-adapter invariants that DO apply: hostile provider input is
 * contained as structured failures (never thrown), every containment feeds
 * the trust ledger, and the declared policy posture stays sane.
 * ────────────────────────────────────────────────────────────*/

const PAYMENT_FIXTURE_SECRET_PREFIX = "fixture-do-not-use";

interface LocalRow {
  name: string;
  make(): {
    verify(rawBody: Uint8Array, headers: Record<string, string>): unknown;
    parse(request: WebhookRequest): unknown;
    policy: AdapterFailurePolicy;
  };
  signatureHeader(rawBody: Uint8Array, timestampSec: number): string;
  signatureHeaderName: string;
}

function webhookRequest(
  rawBody: Uint8Array,
  headers: Record<string, string>,
  receivedAtSec: number,
): WebhookRequest {
  return { rawBody, headers, receivedAtSec };
}

const stripeRow: LocalRow = {
  name: "stripe payment adapter (local surface, BLK-4)",
  signatureHeaderName: "stripe-signature",
  signatureHeader(rawBody, timestampSec) {
    const mac = createHmac("sha256", `${PAYMENT_FIXTURE_SECRET_PREFIX}-stripe`)
      .update(`${timestampSec}.${Buffer.from(rawBody).toString("utf8")}`)
      .digest("hex");
    return `t=${timestampSec},v1=${mac}`;
  },
  make() {
    const adapter = createStripeAdapter({
      signingSecret: `${PAYMENT_FIXTURE_SECRET_PREFIX}-stripe`,
    });
    return {
      verify: (rawBody, headers) =>
        adapter.verifySignature(webhookRequest(rawBody, headers, 1_000_000)),
      parse: (request) => adapter.parseWebhook(request),
      policy: adapter.failurePolicy,
    };
  },
};

const paystackRow: LocalRow = {
  name: "paystack payment adapter (local surface, BLK-4)",
  signatureHeaderName: "x-paystack-signature",
  signatureHeader(rawBody) {
    return createHmac("sha512", `${PAYMENT_FIXTURE_SECRET_PREFIX}-paystack`)
      .update(Buffer.from(rawBody))
      .digest("hex");
  },
  make() {
    const adapter = createPaystackAdapter({
      secretKey: `${PAYMENT_FIXTURE_SECRET_PREFIX}-paystack`,
    });
    return {
      verify: (rawBody, headers) =>
        adapter.verifySignature(webhookRequest(rawBody, headers, 1_000_000)),
      parse: (request) => adapter.parseWebhook(request),
      policy: adapter.failurePolicy,
    };
  },
};

const localRows: LocalRow[] = [stripeRow, paystackRow];

describe("MH-30 failure battery — local-surface payment adapters (BLK-4)", () => {
  it.each(localRows.map((row) => [row.name, row] as const))(
    "%s: hostile provider input is contained as structured failures, never thrown",
    (_name, row) => {
      const harness = row.make();
      const timestampSec = 1_000_000;
      const body = (value: string): Uint8Array => new TextEncoder().encode(value);

      const hostileVerify: {
        label: string;
        headers: Record<string, string>;
        rawBody: Uint8Array;
      }[] = [
        {
          label: "missing signature header",
          headers: {},
          rawBody: body("{}"),
        },
        {
          label: "malformed signature header",
          headers: { [row.signatureHeaderName]: "not-a-signature" },
          rawBody: body("{}"),
        },
        {
          label: "wrong digest",
          headers: {
            [row.signatureHeaderName]: `t=${timestampSec},v1=${"0".repeat(64)}`,
          },
          rawBody: body("{}"),
        },
      ];
      for (const item of hostileVerify) {
        let threw = false;
        try {
          const result = harness.verify(item.rawBody, item.headers) as { ok: boolean };
          expect(result.ok, item.label).toBe(false);
        } catch {
          threw = true;
        }
        expect(threw, `${item.label} must be contained, not thrown`).toBe(false);
      }

      const hostileParse: { label: string; request: WebhookRequest }[] = [
        {
          label: "invalid JSON with a valid signature",
          request: webhookRequest(
            body("definitely not json"),
            {
              [row.signatureHeaderName]: row.signatureHeader(
                body("definitely not json"),
                timestampSec,
              ),
            },
            timestampSec,
          ),
        },
        {
          label: "unknown event type with a valid signature",
          request: webhookRequest(
            body(JSON.stringify({ id: "evt_1", type: "totally.unknown.event" })),
            {
              [row.signatureHeaderName]: row.signatureHeader(
                body(JSON.stringify({ id: "evt_1", type: "totally.unknown.event" })),
                timestampSec,
              ),
            },
            timestampSec,
          ),
        },
        {
          label: "malformed data.object with a valid signature",
          request: webhookRequest(
            body(
              JSON.stringify({
                id: "evt_1",
                type: "payment_intent.succeeded",
                data: { object: {} },
              }),
            ),
            {
              [row.signatureHeaderName]: row.signatureHeader(
                body(
                  JSON.stringify({
                    id: "evt_1",
                    type: "payment_intent.succeeded",
                    data: { object: {} },
                  }),
                ),
                timestampSec,
              ),
            },
            timestampSec,
          ),
        },
      ];
      for (const item of hostileParse) {
        let threw = false;
        try {
          const result = harness.parse(item.request) as { ok: boolean };
          expect(result.ok, item.label).toBe(false);
        } catch {
          threw = true;
        }
        expect(threw, `${item.label} must be contained, not thrown`).toBe(false);
      }

      // Containment is not silent: the boundary feeds the trust ledger's
      // declared posture, and trust is never granted automatically (E-060).
      const snap = harness.policy.snapshot();
      expect(snap.trustVerdict).toBe("unproven");
      expect(snap.declared.timeoutMs).toBeGreaterThan(0);
      expect(snap.declared.breakerFailureThreshold).toBeGreaterThan(0);
    },
  );

  it("record-only email stub holds its send as a structured undeliverable (BLK-5)", async () => {
    // Included because the email adapter is part of the battery surface: the
    // stub must never throw and never fabricate a receipt.
    const stub = createRecordOnlyEmailAdapter();
    const registry: EmailProviderRegistry = {
      isProviderConfigured: () => true,
      credentialReferenceFor: () => "secret://email/resend",
    };
    const result = await stub.send(
      {
        notification: makeNotification(),
        recipientAddress: "parent@example.edu",
        subject: "Battery probe",
        body: "Failure-battery probe send.",
      },
      registry,
    );
    expect(isEmailDeliveryReceipt(result)).toBe(false);
    expect(result).toMatchObject({ outcome: "undeliverable", code: "provider_not_configured" });
  });
});

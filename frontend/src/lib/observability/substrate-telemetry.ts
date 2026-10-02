/**
 * CoreGrid — substrate telemetry collector (MISSION H2-27, Constitution §29).
 *
 * The eight substrate adapters (reconciliation, event-security, event-routing,
 * evidence-capture, reasoning-provenance, cost-attribution, knowledge-currency,
 * tool-runtime) each run an AdapterFailurePolicy that emits AdapterPolicyEvent
 * streams — call outcomes, degraded-mode transitions, breaker transitions and
 * trust-ledger decisions — but nothing aggregates them. This module is the one
 * aggregation point: a PURE collector that subscribes to those streams (the
 * adapters accept an injected failure policy whose `onEvent` sink is wired
 * here), maintains per-provider/per-operation health (failure counts by code,
 * breaker transitions, degraded episodes, trust verdicts), and exposes
 * structured-log emitters in the house format (ts/level/msg/component plus
 * bounded scalar fields, emitted through the shared structured-log formatter).
 *
 * Redaction by construction (§29): the collector NEVER carries an event's
 * free-text `reason`, error causes or payload-bearing fields into state or
 * logs. Only counts, codes, durations and provider/operation names survive.
 * A malformed or unknown event is dropped fail-closed (counted, never thrown,
 * never logged with content). The shared formatter's secret-key redaction
 * still runs as defense-in-depth on every emitted line.
 *
 * Purity: no I/O, no wall clock — the aggregation clock is injectable, and
 * emission goes through an injectable sink (default: the structured-log
 * console sink). Subscription is opt-in; adapters stay untouched (composition,
 * not rewrite).
 */
import type {
  AdapterErrorCode,
  AdapterMode,
  AdapterPolicyEvent,
  BreakerState,
  TrustVerdict,
} from "../adapters/failure-policy";
import {
  logStructured,
  type LogEmitOptions,
  type StructuredLogEntry,
} from "./structured-log";
import { SystemClock, TimeAuthority } from "../kernel/time-authority";

/** J-023 time-source rule: time enters only via the kernel authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

/* ─────────────────────────────────────────────────────────────
 * Vocabulary
 * ────────────────────────────────────────────────────────────*/

export const SUBSTRATE_TELEMETRY_COMPONENT = "substrate-telemetry";

/** Fixed failure-code vocabulary mirrored from the adapter contract. */
export interface FailureCodeCounts {
  timeout: number;
  provider_error: number;
  breaker_open: number;
}

export const EMPTY_FAILURE_CODE_COUNTS: Readonly<FailureCodeCounts> = {
  timeout: 0,
  provider_error: 0,
  breaker_open: 0,
};

/** Fixed trust-verdict vocabulary (E-060): decisions, never auto-trust. */
export interface TrustVerdictCounts {
  trusted: number;
  untrusted: number;
  unproven: number;
}

export const EMPTY_TRUST_VERDICT_COUNTS: Readonly<TrustVerdictCounts> = {
  trusted: 0,
  untrusted: 0,
  unproven: 0,
};

/** One closed degraded episode (per provider). Open episodes are live state. */
export interface DegradedEpisodeRecord {
  openedAtMs: number;
  closedAtMs: number;
  /** closedAtMs - openedAtMs; never negative. */
  openMs: number;
}

/* ─────────────────────────────────────────────────────────────
 * Aggregate shapes (bounded, whitelist fields only)
 * ────────────────────────────────────────────────────────────*/

export interface OperationTelemetry {
  provider: string;
  operation: string;
  /** Resolved calls (call_succeeded events — one per call). */
  successes: number;
  /** Failed ATTEMPTS (call_failed events — retries count individually). */
  failureAttempts: number;
  codes: FailureCodeCounts;
  lastSuccessDurationMs: number | null;
  lastFailureAtMs: number | null;
  lastEventAtMs: number | null;
}

export interface ProviderTelemetry {
  provider: string;
  successes: number;
  failureAttempts: number;
  timeouts: number;
  modeChanges: number;
  breakerChanges: number;
  /** Transitions into `open` (breaker trips). */
  breakerOpens: number;
  /** Transitions into `half_open` (reset window elapsed, probe admitted). */
  breakerHalfOpens: number;
  /** Transitions into `closed` (probe succeeded). */
  breakerCloses: number;
  /** Last declared mode/breaker transition targets; null before any event. */
  currentMode: AdapterMode | null;
  currentBreaker: BreakerState | null;
  degradedEpisodeOpen: boolean;
  degradedEpisodeOpenedAtMs: number | null;
  /** now() - openedAtMs while open; null when closed or before open. */
  degradedEpisodeOpenMs: number | null;
  degradedEpisodesClosed: number;
  lastDegradedEpisode: DegradedEpisodeRecord | null;
  trustDecisions: number;
  trustVerdictCounts: TrustVerdictCounts;
  lastTrustVerdict: TrustVerdict | null;
  lastEventAtMs: number | null;
  /** Sorted by operation name. */
  operations: OperationTelemetry[];
}

export interface SubstrateTelemetrySnapshot {
  eventsIngested: number;
  malformedEventsDropped: number;
  logEntriesBuffered: number;
  logEntriesDropped: number;
  /** Sorted by provider name. */
  providers: ProviderTelemetry[];
}

/* ─────────────────────────────────────────────────────────────
 * Options
 * ────────────────────────────────────────────────────────────*/

export interface SubstrateTelemetryOptions {
  /** Injectable clock (ms) driving live-episode durations; no wall clock. */
  now?: () => number;
  /** House `component` field; defaults to SUBSTRATE_TELEMETRY_COMPONENT. */
  component?: string;
  /** Bounded entry buffer; oldest entries are discarded past the cap. */
  maxBufferedEntries?: number;
  /** Optional live observer invoked with every produced entry. */
  onEntry?: (entry: StructuredLogEntry) => void;
}

const DEFAULT_MAX_BUFFERED_ENTRIES = 500;

/* ─────────────────────────────────────────────────────────────
 * Fail-closed event validation (unknown shapes are dropped)
 * ────────────────────────────────────────────────────────────*/

const EVENT_KINDS: ReadonlySet<string> = new Set([
  "call_failed",
  "call_succeeded",
  "mode_change",
  "breaker_change",
  "trust_decision",
]);

const ERROR_CODES: ReadonlySet<string> = new Set(["timeout", "provider_error", "breaker_open"]);

const MODES: ReadonlySet<string> = new Set(["healthy", "degraded", "isolated"]);

const BREAKER_STATES: ReadonlySet<string> = new Set(["closed", "open", "half_open"]);

const TRUST_VERDICTS: ReadonlySet<string> = new Set(["trusted", "untrusted", "unproven"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/** Structural gate only — a passing event's content is whitelisted on use. */
function isValidPolicyEvent(value: unknown): value is AdapterPolicyEvent {
  if (!isRecord(value)) return false;
  const event = value as Record<string, unknown>;
  if (!EVENT_KINDS.has(event.kind as string)) return false;
  if (!isNonEmptyString(event.provider)) return false;
  if (!isFiniteNumber(event.atMs)) return false;
  switch (event.kind) {
    case "call_failed":
      return ERROR_CODES.has(event.code as string) && isNonEmptyString(event.operation) &&
        isFiniteNumber(event.attempt) && event.attempt >= 1;
    case "call_succeeded":
      return isNonEmptyString(event.operation) && isFiniteNumber(event.attempts) &&
        event.attempts >= 1 && isFiniteNumber(event.durationMs) && event.durationMs >= 0;
    case "mode_change":
      return MODES.has(event.from as string) && MODES.has(event.to as string);
    case "breaker_change":
      return BREAKER_STATES.has(event.from as string) && BREAKER_STATES.has(event.to as string);
    case "trust_decision":
      return TRUST_VERDICTS.has(event.verdict as string);
    default:
      return false;
  }
}

/* ─────────────────────────────────────────────────────────────
 * Aggregate state (mutable internals; exports are fresh copies)
 * ────────────────────────────────────────────────────────────*/

interface OperationState {
  provider: string;
  operation: string;
  successes: number;
  failureAttempts: number;
  codes: FailureCodeCounts;
  lastSuccessDurationMs: number | null;
  lastFailureAtMs: number | null;
  lastEventAtMs: number | null;
}

interface ProviderState {
  provider: string;
  successes: number;
  failureAttempts: number;
  timeouts: number;
  modeChanges: number;
  breakerChanges: number;
  breakerOpens: number;
  breakerHalfOpens: number;
  breakerCloses: number;
  currentMode: AdapterMode | null;
  currentBreaker: BreakerState | null;
  degradedEpisodeOpenedAtMs: number | null;
  degradedEpisodesClosed: number;
  lastDegradedEpisode: DegradedEpisodeRecord | null;
  trustDecisions: number;
  trustVerdictCounts: TrustVerdictCounts;
  lastTrustVerdict: TrustVerdict | null;
  lastEventAtMs: number | null;
  operations: Map<string, OperationState>;
}

function emptyTrustCounts(): TrustVerdictCounts {
  return { ...EMPTY_TRUST_VERDICT_COUNTS };
}

function emptyCodeCounts(): FailureCodeCounts {
  return { ...EMPTY_FAILURE_CODE_COUNTS };
}

/* ─────────────────────────────────────────────────────────────
 * The collector
 * ────────────────────────────────────────────────────────────*/

export interface SubstrateTelemetry {
  /** The subscription handle: wire as the failure policy's `onEvent` sink. */
  sink(): (event: AdapterPolicyEvent) => void;
  /** Ingest one event; returns false when the event was dropped as malformed. */
  ingest(event: unknown): boolean;
  /** Immutable aggregate snapshot, providers and operations sorted by name. */
  snapshot(): SubstrateTelemetrySnapshot;
  provider(provider: string): ProviderTelemetry | null;
  operation(provider: string, operation: string): OperationTelemetry | null;
  /** Number of entries currently buffered (bounded). */
  bufferedLogCount(): number;
  /** Drain and return the buffered entries (newest last). */
  takeLogEntries(): StructuredLogEntry[];
  /** Emit every buffered entry through the house formatter; returns the count. */
  emitPendingLogs(options?: LogEmitOptions): number;
}

export function createSubstrateTelemetry(
  options: SubstrateTelemetryOptions = {},
): SubstrateTelemetry {
  const now = options.now ?? (() => timeAuthority.now().atMs);
  const component = options.component ?? SUBSTRATE_TELEMETRY_COMPONENT;
  const maxBuffered = options.maxBufferedEntries ?? DEFAULT_MAX_BUFFERED_ENTRIES;

  const providers = new Map<string, ProviderState>();
  const buffer: StructuredLogEntry[] = [];
  let eventsIngested = 0;
  let malformedDropped = 0;
  let droppedFromBuffer = 0;

  function pushEntry(entry: StructuredLogEntry): void {
    options.onEntry?.(entry);
    buffer.push(entry);
    while (buffer.length > maxBuffered) {
      buffer.shift();
      droppedFromBuffer += 1;
    }
  }

  function providerState(name: string): ProviderState {
    let state = providers.get(name);
    if (state == null) {
      state = {
        provider: name,
        successes: 0,
        failureAttempts: 0,
        timeouts: 0,
        modeChanges: 0,
        breakerChanges: 0,
        breakerOpens: 0,
        breakerHalfOpens: 0,
        breakerCloses: 0,
        currentMode: null,
        currentBreaker: null,
        degradedEpisodeOpenedAtMs: null,
        degradedEpisodesClosed: 0,
        lastDegradedEpisode: null,
        trustDecisions: 0,
        trustVerdictCounts: emptyTrustCounts(),
        lastTrustVerdict: null,
        lastEventAtMs: null,
        operations: new Map(),
      };
      providers.set(name, state);
    }
    return state;
  }

  function operationState(state: ProviderState, operation: string): OperationState {
    let op = state.operations.get(operation);
    if (op == null) {
      op = {
        provider: state.provider,
        operation,
        successes: 0,
        failureAttempts: 0,
        codes: emptyCodeCounts(),
        lastSuccessDurationMs: null,
        lastFailureAtMs: null,
        lastEventAtMs: null,
      };
      state.operations.set(operation, op);
    }
    return op;
  }

  function ingest(raw: unknown): boolean {
    if (!isValidPolicyEvent(raw)) {
      malformedDropped += 1;
      const kind = isRecord(raw) && typeof raw.kind === "string" ? raw.kind : "unknown";
      pushEntry({
        msg: "substrate-telemetry-malformed-event-dropped",
        level: "warn",
        component,
        event_kind: kind,
      });
      return false;
    }
    eventsIngested += 1;
    const state = providerState(raw.provider);
    state.lastEventAtMs = raw.atMs;

    switch (raw.kind) {
      case "call_succeeded": {
        state.successes += 1;
        const op = operationState(state, raw.operation);
        op.successes += 1;
        op.lastSuccessDurationMs = raw.durationMs;
        op.lastEventAtMs = raw.atMs;
        pushEntry({
          msg: "substrate-adapter-call-succeeded",
          level: "debug",
          component,
          provider: raw.provider,
          operation: raw.operation,
          attempts: raw.attempts,
          duration_ms: raw.durationMs,
        });
        return true;
      }
      case "call_failed": {
        state.failureAttempts += 1;
        if (raw.code === "timeout") state.timeouts += 1;
        const op = operationState(state, raw.operation);
        op.failureAttempts += 1;
        op.codes[raw.code] += 1;
        op.lastFailureAtMs = raw.atMs;
        op.lastEventAtMs = raw.atMs;
        pushEntry({
          msg: "substrate-adapter-call-failed",
          level: "warn",
          component,
          provider: raw.provider,
          operation: raw.operation,
          code: raw.code,
          attempt: raw.attempt,
        });
        return true;
      }
      case "mode_change": {
        state.modeChanges += 1;
        state.currentMode = raw.to;
        if (raw.to === "degraded" && state.degradedEpisodeOpenedAtMs === null) {
          state.degradedEpisodeOpenedAtMs = raw.atMs;
        }
        if (raw.from === "degraded" && state.degradedEpisodeOpenedAtMs !== null) {
          const openedAtMs = state.degradedEpisodeOpenedAtMs;
          state.degradedEpisodeOpenedAtMs = null;
          const closedAtMs = Math.max(openedAtMs, raw.atMs);
          state.degradedEpisodesClosed += 1;
          state.lastDegradedEpisode = {
            openedAtMs,
            closedAtMs,
            openMs: closedAtMs - openedAtMs,
          };
        }
        pushEntry({
          msg: "substrate-adapter-mode-change",
          level: raw.to === "degraded" ? "warn" : "info",
          component,
          provider: raw.provider,
          from: raw.from,
          to: raw.to,
        });
        return true;
      }
      case "breaker_change": {
        state.breakerChanges += 1;
        state.currentBreaker = raw.to;
        if (raw.to === "open") state.breakerOpens += 1;
        if (raw.to === "half_open") state.breakerHalfOpens += 1;
        if (raw.to === "closed") state.breakerCloses += 1;
        pushEntry({
          msg: "substrate-adapter-breaker-change",
          level: raw.to === "open" ? "error" : raw.to === "half_open" ? "warn" : "info",
          component,
          provider: raw.provider,
          from: raw.from,
          to: raw.to,
        });
        return true;
      }
      case "trust_decision": {
        state.trustDecisions += 1;
        state.trustVerdictCounts[raw.verdict] += 1;
        state.lastTrustVerdict = raw.verdict;
        pushEntry({
          msg: "substrate-adapter-trust-decision",
          level: raw.verdict === "untrusted" ? "warn" : "info",
          component,
          provider: raw.provider,
          verdict: raw.verdict,
        });
        return true;
      }
    }
  }

  function toOperationTelemetry(op: OperationState): OperationTelemetry {
    return { ...op, codes: { ...op.codes } };
  }

  function toProviderTelemetry(state: ProviderState): ProviderTelemetry {
    const openedAtMs = state.degradedEpisodeOpenedAtMs;
    return {
      provider: state.provider,
      successes: state.successes,
      failureAttempts: state.failureAttempts,
      timeouts: state.timeouts,
      modeChanges: state.modeChanges,
      breakerChanges: state.breakerChanges,
      breakerOpens: state.breakerOpens,
      breakerHalfOpens: state.breakerHalfOpens,
      breakerCloses: state.breakerCloses,
      currentMode: state.currentMode,
      currentBreaker: state.currentBreaker,
      degradedEpisodeOpen: openedAtMs !== null,
      degradedEpisodeOpenedAtMs: openedAtMs,
      degradedEpisodeOpenMs: openedAtMs === null ? null : Math.max(0, now() - openedAtMs),
      degradedEpisodesClosed: state.degradedEpisodesClosed,
      lastDegradedEpisode: state.lastDegradedEpisode == null
        ? null
        : { ...state.lastDegradedEpisode },
      trustDecisions: state.trustDecisions,
      trustVerdictCounts: { ...state.trustVerdictCounts },
      lastTrustVerdict: state.lastTrustVerdict,
      lastEventAtMs: state.lastEventAtMs,
      operations: [...state.operations.values()]
        .map(toOperationTelemetry)
        .sort((a, b) => (a.operation < b.operation ? -1 : a.operation > b.operation ? 1 : 0)),
    };
  }

  return {
    sink(): (event: AdapterPolicyEvent) => void {
      return (event) => {
        ingest(event);
      };
    },

    ingest,

    snapshot(): SubstrateTelemetrySnapshot {
      return {
        eventsIngested,
        malformedEventsDropped: malformedDropped,
        logEntriesBuffered: buffer.length,
        logEntriesDropped: droppedFromBuffer,
        providers: [...providers.values()]
          .map(toProviderTelemetry)
          .sort((a, b) => (a.provider < b.provider ? -1 : a.provider > b.provider ? 1 : 0)),
      };
    },

    provider(name: string): ProviderTelemetry | null {
      const state = providers.get(name);
      return state == null ? null : toProviderTelemetry(state);
    },

    operation(providerName: string, operation: string): OperationTelemetry | null {
      const state = providers.get(providerName);
      if (state == null) return null;
      const op = state.operations.get(operation);
      return op == null ? null : toOperationTelemetry(op);
    },

    bufferedLogCount(): number {
      return buffer.length;
    },

    takeLogEntries(): StructuredLogEntry[] {
      return buffer.splice(0, buffer.length);
    },

    emitPendingLogs(emitOptions: LogEmitOptions = {}): number {
      const entries = this.takeLogEntries();
      for (const entry of entries) {
        logStructured(entry, { ...emitOptions });
      }
      return entries.length;
    },
  };
}
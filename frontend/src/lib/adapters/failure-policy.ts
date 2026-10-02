import { SystemClock, TimeAuthority } from "../kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

/**
 * CoreGrid — external adapter failure-semantics contract (J-045, V1CAP-080,
 * MISSION-R-72; E-060: external systems are never automatically trusted).
 *
 * The one pattern every external adapter inherits. Composition, not rewrite:
 * adapters declare a policy instance and wrap their external calls — public
 * contracts stay untouched. The policy owns five semantics at the call
 * boundary:
 *
 * 1. Bounded timeouts — every external call is raced against a per-call
 *    deadline enforced by the injected {@link AdapterClock}. A hung provider
 *    can never hang the host loop; the losing promise is abandoned inside the
 *    boundary.
 * 2. Error containment — an adapter failure is converted into a structured
 *    result and never escapes the call boundary. A throwing provider cannot
 *    crash the host loop or corrupt canonical state; failures stop at the
 *    boundary. Containment extends to policy-internal defects.
 * 3. Degraded mode — consecutive failures move the adapter into an explicit,
 *    recorded degraded episode: observable via {@link AdapterFailurePolicy.snapshot},
 *    announced on the event sink (never silent), and time-bounded — every
 *    episode carries an expiry and is re-armed by further failures, cleared
 *    by the first success.
 * 4. Retry with caps + deterministic backoff — retries are bounded by
 *    `maxAttempts`, use pure exponential backoff (`base * 2^n`, capped), and
 *    honor a per-call retryability predicate. The injected clock makes the
 *    whole loop deterministic and test-friendly.
 * 5. Circuit breaker — after `breakerFailureThreshold` consecutive failures
 *    the breaker opens and calls are denied WITHOUT provider contact; after
 *    `breakerResetMs` a single half-open probe is admitted; success closes,
 *    failure re-opens. Concurrent half-open probes are denied.
 *
 * Finally, every attempt feeds a per-provider trust ledger: the failure
 * history computes a trust RECOMMENDATION, but a trust decision is only ever
 * recorded explicitly ({@link AdapterFailurePolicy.recordTrustDecision}).
 * The recommendation verdict space never contains "trusted" — external
 * systems are never automatically trusted (E-060).
 *
 * Boundary semantics: "success" means the call RESOLVED (transport-level
 * health); structured provider-level failures (e.g. a delivery failure
 * result) pass through unchanged and are the adapter contract's own
 * vocabulary. I/O-bearing calls go through {@link AdapterFailurePolicy.run};
 * purely local operations (no I/O to time out) use
 * {@link AdapterFailurePolicy.containSync}, which contains and records but
 * never gates — local verification must keep working even while a provider
 * is distrusted.
 */

/* ─────────────────────────────────────────────────────────────
 * Clock (deterministic, test-friendly)
 * ────────────────────────────────────────────────────────────*/

export interface AdapterClock {
  /** Wall/virtual time in ms driving every deadline and duration. */
  nowMs(): number;
  /** Await a delay of `ms`; the implementation owns how time passes. */
  delay(ms: number): Promise<void>;
}

export const systemClock: AdapterClock = {
  nowMs: () => timeAuthority.now().atMs,
  delay: (ms: number) =>
    new Promise<void>((resolve) => {
      setTimeout(resolve, ms);
    }),
};

/* ─────────────────────────────────────────────────────────────
 * Vocabulary
 * ────────────────────────────────────────────────────────────*/

export type AdapterErrorCode = "timeout" | "provider_error" | "breaker_open";

export type AdapterMode = "healthy" | "degraded" | "isolated";

export type BreakerState = "closed" | "open" | "half_open";

export type TrustVerdict = "trusted" | "untrusted" | "unproven";

/** Pure exponential backoff with a cap: `min(cap, base * 2^(attempt-1))`. */
export function computeBackoffMs(attempt: number, baseMs: number, capMs: number): number {
  const exponent = Math.max(0, Math.floor(attempt) - 1);
  return Math.min(capMs, baseMs * 2 ** exponent);
}

export function describeError(err: unknown): string {
  if (err instanceof Error) return err.message;
  if (typeof err === "string") return err;
  if (typeof err === "object" && err !== null) {
    try {
      return JSON.stringify(err);
    } catch {
      return "[unserializable error]";
    }
  }
  return String(err);
}

/* ─────────────────────────────────────────────────────────────
 * Events (degraded mode is never silent)
 * ────────────────────────────────────────────────────────────*/

export type AdapterPolicyEvent =
  | {
      kind: "call_failed";
      provider: string;
      operation: string;
      code: AdapterErrorCode;
      attempt: number;
      atMs: number;
      reason: string;
    }
  | {
      kind: "call_succeeded";
      provider: string;
      operation: string;
      attempts: number;
      durationMs: number;
      atMs: number;
    }
  | {
      kind: "mode_change";
      provider: string;
      from: AdapterMode;
      to: AdapterMode;
      atMs: number;
      reason: string;
    }
  | {
      kind: "breaker_change";
      provider: string;
      from: BreakerState;
      to: BreakerState;
      atMs: number;
      reason: string;
    }
  | {
      kind: "trust_decision";
      provider: string;
      verdict: TrustVerdict;
      atMs: number;
      reason: string;
    };

/* ─────────────────────────────────────────────────────────────
 * Trust decision record (E-060: never automatically trusted)
 * ────────────────────────────────────────────────────────────*/

export interface ProviderTrustBasis {
  provider: string;
  /** Recorded attempt outcomes (each retry attempt counts). */
  totalCalls: number;
  totalFailures: number;
  consecutiveFailures: number;
  /** failures / calls; null while no outcome has been recorded. */
  failureRate: number | null;
  lastFailureAtMs: number | null;
}

/**
 * The computed recommendation. The verdict space deliberately EXCLUDES
 * "trusted": no amount of success history promotes a provider automatically.
 */
export interface ProviderTrustRecommendation {
  provider: string;
  verdict: "untrusted" | "unproven";
  reason: string;
  recommendedAtMs: number;
  basis: ProviderTrustBasis;
}

/** An explicitly recorded decision (by a human or governed process). */
export interface ProviderTrustDecision {
  provider: string;
  verdict: TrustVerdict;
  reason: string;
  decidedBy: string;
  decidedAtMs: number;
  /** Failure history the decision was based on (provenance). */
  basis: ProviderTrustBasis;
}

/** Minimum sample before failure-rate evidence counts toward distrust. */
const MIN_TRUST_SAMPLE = 5;
/** Failure rate at/above which the recommendation is "untrusted". */
const UNTRUST_FAILURE_RATE = 0.5;

/* ─────────────────────────────────────────────────────────────
 * Configuration (fail fast on misconfiguration at construction)
 * ────────────────────────────────────────────────────────────*/

export interface AdapterFailurePolicyConfig {
  /** Stable provider identity for observability and trust records. */
  provider: string;
  /** Per-call deadline in ms, enforced at the call boundary. */
  timeoutMs: number;
  /** Total attempts per call (first try + retries); minimum 1. */
  maxAttempts: number;
  /** Deterministic backoff base and cap in ms. */
  backoffBaseMs: number;
  backoffCapMs: number;
  /** Consecutive failures that arm degraded mode (≤ breaker threshold). */
  degradedAfterFailures: number;
  /** Time bound of one degraded episode; re-armed by further failures. */
  degradedWindowMs: number;
  /** Consecutive failures that open the breaker. */
  breakerFailureThreshold: number;
  /** How long an open breaker waits before admitting a half-open probe. */
  breakerResetMs: number;
  /** Injectable clock; defaults to the system clock. */
  clock?: AdapterClock;
  /** Observability sink for state transitions and call outcomes. */
  onEvent?: (event: AdapterPolicyEvent) => void;
}

function requirePositiveNumber(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(
      `AdapterFailurePolicy.${name} must be a finite positive number (received ${String(value)})`,
    );
  }
}

function requirePositiveInteger(name: string, value: number): void {
  requirePositiveNumber(name, value);
  if (!Number.isInteger(value)) {
    throw new TypeError(
      `AdapterFailurePolicy.${name} must be an integer (received ${String(value)})`,
    );
  }
}

function validateConfig(config: AdapterFailurePolicyConfig): void {
  if (typeof config.provider !== "string" || config.provider.trim() === "") {
    throw new TypeError("AdapterFailurePolicy.provider must be a non-empty string");
  }
  requirePositiveNumber("timeoutMs", config.timeoutMs);
  requirePositiveInteger("maxAttempts", config.maxAttempts);
  requirePositiveNumber("backoffBaseMs", config.backoffBaseMs);
  requirePositiveNumber("backoffCapMs", config.backoffCapMs);
  if (config.backoffCapMs < config.backoffBaseMs) {
    throw new TypeError("AdapterFailurePolicy.backoffCapMs must be >= backoffBaseMs");
  }
  requirePositiveInteger("degradedAfterFailures", config.degradedAfterFailures);
  requirePositiveNumber("degradedWindowMs", config.degradedWindowMs);
  requirePositiveInteger("breakerFailureThreshold", config.breakerFailureThreshold);
  requirePositiveNumber("breakerResetMs", config.breakerResetMs);
  if (config.degradedAfterFailures > config.breakerFailureThreshold) {
    throw new TypeError(
      "AdapterFailurePolicy.degradedAfterFailures must be <= breakerFailureThreshold (degraded mode must engage no later than isolation)",
    );
  }
}

/* ─────────────────────────────────────────────────────────────
 * Results
 * ────────────────────────────────────────────────────────────*/

export interface AdapterCallOk<T> {
  outcome: "ok";
  value: T;
  attempts: number;
  durationMs: number;
  /** Effective adapter mode at completion. */
  mode: AdapterMode;
}

export interface AdapterCallError {
  outcome: "error";
  code: AdapterErrorCode;
  reason: string;
  attempts: number;
  durationMs: number;
  mode: AdapterMode;
  /** Contained provider error detail, when one existed. */
  cause: string | null;
}

/** A call result. Errors are returned, NEVER thrown. */
export type AdapterCallResult<T> = AdapterCallOk<T> | AdapterCallError;

export interface AdapterCallSpec<T> {
  /** Stable operation name for events and trust records. */
  operation: string;
  /** The external call. Anything it throws or hangs is contained. */
  call: () => Promise<T>;
  /** Per-call attempts override; defaults to the declared `maxAttempts`. */
  maxAttempts?: number;
  /** Per-call retryability predicate; defaults to "retry every failure". */
  retryable?: (code: AdapterErrorCode) => boolean;
}

export interface AdapterPolicySnapshot {
  provider: string;
  mode: AdapterMode;
  breaker: BreakerState;
  breakerOpenedAtMs: number | null;
  breakerNextProbeAtMs: number | null;
  degradedActive: boolean;
  degradedSinceMs: number | null;
  degradedUntilMs: number | null;
  /** True when the recorded degraded episode's window has elapsed. */
  degradedExpired: boolean;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  totalCalls: number;
  totalFailures: number;
  totalTimeouts: number;
  lastError: { code: AdapterErrorCode; reason: string; atMs: number } | null;
  /** Explicitly decided verdict; "unproven" until a decision is recorded. */
  trustVerdict: TrustVerdict;
  /** The declared thresholds this adapter inherited (observability). */
  declared: {
    timeoutMs: number;
    maxAttempts: number;
    degradedAfterFailures: number;
    degradedWindowMs: number;
    breakerFailureThreshold: number;
    breakerResetMs: number;
  };
}

/* ─────────────────────────────────────────────────────────────
 * Policy engine
 * ────────────────────────────────────────────────────────────*/

type AttemptFailure = { code: AdapterErrorCode; reason: string; cause: string | null };

type AttemptWinner<T> =
  { tag: "value"; value: T } | { tag: "provider_error"; reason: string } | { tag: "timeout" };

export class AdapterFailurePolicy {
  private readonly cfg: Required<
    Pick<
      AdapterFailurePolicyConfig,
      | "provider"
      | "timeoutMs"
      | "maxAttempts"
      | "backoffBaseMs"
      | "backoffCapMs"
      | "degradedAfterFailures"
      | "degradedWindowMs"
      | "breakerFailureThreshold"
      | "breakerResetMs"
    >
  > &
    AdapterFailurePolicyConfig;
  private readonly clock: AdapterClock;

  private breakerState: BreakerState = "closed";
  private breakerOpenedAtMs: number | null = null;
  private breakerNextProbeAtMs: number | null = null;
  private probeInFlight = false;

  private degradedSinceMs: number | null = null;
  private degradedUntilMs: number | null = null;

  private consecutiveFailures = 0;
  private consecutiveSuccesses = 0;
  private totalCalls = 0;
  private totalFailures = 0;
  private totalTimeouts = 0;
  private lastError: AdapterPolicySnapshot["lastError"] = null;

  private readonly trustDecisionLog: ProviderTrustDecision[] = [];

  constructor(config: AdapterFailurePolicyConfig) {
    validateConfig(config);
    this.cfg = { ...config };
    this.clock = config.clock ?? systemClock;
  }

  /* ── I/O-bearing execution (timeout + retry + breaker gating) ── */

  async run<T>(spec: AdapterCallSpec<T>): Promise<AdapterCallResult<T>> {
    const startedAt = this.clock.nowMs();
    try {
      return await this.executeRun(spec, startedAt);
    } catch (err) {
      // Containment at the outermost boundary: even a policy-internal defect
      // becomes a structured result — the host loop can never be crashed.
      const reason = describeError(err);
      return {
        outcome: "error",
        code: "provider_error",
        reason: `adapter call contained: ${reason}`,
        attempts: 0,
        durationMs: Math.max(0, this.clock.nowMs() - startedAt),
        mode: this.modeAt(this.clock.nowMs()),
        cause: reason,
      };
    }
  }

  private async executeRun<T>(
    spec: AdapterCallSpec<T>,
    startedAt: number,
  ): Promise<AdapterCallResult<T>> {
    const now = this.clock.nowMs();
    if (this.breakerState === "open") {
      if (now >= (this.breakerNextProbeAtMs ?? Number.MAX_SAFE_INTEGER)) {
        this.setBreaker("half_open", "reset window elapsed; admitting a single probe");
      } else {
        return this.denyBreaker(startedAt, "circuit is open");
      }
    }
    const isProbe = this.breakerState === "half_open";
    if (isProbe) {
      if (this.probeInFlight) {
        return this.denyBreaker(startedAt, "a half-open probe is already in flight");
      }
      this.probeInFlight = true;
    }
    try {
      const attemptsAllowed = isProbe ? 1 : resolveAttempts(spec.maxAttempts, this.cfg.maxAttempts);
      let lastFailure: AttemptFailure | null = null;
      let attemptsMade = 0;

      for (let attempt = 1; attempt <= attemptsAllowed; attempt += 1) {
        attemptsMade += 1;
        const attemptResult = await this.attemptOnce(spec.operation, spec.call);
        if (attemptResult.outcome === "ok") {
          this.recordSuccess(spec.operation, attempt, attemptResult.durationMs);
          return {
            outcome: "ok",
            value: attemptResult.value,
            attempts: attempt,
            durationMs: attemptResult.durationMs,
            mode: this.modeAt(this.clock.nowMs()),
          };
        }
        lastFailure = {
          code: attemptResult.code,
          reason: attemptResult.reason,
          cause: attemptResult.cause,
        };
        this.recordFailure(spec.operation, lastFailure, attempt);

        if (isProbe) {
          this.probeInFlight = false;
          this.setBreaker("open", "half-open probe failed");
          this.breakerNextProbeAtMs = this.clock.nowMs() + this.cfg.breakerResetMs;
          break;
        }
        if (this.isBreakerOpen()) break;

        if (attempt < attemptsAllowed) {
          const retryable = spec.retryable ?? ((code: AdapterErrorCode) => true);
          if (!retryable(lastFailure.code)) break;
          await this.clock.delay(
            computeBackoffMs(attempt, this.cfg.backoffBaseMs, this.cfg.backoffCapMs),
          );
          if (this.isBreakerOpen()) break;
        }
      }

      const failure: AttemptFailure = lastFailure ?? {
        code: "provider_error",
        reason: "adapter call produced no attempt",
        cause: null,
      };
      return {
        outcome: "error",
        code: failure.code,
        reason: failure.reason,
        attempts: attemptsMade,
        durationMs: Math.max(0, this.clock.nowMs() - startedAt),
        mode: this.modeAt(this.clock.nowMs()),
        cause: failure.cause,
      };
    } finally {
      if (isProbe) this.probeInFlight = false;
    }
  }

  private denyBreaker(startedAt: number, why: string): AdapterCallError {
    return {
      outcome: "error",
      code: "breaker_open",
      reason: `call denied without provider contact: ${why}`,
      attempts: 0,
      durationMs: Math.max(0, this.clock.nowMs() - startedAt),
      mode: this.modeAt(this.clock.nowMs()),
      cause: null,
    };
  }

  private async attemptOnce<T>(
    operation: string,
    call: () => Promise<T>,
  ): Promise<
    | { outcome: "ok"; value: T; durationMs: number }
    | ({ outcome: "error"; durationMs: number } & AttemptFailure)
  > {
    const startedAt = this.clock.nowMs();
    let callPromise: Promise<T>;
    try {
      callPromise = call();
    } catch (err) {
      // A provider that throws synchronously is still contained and recorded
      // through the same failure path as an async rejection.
      callPromise = Promise.reject(err);
    }
    const callWinner: Promise<AttemptWinner<T>> = callPromise.then(
      (value: T): AttemptWinner<T> => ({ tag: "value", value }),
      (err: unknown): AttemptWinner<T> => ({ tag: "provider_error", reason: describeError(err) }),
    );
    const timeoutWinner: Promise<AttemptWinner<T>> = this.clock
      .delay(this.cfg.timeoutMs)
      .then((): AttemptWinner<T> => ({ tag: "timeout" }));
    const winner = await Promise.race([callWinner, timeoutWinner]);
    const durationMs = Math.max(0, this.clock.nowMs() - startedAt);
    if (winner.tag === "timeout") {
      return {
        outcome: "error",
        code: "timeout",
        reason: `${operation} exceeded the ${this.cfg.timeoutMs}ms adapter timeout`,
        cause: null,
        durationMs,
      };
    }
    if (winner.tag === "provider_error") {
      return {
        outcome: "error",
        code: "provider_error",
        reason: winner.reason,
        cause: winner.reason,
        durationMs,
      };
    }
    return { outcome: "ok", value: winner.value, durationMs };
  }

  /* ── Local (non-I/O) containment — records but never gates ── */

  containSync<T>(operation: string, fn: () => T): AdapterCallResult<T> {
    try {
      return this.containSyncInner(operation, fn);
    } catch (err) {
      const reason = describeError(err);
      return {
        outcome: "error",
        code: "provider_error",
        reason: `adapter call contained: ${reason}`,
        attempts: 0,
        durationMs: 0,
        mode: this.modeAt(this.clock.nowMs()),
        cause: reason,
      };
    }
  }

  private containSyncInner<T>(operation: string, fn: () => T): AdapterCallResult<T> {
    const startedAt = this.clock.nowMs();
    let value: T;
    try {
      value = fn();
    } catch (err) {
      const reason = describeError(err);
      const failure: AttemptFailure = { code: "provider_error", reason, cause: reason };
      this.recordFailure(operation, failure, 1);
      return {
        outcome: "error",
        code: failure.code,
        reason: `${operation} failed and was contained: ${reason}`,
        attempts: 1,
        durationMs: Math.max(0, this.clock.nowMs() - startedAt),
        mode: this.modeAt(this.clock.nowMs()),
        cause: reason,
      };
    }
    const durationMs = Math.max(0, this.clock.nowMs() - startedAt);
    this.recordSuccess(operation, 1, durationMs);
    return {
      outcome: "ok",
      value,
      attempts: 1,
      durationMs,
      mode: this.modeAt(this.clock.nowMs()),
    };
  }

  /* ── Recording (shared by run + containSync) ── */

  private recordSuccess(operation: string, attempts: number, durationMs: number): void {
    const atMs = this.clock.nowMs();
    this.consecutiveFailures = 0;
    this.consecutiveSuccesses += 1;
    this.totalCalls += 1;
    this.emit({
      kind: "call_succeeded",
      provider: this.cfg.provider,
      operation,
      attempts,
      durationMs,
      atMs,
    });
    if (this.breakerState === "half_open") {
      this.setBreaker("closed", "half-open probe succeeded");
      this.breakerOpenedAtMs = null;
      this.breakerNextProbeAtMs = null;
    }
    if (this.degradedSinceMs !== null) {
      this.degradedSinceMs = null;
      this.degradedUntilMs = null;
      this.emit({
        kind: "mode_change",
        provider: this.cfg.provider,
        from: "degraded",
        to: "healthy",
        atMs,
        reason: "call succeeded; degraded episode cleared",
      });
    }
  }

  private recordFailure(operation: string, failure: AttemptFailure, attempt: number): void {
    const atMs = this.clock.nowMs();
    this.consecutiveFailures += 1;
    this.consecutiveSuccesses = 0;
    this.totalCalls += 1;
    this.totalFailures += 1;
    if (failure.code === "timeout") this.totalTimeouts += 1;
    this.lastError = { code: failure.code, reason: failure.reason, atMs };
    this.emit({
      kind: "call_failed",
      provider: this.cfg.provider,
      operation,
      code: failure.code,
      attempt,
      atMs,
      reason: failure.reason,
    });

    if (this.consecutiveFailures >= this.cfg.degradedAfterFailures) {
      const wasDegraded = this.degradedSinceMs !== null;
      const from: AdapterMode = wasDegraded ? "degraded" : "healthy";
      this.degradedSinceMs = this.degradedSinceMs ?? atMs;
      this.degradedUntilMs = atMs + this.cfg.degradedWindowMs;
      if (!wasDegraded) {
        this.emit({
          kind: "mode_change",
          provider: this.cfg.provider,
          from,
          to: "degraded",
          atMs,
          reason: `${this.consecutiveFailures} consecutive failures reached the degraded threshold (${this.cfg.degradedAfterFailures})`,
        });
      }
    }

    if (
      this.breakerState === "closed" &&
      this.consecutiveFailures >= this.cfg.breakerFailureThreshold
    ) {
      this.setBreaker(
        "open",
        `${this.consecutiveFailures} consecutive failures reached the breaker threshold (${this.cfg.breakerFailureThreshold})`,
      );
      this.breakerNextProbeAtMs = atMs + this.cfg.breakerResetMs;
    }
  }

  private setBreaker(to: BreakerState, reason: string): void {
    const from = this.breakerState;
    if (from === to) return;
    this.breakerState = to;
    if (to === "open") this.breakerOpenedAtMs = this.clock.nowMs();
    this.emit({
      kind: "breaker_change",
      provider: this.cfg.provider,
      from,
      to,
      atMs: this.clock.nowMs(),
      reason,
    });
  }

  private modeAt(atMs: number): AdapterMode {
    if (this.breakerState !== "closed") return "isolated";
    if (this.degradedSinceMs !== null && atMs < (this.degradedUntilMs ?? 0)) return "degraded";
    return "healthy";
  }

  /** Read the breaker state through a call so control-flow narrowing of the
   * property never hides mutations made by recordFailure/setBreaker. */
  private isBreakerOpen(): boolean {
    return this.breakerState === "open";
  }

  private emit(event: AdapterPolicyEvent): void {
    const sink = this.cfg.onEvent;
    if (!sink) return;
    try {
      sink(event);
    } catch {
      // Observability must never break containment.
    }
  }

  /* ── Observation ── */

  snapshot(nowMs?: number): AdapterPolicySnapshot {
    const at = nowMs ?? this.clock.nowMs();
    const degradedActive = this.degradedSinceMs !== null;
    return {
      provider: this.cfg.provider,
      mode: this.modeAt(at),
      breaker: this.breakerState,
      breakerOpenedAtMs: this.breakerOpenedAtMs,
      breakerNextProbeAtMs: this.breakerNextProbeAtMs,
      degradedActive,
      degradedSinceMs: this.degradedSinceMs,
      degradedUntilMs: this.degradedUntilMs,
      degradedExpired: degradedActive && at >= (this.degradedUntilMs ?? 0),
      consecutiveFailures: this.consecutiveFailures,
      consecutiveSuccesses: this.consecutiveSuccesses,
      totalCalls: this.totalCalls,
      totalFailures: this.totalFailures,
      totalTimeouts: this.totalTimeouts,
      lastError: this.lastError,
      trustVerdict: this.currentTrustVerdict(),
      declared: {
        timeoutMs: this.cfg.timeoutMs,
        maxAttempts: this.cfg.maxAttempts,
        degradedAfterFailures: this.cfg.degradedAfterFailures,
        degradedWindowMs: this.cfg.degradedWindowMs,
        breakerFailureThreshold: this.cfg.breakerFailureThreshold,
        breakerResetMs: this.cfg.breakerResetMs,
      },
    };
  }

  /* ── Trust (E-060) ── */

  trustBasis(): ProviderTrustBasis {
    return {
      provider: this.cfg.provider,
      totalCalls: this.totalCalls,
      totalFailures: this.totalFailures,
      consecutiveFailures: this.consecutiveFailures,
      failureRate: this.totalCalls === 0 ? null : this.totalFailures / this.totalCalls,
      lastFailureAtMs: this.lastError?.atMs ?? null,
    };
  }

  /** A recommendation only — never a decision, never "trusted". */
  recommendTrust(nowMs?: number): ProviderTrustRecommendation {
    const basis = this.trustBasis();
    const recommendedAtMs = nowMs ?? this.clock.nowMs();
    if (basis.totalCalls === 0) {
      return {
        provider: this.cfg.provider,
        verdict: "unproven",
        reason:
          "no call outcomes recorded; external systems are never automatically trusted (E-060)",
        recommendedAtMs,
        basis,
      };
    }
    const rateEvidence =
      basis.failureRate !== null &&
      basis.totalCalls >= MIN_TRUST_SAMPLE &&
      basis.failureRate >= UNTRUST_FAILURE_RATE;
    if (basis.consecutiveFailures >= this.cfg.breakerFailureThreshold || rateEvidence) {
      return {
        provider: this.cfg.provider,
        verdict: "untrusted",
        reason: `failure history exceeds the trust floor (consecutive=${basis.consecutiveFailures}, threshold=${this.cfg.breakerFailureThreshold}, rate=${basis.failureRate === null ? "n/a" : basis.failureRate.toFixed(3)})`,
        recommendedAtMs,
        basis,
      };
    }
    return {
      provider: this.cfg.provider,
      verdict: "unproven",
      reason:
        "failure history does not yet warrant distrust; trust is never granted automatically (E-060)",
      recommendedAtMs,
      basis,
    };
  }

  /** Record an EXPLICIT trust decision (human or governed process). */
  recordTrustDecision(input: {
    verdict: TrustVerdict;
    reason: string;
    decidedBy: string;
    atMs?: number;
  }): ProviderTrustDecision {
    const decidedAtMs = input.atMs ?? this.clock.nowMs();
    const decision: ProviderTrustDecision = {
      provider: this.cfg.provider,
      verdict: input.verdict,
      reason: input.reason,
      decidedBy: input.decidedBy,
      decidedAtMs,
      basis: this.trustBasis(),
    };
    this.trustDecisionLog.push(decision);
    this.emit({
      kind: "trust_decision",
      provider: this.cfg.provider,
      verdict: input.verdict,
      atMs: decidedAtMs,
      reason: input.reason,
    });
    return decision;
  }

  /** Immutable audit trail of explicit trust decisions. */
  trustDecisions(): readonly ProviderTrustDecision[] {
    return [...this.trustDecisionLog];
  }

  /** "unproven" until an explicit decision is recorded. */
  currentTrustVerdict(): TrustVerdict {
    const last = this.trustDecisionLog[this.trustDecisionLog.length - 1];
    return last?.verdict ?? "unproven";
  }
}

function resolveAttempts(override: number | undefined, declared: number): number {
  if (override === undefined) return declared;
  if (!Number.isFinite(override) || override < 1) return declared;
  return Math.floor(override);
}

export function createAdapterFailurePolicy(
  config: AdapterFailurePolicyConfig,
): AdapterFailurePolicy {
  return new AdapterFailurePolicy(config);
}

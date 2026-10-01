/**
 * CoreGrid — single time-source authority (V1CAP-045 / J-023 / MISSION-R-15).
 *
 * THE authoritative clock contract for the platform. E-015 names time
 * primitives and the assurance invariant that event ordering IS the ordering
 * of the loop tail (STREAM J J-023); G-023's UUIDv7 embeds a timestamp, so
 * clock discipline is structurally load-bearing for ID ordering too. Yet no
 * stream names a single clock — this module IS that contract.
 *
 * Law of this module:
 * - No module samples the wall clock directly for a consequential decision.
 *   Modules request time from the authority by injecting a `Clock`; the
 *   authority is the ONLY place a wall clock is sampled.
 * - Issued timestamps are MONOTONIC: an issuance never goes backwards, even
 *   when the injected clock regresses. A regression within the skew
 *   tolerance is clamped (the issued instant holds at the last issued one);
 *   a regression beyond the tolerance FAILS CLOSED with a typed error — a
 *   badly broken clock must halt consequential issuance, not silently lie.
 * - Every issued timestamp is AUDITABLE: it carries a strictly increasing
 *   issuance `sequence` and the `issuer` identity, and the authority keeps
 *   the issuance log (durable persistence arrives with the substrate).
 * - Skew rules for distributed writers: the TOTAL ORDER of issued time is
 *   (atMs, sequence, issuer) — never the wall reading alone. Two writers
 *   sampling the same millisecond still order deterministically by sequence
 *   and issuer; out-of-order writers cannot corrupt ordering because the
 *   monotonic issuance holds the line.
 * - UUIDv7 ID ordering dependency (G-023, documented per T1): a UUIDv7's
 *   embedded millisecond timestamp IS a clock sample. UUIDv7 IDs must mint
 *   their time fields from an authority-issued timestamp, never from a raw
 *   `Date.now()`; and event/record ordering must NEVER rely on IDs alone —
 *   it uses the issued (atMs, sequence, issuer) order, which is why ID
 *   inversion under clock skew cannot reorder history.
 * - Anti-pattern detection: a raw number (`Date.now()`) or a bare string
 *   carries NO issuance provenance (sequence, issuer) and is rejected by
 *   the guard helpers. Consequential consumers accept only issued shapes.
 *
 * Boundary: pure in-process module, no persistence, no I/O. Time enters
 * ONLY through the injected `Clock`; the deterministic test clocks make
 * every consumer testable without waiting on real time.
 */

import { createHash } from "node:crypto";

/* ─────────────────────────────────────────────────────────────
 * Injected clock contract
 * ────────────────────────────────────────────────────────────*/

/**
 * A time source the authority may sample. `issuer` identifies the clock in
 * every audit record (Constitution §12 provenance: every timestamp answers
 * "where did this time come from").
 */
export interface Clock {
  readonly issuer: string;
  /** Sample the underlying clock in epoch milliseconds. */
  nowMs(): number;
}

/** The production adapter — the ONLY sanctioned wall-clock sample site. */
export class SystemClock implements Clock {
  readonly issuer = "clock:system";
  nowMs(): number {
    return Date.now();
  }
}

/** Deterministic test clock frozen at one instant. */
export class FixedClock implements Clock {
  readonly issuer: string;
  constructor(
    private readonly ms: number,
    issuer = "clock:fixed",
  ) {
    if (!Number.isFinite(ms)) throw new Error("time_authority: fixed clock requires a finite instant");
    this.issuer = issuer;
  }
  nowMs(): number {
    return this.ms;
  }
}

/**
 * Deterministic test clock that advances by a fixed step on every sample —
 * the canonical monotonic deterministic implementation for suites.
 */
export class SteppedClock implements Clock {
  readonly issuer: string;
  private current: number;
  constructor(
    startMs: number,
    private readonly stepMs: number,
    issuer = "clock:stepped",
  ) {
    if (!Number.isFinite(startMs) || !Number.isFinite(stepMs) || stepMs <= 0) {
      throw new Error("time_authority: stepped clock requires a finite start and a positive step");
    }
    this.current = startMs;
    this.issuer = issuer;
  }
  nowMs(): number {
    const sample = this.current;
    this.current += this.stepMs;
    return sample;
  }
}

/* ─────────────────────────────────────────────────────────────
 * Issued timestamp (the auditable authority shape)
 * ────────────────────────────────────────────────────────────*/

/**
 * A timestamp minted by the authority. The provenance fields (`sequence`,
 * `issuer`) are what distinguish an authoritative time from a raw wall
 * reading: every issued instant answers WHO issued it and WHERE it falls in
 * the issuance order.
 */
export interface IssuedTimestamp {
  /** ISO-8601 UTC representation of the issued instant. */
  readonly at: string;
  /** Epoch milliseconds of the issued instant (monotonic, never backwards). */
  readonly atMs: number;
  /** Strictly increasing issuance sequence across the authority. */
  readonly sequence: number;
  /** The issuer identity (clock + authority) for the audit trail. */
  readonly issuer: string;
}

/** Skew tolerance default: regressions up to this many ms are clamped. */
export const DEFAULT_SKEW_TOLERANCE_MS = 5_000;

/** Typed rejection when the injected clock regresses beyond the tolerance. */
export class ClockRegressionError extends Error {
  readonly observedMs: number;
  readonly lastIssuedMs: number;
  readonly regressionMs: number;

  constructor(observedMs: number, lastIssuedMs: number) {
    const regressionMs = lastIssuedMs - observedMs;
    super(
      `time_authority: clock regression of ${regressionMs}ms exceeds the skew tolerance ` +
        `(observed ${observedMs}, last issued ${lastIssuedMs}) — consequential issuance halted (fail-closed)`,
    );
    this.name = "ClockRegressionError";
    this.observedMs = observedMs;
    this.lastIssuedMs = lastIssuedMs;
    this.regressionMs = regressionMs;
  }
}

/** Typed rejection for any time value lacking issuance provenance. */
export class RawTimeSourceError extends Error {
  constructor(valueType: string) {
    super(
      `time_authority: ${valueType} carries no issuance provenance (sequence/issuer) — ` +
        "consequential decisions must consume a timestamp issued by the TimeAuthority, never a raw wall reading",
    );
    this.name = "RawTimeSourceError";
  }
}

/* ─────────────────────────────────────────────────────────────
 * Anti-pattern guards (raw number/string detection)
 * ────────────────────────────────────────────────────────────*/

/**
 * Shape guard for an authority-issued timestamp: the value must be an object
 * carrying the full issuance provenance — an ISO `at`, a finite `atMs` that
 * `at` parses back to, a non-negative integer `sequence`, and a non-empty
 * `issuer`. A raw number (`Date.now()`), a bare timestamp string, or any
 * object missing provenance FAILS this guard: those shapes cannot answer the
 * audit questions and are rejected by construction.
 */
export function isAuthorityTimestampShape(value: unknown): value is IssuedTimestamp {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<IssuedTimestamp>;
  if (typeof candidate.at !== "string" || !Number.isFinite(Date.parse(candidate.at))) return false;
  if (typeof candidate.atMs !== "number" || !Number.isFinite(candidate.atMs)) return false;
  if (typeof candidate.sequence !== "number" || !Number.isInteger(candidate.sequence) || candidate.sequence < 0) {
    return false;
  }
  if (typeof candidate.issuer !== "string" || candidate.issuer.trim().length === 0) return false;
  return Date.parse(candidate.at) === candidate.atMs;
}

/**
 * Fail-closed guard: return the value when it is a well-formed authority
 * timestamp shape; throw `RawTimeSourceError` otherwise (raw numbers and
 * strings included). Use at the boundary of every consequential consumer.
 */
export function assertAuthorityTimestamp(value: unknown): IssuedTimestamp {
  if (!isAuthorityTimestampShape(value)) {
    throw new RawTimeSourceError(
      typeof value === "number"
        ? "a raw epoch number"
        : typeof value === "string"
          ? "a raw timestamp string"
          : `a ${value === null ? "null" : typeof value} value`,
    );
  }
  return value;
}

/**
 * Deterministic TOTAL ORDER over issued timestamps — the skew rule for
 * distributed writers. Order is (atMs, sequence, issuer): the wall reading
 * is only the first coordinate, so two writers that sampled the same
 * millisecond still order deterministically, and an out-of-order arrival
 * cannot corrupt the order because sequence and issuer break every tie.
 */
export function compareIssued(a: IssuedTimestamp, b: IssuedTimestamp): number {
  if (a.atMs !== b.atMs) return a.atMs < b.atMs ? -1 : 1;
  if (a.sequence !== b.sequence) return a.sequence < b.sequence ? -1 : 1;
  if (a.issuer !== b.issuer) return a.issuer < b.issuer ? -1 : a.issuer > b.issuer ? 1 : 0;
  return 0;
}

/** True when `b` is strictly after `a` in the authority total order. */
export function isAfterInIssuanceOrder(a: IssuedTimestamp, b: IssuedTimestamp): boolean {
  return compareIssued(a, b) < 0;
}

/* ─────────────────────────────────────────────────────────────
 * The authority
 * ────────────────────────────────────────────────────────────*/

export interface TimeAuthorityConfig {
  /**
   * Maximum clock regression tolerated before issuance fails closed. Within
   * the tolerance a regression is treated as skew and the issued instant is
   * clamped to the last issued one (monotonicity holds); beyond it the
   * clock is considered broken and issuance HALTS.
   */
  readonly skewToleranceMs?: number;
  /** Bounded audit trail: maximum issuance log entries retained in memory. */
  readonly maxIssuanceLog?: number;
}

export class TimeAuthority {
  private readonly clock: Clock;
  private readonly skewToleranceMs: number;
  private readonly maxIssuanceLog: number;
  private readonly log: IssuedTimestamp[] = [];
  private last: IssuedTimestamp | null = null;

  constructor(clock: Clock, config: TimeAuthorityConfig = {}) {
    this.clock = clock;
    this.skewToleranceMs = config.skewToleranceMs ?? DEFAULT_SKEW_TOLERANCE_MS;
    this.maxIssuanceLog = config.maxIssuanceLog ?? 10_000;
    if (!Number.isFinite(this.skewToleranceMs) || this.skewToleranceMs < 0) {
      throw new Error("time_authority: skewToleranceMs must be a non-negative finite number");
    }
    if (!Number.isInteger(this.maxIssuanceLog) || this.maxIssuanceLog <= 0) {
      throw new Error("time_authority: maxIssuanceLog must be a positive integer");
    }
  }

  /**
   * Issue the next authoritative timestamp. Monotonic law: the issued
   * `atMs` never goes backwards. When the injected clock regresses within
   * the skew tolerance the issuance CLAMPS to the last issued instant (the
   * sequence still advances, so ordering stays strict); a regression beyond
   * the tolerance throws `ClockRegressionError` and nothing is issued.
   */
  now(): IssuedTimestamp {
    const sample = this.clock.nowMs();
    if (!Number.isFinite(sample)) {
      throw new Error(`time_authority: clock "${this.clock.issuer}" returned a non-finite sample`);
    }
    const previous = this.last;
    if (previous !== null && sample < previous.atMs) {
      const regressionMs = previous.atMs - sample;
      if (regressionMs > this.skewToleranceMs) {
        throw new ClockRegressionError(sample, previous.atMs);
      }
      // Skew within tolerance: clamp forward — never issue a backwards time.
      const clamped: IssuedTimestamp = {
        at: previous.at,
        atMs: previous.atMs,
        sequence: previous.sequence + 1,
        issuer: this.issuer(),
      };
      this.remember(clamped);
      return clamped;
    }
    const atMs = previous === null ? sample : Math.max(sample, previous.atMs);
    const issued: IssuedTimestamp = {
      at: new Date(atMs).toISOString(),
      atMs,
      sequence: previous === null ? 0 : previous.sequence + 1,
      issuer: this.issuer(),
    };
    this.remember(issued);
    return issued;
  }

  /** The most recently issued timestamp, or null before the first issuance. */
  lastIssued(): IssuedTimestamp | null {
    return this.last;
  }

  /**
   * The issuance audit trail (bounded, newest last): every issued timestamp
   * with its sequence and issuer. Durable persistence arrives with the
   * substrate; this in-memory log is the V1 audit reference.
   */
  issuanceLog(): readonly IssuedTimestamp[] {
    return this.log.slice();
  }

  /**
   * Ledger-verified guard: shape-valid AND actually minted by THIS
   * authority. A forged object with the right fields is still rejected —
   * auditability is checked against the issuance log, not the shape alone.
   */
  isAuthorityTimestamp(value: unknown): value is IssuedTimestamp {
    if (!isAuthorityTimestampShape(value)) return false;
    if (value.issuer !== this.issuer()) return false;
    return this.log.some(
      (issued) => issued.sequence === value.sequence && issued.atMs === value.atMs,
    );
  }

  /** The audit issuer identity for every timestamp this authority mints. */
  private issuer(): string {
    return `time-authority:${this.clock.issuer}`;
  }

  private remember(issued: IssuedTimestamp): void {
    this.last = issued;
    this.log.push(issued);
    if (this.log.length > this.maxIssuanceLog) {
      this.log.splice(0, this.log.length - this.maxIssuanceLog);
    }
  }
}

/* ─────────────────────────────────────────────────────────────
 * Deterministic derivation helper (UUIDv7 ordering dependency)
 * ────────────────────────────────────────────────────────────*/

/**
 * Stable time-coordinate for minting time-ordered identifiers (UUIDv7's
 * embedded timestamp field): the issued `atMs` and `sequence` combined so
 * two issuances in the same millisecond never collide. IDs minted from this
 * coordinate sort lexicographically in the authority's total order; IDs
 * minted from anything else have NO ordering guarantee — that is the
 * documented UUIDv7 dependency this contract pins.
 */
export function issuanceCoordinate(issued: IssuedTimestamp): string {
  return createHash("sha256")
    .update([issued.atMs, issued.sequence, issued.issuer].join("|"))
    .digest("hex")
    .slice(0, 32);
}
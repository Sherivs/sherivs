/**
 * CoreGrid — external-adapter failure-semantics contract (H3 wave, mission
 * B-023 / J-045), layered on the existing {@link AdapterFailurePolicy}
 * (`./failure-policy`, read-only import — composition, never modification).
 *
 * WHAT this layer adds on top of the policy engine:
 *
 * 1. Per-provider failure profiles — every external provider must be
 *    DECLARED before it is called. An undeclared provider admits nothing
 *    (`unknown_provider`); there is no permissive default. Declarations are
 *    Zod-validated, bounded (no unbounded timeouts, retry storms, or
 *    degraded windows) and carry provenance (AGENTS §12).
 * 2. Strict provider isolation — each declared provider owns its private
 *    policy instance (ledger, breaker, degraded episode, trust log). One
 *    provider's failure history can never contaminate another's.
 * 3. Gate order (fail closed, cheapest first):
 *      unknown_provider → invalid_call_spec → trust_gate → degraded_denied
 *      → (only then) the policy's timeout/retry/breaker boundary.
 *    A gated call is denied WITHOUT provider contact and recorded.
 * 4. Timeout budget — the declared `timeoutMs` is the only deadline a
 *    provider gets (enforced by the policy); declarations above
 *    `MAX_PROVIDER_TIMEOUT_MS` are rejected at parse time. Retry attempts
 *    can be tightened per call but never expanded beyond the declared cap
 *    (`invalid_call_spec`).
 * 5. Degraded-mode behavior — each provider declares `whileDegraded`:
 *    `"admit"` (keep calling through the degraded episode) or `"deny"`
 *    (calls fail closed while the episode is active). Breaker/open and
 *    half-open recovery is unaffected: an isolated adapter is never in the
 *    degraded mode, so the recovery probe always reaches the policy.
 * 6. Per-provider trust decisions (E-060: external systems are never
 *    automatically trusted) — the gate consults an EFFECTIVE trust verdict:
 *    the last explicit decision when one was recorded, otherwise the
 *    policy's recommendation. The recommendation space can never contain
 *    "trusted", so without an explicit decision a provider is admitted only
 *    while "unproven"; a failure history that exceeds the trust floor denies
 *    all calls at the gate (`trust_gate`) until a governed decision
 *    re-admits the provider. Decisions require a non-empty `decidedBy` and
 *    land in the policy's immutable decision log.
 * 7. Containment all the way down — `run` and `containSync` return
 *    structured results and NEVER throw; even a defect inside this layer is
 *    contained as `internal_defect`. Every gate denial and every policy
 *    event is appended to an in-memory audit trail (denials are never
 *    silent); a sink may be injected, and a throwing sink can never break
 *    containment.
 *
 * Pure in-process contract: no I/O, no persistence, no vendors, no secrets,
 * no implicit timers — all time flows from the injected {@link AdapterClock}.
 */

import { z } from "zod";
import {
  createAdapterFailurePolicy,
  describeError,
  systemClock,
  type AdapterCallResult,
  type AdapterClock,
  type AdapterErrorCode,
  type AdapterPolicyEvent,
  type AdapterPolicySnapshot,
  type ProviderTrustDecision,
  type TrustVerdict,
} from "./failure-policy";

/* ─────────────────────────────────────────────────────────────
 * Bounded declarations (no unbounded failure budgets)
 * ────────────────────────────────────────────────────────────*/

/** Hard ceiling on any per-call provider timeout, in ms (60s). */
export const MAX_PROVIDER_TIMEOUT_MS = 60_000;

/** Hard ceiling on attempts per call (first try + retries). */
export const MAX_ATTEMPTS_PER_CALL = 8;

/** Hard ceiling on any backoff value, in ms (60s). */
export const MAX_BACKOFF_MS = 60_000;

/** Hard ceiling on one degraded episode, in ms (5 min). */
export const MAX_DEGRADED_WINDOW_MS = 300_000;

/** Hard ceiling on the breaker reset window, in ms (5 min). */
export const MAX_BREAKER_RESET_MS = 300_000;

/** Hard ceiling on the breaker failure threshold. */
export const MAX_BREAKER_THRESHOLD = 100;

/* ─────────────────────────────────────────────────────────────
 * Vocabulary
 * ────────────────────────────────────────────────────────────*/

const REF_PATTERN = /^[a-z][a-z0-9_.:-]{0,127}$/;

function nonBlank(label: string) {
  return z
    .string()
    .min(1, `${label} must be a non-empty string`)
    .refine((value) => value.trim().length > 0, `${label} must not be blank`);
}

export const providerRefSchema = z
  .string()
  .regex(
    REF_PATTERN,
    "provider must be a lowercase identifier (letters, digits, _ . : -; starts with a letter; at most 128 characters)",
  );
export type ProviderRef = z.infer<typeof providerRefSchema>;

export const degradedBehaviorSchema = z.enum(["admit", "deny"]);
export type DegradedBehavior = z.infer<typeof degradedBehaviorSchema>;

/** Provenance of a failure-profile declaration (AGENTS §12). */
export const failureProfileProvenanceSchema = z.strictObject({
  /** Who declared the profile (role or principal reference, not a secret). */
  declaredBy: nonBlank("provenance.declaredBy"),
  /** Under which authority the declaration was made (AGENTS §43). */
  authority: nonBlank("provenance.authority"),
  /** ISO-8601 timestamp of the declaration. */
  declaredAt: z.string().datetime(),
});

export type FailureProfileProvenance = z.infer<typeof failureProfileProvenanceSchema>;

export const providerFailureProfileSchema = z.strictObject({
  provider: providerRefSchema,
  /** Per-call deadline in ms; enforced by the policy at the call boundary. */
  timeoutMs: z
    .number()
    .int()
    .positive()
    .max(MAX_PROVIDER_TIMEOUT_MS, `timeoutMs exceeds the hard ceiling of ${MAX_PROVIDER_TIMEOUT_MS}ms`),
  /** Total attempts per call (first try + retries). */
  maxAttempts: z
    .number()
    .int()
    .min(1)
    .max(MAX_ATTEMPTS_PER_CALL, `maxAttempts exceeds the hard ceiling of ${MAX_ATTEMPTS_PER_CALL}`),
  /** Deterministic backoff base and cap in ms (cap >= base). */
  backoffBaseMs: z.number().int().positive().max(MAX_BACKOFF_MS),
  backoffCapMs: z.number().int().positive().max(MAX_BACKOFF_MS),
  /** Consecutive failures that arm degraded mode (<= breaker threshold). */
  degradedAfterFailures: z.number().int().positive().max(MAX_BREAKER_THRESHOLD),
  /** Time bound of one degraded episode. */
  degradedWindowMs: z
    .number()
    .int()
    .positive()
    .max(MAX_DEGRADED_WINDOW_MS, `degradedWindowMs exceeds the hard ceiling of ${MAX_DEGRADED_WINDOW_MS}ms`),
  /** Consecutive failures that open the breaker. */
  breakerFailureThreshold: z.number().int().positive().max(MAX_BREAKER_THRESHOLD),
  /** How long an open breaker waits before admitting a half-open probe. */
  breakerResetMs: z
    .number()
    .int()
    .positive()
    .max(MAX_BREAKER_RESET_MS, `breakerResetMs exceeds the hard ceiling of ${MAX_BREAKER_RESET_MS}ms`),
  /** What calls may do while a degraded episode is active. */
  whileDegraded: degradedBehaviorSchema,
  provenance: failureProfileProvenanceSchema,
});

export type ProviderFailureProfile = z.infer<typeof providerFailureProfileSchema>;

export const providerFailureProfilesSchema = z.strictObject({
  profiles: z
    .array(providerFailureProfileSchema)
    .min(1, "at least one provider failure profile must be declared"),
});

export type ProviderFailureProfilesInput = z.infer<typeof providerFailureProfilesSchema>;

/** A validated, duplicate-free registry produced only by parsing. */
export interface AdapterFailureSemanticsRegistry {
  readonly profiles: readonly ProviderFailureProfile[];
}

export type RegistryParseResult =
  | { ok: true; registry: AdapterFailureSemanticsRegistry }
  | { ok: false; reason: "invalid_profiles"; issues: readonly string[] };

/**
 * Parse and validate a provider failure-profile registry. Beyond the Zod
 * schema, cross-field invariants are enforced here so misconfiguration is a
 * structured parse failure, never a construction-time throw:
 * - backoffCapMs >= backoffBaseMs;
 * - degradedAfterFailures <= breakerFailureThreshold (degraded mode must
 *   engage no later than isolation).
 */
export function parseProviderFailureProfiles(input: unknown): RegistryParseResult {
  const parsed = providerFailureProfilesSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      reason: "invalid_profiles",
      issues: parsed.error.issues.map((issue) => {
        const path = issue.path.map(String).join(".");
        return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
      }),
    };
  }
  const issues: string[] = [];
  const seen = new Set<string>();
  for (const profile of parsed.data.profiles) {
    if (seen.has(profile.provider)) {
      issues.push(`duplicate failure profile for ${profile.provider}: one profile per provider`);
      continue;
    }
    seen.add(profile.provider);
    if (profile.backoffCapMs < profile.backoffBaseMs) {
      issues.push(`${profile.provider}: backoffCapMs must be >= backoffBaseMs`);
    }
    if (profile.degradedAfterFailures > profile.breakerFailureThreshold) {
      issues.push(
        `${profile.provider}: degradedAfterFailures must be <= breakerFailureThreshold (degraded mode must engage no later than isolation)`,
      );
    }
  }
  if (issues.length > 0) return { ok: false, reason: "invalid_profiles", issues };
  return { ok: true, registry: { profiles: parsed.data.profiles } };
}

/* ─────────────────────────────────────────────────────────────
 * Gates and results
 * ────────────────────────────────────────────────────────────*/

/** Why a call was denied before reaching the policy boundary. */
export type AdapterGateReason =
  | "unknown_provider"
  | "invalid_call_spec"
  | "trust_gate"
  | "degraded_denied"
  | "internal_defect";

export type TrustGateSource =
  | { readonly kind: "recommendation"; readonly reason: string }
  | { readonly kind: "explicit_decision"; readonly decidedBy: string; readonly reason: string };

/**
 * A call result. `denied: false` carries the underlying policy result
 * (errors are returned there, never thrown); `denied: true` means the call
 * was gated BEFORE any provider contact.
 */
export type AdapterSemanticsResult<T> =
  | { readonly denied: false; readonly policy: AdapterCallResult<T> }
  | { readonly denied: true; readonly gate: AdapterGateReason; readonly detail: string; readonly atMs: number };

export interface AdapterSemanticsCallSpec<T> {
  /** Stable operation name for events and trust records. */
  readonly operation: string;
  /** The external call. Anything it throws or hangs is contained. */
  readonly call: () => Promise<T>;
  /**
   * Per-call attempts; must be an integer in [1, declared maxAttempts].
   * Attempts can be tightened, never expanded beyond the declared cap.
   */
  readonly maxAttempts?: number;
  /** Per-call retryability predicate; defaults to "retry every failure". */
  readonly retryable?: (code: AdapterErrorCode) => boolean;
}

/* ─────────────────────────────────────────────────────────────
 * Audit events (gate denials are never silent)
 * ────────────────────────────────────────────────────────────*/

export type AdapterSemanticsEvent =
  | {
      kind: "call_denied";
      provider: string;
      gate: AdapterGateReason;
      detail: string;
      atMs: number;
    }
  | {
      kind: "trust_recommendation";
      provider: string;
      verdict: "untrusted" | "unproven";
      reason: string;
      atMs: number;
    }
  | {
      kind: "trust_decision_recorded";
      provider: string;
      verdict: TrustVerdict;
      decidedBy: string;
      reason: string;
      atMs: number;
    }
  | {
      kind: "trust_decision_rejected";
      provider: string;
      detail: string;
      atMs: number;
    };

export type AdapterSemanticsAuditEvent =
  | { source: "semantics"; event: AdapterSemanticsEvent }
  | { source: "policy"; event: AdapterPolicyEvent };

export type AdapterSemanticsEventSink = (event: AdapterSemanticsAuditEvent) => void;

/** Fail-closed observation of one declared provider. */
export interface AdapterSemanticsSnapshot {
  readonly provider: string;
  readonly degradedBehavior: DegradedBehavior;
  /** Effective trust verdict gating calls (E-060). */
  readonly effectiveTrustVerdict: TrustVerdict;
  readonly trustGateSource: TrustGateSource;
  /** The underlying policy snapshot (mode, breaker, ledgers, declared). */
  readonly policy: AdapterPolicySnapshot;
}

export type TrustDecisionResult =
  | { ok: true; decision: ProviderTrustDecision }
  | { ok: false; reason: "unknown_provider" | "invalid_decision"; detail: string };

const trustDecisionInputSchema = z.strictObject({
  verdict: z.enum(["trusted", "untrusted", "unproven"]),
  reason: nonBlank("reason"),
  decidedBy: nonBlank("decidedBy"),
  atMs: z.number().int().positive().optional(),
});

/* ─────────────────────────────────────────────────────────────
 * Semantics engine
 * ────────────────────────────────────────────────────────────*/

interface ProviderEntry {
  readonly profile: ProviderFailureProfile;
  readonly policy: ReturnType<typeof createAdapterFailurePolicy>;
  /** Last explicit trust decision verdict; null while none was recorded. */
  explicitVerdict: TrustVerdict | null;
  /** Recommendation verdict as of the last transition check. */
  lastRecommendation: "untrusted" | "unproven";
}

export interface AdapterFailureSemanticsConfig {
  /** A validated registry from `parseProviderFailureProfiles`. */
  readonly registry: AdapterFailureSemanticsRegistry;
  /** Injectable clock; defaults to the system clock. */
  readonly clock?: AdapterClock;
  /** Observability sink for semantics and policy events. */
  readonly onEvent?: AdapterSemanticsEventSink;
}

export class AdapterFailureSemantics {
  private readonly clock: AdapterClock;
  private readonly onEvent: AdapterSemanticsEventSink | null;
  private readonly entries = new Map<string, ProviderEntry>();
  private readonly auditLog: AdapterSemanticsAuditEvent[] = [];

  constructor(config: AdapterFailureSemanticsConfig) {
    if (!config || typeof config !== "object" || !Array.isArray(config.registry?.profiles)) {
      throw new TypeError(
        "AdapterFailureSemantics.registry must be a parsed registry from parseProviderFailureProfiles",
      );
    }
    if (config.registry.profiles.length === 0) {
      throw new TypeError(
        "AdapterFailureSemantics.registry must declare at least one provider failure profile",
      );
    }
    this.clock = config.clock ?? systemClock;
    this.onEvent = config.onEvent ?? null;
    for (const profile of config.registry.profiles) {
      // Profiles were validated by the parser; the policy constructor's own
      // validation is defense in depth and throws only on parser defect.
      const policy = createAdapterFailurePolicy({
        provider: profile.provider,
        timeoutMs: profile.timeoutMs,
        maxAttempts: profile.maxAttempts,
        backoffBaseMs: profile.backoffBaseMs,
        backoffCapMs: profile.backoffCapMs,
        degradedAfterFailures: profile.degradedAfterFailures,
        degradedWindowMs: profile.degradedWindowMs,
        breakerFailureThreshold: profile.breakerFailureThreshold,
        breakerResetMs: profile.breakerResetMs,
        clock: this.clock,
        onEvent: (event: AdapterPolicyEvent) => {
          this.pushAndForward({ source: "policy", event });
        },
      });
      const initial = policy.recommendTrust();
      this.entries.set(profile.provider, {
        profile,
        policy,
        explicitVerdict: null,
        lastRecommendation: initial.verdict,
      });
    }
  }

  /* ── I/O-bearing execution: gates first, then the policy boundary ── */

  async run<T>(
    provider: string,
    spec: AdapterSemanticsCallSpec<T>,
  ): Promise<AdapterSemanticsResult<T>> {
    const startedAtMs = this.clock.nowMs();
    try {
      return await this.runInner(provider, spec, startedAtMs);
    } catch (err) {
      // Containment at the outermost boundary: even a defect inside this
      // layer becomes a structured denial — the host loop can never crash.
      return {
        denied: true,
        gate: "internal_defect",
        detail: `adapter semantics contained a defect: ${describeError(err)}`,
        atMs: this.clock.nowMs(),
      };
    }
  }

  private async runInner<T>(
    provider: string,
    spec: AdapterSemanticsCallSpec<T>,
    startedAtMs: number,
  ): Promise<AdapterSemanticsResult<T>> {
    const entry = this.entries.get(provider);
    if (entry === undefined) {
      return this.deny(
        provider,
        "unknown_provider",
        `no failure profile is declared for provider ${provider}; admission fails closed`,
        startedAtMs,
      );
    }
    const specError = this.validateSpec(entry, spec);
    if (specError !== null) {
      return this.deny(provider, "invalid_call_spec", specError, startedAtMs);
    }
    const trust = this.effectiveTrust(entry);
    if (trust.verdict === "untrusted") {
      return this.deny(
        provider,
        "trust_gate",
        `provider ${provider} is distrusted (E-060: external systems are never automatically trusted); calls fail closed until an explicit trust decision re-admits it [${trust.source.kind}: ${trust.source.reason}]`,
        startedAtMs,
      );
    }
    const snapshot = entry.policy.snapshot(this.clock.nowMs());
    if (snapshot.mode === "degraded" && entry.profile.whileDegraded === "deny") {
      return this.deny(
        provider,
        "degraded_denied",
        `provider ${provider} is in a degraded episode (until ${String(snapshot.degradedUntilMs)}ms) and whileDegraded=deny; calls fail closed without provider contact`,
        startedAtMs,
      );
    }
    const result = await entry.policy.run({
      operation: spec.operation,
      call: spec.call,
      ...(spec.maxAttempts === undefined ? {} : { maxAttempts: spec.maxAttempts }),
      ...(spec.retryable === undefined ? {} : { retryable: spec.retryable }),
    });
    this.refreshTrustRecommendation(entry);
    return { denied: false, policy: result };
  }

  /* ── Local (non-I/O) containment — records but never gates ── */

  /**
   * Contained local operation for a declared provider. Per the base law,
   * local verification must keep working even while a provider is
   * distrusted, so only `unknown_provider` gates here; failures are
   * contained and recorded by the policy.
   */
  containSync<T>(provider: string, operation: string, fn: () => T): AdapterSemanticsResult<T> {
    try {
      const entry = this.entries.get(provider);
      if (entry === undefined) {
        const atMs = this.clock.nowMs();
        return this.deny(
          provider,
          "unknown_provider",
          `no failure profile is declared for provider ${provider}; admission fails closed`,
          atMs,
        );
      }
      return { denied: false, policy: entry.policy.containSync(operation, fn) };
    } catch (err) {
      return {
        denied: true,
        gate: "internal_defect",
        detail: `adapter semantics contained a defect: ${describeError(err)}`,
        atMs: this.clock.nowMs(),
      };
    }
  }

  /* ── Trust decisions (E-060: explicit, provenanced, auditable) ── */

  /**
   * Record an EXPLICIT trust decision for a declared provider. This is the
   * only way a provider becomes "trusted" or is re-admitted after distrust.
   */
  recordTrustDecision(
    provider: string,
    input: { verdict: TrustVerdict; reason: string; decidedBy: string; atMs?: number },
  ): TrustDecisionResult {
    const atMs = this.clock.nowMs();
    const entry = this.entries.get(provider);
    if (entry === undefined) {
      return {
        ok: false,
        reason: "unknown_provider",
        detail: `no failure profile is declared for provider ${provider}; no decision can be recorded`,
      };
    }
    const parsed = trustDecisionInputSchema.safeParse(input);
    if (!parsed.success) {
      const detail = parsed.error.issues
        .map((issue) => {
          const path = issue.path.map(String).join(".");
          return path.length > 0 ? `${path}: ${issue.message}` : issue.message;
        })
        .join("; ");
      this.emit({ kind: "trust_decision_rejected", provider, detail, atMs });
      return { ok: false, reason: "invalid_decision", detail };
    }
    const decision = entry.policy.recordTrustDecision({
      verdict: parsed.data.verdict,
      reason: parsed.data.reason,
      decidedBy: parsed.data.decidedBy,
      ...(parsed.data.atMs === undefined ? {} : { atMs: parsed.data.atMs }),
    });
    entry.explicitVerdict = parsed.data.verdict;
    this.emit({
      kind: "trust_decision_recorded",
      provider,
      verdict: parsed.data.verdict,
      decidedBy: parsed.data.decidedBy,
      reason: parsed.data.reason,
      atMs: decision.decidedAtMs,
    });
    return { ok: true, decision };
  }

  /* ── Observation ── */

  /** Fail-closed snapshot; null for an undeclared provider. */
  snapshot(provider: string): AdapterSemanticsSnapshot | null {
    const entry = this.entries.get(provider);
    if (entry === undefined) return null;
    const trust = this.effectiveTrust(entry);
    return {
      provider,
      degradedBehavior: entry.profile.whileDegraded,
      effectiveTrustVerdict: trust.verdict,
      trustGateSource: trust.source,
      policy: entry.policy.snapshot(this.clock.nowMs()),
    };
  }

  /** Declared provider identities (no implicit registrations exist). */
  providers(): readonly string[] {
    return [...this.entries.keys()];
  }

  /** Immutable audit trail: every gate denial, trust event, and policy event. */
  auditTrail(): readonly AdapterSemanticsAuditEvent[] {
    return [...this.auditLog];
  }

  /* ── Internals ── */

  private effectiveTrust(entry: ProviderEntry): { verdict: TrustVerdict; source: TrustGateSource } {
    if (entry.explicitVerdict !== null) {
      const decision = [...entry.policy.trustDecisions()].pop() ?? null;
      return {
        verdict: entry.explicitVerdict,
        source:
          decision === null
            ? { kind: "explicit_decision", decidedBy: "unknown", reason: "explicit verdict recorded" }
            : {
                kind: "explicit_decision",
                decidedBy: decision.decidedBy,
                reason: decision.reason,
              },
      };
    }
    const recommendation = entry.policy.recommendTrust();
    return {
      verdict: recommendation.verdict,
      source: { kind: "recommendation", reason: recommendation.reason },
    };
  }

  /**
   * Track recommendation transitions so a flip into distrust is announced
   * exactly once (never silent, never spammy).
   */
  private refreshTrustRecommendation(entry: ProviderEntry): void {
    const recommendation = entry.policy.recommendTrust();
    if (recommendation.verdict === entry.lastRecommendation) return;
    entry.lastRecommendation = recommendation.verdict;
    this.emit({
      kind: "trust_recommendation",
      provider: entry.profile.provider,
      verdict: recommendation.verdict,
      reason: recommendation.reason,
      atMs: recommendation.recommendedAtMs,
    });
  }

  private validateSpec<T>(entry: ProviderEntry, spec: AdapterSemanticsCallSpec<T>): string | null {
    if (spec === null || typeof spec !== "object") {
      return "call spec must be an object";
    }
    if (typeof spec.operation !== "string" || spec.operation.trim() === "") {
      return "call spec.operation must be a non-empty string";
    }
    if (typeof spec.call !== "function") {
      return "call spec.call must be a function";
    }
    if (spec.maxAttempts !== undefined) {
      const override = spec.maxAttempts;
      if (!Number.isInteger(override) || override < 1) {
        return "call spec.maxAttempts must be a positive integer";
      }
      if (override > entry.profile.maxAttempts) {
        return `call spec.maxAttempts (${String(override)}) exceeds the declared cap (${String(entry.profile.maxAttempts)}); attempts can be tightened, never expanded`;
      }
    }
    return null;
  }

  private deny(provider: string, gate: AdapterGateReason, detail: string, atMs: number): { denied: true; gate: AdapterGateReason; detail: string; atMs: number } {
    this.emit({ kind: "call_denied", provider, gate, detail, atMs });
    return { denied: true, gate, detail, atMs };
  }

  private emit(event: AdapterSemanticsEvent): void {
    this.pushAndForward({ source: "semantics", event });
  }

  private pushAndForward(auditEvent: AdapterSemanticsAuditEvent): void {
    this.auditLog.push(auditEvent);
    const sink = this.onEvent;
    if (sink === null) return;
    try {
      sink(auditEvent);
    } catch {
      // Observability must never break containment.
    }
  }
}

export function createAdapterFailureSemantics(
  config: AdapterFailureSemanticsConfig,
): AdapterFailureSemantics {
  return new AdapterFailureSemantics(config);
}

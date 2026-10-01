/**
 * CoreGrid — failure & incident architecture for the governed loop
 * (V1CAP-075 / MISSION-R-102 T1; hardening L-H-027; E-102: failures are
 * first-class events with evidence).
 *
 * Three contracts live here:
 *
 * 1. FAILURE-MODE TAXONOMY — for every stage of the governed loop
 *    (Observation, Context, Intelligence, Decision, Mission, Delegation,
 *    Worker Execution, Action, Evidence, Verification, Memory) and every
 *    failure mode (absent, stale, wrong, duplicate, unauthorized, degraded),
 *    the taxonomy declares the DETECT signal that fires and the CONTAIN
 *    response applied. Containment postures are `fail_closed` or
 *    `fail_degraded` ONLY — there is no fail-open posture in the vocabulary,
 *    and no containment is silent: every mode carries an observable detect
 *    signal and a non-empty response (composition over the verified
 *    observability foundation: `observability/structured-log.ts`,
 *    `observability/health.ts`, `adapters/failure-policy.ts`).
 *
 * 2. INCIDENT RECORD + APPEND-ONLY LOG — an incident is first-class evidence:
 *    id, stage, mode, detection (signal + evidence ref), containment applied,
 *    resolved_at. The log is append-only: entries are frozen on write, never
 *    removed or reordered, duplicate incident ids are rejected, and resolution
 *    is recorded by APPENDING an immutable resolution entry, never by
 *    rewriting the original incident.
 *
 * 3. ESCALATION RULE — critical modes (or repeated incidents of the same
 *    stage+mode within the window) escalate to a human operator via the
 *    notification policy's restricted `escalation` category (in-app only).
 *    Critical incidents are NEVER auto-retried: `autoRetry` is false for every
 *    critical taxonomy entry and the escalation decision reports
 *    `autoRetry: "prohibited"` for critical severities.
 *
 * Pure contract module: no I/O, no provider imports, no secrets.
 */

/* ─────────────────────────────────────────────────────────────
 * Vocabulary
 * ────────────────────────────────────────────────────────────*/

/** The governed loop stages (foundation loop: admission → … → verification). */
export type LoopStage =
  | "observation"
  | "context"
  | "intelligence"
  | "decision"
  | "mission"
  | "delegation"
  | "worker_execution"
  | "action"
  | "evidence"
  | "verification"
  | "memory";

export const LOOP_STAGES: readonly LoopStage[] = [
  "observation",
  "context",
  "intelligence",
  "decision",
  "mission",
  "delegation",
  "worker_execution",
  "action",
  "evidence",
  "verification",
  "memory",
];

/** The six failure modes enumerated for every loop stage. */
export type FailureMode = "absent" | "stale" | "wrong" | "duplicate" | "unauthorized" | "degraded";

export const FAILURE_MODES: readonly FailureMode[] = [
  "absent",
  "stale",
  "wrong",
  "duplicate",
  "unauthorized",
  "degraded",
];

/** Severity drives escalation; "critical" is never auto-retried. */
export type FailureSeverity = "critical" | "major" | "minor";

/**
 * Containment postures. The type deliberately EXCLUDES "fail_open": a
 * fail-open containment is unrepresentable in this contract.
 */
export type ContainmentPosture = "fail_closed" | "fail_degraded";

export const CONTAINMENT_POSTURES: readonly ContainmentPosture[] = [
  "fail_closed",
  "fail_degraded",
];

/**
 * The observable DETECT signals, drawn from the verified observability
 * foundation: adapter failure-policy events, structured logs, the health
 * report, contract validation refusals and SLI evaluation.
 */
export type DetectSignal =
  | "adapter_timeout"
  | "adapter_breaker_open"
  | "adapter_call_error"
  | "structured_log_error"
  | "health_probe_failing"
  | "health_probe_degraded"
  | "schema_validation_reject"
  | "contract_validation_reject"
  | "authorization_denial"
  | "idempotency_replay_detected"
  | "idempotency_conflict"
  | "staleness_probe"
  | "deduplication_hit"
  | "provenance_mismatch"
  | "verification_refusal"
  | "sli_threshold_breach";

/** A detect declaration: what signal fires and what it observes. */
export interface DetectSpec {
  signal: DetectSignal;
  /** Non-empty human-safe description of how the signal fires. */
  description: string;
}

/** A containment declaration: posture + explicit, non-silent response. */
export interface ContainSpec {
  posture: ContainmentPosture;
  /** Non-empty description of the containment applied. Never silent. */
  response: string;
}

/** One enumerated failure mode of one loop stage. */
export interface FailureModeSpec {
  stage: LoopStage;
  mode: FailureMode;
  /** What goes wrong at this stage when this mode occurs. */
  description: string;
  /** DETECT: the observable signal that fires. */
  detect: DetectSpec;
  /** CONTAIN: the fail-closed / fail-degraded response applied. */
  contain: ContainSpec;
  severity: FailureSeverity;
  /**
   * Whether bounded automatic retry is permitted after this mode. False for
   * every critical mode: critical incidents escalate to a human, never
   * auto-retry.
   */
  autoRetry: boolean;
}

/* ─────────────────────────────────────────────────────────────
 * Taxonomy authoring (one entry per stage × mode)
 * ────────────────────────────────────────────────────────────*/

interface ModeAuthoring {
  description: string;
  detect: DetectSignal;
  detectDetail: string;
  posture: ContainmentPosture;
  response: string;
  severity: FailureSeverity;
}

interface StageAuthoring {
  stage: LoopStage;
  /** What the stage produces (used to ground per-mode descriptions). */
  produces: string;
  modes: Record<FailureMode, ModeAuthoring>;
}

const TAXONOMY_AUTHORING: readonly StageAuthoring[] = [
  {
    stage: "observation",
    produces: "an observed reality signal admitted into the kernel",
    modes: {
      absent: {
        description: "An expected observation never arrives (source silent, drop in transit).",
        detect: "adapter_timeout",
        detectDetail: "observation deadline elapses with no record; absence probe fires",
        posture: "fail_degraded",
        response:
          "loop continues on the last verified observation state; the absence is recorded as an incident and surfaced on the health probe",
        severity: "major",
      },
      stale: {
        description: "The observation arrives but predates the freshness bound for its source.",
        detect: "staleness_probe",
        detectDetail: "recorded_at older than the source's freshness window",
        posture: "fail_degraded",
        response:
          "observation marked stale and excluded from canonical reads; a re-observation is requested",
        severity: "major",
      },
      wrong: {
        description: "The observation misrepresents reality (corrupt payload, mismatched provenance).",
        detect: "provenance_mismatch",
        detectDetail: "provenance/aggregate check fails against the claimed source",
        posture: "fail_closed",
        response:
          "observation rejected at the kernel boundary and quarantined; canonical truth is not updated",
        severity: "major",
      },
      duplicate: {
        description: "The same observation is admitted twice (at-least-once transport replay).",
        detect: "deduplication_hit",
        detectDetail: "deduplication key matches an already-recorded observation",
        posture: "fail_degraded",
        response:
          "duplicate dropped with the original's reference recorded; no second reality effect",
        severity: "minor",
      },
      unauthorized: {
        description: "An actor without observation authority injects or reads observations.",
        detect: "authorization_denial",
        detectDetail: "authorization decision returns DENY at the observation boundary",
        posture: "fail_closed",
        response:
          "write/read denied, incident recorded with the denial evidence; no reality rows touched",
        severity: "critical",
      },
      degraded: {
        description: "The observation source is partially available (partial telemetry, throttled feed).",
        detect: "health_probe_degraded",
        detectDetail: "source dependency check reports degraded on the health report",
        posture: "fail_degraded",
        response:
          "loop runs with reduced observation coverage; the degradation is announced, never silent",
        severity: "minor",
      },
    },
  },
  {
    stage: "context",
    produces: "the authorized context package assembled for the loop",
    modes: {
      absent: {
        description: "A mandatory context element (identity, tenant, purpose) is missing.",
        detect: "contract_validation_reject",
        detectDetail: "context-package completeness check rejects the package",
        posture: "fail_closed",
        response:
          "the loop does not proceed to intelligence without a complete context package",
        severity: "major",
      },
      stale: {
        description: "Context elements were assembled against outdated reality state.",
        detect: "staleness_probe",
        detectDetail: "context element older than the freshness bound for its class",
        posture: "fail_degraded",
        response:
          "stale elements flagged in the package; downstream stages may require re-assembly before consequential effects",
        severity: "major",
      },
      wrong: {
        description: "The context package contains elements outside the authorized scope.",
        detect: "schema_validation_reject",
        detectDetail: "element fails schema/policy validation during assembly",
        posture: "fail_closed",
        response: "offending element dropped; assembly fails closed if the package cannot be completed",
        severity: "major",
      },
      duplicate: {
        description: "The same context element is included more than once (join fan-out).",
        detect: "deduplication_hit",
        detectDetail: "assembly deduplicates by element identity",
        posture: "fail_degraded",
        response: "duplicates collapsed to one element; the collapse is recorded in the package",
        severity: "minor",
      },
      unauthorized: {
        description: "The context package includes elements the actor is not authorized to see.",
        detect: "authorization_denial",
        detectDetail: "element-level authorization check returns DENY/REDACT during assembly",
        posture: "fail_closed",
        response:
          "unauthorized elements are excluded (REDACT where partial visibility applies); the package never carries unauthorized data",
        severity: "critical",
      },
      degraded: {
        description: "Assembly ran with reduced element coverage (a context source was unavailable).",
        detect: "structured_log_error",
        detectDetail: "assembly logs a source failure; package carries reduced-coverage marker",
        posture: "fail_degraded",
        response: "assembly completes with the reduced-coverage marker recorded on the package",
        severity: "minor",
      },
    },
  },
  {
    stage: "intelligence",
    produces: "an AI-derived recommendation through the AI gateway",
    modes: {
      absent: {
        description: "The gateway returns no inference (provider outage, budget refusal).",
        detect: "adapter_call_error",
        detectDetail: "gateway call contained as a structured error (timeout/provider_error/budget refusal)",
        posture: "fail_degraded",
        response:
          "the loop falls back to the deterministic non-AI path; the missing inference is recorded, never silently skipped",
        severity: "major",
      },
      stale: {
        description: "The inference was computed against a context older than the freshness bound.",
        detect: "staleness_probe",
        detectDetail: "inference context stamp older than the freshness bound",
        posture: "fail_degraded",
        response: "inference marked stale and demoted to non-authoritative for consequential decisions",
        severity: "major",
      },
      wrong: {
        description: "The inference output fails its contract (malformed, out-of-domain, unparseable).",
        detect: "schema_validation_reject",
        detectDetail: "output fails the gateway's output-contract validation",
        posture: "fail_closed",
        response:
          "output rejected as untrusted AI output (AI OUTPUT TRUST); the loop proceeds on the validated path only",
        severity: "major",
      },
      duplicate: {
        description: "The same inference is recorded twice under distinct ids (double metering).",
        detect: "deduplication_hit",
        detectDetail: "metering ledger dedup key matches an existing inference record",
        posture: "fail_degraded",
        response: "second record collapsed onto the original; metering stays single-count",
        severity: "minor",
      },
      unauthorized: {
        description: "An unauthorized actor/model/purpose is used, or unauthorized context reached the model.",
        detect: "authorization_denial",
        detectDetail: "gateway pre-invocation authorization/purpose check returns DENY",
        posture: "fail_closed",
        response:
          "invocation refused before any model contact; AI privacy law holds (minimization/redaction precede the model)",
        severity: "critical",
      },
      degraded: {
        description: "The gateway is operating in a degraded mode (fallback routing, elevated latency).",
        detect: "health_probe_degraded",
        detectDetail: "gateway dependency check or breaker state reports degraded",
        posture: "fail_degraded",
        response: "inference continues through the fallback route; degradation announced via policy events",
        severity: "minor",
      },
    },
  },
  {
    stage: "decision",
    produces: "an authorization/policy decision (ALLOW/DENY/REDACT/ESCALATE)",
    modes: {
      absent: {
        description: "No decision is returned (policy engine unavailable, evaluation skipped).",
        detect: "verification_refusal",
        detectDetail: "decision boundary requires a decision; absence of one is a refusal",
        posture: "fail_closed",
        response: "no decision means DENY: the effect is not executed and the absence is recorded",
        severity: "critical",
      },
      stale: {
        description: "The decision was made under a policy or identity state that has since changed.",
        detect: "staleness_probe",
        detectDetail: "decision stamp precedes the latest policy/identity revision",
        posture: "fail_closed",
        response: "decision invalidated; the effect must be re-decided under current policy",
        severity: "critical",
      },
      wrong: {
        description: "The decision mis-evaluates the policy (wrong verb, wrong resource, wrong tenant).",
        detect: "sli_threshold_breach",
        detectDetail: "decision-outcome invariant probe / audit review flags a mis-evaluation",
        posture: "fail_closed",
        response:
          "decision reverted to DENY pending human review; the mis-evaluation is recorded as an incident",
        severity: "critical",
      },
      duplicate: {
        description: "The same decision request is evaluated twice with divergent outcomes.",
        detect: "deduplication_hit",
        detectDetail: "decision cache/ledger key matches with a divergent recorded outcome",
        posture: "fail_closed",
        response: "divergence fails closed: the stricter (DENY) outcome applies and review is triggered",
        severity: "major",
      },
      unauthorized: {
        description: "A decision is issued by an actor or path without decision authority.",
        detect: "authorization_denial",
        detectDetail: "decision issuer identity fails the decision-authority check",
        posture: "fail_closed",
        response: "decision voided; effects issued under it are halted and the issuance is recorded",
        severity: "critical",
      },
      degraded: {
        description: "The policy engine is serving partial rules (a rule source is unavailable).",
        detect: "health_probe_degraded",
        detectDetail: "policy-source dependency check reports degraded",
        posture: "fail_closed",
        response:
          "decisions evaluated only against available rules with fail-closed defaults; consequential effects are held",
        severity: "major",
      },
    },
  },
  {
    stage: "mission",
    produces: "a mission admission with idempotent replay semantics",
    modes: {
      absent: {
        description: "The mission record never materializes after admission (write lost).",
        detect: "adapter_timeout",
        detectDetail: "admission acknowledgement deadline elapses without a persisted mission row",
        posture: "fail_closed",
        response: "admission is not counted as succeeded; the caller receives a structured error, never a silent drop",
        severity: "major",
      },
      stale: {
        description: "Admission replayed against a superseded mission version.",
        detect: "staleness_probe",
        detectDetail: "mission version superseded before/at admission",
        posture: "fail_closed",
        response: "superseded admission refused with an explicit version conflict",
        severity: "major",
      },
      wrong: {
        description: "Admission carries a payload that fails the mission contract.",
        detect: "contract_validation_reject",
        detectDetail: "admission payload fails the mission contract validation",
        posture: "fail_closed",
        response: "admission refused with the validation refusal recorded",
        severity: "major",
      },
      duplicate: {
        description: "The same idempotency key is admitted with different content (replay attack).",
        detect: "idempotency_conflict",
        detectDetail: "idempotency key matches an existing admission with divergent payload",
        posture: "fail_closed",
        response: "conflict rejected: the original admission stands, the divergent replay is refused",
        severity: "critical",
      },
      unauthorized: {
        description: "Admission attempted by an actor without mission authority for the tenant.",
        detect: "authorization_denial",
        detectDetail: "tenant/role authorization returns DENY at admission",
        posture: "fail_closed",
        response: "admission denied; denial evidence recorded on the incident",
        severity: "critical",
      },
      degraded: {
        description: "Admission served while a dependency (registry, lease store) is degraded.",
        detect: "health_probe_degraded",
        detectDetail: "admission dependency check reports degraded",
        posture: "fail_degraded",
        response: "admissions continue with reduced guarantees announced; consequential effects remain gated",
        severity: "minor",
      },
    },
  },
  {
    stage: "delegation",
    produces: "an authorized delegation record granting worker authority",
    modes: {
      absent: {
        description: "The delegation record is missing when the worker presents it (lost record).",
        detect: "contract_validation_reject",
        detectDetail: "delegation lookup fails for a presented record id",
        posture: "fail_closed",
        response: "worker action refused: no record, no authority",
        severity: "major",
      },
      stale: {
        description: "The delegation is expired, revoked, or superseded at use time.",
        detect: "staleness_probe",
        detectDetail: "lifecycle/expiry check fails against the current clock and lifecycle state",
        posture: "fail_closed",
        response: "expired/revoked authority denied (Expired access fails; Revoked access fails)",
        severity: "critical",
      },
      wrong: {
        description: "The delegation record fails its contract (bad signature fields, invalid lifecycle).",
        detect: "contract_validation_reject",
        detectDetail: "delegation core validation returns an error",
        posture: "fail_closed",
        response: "record refused; no authority is derived from an invalid delegation",
        severity: "major",
      },
      duplicate: {
        description: "The same idempotency key records a divergent delegation (escalation attempt).",
        detect: "idempotency_conflict",
        detectDetail: "idempotent conflict on the delegation record key",
        posture: "fail_closed",
        response: "conflict and any implied escalation denied outright (E-045); original record stands",
        severity: "critical",
      },
      unauthorized: {
        description: "A re-delegation or authority expansion outside the granted scope is attempted.",
        detect: "authorization_denial",
        detectDetail: "delegation scope check returns DENY (no silent expansion, AGENTS §6)",
        posture: "fail_closed",
        response: "expansion refused; the attempt is recorded with the denial evidence",
        severity: "critical",
      },
      degraded: {
        description: "Delegation verification runs against a degraded authority store.",
        detect: "health_probe_degraded",
        detectDetail: "authority-store dependency check reports degraded",
        posture: "fail_closed",
        response: "new delegations are held while verification cannot be guaranteed",
        severity: "major",
      },
    },
  },
  {
    stage: "worker_execution",
    produces: "a bounded worker execution under delegated authority",
    modes: {
      absent: {
        description: "The worker never starts or never reports (runtime silent death).",
        detect: "adapter_timeout",
        detectDetail: "execution lease/heartbeat deadline elapses without a report",
        posture: "fail_degraded",
        response: "execution marked abandoned via lease expiry; mission stays pending for human-visible retry",
        severity: "major",
      },
      stale: {
        description: "The worker executes against context or authority older than its freshness bound.",
        detect: "staleness_probe",
        detectDetail: "execution pre-flight staleness check fails",
        posture: "fail_closed",
        response: "execution refused pre-flight; the worker must re-acquire fresh context",
        severity: "major",
      },
      wrong: {
        description: "The worker produces output outside its declared capability or task contract.",
        detect: "schema_validation_reject",
        detectDetail: "execution output fails the task contract validation",
        posture: "fail_closed",
        response: "output rejected; the execution is recorded as failed with the validation refusal",
        severity: "critical",
      },
      duplicate: {
        description: "The same execution is started twice (double-scheduled worker).",
        detect: "idempotency_replay_detected",
        detectDetail: "execution idempotency key replays an existing execution",
        posture: "fail_degraded",
        response: "second start returns the original execution's result; no double effect",
        severity: "major",
      },
      unauthorized: {
        description: "The worker exceeds its delegated capability, tenant, or memory scope.",
        detect: "authorization_denial",
        detectDetail: "capability gate returns DENY on the exceeded scope",
        posture: "fail_closed",
        response: "exceeding step refused; the attempt is recorded — authority never expands silently",
        severity: "critical",
      },
      degraded: {
        description: "Worker runtime is serving reduced capacity (quota pressure, degraded dependency).",
        detect: "health_probe_degraded",
        detectDetail: "runtime dependency check reports degraded / quota near exhaustion",
        posture: "fail_degraded",
        response: "executions throttle to the reduced capacity; the degradation is announced",
        severity: "minor",
      },
    },
  },
  {
    stage: "action",
    produces: "a bounded external effect through an adapter",
    modes: {
      absent: {
        description: "The external effect never lands (provider drop, lost write).",
        detect: "adapter_timeout",
        detectDetail: "adapter deadline elapses without provider acknowledgement",
        posture: "fail_degraded",
        response: "effect recorded as unresolved; retry only through the adapter's bounded policy, never silent",
        severity: "major",
      },
      stale: {
        description: "The action executes against stale authorization or a superseded request.",
        detect: "staleness_probe",
        detectDetail: "pre-effect authority/version check fails",
        posture: "fail_closed",
        response: "effect refused pre-flight; the stale request is recorded",
        severity: "critical",
      },
      wrong: {
        description: "The action produces the wrong external effect (bad payload to the provider).",
        detect: "adapter_call_error",
        detectDetail: "provider returns a structured delivery failure contained at the boundary",
        posture: "fail_closed",
        response: "failure contained and recorded; no compensation is attempted automatically",
        severity: "critical",
      },
      duplicate: {
        description: "The external effect is applied twice (retry without idempotency).",
        detect: "idempotency_replay_detected",
        detectDetail: "provider idempotency key / replay guard detects a duplicate effect",
        posture: "fail_closed",
        response: "duplicate effect refused (exactly-once under retry, J-030); the replay attempt is recorded",
        severity: "critical",
      },
      unauthorized: {
        description: "The action attempts an effect outside the decision's authorization.",
        detect: "authorization_denial",
        detectDetail: "pre-effect authorization re-check returns DENY",
        posture: "fail_closed",
        response: "effect refused; the attempt is recorded with the denial evidence",
        severity: "critical",
      },
      degraded: {
        description: "The adapter operates in degraded/isolated mode (breaker open, degraded window).",
        detect: "adapter_breaker_open",
        detectDetail: "breaker denies the call without provider contact",
        posture: "fail_degraded",
        response: "call denied without provider contact; the loop degrades per the adapter policy snapshot",
        severity: "minor",
      },
    },
  },
  {
    stage: "evidence",
    produces: "captured evidence of what the loop did",
    modes: {
      absent: {
        description: "No evidence is captured for a consequential step.",
        detect: "verification_refusal",
        detectDetail: "verification refuses to pass a step with no evidence tail",
        posture: "fail_closed",
        response: "the step cannot count as done; completion requires evidence, not assumption",
        severity: "critical",
      },
      stale: {
        description: "Evidence was captured against a state that has since changed.",
        detect: "staleness_probe",
        detectDetail: "evidence timestamp precedes the verified state change it claims to witness",
        posture: "fail_closed",
        response: "evidence marked non-witnessing; verification re-captures before passing",
        severity: "major",
      },
      wrong: {
        description: "The evidence payload misrepresents the step it witnesses.",
        detect: "provenance_mismatch",
        detectDetail: "evidence provenance check fails against the recorded step",
        posture: "fail_closed",
        response: "evidence quarantined; the step it claims to witness is re-verified",
        severity: "critical",
      },
      duplicate: {
        description: "The same evidence is recorded twice (double-counted witness).",
        detect: "deduplication_hit",
        detectDetail: "evidence dedup key matches an existing record",
        posture: "fail_degraded",
        response: "duplicate collapsed onto the original record; witness count stays single",
        severity: "minor",
      },
      unauthorized: {
        description: "Evidence is read or written outside its authorization envelope.",
        detect: "authorization_denial",
        detectDetail: "evidence access authorization returns DENY/REDACT",
        posture: "fail_closed",
        response: "access denied; evidence envelope holds (tenant/role/relationship checks)",
        severity: "critical",
      },
      degraded: {
        description: "Evidence capture ran with reduced fidelity (redacted fields, partial payload).",
        detect: "structured_log_error",
        detectDetail: "capture logs a fidelity reduction; record carries a reduced-fidelity marker",
        posture: "fail_degraded",
        response: "evidence stored with the reduced-fidelity marker; over-redaction beats leakage",
        severity: "minor",
      },
    },
  },
  {
    stage: "verification",
    produces: "a verified (not assumed) outcome statement",
    modes: {
      absent: {
        description: "Verification never runs (skipped, lost to a crash).",
        detect: "verification_refusal",
        detectDetail: "completion requires a verification record; its absence is a refusal",
        posture: "fail_closed",
        response: "outcome stays unverified: it does not count as done and cannot close the loop",
        severity: "critical",
      },
      stale: {
        description: "Verification ran against a state superseded before completion.",
        detect: "staleness_probe",
        detectDetail: "verified stamp precedes the latest reality revision for the subject",
        posture: "fail_closed",
        response: "verification invalidated; the outcome must be re-verified against current state",
        severity: "critical",
      },
      wrong: {
        description: "Verification passes a step that fails its invariant (or vice versa).",
        detect: "sli_threshold_breach",
        detectDetail: "verification pass-rate SLI breaches / audit re-check contradicts the verdict",
        posture: "fail_closed",
        response: "verdict reverted; the discrepancy is recorded as an incident for review",
        severity: "critical",
      },
      duplicate: {
        description: "The same verification is recorded twice with divergent verdicts.",
        detect: "deduplication_hit",
        detectDetail: "verification dedup key matches with a divergent verdict",
        posture: "fail_closed",
        response: "divergence fails closed: the failing verdict applies and review is triggered",
        severity: "major",
      },
      unauthorized: {
        description: "Verification issued by an actor without verification authority.",
        detect: "authorization_denial",
        detectDetail: "verifier identity fails the verification-authority check",
        posture: "fail_closed",
        response: "verdict voided; the issuance is recorded",
        severity: "critical",
      },
      degraded: {
        description: "Verification ran with reduced invariant coverage (a checker was unavailable).",
        detect: "health_probe_degraded",
        detectDetail: "checker dependency reports degraded; coverage ledger records the reduction",
        posture: "fail_closed",
        response: "outcomes verified under reduced coverage are held short of completion",
        severity: "major",
      },
    },
  },
  {
    stage: "memory",
    produces: "authorized memory retrieval/storage for the loop",
    modes: {
      absent: {
        description: "Expected memory is missing at retrieval time (lost or evicted).",
        detect: "adapter_timeout",
        detectDetail: "retrieval deadline elapses / lookup returns no record",
        posture: "fail_degraded",
        response: "loop proceeds without the memory; the absence is recorded, never filled by inference",
        severity: "major",
      },
      stale: {
        description: "Retrieved memory predates the freshness bound for its class.",
        detect: "staleness_probe",
        detectDetail: "memory stamp older than its freshness window",
        posture: "fail_degraded",
        response: "memory flagged stale to the consumer; never silently presented as current",
        severity: "major",
      },
      wrong: {
        description: "Retrieved memory fails integrity checks (corrupt or mismatched provenance).",
        detect: "provenance_mismatch",
        detectDetail: "memory provenance/integrity check fails",
        posture: "fail_closed",
        response: "memory withheld; canonical truth is never overwritten by corrupt memory",
        severity: "critical",
      },
      duplicate: {
        description: "The same memory entry is stored twice (double-write).",
        detect: "deduplication_hit",
        detectDetail: "memory dedup key matches an existing entry",
        posture: "fail_degraded",
        response: "duplicate collapsed onto the original entry",
        severity: "minor",
      },
      unauthorized: {
        description: "A retrieval or expansion exceeds the actor's declared memory scope.",
        detect: "authorization_denial",
        detectDetail: "memory-scope authorization returns DENY (no silent scope expansion)",
        posture: "fail_closed",
        response: "retrieval denied; the attempt is recorded — memory scope never expands silently",
        severity: "critical",
      },
      degraded: {
        description: "The memory store is serving reduced capability (partial index, throttled reads).",
        detect: "health_probe_degraded",
        detectDetail: "memory-store dependency check reports degraded",
        posture: "fail_degraded",
        response: "retrieval continues with reduced coverage announced on the health report",
        severity: "minor",
      },
    },
  },
];

function authoringToSpec(stage: LoopStage, mode: FailureMode, a: ModeAuthoring): FailureModeSpec {
  return {
    stage,
    mode,
    description: a.description,
    detect: { signal: a.detect, description: a.detectDetail },
    contain: { posture: a.posture, response: a.response },
    severity: a.severity,
    // Critical modes never auto-retry; this is asserted by auditTaxonomy.
    autoRetry: a.severity !== "critical",
  };
}

function buildTaxonomy(): ReadonlyMap<LoopStage, ReadonlyMap<FailureMode, FailureModeSpec>> {
  const map = new Map<LoopStage, ReadonlyMap<FailureMode, FailureModeSpec>>();
  for (const stageAuthoring of TAXONOMY_AUTHORING) {
    const modeMap = new Map<FailureMode, FailureModeSpec>();
    for (const mode of FAILURE_MODES) {
      modeMap.set(mode, authoringToSpec(stageAuthoring.stage, mode, stageAuthoring.modes[mode]));
    }
    map.set(stageAuthoring.stage, modeMap);
  }
  return map;
}

/** The full failure-mode taxonomy: every stage × every mode, no gaps. */
export const FAILURE_TAXONOMY: ReadonlyMap<LoopStage, ReadonlyMap<FailureMode, FailureModeSpec>> =
  buildTaxonomy();

/** All 66 taxonomy entries as a flat readonly list. */
export const FAILURE_TAXONOMY_ENTRIES: readonly FailureModeSpec[] = TAXONOMY_AUTHORING.flatMap(
  (stageAuthoring) =>
    FAILURE_MODES.map((mode) => authoringToSpec(stageAuthoring.stage, mode, stageAuthoring.modes[mode])),
);

/** The spec for one (stage, mode) pair; always defined for valid inputs. */
export function failureModeSpec(stage: LoopStage, mode: FailureMode): FailureModeSpec {
  const spec = FAILURE_TAXONOMY.get(stage)?.get(mode);
  if (!spec) {
    // Fail-closed on unknown lookups: refuse rather than invent a spec.
    throw new TypeError(`no failure-mode spec for stage "${stage}" mode "${mode}"`);
  }
  return spec;
}

export function isLoopStage(value: unknown): value is LoopStage {
  return typeof value === "string" && (LOOP_STAGES as readonly string[]).includes(value);
}

export function isFailureMode(value: unknown): value is FailureMode {
  return typeof value === "string" && (FAILURE_MODES as readonly string[]).includes(value);
}

/* ─────────────────────────────────────────────────────────────
 * Taxonomy audit (fail-closed self-check)
 * ────────────────────────────────────────────────────────────*/

export interface TaxonomyAudit {
  stages: number;
  modes: number;
  entries: number;
  failOpenEntries: number;
  silentContainments: number;
  criticalWithAutoRetry: number;
  ok: boolean;
  problems: readonly string[];
}

/**
 * Static audit of the authored taxonomy: complete coverage, no fail-open
 * posture, no silent containment, no critical mode with auto-retry.
 */
export function auditTaxonomy(): TaxonomyAudit {
  const problems: string[] = [];
  let failOpenEntries = 0;
  let silentContainments = 0;
  let criticalWithAutoRetry = 0;

  for (const stage of LOOP_STAGES) {
    const modeMap = FAILURE_TAXONOMY.get(stage);
    if (!modeMap) {
      problems.push(`stage "${stage}" has no taxonomy entry`);
      continue;
    }
    for (const mode of FAILURE_MODES) {
      const spec = modeMap.get(mode);
      if (!spec) {
        problems.push(`stage "${stage}" is missing mode "${mode}"`);
        continue;
      }
      if (spec.contain.posture !== "fail_closed" && spec.contain.posture !== "fail_degraded") {
        failOpenEntries += 1;
        problems.push(`stage "${stage}" mode "${mode}" has a fail-open posture`);
      }
      if (spec.contain.response.trim() === "" || spec.detect.description.trim() === "") {
        silentContainments += 1;
        problems.push(`stage "${stage}" mode "${mode}" has a silent containment or detect`);
      }
      if (spec.severity === "critical" && spec.autoRetry) {
        criticalWithAutoRetry += 1;
        problems.push(`stage "${stage}" mode "${mode}" is critical but permits auto-retry`);
      }
    }
  }

  return {
    stages: LOOP_STAGES.length,
    modes: FAILURE_MODES.length,
    entries: FAILURE_TAXONOMY_ENTRIES.length,
    failOpenEntries,
    silentContainments,
    criticalWithAutoRetry,
    ok: problems.length === 0,
    problems,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Incident record + append-only log
 * ────────────────────────────────────────────────────────────*/

export interface IncidentDetection {
  signal: DetectSignal;
  /** Reference to the evidence that fired detection (log line, event, SLI sample, report ts). */
  evidenceRef: string;
  /** ISO-8601 timestamp of the detection observation. */
  observedAt: string;
}

export interface IncidentContainment {
  posture: ContainmentPosture;
  /** The containment response applied (from the taxonomy, never silent). */
  response: string;
  /** Tenant scope the containment applies to; null for tenant-agnostic containment. */
  tenantId: string | null;
}

/** The core incident record as first appended (resolved_at managed by the log). */
export interface IncidentRecord {
  id: string;
  /** Log sequence number assigned at append time (monotonic, 1-based). */
  seq: number;
  stage: LoopStage;
  mode: FailureMode;
  severity: FailureSeverity;
  /** ISO-8601 detection timestamp (mirrors detection.observedAt). */
  detectedAt: string;
  detection: IncidentDetection;
  containment: IncidentContainment;
  escalated: boolean;
}

/** A resolution entry: appended to the log, never merged into the original. */
export interface IncidentResolution {
  incidentId: string;
  resolvedAt: string;
  resolvedBy: string;
  note: string | null;
}

export type IncidentLogEntry =
  | { readonly kind: "incident"; readonly seq: number; readonly recordedAt: string; readonly incident: IncidentRecord }
  | {
      readonly kind: "resolution";
      readonly seq: number;
      readonly recordedAt: string;
      readonly resolution: IncidentResolution;
    };

/** The incident record joined with its resolution (resolved_at projected). */
export interface IncidentView extends IncidentRecord {
  resolvedAt: string | null;
}

export interface RecordIncidentInput {
  id: string;
  stage: LoopStage;
  mode: FailureMode;
  detection: IncidentDetection;
  tenantId?: string | null;
  escalated?: boolean;
  /** Optional clock override for `recordedAt`/`detectedAt` defaults. */
  detectedAt?: string;
}

export interface ResolveIncidentInput {
  incidentId: string;
  resolvedAt: string;
  resolvedBy: string;
  note?: string;
}

export interface EscalationPolicyConfig {
  /** Severities that escalate on first occurrence. Default: ["critical"]. */
  immediateSeverities: readonly FailureSeverity[];
  /** Occurrences of the same (stage, mode) that trigger escalation. Default 3. */
  repeatThreshold: number;
  /** Window (ms) over which repeats are counted. Default 15 minutes. */
  repeatWindowMs: number;
  /** Fixed escalation route: human operator via the notification escalation category. */
  route: "human_operator_via_notification_escalation";
}

export const DEFAULT_ESCALATION_POLICY: EscalationPolicyConfig = {
  immediateSeverities: ["critical"],
  repeatThreshold: 3,
  repeatWindowMs: 15 * 60 * 1000,
  route: "human_operator_via_notification_escalation",
};

export interface EscalationDecision {
  escalate: boolean;
  reasons: readonly string[];
  route: EscalationPolicyConfig["route"] | null;
  /** "prohibited" for critical incidents (never auto-retry critical). */
  autoRetry: "prohibited" | "permitted";
}

function isIsoTimestamp(value: unknown): value is string {
  return typeof value === "string" && value.length > 0 && !Number.isNaN(Date.parse(value));
}

function nonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Append-only incident log. Entries are frozen on write; resolution appends a
 * new entry instead of mutating the original; duplicate ids and malformed
 * records are rejected (fail-closed).
 */
export class IncidentLog {
  private readonly entriesInternal: IncidentLogEntry[] = [];
  private readonly incidentsById = new Map<string, IncidentRecord>();
  private readonly resolutionsByIncident = new Map<string, IncidentResolution>();
  private nextSeq = 1;

  get length(): number {
    return this.entriesInternal.length;
  }

  /** Immutable copy of the log, in append order. */
  entries(): readonly IncidentLogEntry[] {
    return [...this.entriesInternal];
  }

  /** Record a new incident. Fail-closed on malformed input or duplicate id. */
  record(input: RecordIncidentInput): IncidentView {
    const spec = failureModeSpec(input.stage, input.mode);
    const id = nonEmpty(input.id) ? input.id.trim() : "";
    if (!id) throw new TypeError("incident id must be a non-empty string");
    if (this.incidentsById.has(id)) {
      throw new TypeError(`incident id "${id}" already recorded; the log is append-only`);
    }
    if (!nonEmpty(input.detection.evidenceRef)) {
      throw new TypeError("incident detection.evidenceRef is required: failures carry evidence");
    }
    if (!isIsoTimestamp(input.detection.observedAt)) {
      throw new TypeError("incident detection.observedAt must be an ISO timestamp");
    }
    const detectedAt = input.detectedAt ?? input.detection.observedAt;
    if (!isIsoTimestamp(detectedAt)) {
      throw new TypeError("incident detectedAt must be an ISO timestamp");
    }
    const tenantId =
      input.tenantId === undefined || input.tenantId === null ? null : String(input.tenantId).trim();

    const incident: IncidentRecord = Object.freeze({
      id,
      seq: this.nextSeq,
      stage: spec.stage,
      mode: spec.mode,
      severity: spec.severity,
      detectedAt,
      detection: Object.freeze({
        signal: input.detection.signal,
        evidenceRef: input.detection.evidenceRef.trim(),
        observedAt: input.detection.observedAt,
      }),
      containment: Object.freeze({
        posture: spec.contain.posture,
        response: spec.contain.response,
        tenantId: tenantId !== "" ? tenantId : null,
      }),
      escalated: input.escalated === true,
    });

    const entry: IncidentLogEntry = Object.freeze({
      kind: "incident",
      seq: this.nextSeq,
      recordedAt: detectedAt,
      incident,
    });
    this.entriesInternal.push(entry);
    this.incidentsById.set(id, incident);
    this.nextSeq += 1;
    return this.view(id) as IncidentView;
  }

  /**
   * Record the resolution of an incident by APPENDING a resolution entry.
   * Fail-closed: unknown incidents and double resolution are refused.
   */
  resolve(input: ResolveIncidentInput): IncidentResolution {
    const id = nonEmpty(input.incidentId) ? input.incidentId.trim() : "";
    if (!id) throw new TypeError("resolution incidentId must be a non-empty string");
    if (!this.incidentsById.has(id)) {
      throw new TypeError(`cannot resolve unknown incident "${id}"`);
    }
    if (this.resolutionsByIncident.has(id)) {
      throw new TypeError(`incident "${id}" is already resolved; the log is append-only`);
    }
    if (!isIsoTimestamp(input.resolvedAt)) {
      throw new TypeError("resolution resolvedAt must be an ISO timestamp");
    }
    if (!nonEmpty(input.resolvedBy)) {
      throw new TypeError("resolution resolvedBy must be a non-empty string");
    }
    const resolution: IncidentResolution = {
      incidentId: id,
      resolvedAt: input.resolvedAt,
      resolvedBy: input.resolvedBy.trim(),
      note: input.note !== undefined && nonEmpty(input.note) ? input.note.trim() : null,
    };
    const entry: IncidentLogEntry = Object.freeze({
      kind: "resolution",
      seq: this.nextSeq,
      recordedAt: resolution.resolvedAt,
      resolution,
    });
    this.entriesInternal.push(entry);
    this.resolutionsByIncident.set(id, resolution);
    this.nextSeq += 1;
    return resolution;
  }

  /** The incident view (record + projected resolved_at) for one id. */
  view(id: string): IncidentView | null {
    const incident = this.incidentsById.get(id);
    if (!incident) return null;
    const resolution = this.resolutionsByIncident.get(id) ?? null;
    return {
      ...incident,
      containment: { ...incident.containment },
      detection: { ...incident.detection },
      resolvedAt: resolution?.resolvedAt ?? null,
    };
  }

  /** All incident views in append order (resolutions projected). */
  views(): readonly IncidentView[] {
    return [...this.incidentsById.keys()].map((id) => this.view(id) as IncidentView);
  }

  /** Incidents not yet resolved. */
  openIncidents(): readonly IncidentView[] {
    return this.views().filter((incident) => incident.resolvedAt === null);
  }

  /** Count of incidents for one (stage, mode) pair. */
  countFor(stage: LoopStage, mode: FailureMode): number {
    return this.views().filter((incident) => incident.stage === stage && incident.mode === mode).length;
  }

  /** Append-order entries of one (stage, mode) pair. */
  forStageMode(stage: LoopStage, mode: FailureMode): readonly IncidentView[] {
    return this.views().filter((incident) => incident.stage === stage && incident.mode === mode);
  }
}

/* ─────────────────────────────────────────────────────────────
 * Escalation rule
 * ────────────────────────────────────────────────────────────*/

/** ISO timestamp difference in ms (caller-supplied clock keeps this pure). */
function isoDiffMs(fromIso: string, toIso: string): number {
  return Date.parse(toIso) - Date.parse(fromIso);
}

/**
 * Evaluate the escalation rule for one incident against the log history:
 * critical severity escalates immediately; non-critical incidents escalate
 * when the same (stage, mode) reaches `repeatThreshold` occurrences inside
 * `repeatWindowMs`. Escalation routes to a human operator via the
 * notification policy's restricted `escalation` category — never auto-retry
 * for critical incidents.
 */
export function evaluateEscalation(
  incident: IncidentView,
  log: IncidentLog,
  nowMs: number,
  config: EscalationPolicyConfig = DEFAULT_ESCALATION_POLICY,
): EscalationDecision {
  const reasons: string[] = [];
  const critical = incident.severity === "critical";

  if (config.immediateSeverities.includes(incident.severity)) {
    reasons.push(
      `severity "${incident.severity}" is in the immediate escalation set [${config.immediateSeverities.join(", ")}]`,
    );
  }

  if (!critical && config.repeatThreshold > 1) {
    const peers = log
      .forStageMode(incident.stage, incident.mode)
      .filter((peer) => isoDiffMs(peer.detectedAt, incident.detectedAt) <= config.repeatWindowMs);
    // The incident under evaluation may already be recorded (re-evaluation)
    // or not yet recorded (pre-append evaluation); count occurrences once.
    const selfInLog = peers.some((peer) => peer.id === incident.id);
    const occurrences = selfInLog ? peers.length : peers.length + 1;
    if (occurrences >= config.repeatThreshold) {
      reasons.push(
        `${occurrences} incidents of (${incident.stage}, ${incident.mode}) within the ${config.repeatWindowMs}ms window reached the repeat threshold ${config.repeatThreshold}`,
      );
    }
  }

  const escalate = reasons.length > 0;
  return {
    escalate,
    reasons,
    route: escalate ? config.route : null,
    autoRetry: critical ? "prohibited" : "permitted",
  };
}

/**
 * Record an incident, evaluate the escalation rule for it, and return the
 * view with the escalation decision. The record's `escalated` flag reflects
 * the decision; the caller owns notifying the human operator via the
 * notification policy's restricted `escalation` category (in-app only).
 */
export function recordAndEvaluate(
  log: IncidentLog,
  input: RecordIncidentInput,
  config: EscalationPolicyConfig = DEFAULT_ESCALATION_POLICY,
): { view: IncidentView; decision: EscalationDecision } {
  const spec = failureModeSpec(input.stage, input.mode);
  const decision = evaluateEscalation(
    {
      ...input,
      seq: 0,
      severity: spec.severity,
      detectedAt: input.detectedAt ?? input.detection.observedAt,
      containment: { ...spec.contain, tenantId: input.tenantId ?? null },
      resolvedAt: null,
      escalated: false,
    },
    log,
    Date.parse(input.detectedAt ?? input.detection.observedAt),
    config,
  );
  const view = log.record({ ...input, escalated: decision.escalate });
  return { view, decision: { ...decision, escalate: view.escalated } };
}
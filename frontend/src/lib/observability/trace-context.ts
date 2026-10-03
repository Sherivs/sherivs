/**
 * CoreGrid — trace context propagation contract (H3 wave F-047, Constitution
 * §29 observability / §12 provenance).
 *
 * A trace context is the provenance thread that ties one logical operation
 * across every boundary it crosses: `trace_id` (the whole operation) and
 * `correlation_id` (one link within it). This module is the CONTRACT for
 * creating, carrying and serializing that thread.
 *
 * Laws of this module:
 * - EXPLICIT PROPAGATION ONLY. A trace context moves between call sites as a
 *   plain value passed through function parameters (or a plain carrier
 *   record). There is no ambient store, no global current-context slot, no
 *   async-context magic: if a function needs the context, the caller must
 *   hand it over. This keeps tenant/trace isolation compositional and
 *   auditable — a boundary either receives the context explicitly or it does
 *   not have one (fail-closed, never guessed).
 * - CRYPTOGRAPHIC GENERATION WHERE AVAILABLE. New ids mint 128 bits of
 *   entropy from `crypto.getRandomValues` when the platform provides it; the
 *   documented fallback (counter + seeded FNV-1a mix) is a uniqueness
 *   primitive for exotic runtimes only and carries no trace data.
 * - REDACTION-SAFE SERIALIZATION. The serialized shape is a fixed whitelist
 *   of fields. Attribute keys are screened through the shared structured-log
 *   sensitive-key redaction, and attribute VALUES are screened against
 *   credential-shaped patterns (key prefixes, bearer tokens, JWTs, long
 *   secrets) — over-redaction is acceptable, leakage is not (§29, §30).
 * - COMPOSITION, NOT REWRITE. Serialization reuses the shared structured-log
 *   redaction primitives (`isSensitiveKey`, `redactValue`, `REDACTED`) and
 *   produces entries in the house `StructuredLogEntry` shape, so trace fields
 *   flow through the existing log/telemetry sinks untouched.
 *
 * Purity: no I/O, no network, no database. Time enters only via the kernel
 * time authority (J-023) or an injected `now`. Untrusted input is parsed with
 * Zod and fails closed to a typed verdict — a malformed context never throws
 * on a boundary and never degrades into an ambient default.
 */

import { z } from "zod";
import { REDACTED, isSensitiveKey, redactValue } from "./structured-log";
import type { LogLevel, StructuredLogEntry } from "./structured-log";
import { SystemClock, TimeAuthority } from "../kernel/time-authority";

/** J-023 time-source rule: time enters only via the kernel authority. */
const timeAuthority = new TimeAuthority(new SystemClock());

/* ─────────────────────────────────────────────────────────────
 * Vocabulary and bounds
 * ────────────────────────────────────────────────────────────*/

export const TRACE_CONTEXT_COMPONENT = "trace-context";

/** Wire/carrier keys (flat, lowercase, header-safe). */
export const TRACE_ID_WIRE_KEY = "trace_id";
export const CORRELATION_ID_WIRE_KEY = "correlation_id";

export const TRACE_ID_MIN_LENGTH = 8;
export const TRACE_ID_MAX_LENGTH = 128;
export const MAX_TRACE_ATTRIBUTES = 16;
export const MAX_TRACE_ATTRIBUTE_KEY_LENGTH = 64;
export const MAX_TRACE_ATTRIBUTE_VALUE_LENGTH = 256;

/** Bounded, whitespace-free, printable token: ids, UUIDs and epoch traces fit. */
const TRACE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:@-]{7,127}$/;

const TRACE_ATTRIBUTE_KEY_PATTERN = /^[A-Za-z0-9_.:-]+$/;

/**
 * A trace context: the explicit, typed provenance thread. Plain data —
 * structurally cloneable across workers/postMessage/serialization boundaries
 * without needing this module's classes.
 */
export interface TraceContext {
  readonly trace_id: string;
  readonly correlation_id: string;
  /** Authority-issued creation instant in epoch ms; null when unknown (extracted). */
  readonly created_at_ms: number | null;
  /** Bounded, caller-declared, non-sensitive-by-contract baggage. */
  readonly attributes: Readonly<Record<string, string>>;
}

/** Typed verdict for every untrusted-input path (never throws). */
export type TraceVerdict =
  | { ok: true; context: TraceContext }
  | { ok: false; reason: TraceVerdictReason };

export type TraceVerdictReason =
  | "malformed"
  | "invalid_trace_id"
  | "invalid_correlation_id"
  | "invalid_attributes"
  | "empty_carrier";

/** Typed error for PROGRAMMATIC misuse (explicit options that fail validation). */
export class TraceContextError extends Error {
  readonly reason: TraceVerdictReason;

  constructor(reason: TraceVerdictReason, detail: string) {
    super(`trace-context: ${reason}: ${detail}`);
    this.name = "TraceContextError";
    this.reason = reason;
  }
}

/* ─────────────────────────────────────────────────────────────
 * Zod contracts
 * ────────────────────────────────────────────────────────────*/

export const traceIdSchema = z
  .string()
  .min(TRACE_ID_MIN_LENGTH)
  .max(TRACE_ID_MAX_LENGTH)
  .regex(TRACE_ID_PATTERN);

export const correlationIdSchema = traceIdSchema;

export const traceAttributesSchema = z
  .record(
    z.string().min(1).max(MAX_TRACE_ATTRIBUTE_KEY_LENGTH).regex(TRACE_ATTRIBUTE_KEY_PATTERN),
    z.string().max(MAX_TRACE_ATTRIBUTE_VALUE_LENGTH),
  )
  .refine((attrs) => Object.keys(attrs).length <= MAX_TRACE_ATTRIBUTES, {
    message: `at most ${MAX_TRACE_ATTRIBUTES} attributes`,
  });

export const traceContextSchema = z.object({
  trace_id: traceIdSchema,
  correlation_id: correlationIdSchema,
  created_at_ms: z.number().int().nonnegative().nullable().optional(),
  attributes: traceAttributesSchema.optional(),
});

/* ─────────────────────────────────────────────────────────────
 * Generation (cryptographic randomness where available)
 * ────────────────────────────────────────────────────────────*/

/** 128-bit entropy source when the platform provides WebCrypto. */
function randomHex32Bytes(): string | null {
  const cryptoRef = globalThis.crypto;
  if (cryptoRef != null && typeof cryptoRef.getRandomValues === "function") {
    const bytes = new Uint8Array(16);
    cryptoRef.getRandomValues(bytes);
    let out = "";
    for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
    return out;
  }
  return null;
}

function fnv1a32Hex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/**
 * Fallback uniqueness primitive for runtimes without WebCrypto. The counter
 * exists ONLY to keep fallback ids unique — it stores no trace context and
 * is never a source of truth for any caller.
 */
let fallbackUniquenessCounter = 0;

export interface CreateIdOptions {
  /** Mixed into the fallback path only (never into crypto-random ids). */
  seed?: string;
}

function generateId(options: CreateIdOptions = {}): string {
  const random = randomHex32Bytes();
  if (random !== null) return random;
  fallbackUniquenessCounter += 1;
  const mix = `${options.seed ?? ""}:${fallbackUniquenessCounter}:${timeAuthority.now().atMs}`;
  return `fb${fnv1a32Hex(mix)}${fnv1a32Hex(`${mix}:salt`)}`;
}

/** Mint a fresh 32-char trace id (crypto-random where available). */
export function createTraceId(options: CreateIdOptions = {}): string {
  return generateId(options);
}

/** Mint a fresh 32-char correlation id (crypto-random where available). */
export function createCorrelationId(options: CreateIdOptions = {}): string {
  return generateId(options);
}

function nowMs(): number {
  return timeAuthority.now().atMs;
}

function toTraceContext(parsed: {
  trace_id: string;
  correlation_id: string;
  created_at_ms?: number | null;
  attributes?: Record<string, string>;
}): TraceContext {
  return Object.freeze({
    trace_id: parsed.trace_id,
    correlation_id: parsed.correlation_id,
    created_at_ms: parsed.created_at_ms ?? null,
    attributes: Object.freeze({ ...(parsed.attributes ?? {}) }),
  });
}

function verdictFromZod(
  parsed: ReturnType<typeof traceContextSchema.safeParse>,
): TraceVerdict {
  if (parsed.success) {
    return { ok: true, context: toTraceContext(parsed.data) };
  }
  const issues = parsed.error.issues.map((issue) => issue.path.join("."));
  const joined = issues.join(",");
  if (joined.includes("trace_id")) return { ok: false, reason: "invalid_trace_id" };
  if (joined.includes("correlation_id")) return { ok: false, reason: "invalid_correlation_id" };
  if (joined.includes("attributes")) return { ok: false, reason: "invalid_attributes" };
  return { ok: false, reason: "malformed" };
}

/* ─────────────────────────────────────────────────────────────
 * Creation and propagation (explicit parameter passing only)
 * ────────────────────────────────────────────────────────────*/

export interface CreateTraceContextOptions {
  /** Explicit id (validated); a fresh crypto-random id is minted otherwise. */
  traceId?: string;
  correlationId?: string;
  attributes?: Record<string, string>;
  now?: () => number;
}

/**
 * Create a root trace context. Explicit ids/attributes are validated and
 * PROGRAMMATIC misuse throws `TraceContextError` (deterministic developer
 * error — never a silent fallback onto someone else's trace).
 */
export function createTraceContext(options: CreateTraceContextOptions = {}): TraceContext {
  const traceId = options.traceId ?? createTraceId();
  const correlationId = options.correlationId ?? createCorrelationId();
  const traceIdCheck = traceIdSchema.safeParse(traceId);
  if (!traceIdCheck.success) throw new TraceContextError("invalid_trace_id", "explicit trace id rejected");
  const correlationIdCheck = correlationIdSchema.safeParse(correlationId);
  if (!correlationIdCheck.success) {
    throw new TraceContextError("invalid_correlation_id", "explicit correlation id rejected");
  }
  const attributesCheck = traceAttributesSchema.safeParse(options.attributes ?? {});
  if (!attributesCheck.success) {
    throw new TraceContextError("invalid_attributes", "explicit attributes rejected");
  }
  return toTraceContext({
    trace_id: traceId,
    correlation_id: correlationId,
    created_at_ms: options.now != null ? options.now() : nowMs(),
    attributes: attributesCheck.data,
  });
}

export interface PropagateOptions {
  /** Explicit child correlation id (validated); a fresh one is minted otherwise. */
  correlationId?: string;
  /** Child-local attributes layered OVER the parent's. */
  attributes?: Record<string, string>;
  now?: () => number;
}

/**
 * Derive the child context for one downstream hop: the `trace_id` CONTINUES
 * (one operation, many hops), the `correlation_id` is fresh per hop (each
 * link is individually addressable), attributes compose parent-then-child.
 * The parent is never mutated.
 */
export function propagateToChild(parent: TraceContext, options: PropagateOptions = {}): TraceContext {
  const correlationId = options.correlationId ?? createCorrelationId();
  const correlationIdCheck = correlationIdSchema.safeParse(correlationId);
  if (!correlationIdCheck.success) {
    throw new TraceContextError("invalid_correlation_id", "explicit child correlation id rejected");
  }
  const childAttributes = { ...parent.attributes, ...(options.attributes ?? {}) };
  const attributesCheck = traceAttributesSchema.safeParse(childAttributes);
  if (!attributesCheck.success) {
    throw new TraceContextError("invalid_attributes", "merged child attributes rejected");
  }
  return toTraceContext({
    trace_id: parent.trace_id,
    correlation_id: correlationId,
    created_at_ms: options.now != null ? options.now() : nowMs(),
    attributes: attributesCheck.data,
  });
}

/**
 * Run one unit of work with an EXPLICITLY PASSED context. This is the
 * sanctioned propagation pattern: the closure receives the context as a
 * parameter — there is no ambient/global slot to read from, so concurrent
 * units of work cannot observe each other's context.
 */
export function runWithTraceContext<T>(context: TraceContext, fn: (propagated: TraceContext) => T): T {
  return fn(context);
}

/**
 * Fail-closed parse of UNTRUSTED boundary data (wire carrier, message
 * attribute, queued record). Never throws; malformed input yields a typed
 * rejection and the caller keeps whatever context it already held.
 */
export function extractTraceContext(carrier: unknown): TraceVerdict {
  if (carrier == null) return { ok: false, reason: "empty_carrier" };
  if (typeof carrier !== "object" || Array.isArray(carrier)) {
    return { ok: false, reason: "malformed" };
  }
  const record = carrier as Record<string, unknown>;
  const isEmpty = Object.keys(record).length === 0;
  if (isEmpty) return { ok: false, reason: "empty_carrier" };
  return verdictFromZod(traceContextSchema.safeParse(record));
}

/**
 * Propagation law at a boundary: the INCOMING trace continues the operation
 * (trace continuity across services); correlation, timestamps and attributes
 * come from the incoming context when present, otherwise from the current
 * context. Untrusted input never throws and never fabricates ids.
 */
export function continueTraceContext(incoming: unknown, current?: TraceContext): TraceVerdict {
  const verdict = extractTraceContext(incoming);
  if (!verdict.ok) return verdict;
  const incomingContext = verdict.context;
  const merged = toTraceContext({
    trace_id: incomingContext.trace_id,
    correlation_id: incomingContext.correlation_id,
    created_at_ms: incomingContext.created_at_ms,
    attributes:
      Object.keys(incomingContext.attributes).length > 0
        ? { ...incomingContext.attributes }
        : { ...(current?.attributes ?? {}) },
  });
  return { ok: true, context: merged };
}

/**
 * Flat string carrier for wire/queue/header-shaped boundaries. Only the two
 * ids travel on the wire — attributes are in-process baggage, never ambient
 * credentials-by-accident.
 */
export function injectTraceContext(context: TraceContext): Record<string, string> {
  return {
    [TRACE_ID_WIRE_KEY]: context.trace_id,
    [CORRELATION_ID_WIRE_KEY]: context.correlation_id,
  };
}

/* ─────────────────────────────────────────────────────────────
 * Redaction-safe serialization (§29 / §30)
 * ────────────────────────────────────────────────────────────*/

/** Credential-shaped VALUE patterns — redacted on output, fail-closed. */
const CREDENTIAL_VALUE_PATTERNS: readonly RegExp[] = [
  /^sk-[A-Za-z0-9_-]{8,}$/,
  /^pk_(live|test)_[A-Za-z0-9_-]{8,}$/,
  /^rk_[A-Za-z0-9_-]{8,}$/,
  /^gh[pousr]_[A-Za-z0-9]{20,}$/,
  /^Bearer\s+\S+$/i,
  /^Basic\s+\S+$/i,
  /^-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, // token/JWT-shaped (dot-separated opaque parts)
  /^[0-9a-f]{32,}$/i, // long hex secrets
  /^[A-Za-z0-9+/]{40,}={0,2}$/, // long base64 secrets
];

/** True when a value looks like credential material regardless of its key. */
export function isCredentialShapedValue(value: string): boolean {
  return CREDENTIAL_VALUE_PATTERNS.some((pattern) => pattern.test(value));
}

/**
 * The serialized shape is a FIXED WHITELIST: `trace_id`, `correlation_id`,
 * `created_at_ms`, `attributes`. Sensitive-keyed attributes become
 * `[REDACTED]` via the shared structured-log redaction; credential-shaped
 * values are redacted too (over-redact, never leak).
 */
export function serializeTraceContextFields(context: TraceContext): Record<string, unknown> {
  const fields: Record<string, unknown> = {
    trace_id: context.trace_id,
    correlation_id: context.correlation_id,
  };
  if (context.created_at_ms !== null) fields.created_at_ms = context.created_at_ms;
  const attributeKeys = Object.keys(context.attributes);
  if (attributeKeys.length > 0) {
    const serialized: Record<string, unknown> = {};
    for (const key of attributeKeys) {
      const value = context.attributes[key];
      serialized[key] = isSensitiveKey(key) || isCredentialShapedValue(value)
        ? REDACTED
        : redactValue(value);
    }
    fields.attributes = serialized;
  }
  return fields;
}

/** One JSON line, redaction-safe; serialization failure degrades, never throws. */
export function serializeTraceContext(context: TraceContext): string {
  try {
    return JSON.stringify(serializeTraceContextFields(context));
  } catch {
    return JSON.stringify({ trace_id: context.trace_id, correlation_id: context.correlation_id });
  }
}

/* ─────────────────────────────────────────────────────────────
 * Structured-log / telemetry composition (read-only on the sinks)
 * ────────────────────────────────────────────────────────────*/

/** The trace fields for a house log entry (snake_case, sink-compatible). */
export function traceLogFields(context: TraceContext): { trace_id: string; correlation_id: string } {
  return { trace_id: context.trace_id, correlation_id: context.correlation_id };
}

export interface TraceLogEntryOptions {
  msg: string;
  level?: LogLevel;
  component?: string;
  /** Caller fields appended after the trace fields (sinks redact on emit). */
  fields?: Record<string, unknown>;
}

/**
 * Build a house `StructuredLogEntry` carrying the trace fields, ready for
 * `logStructured` / the telemetry buffer. The caller's component is kept so
 * provenance answers "which surface emitted this" (§29).
 */
export function traceLogEntry(context: TraceContext, options: TraceLogEntryOptions): StructuredLogEntry {
  return {
    msg: options.msg,
    level: options.level ?? "info",
    component: options.component ?? TRACE_CONTEXT_COMPONENT,
    ...traceLogFields(context),
    ...(options.fields ?? {}),
  };
}

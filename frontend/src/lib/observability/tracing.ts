/**
 * Sherivs — vendor-neutral tracing facade (mission M23, ADR-110; master brief §2.2 rule 14).
 *
 * A small span API that is a NO-OP unless an OTLP traces endpoint is configured. When one is,
 * finished spans are batched and sent as OTLP/HTTP JSON (`POST <endpoint>`, content type
 * application/json) using `fetch`. No vendor SDK, no new dependency: any OpenTelemetry
 * Collector or agent that accepts OTLP/HTTP (for example the Datadog Agent's OTLP receiver)
 * can receive it. Nothing is configured to receive it today.
 *
 * Laws of this module:
 * - NO-OP BY DEFAULT. Without an endpoint, `startSpan` returns a shared inert span and
 *   nothing is buffered, timed or sent.
 * - STRICT ATTRIBUTE ALLOWLIST. Only the keys in `SPAN_ATTRIBUTE_ALLOWLIST` survive, each with
 *   a declared value kind. Every other key (user ids, emails, tokens, headers, bodies, query
 *   strings, tenant ids) is dropped before it reaches a buffer. String values are also screened:
 *   credential-shaped values, email addresses, long digit runs and UUIDs are dropped, and
 *   routes must be templates (no query string). Over-dropping is acceptable; leaking is not.
 * - SAFE NAMES. Span names must be short identifiers; anything else becomes `span`.
 * - ERRORS BY TYPE ONLY. `recordError` keeps the error's constructor name, never its message
 *   or stack, because messages carry user input.
 * - NEVER BREAKS THE CALLER. Export failures are counted and swallowed; the endpoint URL is
 *   never logged.
 * - TIME through the kernel time authority or an injected clock.
 */

import { SystemClock, TimeAuthority } from "../kernel/time-authority";
import { isCredentialShapedValue } from "./trace-context";

/* ─────────────────────────────────────────────────────────────
 * Attribute allowlist
 * ────────────────────────────────────────────────────────────*/

type AttributeKind = "string" | "int" | "bool" | "route" | "token";

/**
 * The ONLY attribute keys a span may carry, with the value kind each accepts.
 * Adding a key is a reviewed change (ADR-110): it must never identify a person or tenant.
 */
export const SPAN_ATTRIBUTE_ALLOWLIST: Readonly<Record<string, AttributeKind>> = Object.freeze({
  "http.request.method": "token",
  "http.route": "route",
  "http.response.status_code": "int",
  "server.function": "token",
  "db.operation.name": "token",
  "db.collection.name": "token",
  "messaging.operation.name": "token",
  "error.type": "token",
  "app.component": "token",
  "app.outcome": "token",
  "app.cache_hit": "bool",
  "app.retry_count": "int",
  "app.item_count": "int",
});

export const MAX_SPAN_ATTRIBUTES = 16;
export const MAX_ATTRIBUTE_STRING_LENGTH = 128;
export const MAX_SPAN_NAME_LENGTH = 96;
export const FALLBACK_SPAN_NAME = "span";

export type SpanAttributeValue = string | number | boolean;
export type SpanAttributes = Record<string, unknown>;

const TOKEN_PATTERN = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/;
/** Route templates: `/home/$section`, `/api/public/{id}`; no query string, no fragment. */
const ROUTE_PATTERN = /^\/[A-Za-z0-9/_.$:{}-]{0,127}$/;
const SPAN_NAME_PATTERN = /^[A-Za-z][A-Za-z0-9 _./:$-]{0,95}$/;
const EMAIL_PATTERN = /[^\s@]+@[^\s@]+\.[^\s@]+/;
const LONG_DIGITS_PATTERN = /\d{6,}/;
/** Key prefixes and credential words the shared screen does not catch inside longer tokens. */
const SECRET_HINT_PATTERN =
  /(?:^|[^A-Za-z])(?:sk|pk|rk)_(?:live|test)_|^sk-|bearer|password|secret|token|apikey|api_key/i;
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

function isSafeText(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= MAX_ATTRIBUTE_STRING_LENGTH &&
    !isCredentialShapedValue(value) &&
    !SECRET_HINT_PATTERN.test(value) &&
    !EMAIL_PATTERN.test(value) &&
    !LONG_DIGITS_PATTERN.test(value) &&
    !UUID_PATTERN.test(value)
  );
}

/** One attribute through the allowlist: the accepted value, or `undefined` (dropped). */
export function screenAttribute(key: string, value: unknown): SpanAttributeValue | undefined {
  if (!Object.prototype.hasOwnProperty.call(SPAN_ATTRIBUTE_ALLOWLIST, key)) return undefined;
  const kind = SPAN_ATTRIBUTE_ALLOWLIST[key];
  switch (kind) {
    case "int":
      return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
        ? value
        : undefined;
    case "bool":
      return typeof value === "boolean" ? value : undefined;
    case "token":
      return typeof value === "string" && TOKEN_PATTERN.test(value) && isSafeText(value)
        ? value
        : undefined;
    case "route":
      return typeof value === "string" && ROUTE_PATTERN.test(value) && isSafeText(value)
        ? value
        : undefined;
    case "string":
      return typeof value === "string" && isSafeText(value) ? value : undefined;
    default:
      return undefined;
  }
}

/** Screen a whole attribute record; returns the survivors and how many were dropped. */
export function screenAttributes(
  attributes: SpanAttributes | undefined,
  existingCount = 0,
): { accepted: Record<string, SpanAttributeValue>; dropped: number } {
  const accepted: Record<string, SpanAttributeValue> = {};
  let dropped = 0;
  if (attributes == null || typeof attributes !== "object") return { accepted, dropped };
  for (const [key, value] of Object.entries(attributes)) {
    const screened = screenAttribute(key, value);
    if (
      screened === undefined ||
      existingCount + Object.keys(accepted).length >= MAX_SPAN_ATTRIBUTES
    ) {
      dropped += 1;
      continue;
    }
    accepted[key] = screened;
  }
  return { accepted, dropped };
}

export function safeSpanName(name: unknown): string {
  if (typeof name !== "string") return FALLBACK_SPAN_NAME;
  const trimmed = name.trim();
  return SPAN_NAME_PATTERN.test(trimmed) &&
    trimmed.length <= MAX_SPAN_NAME_LENGTH &&
    !LONG_DIGITS_PATTERN.test(trimmed) &&
    !UUID_PATTERN.test(trimmed) &&
    !isCredentialShapedValue(trimmed) &&
    !SECRET_HINT_PATTERN.test(trimmed)
    ? trimmed
    : FALLBACK_SPAN_NAME;
}

/* ─────────────────────────────────────────────────────────────
 * Span API
 * ────────────────────────────────────────────────────────────*/

export type SpanKind = "internal" | "server" | "client" | "producer" | "consumer";
export type SpanStatus = "unset" | "ok" | "error";

export interface Span {
  readonly recording: boolean;
  setAttribute(key: string, value: unknown): void;
  setAttributes(attributes: SpanAttributes): void;
  setStatus(status: SpanStatus): void;
  /** Records the error's type (constructor name) and marks the span as an error. */
  recordError(error: unknown): void;
  end(): void;
}

export interface StartSpanOptions {
  kind?: SpanKind;
  attributes?: SpanAttributes;
  /** The parent span, passed explicitly (no ambient context, like trace-context.ts). */
  parent?: Span;
}

export interface Tracer {
  readonly enabled: boolean;
  startSpan(name: string, options?: StartSpanOptions): Span;
  /** Runs `fn` inside a span, ending it and recording a thrown error's type. */
  withSpan<T>(name: string, fn: (span: Span) => Promise<T>, options?: StartSpanOptions): Promise<T>;
  /** Sends buffered spans now. Resolves after the attempt; never rejects. */
  flush(): Promise<void>;
  stats(): TracerStats;
}

export interface TracerStats {
  exportedSpans: number;
  droppedSpans: number;
  droppedAttributes: number;
  failedExports: number;
}

const NOOP_SPAN: Span = Object.freeze({
  recording: false,
  setAttribute: () => undefined,
  setAttributes: () => undefined,
  setStatus: () => undefined,
  recordError: () => undefined,
  end: () => undefined,
});

/** The default tracer: does nothing, buffers nothing, sends nothing. */
export const NOOP_TRACER: Tracer = Object.freeze({
  enabled: false,
  startSpan: () => NOOP_SPAN,
  withSpan: <T>(_name: string, fn: (span: Span) => Promise<T>) => fn(NOOP_SPAN),
  flush: async () => undefined,
  stats: () => ({ exportedSpans: 0, droppedSpans: 0, droppedAttributes: 0, failedExports: 0 }),
});

/* ─────────────────────────────────────────────────────────────
 * OTLP/HTTP JSON exporter
 * ────────────────────────────────────────────────────────────*/

type FetchLike = (
  input: string,
  init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal },
) => Promise<{ ok: boolean; status: number }>;

export interface OtlpTracerOptions {
  /** Full OTLP/HTTP traces URL, e.g. http://localhost:4318/v1/traces. */
  endpoint: string;
  serviceName?: string;
  serviceVersion?: string | null;
  deploymentEnvironment?: string | null;
  fetchImpl?: FetchLike;
  /** Epoch milliseconds. */
  nowMs?: () => number;
  /** Random bytes source (tests inject a deterministic one). */
  randomBytes?: (length: number) => Uint8Array;
  maxBatchSize?: number;
  maxQueueSize?: number;
  exportTimeoutMs?: number;
}

export const DEFAULT_SERVICE_NAME = "sherivs-web";
export const SCOPE_NAME = "sherivs.tracing";
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

/**
 * Accepts an http(s) URL with no credentials; plain http only for a local collector.
 * Returns the normalized URL string or null.
 */
export function validateOtlpEndpoint(raw: unknown): string | null {
  if (typeof raw !== "string" || raw.trim().length === 0) return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  if (url.protocol === "https:") return url.href;
  if (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname)) return url.href;
  return null;
}

const KIND_CODES: Record<SpanKind, number> = {
  internal: 1,
  server: 2,
  client: 3,
  producer: 4,
  consumer: 5,
};
const STATUS_CODES: Record<SpanStatus, number> = { unset: 0, ok: 1, error: 2 };

interface FinishedSpan {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  kind: SpanKind;
  startMs: number;
  endMs: number;
  attributes: Record<string, SpanAttributeValue>;
  status: SpanStatus;
}

function defaultRandomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

function hex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

/** Epoch ms → OTLP unix nanoseconds as a decimal string (JSON-safe, no float loss). */
export function msToUnixNano(ms: number): string {
  const whole = Math.max(0, Math.trunc(ms));
  return whole === 0 ? "0" : `${whole}000000`;
}

function otlpValue(value: SpanAttributeValue): Record<string, unknown> {
  if (typeof value === "boolean") return { boolValue: value };
  if (typeof value === "number") return { intValue: String(value) };
  return { stringValue: value };
}

function otlpAttributes(attributes: Record<string, SpanAttributeValue>) {
  return Object.entries(attributes).map(([key, value]) => ({ key, value: otlpValue(value) }));
}

/** Build the OTLP/HTTP JSON request body for a batch of finished spans. */
export function buildOtlpPayload(
  spans: readonly FinishedSpan[],
  resource: Record<string, SpanAttributeValue>,
): Record<string, unknown> {
  return {
    resourceSpans: [
      {
        resource: { attributes: otlpAttributes(resource) },
        scopeSpans: [
          {
            scope: { name: SCOPE_NAME },
            spans: spans.map((span) => ({
              traceId: span.traceId,
              spanId: span.spanId,
              ...(span.parentSpanId ? { parentSpanId: span.parentSpanId } : {}),
              name: span.name,
              kind: KIND_CODES[span.kind],
              startTimeUnixNano: msToUnixNano(span.startMs),
              endTimeUnixNano: msToUnixNano(span.endMs),
              attributes: otlpAttributes(span.attributes),
              status: { code: STATUS_CODES[span.status] },
            })),
          },
        ],
      },
    ],
  };
}

const RESOURCE_TOKEN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,63}$/;

class RecordingSpan implements Span {
  readonly recording = true;
  readonly traceId: string;
  readonly spanId: string;
  private readonly attributes: Record<string, SpanAttributeValue> = {};
  private status: SpanStatus = "unset";
  private ended = false;

  constructor(
    private readonly tracer: OtlpTracer,
    private readonly name: string,
    private readonly kind: SpanKind,
    private readonly startMs: number,
    traceId: string,
    spanId: string,
    private readonly parentSpanId: string | undefined,
  ) {
    this.traceId = traceId;
    this.spanId = spanId;
  }

  setAttribute(key: string, value: unknown): void {
    this.setAttributes({ [key]: value });
  }

  setAttributes(attributes: SpanAttributes): void {
    if (this.ended) return;
    const existing = Object.keys(this.attributes).length;
    const { accepted, dropped } = screenAttributes(attributes, existing);
    Object.assign(this.attributes, accepted);
    this.tracer.countDroppedAttributes(dropped);
  }

  setStatus(status: SpanStatus): void {
    if (!this.ended && status in STATUS_CODES) this.status = status;
  }

  recordError(error: unknown): void {
    const type =
      error instanceof Error && typeof error.name === "string" && TOKEN_PATTERN.test(error.name)
        ? error.name
        : "Error";
    this.setAttribute("error.type", type);
    this.setStatus("error");
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    this.tracer.enqueue({
      traceId: this.traceId,
      spanId: this.spanId,
      parentSpanId: this.parentSpanId,
      name: this.name,
      kind: this.kind,
      startMs: this.startMs,
      endMs: Math.max(this.startMs, this.tracer.now()),
      attributes: { ...this.attributes },
      status: this.status,
    });
  }
}

class OtlpTracer implements Tracer {
  readonly enabled = true;
  private readonly queue: FinishedSpan[] = [];
  private readonly counters: TracerStats = {
    exportedSpans: 0,
    droppedSpans: 0,
    droppedAttributes: 0,
    failedExports: 0,
  };
  private readonly resource: Record<string, SpanAttributeValue>;
  private readonly fetchImpl: FetchLike;
  private readonly nowMs: () => number;
  private readonly randomBytes: (length: number) => Uint8Array;
  private readonly maxBatchSize: number;
  private readonly maxQueueSize: number;
  private readonly exportTimeoutMs: number;
  private inFlight: Promise<void> | null = null;

  constructor(
    private readonly endpoint: string,
    options: OtlpTracerOptions,
  ) {
    const clock = new TimeAuthority(new SystemClock());
    this.nowMs = options.nowMs ?? (() => clock.now().atMs);
    this.fetchImpl = options.fetchImpl ?? (globalThis.fetch as unknown as FetchLike);
    this.randomBytes = options.randomBytes ?? defaultRandomBytes;
    this.maxBatchSize = options.maxBatchSize ?? 64;
    this.maxQueueSize = options.maxQueueSize ?? 512;
    this.exportTimeoutMs = options.exportTimeoutMs ?? 3_000;
    const resource: Record<string, SpanAttributeValue> = {
      "service.name":
        options.serviceName && RESOURCE_TOKEN.test(options.serviceName)
          ? options.serviceName
          : DEFAULT_SERVICE_NAME,
    };
    if (options.serviceVersion && RESOURCE_TOKEN.test(options.serviceVersion)) {
      resource["service.version"] = options.serviceVersion;
    }
    if (options.deploymentEnvironment && RESOURCE_TOKEN.test(options.deploymentEnvironment)) {
      resource["deployment.environment.name"] = options.deploymentEnvironment;
    }
    this.resource = resource;
  }

  now(): number {
    return this.nowMs();
  }

  countDroppedAttributes(count: number): void {
    this.counters.droppedAttributes += count;
  }

  startSpan(name: string, options: StartSpanOptions = {}): Span {
    const parent = options.parent instanceof RecordingSpan ? options.parent : undefined;
    const span = new RecordingSpan(
      this,
      safeSpanName(name),
      options.kind && options.kind in KIND_CODES ? options.kind : "internal",
      this.nowMs(),
      parent ? parent.traceId : hex(this.randomBytes(16)),
      hex(this.randomBytes(8)),
      parent?.spanId,
    );
    if (options.attributes) span.setAttributes(options.attributes);
    return span;
  }

  async withSpan<T>(
    name: string,
    fn: (span: Span) => Promise<T>,
    options?: StartSpanOptions,
  ): Promise<T> {
    const span = this.startSpan(name, options);
    try {
      const result = await fn(span);
      span.setStatus("ok");
      return result;
    } catch (error) {
      span.recordError(error);
      throw error;
    } finally {
      span.end();
    }
  }

  enqueue(span: FinishedSpan): void {
    if (this.queue.length >= this.maxQueueSize) {
      this.counters.droppedSpans += 1;
      return;
    }
    this.queue.push(span);
    if (this.queue.length >= this.maxBatchSize) void this.flush();
  }

  async flush(): Promise<void> {
    if (this.inFlight) await this.inFlight;
    if (this.queue.length === 0) return;
    const batch = this.queue.splice(0, this.queue.length);
    this.inFlight = this.send(batch).finally(() => {
      this.inFlight = null;
    });
    await this.inFlight;
  }

  private async send(batch: FinishedSpan[]): Promise<void> {
    const controller = typeof AbortController === "function" ? new AbortController() : null;
    const timer = controller
      ? setTimeout(() => controller.abort(), this.exportTimeoutMs)
      : undefined;
    try {
      const response = await this.fetchImpl(this.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildOtlpPayload(batch, this.resource)),
        signal: controller?.signal,
      });
      if (response.ok) {
        this.counters.exportedSpans += batch.length;
      } else {
        this.counters.failedExports += 1;
        this.counters.droppedSpans += batch.length;
      }
    } catch {
      this.counters.failedExports += 1;
      this.counters.droppedSpans += batch.length;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  stats(): TracerStats {
    return { ...this.counters };
  }
}

/**
 * Create a tracer. With no valid endpoint this returns `NOOP_TRACER`, so a missing, empty or
 * unsafe endpoint can never turn tracing on by accident.
 */
export function createTracer(options: Partial<OtlpTracerOptions> = {}): Tracer {
  const endpoint = validateOtlpEndpoint(options.endpoint);
  if (endpoint === null) return NOOP_TRACER;
  return new OtlpTracer(endpoint, { ...options, endpoint });
}

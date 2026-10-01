/**
 * CoreGrid — minimal structured logging (V5.3 Part 30 observability-minimal).
 *
 * One JSON line per event on the console: `ts`, `level`, `msg` plus optional
 * `tenant_id`, `component`, `duration_ms`, `err` and any extra caller fields.
 *
 * Security invariants (Part 29 — AI privacy law / no secrets in logs):
 * - keys whose name looks like a secret/token/password/key are redacted
 *   recursively before serialization, fail-closed (over-redact, never leak);
 * - error values are serialized as `Name: message` only — never stack traces,
 *   never raw unknown payloads;
 * - request logging must log pathname only, never query strings (queries can
 *   carry tokens, e.g. `?token=…`).
 */

export const REDACTED = "[REDACTED]";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface StructuredLogEntry {
  msg: string;
  level?: LogLevel;
  tenant_id?: string | null;
  component?: string | null;
  duration_ms?: number | null;
  err?: unknown;
  [field: string]: unknown;
}

export type LogSink = (line: string, level: LogLevel) => void;

export interface LogFormatOptions {
  /** Injectable clock (ISO string) so formatting stays pure and testable. */
  now?: () => string;
}

export interface LogEmitOptions {
  sink?: LogSink;
  now?: () => string;
}

/** Substrings that mark a key as sensitive, matched case-insensitively. */
const SENSITIVE_KEY_PARTS: readonly string[] = ["secret", "token", "password", "key"];

const CORE_KEYS: ReadonlySet<string> = new Set([
  "msg",
  "level",
  "tenant_id",
  "component",
  "duration_ms",
  "err",
]);

const MAX_REDACT_DEPTH = 8;

export function isSensitiveKey(key: string): boolean {
  const lower = key.toLowerCase();
  return SENSITIVE_KEY_PARTS.some((part) => lower.includes(part));
}

/**
 * Deep-copies a value, replacing any sensitive-keyed member with
 * `[REDACTED]`. Cycles and over-deep structures degrade to sentinel strings
 * instead of throwing, because a logging failure must never take down a
 * request.
 */
export function redactValue(value: unknown, depth = 0, seen?: Set<object>): unknown {
  if (value === null || typeof value !== "object") return value;
  const visited = seen ?? new Set<object>();
  if (visited.has(value)) return "[circular]";
  if (depth >= MAX_REDACT_DEPTH) return "[truncated]";
  visited.add(value);
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, depth + 1, visited));
  }
  const out: Record<string, unknown> = {};
  for (const [key, member] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSensitiveKey(key) ? REDACTED : redactValue(member, depth + 1, visited);
  }
  return out;
}

/** `Name: message` for Errors; safe strings otherwise; never a stack. */
export function serializeError(err: unknown): string {
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  if (typeof err === "string") return err;
  if (err === undefined) return "undefined";
  try {
    const json = JSON.stringify(err);
    return json === undefined ? "[unserializable-error]" : json;
  } catch {
    return "[unserializable-error]";
  }
}

/** Pure: entry → one JSON line. Inject `now` for deterministic tests. */
export function formatLogLine(entry: StructuredLogEntry, options: LogFormatOptions = {}): string {
  const now = options.now ?? (() => new Date().toISOString());
  const ts = now();
  const line: Record<string, unknown> = {
    ts,
    level: entry.level ?? "info",
    msg: entry.msg,
  };
  if (entry.tenant_id != null) line.tenant_id = entry.tenant_id;
  if (entry.component != null) line.component = entry.component;
  if (typeof entry.duration_ms === "number" && Number.isFinite(entry.duration_ms)) {
    line.duration_ms = entry.duration_ms;
  }
  if (entry.err !== undefined) line.err = serializeError(entry.err);

  for (const [key, value] of Object.entries(entry)) {
    if (CORE_KEYS.has(key)) continue;
    line[key] = isSensitiveKey(key) ? REDACTED : redactValue(value);
  }

  try {
    return JSON.stringify(line);
  } catch {
    return JSON.stringify({
      ts,
      level: "error",
      msg: "log-line-serialization-failed",
    });
  }
}

function defaultSink(line: string, level: LogLevel): void {
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

/** Emits one JSON line through the sink (default: level-mapped console). */
export function logStructured(entry: StructuredLogEntry, options: LogEmitOptions = {}): void {
  const sink = options.sink ?? defaultSink;
  const level = entry.level ?? "info";
  sink(formatLogLine(entry, { now: options.now }), level);
}
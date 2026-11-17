/**
 * Ledger redaction (ENGINE-03, ADR-081): what a brokered call may leave behind.
 * The ledger keeps a digest of the exact arguments and a bounded, redacted
 * summary. Secret-named keys and secret-shaped values are dropped, never masked
 * in place, so nothing about them survives.
 */
import { createHash } from "node:crypto";
import { canonicalJson } from "../twin-engine/role-pack";
import { SECRET_KEY_PATTERN, looksLikeSecretValue } from "./connector-vault";

const MAX_STRING = 200;
const MAX_KEYS = 40;
const MAX_DEPTH = 4;

export const argsDigest = (args: unknown): string =>
  createHash("sha256").update(canonicalJson(args)).digest("hex");

function walk(value: unknown, depth: number): unknown {
  if (value === null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (looksLikeSecretValue(value)) return "[withheld]";
    return value.length > MAX_STRING ? `${value.slice(0, MAX_STRING)}…` : value;
  }
  if (depth >= MAX_DEPTH) return "[truncated]";
  if (Array.isArray(value)) return value.slice(0, MAX_KEYS).map((v) => walk(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = Object.create(null) as Record<string, unknown>;
    let n = 0;
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SECRET_KEY_PATTERN.test(k) || k === "__proto__" || k === "constructor") continue;
      if (n++ >= MAX_KEYS) break;
      out[k] = walk(v, depth + 1);
    }
    return out;
  }
  return "[unsupported]";
}

export const redactArgs = (args: unknown): unknown => walk(args, 0);

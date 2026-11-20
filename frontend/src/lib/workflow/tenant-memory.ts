// AIN-03: tenant memory and context scopes. Pure, no I/O. The database is the authority (wf_memory_* tables and the
// guards, migration 20261117000990); this file restates its reviewed data and its caps so the application can explain a
// refusal before it asks, and so a unit test fails when the two drift apart. It stores nothing and grants nothing: a
// write exists only through wf_memory_put / wf_memory_agent_propose, and an agent reads only through
// wf_memory_agent_read, which stays closed until the founder decides the AI route (decision 3).

export const MEMORY_SCOPES = ["organization", "workflow", "agent", "run"] as const;
export type MemoryScope = (typeof MEMORY_SCOPES)[number];

export const MEMORY_CLASSES = ["reference", "note"] as const;
export type MemoryClass = (typeof MEMORY_CLASSES)[number];

export type MemoryScopeRule = Readonly<{
  defaultTtlDays: number;
  maxTtlDays: number;
  maxItems: number;
  agentMayPropose: boolean;
}>;

/** wf_memory_scope_kind. Engineering defaults for the founder to ratify. Agents propose only into agent and run. */
export const MEMORY_SCOPE_RULES: Readonly<Record<MemoryScope, MemoryScopeRule>> = Object.freeze({
  organization: { defaultTtlDays: 365, maxTtlDays: 1095, maxItems: 300, agentMayPropose: false },
  workflow: { defaultTtlDays: 180, maxTtlDays: 730, maxItems: 200, agentMayPropose: false },
  agent: { defaultTtlDays: 90, maxTtlDays: 365, maxItems: 200, agentMayPropose: true },
  run: { defaultTtlDays: 7, maxTtlDays: 30, maxItems: 50, agentMayPropose: true },
});

/** wf_memory_org_item_cap(): live items per organization across all scopes. */
export const MEMORY_ORG_ITEM_CAP = 2000;
/** wf_memory_agent_daily_proposals(): proposals per agent and organization in any 24 hours. */
export const MEMORY_AGENT_DAILY_PROPOSALS = 50;
/** wf_memory_item_delete_guard: a retired row is deleted by the retention pass after this many days. */
export const MEMORY_RETIRED_KEEP_DAYS = 30;

export const MEMORY_KEY_PATTERN = /^[a-z][a-z0-9_.-]{1,95}$/;
const VALUE_KEY_PATTERN = /^[a-z][a-z0-9_]{0,47}$/;
const REFERENCE_STRING_PATTERN = /^[A-Za-z0-9_.:/-]{1,200}$/;
export const MEMORY_VALUE_MAX_BYTES = 4096;
export const MEMORY_VALUE_MAX_ENTRIES = 20;
export const MEMORY_NOTE_MAX_CHARS = 300;

export type MemoryRefusal =
  | "invalid_class"
  | "invalid_key"
  | "invalid_scope"
  | "value_not_an_object"
  | "value_too_large"
  | "value_entry_count"
  | "value_key_invalid"
  | "value_not_flat"
  | "reference_string_not_a_code"
  | "note_text_length"
  | "lifetime_out_of_bounds"
  | "ai_readable_needs_reference"
  | "agent_cannot_write_this_scope";

/** Mirror of wf_memory_value_ok: null when the value fits the class, else the first reason it does not. */
export function memoryValueRefusal(cls: string, value: unknown): MemoryRefusal | null {
  if (cls !== "reference" && cls !== "note") return "invalid_class";
  if (typeof value !== "object" || value === null || Array.isArray(value))
    return "value_not_an_object";
  const entries = Object.entries(value as Record<string, unknown>);
  if (entries.length < 1 || entries.length > MEMORY_VALUE_MAX_ENTRIES) return "value_entry_count";
  if (new TextEncoder().encode(JSON.stringify(value)).length > MEMORY_VALUE_MAX_BYTES) {
    return "value_too_large";
  }
  for (const [k, v] of entries) {
    if (!VALUE_KEY_PATTERN.test(k)) return "value_key_invalid";
    if (typeof v === "boolean" || typeof v === "number") continue;
    if (typeof v !== "string") return "value_not_flat";
    if (cls === "reference") {
      if (!REFERENCE_STRING_PATTERN.test(v)) return "reference_string_not_a_code";
    } else if (v.length < 1 || v.length > MEMORY_NOTE_MAX_CHARS) {
      return "note_text_length";
    }
  }
  return null;
}

export type MemoryWriteRequest = Readonly<{
  by: "person" | "agent";
  scope: string;
  key: string;
  cls: string;
  value: unknown;
  ttlDays?: number | null;
  aiReadable?: boolean;
}>;

/** Why the database would refuse this write for reasons of shape alone (null = nothing wrong with the request). */
export function memoryWriteRefusal(req: MemoryWriteRequest): MemoryRefusal | null {
  const rule = (MEMORY_SCOPE_RULES as Record<string, MemoryScopeRule | undefined>)[req.scope];
  if (!rule || !Object.hasOwn(MEMORY_SCOPE_RULES, req.scope)) return "invalid_scope";
  if (!MEMORY_KEY_PATTERN.test(req.key)) return "invalid_key";
  const shape = memoryValueRefusal(req.cls, req.value);
  if (shape) return shape;
  if (req.by === "agent" && !rule.agentMayPropose) return "agent_cannot_write_this_scope";
  if (req.aiReadable && (req.cls !== "reference" || req.by === "agent"))
    return "ai_readable_needs_reference";
  const ttl = req.ttlDays ?? rule.defaultTtlDays;
  if (!Number.isInteger(ttl) || ttl < 1 || ttl > rule.maxTtlDays) return "lifetime_out_of_bounds";
  return null;
}

/** When an item written now with this lifetime ends. The clock is passed in (no ambient time in this library). */
export function memoryExpiresAtMs(
  nowMs: number,
  scope: MemoryScope,
  ttlDays?: number | null,
): number {
  return nowMs + (ttlDays ?? MEMORY_SCOPE_RULES[scope].defaultTtlDays) * 86_400_000;
}

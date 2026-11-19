/**
 * M5a (E-009) — value validation of one graph answer (same rules as the R1
 * `validateValue` for the shared answer types).
 */
import type { GraphAnswerValue, GraphQuestion } from "./types";

export function graphAnswerIssue(q: GraphQuestion, v: GraphAnswerValue): string | null {
  const val = q.validation;
  switch (q.type) {
    case "bool":
      return typeof v === "boolean" ? null : "type_mismatch";
    case "number":
      if (typeof v !== "number" || !Number.isFinite(v)) return "type_mismatch";
      if (val.min !== undefined && v < val.min) return "below_min";
      if (val.max !== undefined && v > val.max) return "above_max";
      return null;
    case "single":
      return typeof v === "string" && q.options.includes(v) ? null : "invalid_option";
    case "multi": {
      if (!Array.isArray(v) || !v.every((x) => typeof x === "string")) return "type_mismatch";
      if (new Set(v).size !== v.length) return "duplicate_items";
      if (v.some((x) => !q.options.includes(x))) return "invalid_option";
      if (val.minItems !== undefined && v.length < val.minItems) return "too_few_items";
      if (val.maxItems !== undefined && v.length > val.maxItems) return "too_many_items";
      return null;
    }
    case "text":
      if (typeof v !== "string" || v.trim().length === 0) return "type_mismatch";
      if (val.maxLength !== undefined && v.length > val.maxLength) return "too_long";
      return null;
    default:
      return "unknown_type";
  }
}

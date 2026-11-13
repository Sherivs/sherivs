/**
 * SV1-REALITY R1 (#332) — reusable registry validation and deterministic
 * versioning. Pure functions over a question list.
 */
import type { DiscoveryQuestion, QuestionIssue } from "./question-types";
import {
  isAnswerType,
  isEntityType,
  isInstitutionType,
  isRealityDomain,
  type InstitutionType,
  type RealityDomain,
} from "./taxonomy";

export const QUESTION_ID_PATTERN = /^[a-z][a-z0-9]*(\.[a-z][a-z0-9_]*){2,}$/;
export const CONFIG_PATH_PATTERN =
  /^scholar\.institution\.operating_model\.[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)*$/;
const OPTION_TYPES = new Set(["single", "multi"]);

export interface BranchCoverageRule {
  readonly institutionType: InstitutionType;
  readonly domains: readonly RealityDomain[];
}

export function validateRegistry(
  questions: readonly DiscoveryQuestion[],
  coverage: readonly BranchCoverageRule[] = [],
): QuestionIssue[] {
  const issues: QuestionIssue[] = [];
  const add = (code: string, questionId: string | undefined, message: string) =>
    issues.push({ code, questionId, message });

  const byId = new Map<string, DiscoveryQuestion>();
  for (const q of questions) {
    if (byId.has(q.id)) add("duplicate_id", q.id, "question id is not unique");
    byId.set(q.id, q);
  }

  for (const q of questions) {
    if (!QUESTION_ID_PATTERN.test(q.id))
      add("bad_id_format", q.id, "expected <pack>.<topic>.<name>");
    if (!q.id.startsWith(`${q.pack}.`))
      add("id_pack_mismatch", q.id, `id must start with ${q.pack}.`);
    if (!isRealityDomain(q.domain)) add("unknown_domain", q.id, q.domain);
    if (!isAnswerType(q.answerType)) add("unknown_answer_type", q.id, q.answerType);
    if (q.institutionTypes.length === 0)
      add("no_institution_types", q.id, "at least one institution type");
    for (const t of q.institutionTypes)
      if (!isInstitutionType(t)) add("unknown_institution_type", q.id, t);
    if (!q.prompt.trim()) add("empty_prompt", q.id, "prompt required");
    if (q.requiredToActivate && !q.required)
      add("activation_requires_required", q.id, "requiredToActivate implies required");
    if (
      OPTION_TYPES.has(q.answerType) &&
      !(q.validation.options && q.validation.options.length > 0)
    ) {
      add("missing_options", q.id, "single/multi questions need validation.options");
    }
    const v = q.validation;
    if (v.min !== undefined && v.max !== undefined && v.min > v.max)
      add("bad_range", q.id, "min > max");
    if (v.minItems !== undefined && v.maxItems !== undefined && v.minItems > v.maxItems)
      add("bad_range", q.id, "minItems > maxItems");
    if (q.websiteMapping.publicSafe && !q.websiteMapping.field)
      add("public_field_missing", q.id, "publicSafe needs a field key");
    if (q.websiteMapping.publicSafe && q.domain === "human")
      add("public_human_forbidden", q.id, "human-domain answers are never public");
    if (!CONFIG_PATH_PATTERN.test(q.configMapping.path))
      add("bad_config_path", q.id, q.configMapping.path);
    if (!isEntityType(q.configMapping.entityType))
      add("unknown_entity_type", q.id, q.configMapping.entityType);

    for (const d of q.dependsOn) {
      if (d === q.id) add("self_dependency", q.id, "depends on itself");
      else if (!byId.has(d)) add("unknown_dependency", q.id, d);
    }
    for (const f of q.followUps) {
      const child = byId.get(f);
      if (!child) add("unknown_follow_up", q.id, f);
      else if (!child.visibleWhen.some((c) => c.questionId === q.id)) {
        add("follow_up_not_gated", q.id, `${f} must be visible only when ${q.id} is answered`);
      }
    }
    for (const c of q.visibleWhen) {
      const target = byId.get(c.questionId);
      if (!target) add("unknown_visibility_ref", q.id, c.questionId);
      else {
        if (!q.dependsOn.includes(c.questionId))
          add("visibility_not_a_dependency", q.id, c.questionId);
        if (!target.institutionTypes.some((t) => q.institutionTypes.includes(t))) {
          add("visibility_type_disjoint", q.id, c.questionId);
        }
      }
    }
  }

  for (const cycle of findCycles(questions)) add("dependency_cycle", cycle[0], cycle.join(" -> "));

  for (const rule of coverage) {
    const forType = questions.filter((q) => q.institutionTypes.includes(rule.institutionType));
    if (!forType.some((q) => q.visibleWhen.length === 0)) {
      add(
        "no_root_question",
        undefined,
        `${rule.institutionType} has no unconditional entry question`,
      );
    }
    for (const d of rule.domains) {
      if (!forType.some((q) => q.domain === d))
        add("branch_coverage_gap", undefined, `${rule.institutionType}:${d}`);
    }
  }
  return issues;
}

function findCycles(questions: readonly DiscoveryQuestion[]): string[][] {
  const deps = new Map(questions.map((q) => [q.id, q.dependsOn.filter((d) => d !== q.id)]));
  const state = new Map<string, 1 | 2>();
  const cycles: string[][] = [];
  const stack: string[] = [];
  const visit = (id: string) => {
    state.set(id, 1);
    stack.push(id);
    for (const d of deps.get(id) ?? []) {
      if (!deps.has(d)) continue;
      if (state.get(d) === 1) cycles.push([...stack.slice(stack.indexOf(d)), d]);
      else if (!state.has(d)) visit(d);
    }
    stack.pop();
    state.set(id, 2);
  };
  for (const id of [...deps.keys()].sort()) if (!state.has(id)) visit(id);
  return cycles;
}

/** Stable JSON: keys sorted, arrays kept in order. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

/** FNV-1a 32-bit over canonical JSON of the id-sorted registry; deterministic and order-independent. */
export function registryContentHash(questions: readonly DiscoveryQuestion[]): string {
  const sorted = [...questions].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const text = canonicalJson(sorted);
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

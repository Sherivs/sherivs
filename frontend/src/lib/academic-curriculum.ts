/**
 * CoreGrid — Academic Learning Intelligence: curriculum and competency intelligence.
 *
 * The blueprint's core claim (Phase 11 §C, §I–§O) is that the platform must know what was
 * being taught, against what competency, before it interprets any evidence about learning.
 * This module owns that structure and nothing else:
 *
 *   Curriculum hierarchy (institution → … → objective → competency)
 *   Curriculum VERSIONING, so a historical record stays interpretable under the version it
 *   was created against (invariant FB.24, §K)
 *   Competency definitions with a CONFIGURABLE level scale and an explicit prerequisite
 *   graph that refuses cycles (invariant FB.25, §L–§N)
 *   Learning objectives bound to competencies with declared mastery criteria (§O)
 *
 * Domain-neutral: no runtime is named; an installed runtime supplies its own curriculum and
 * competency vocabulary as data.
 */

/** Where a curriculum sits in the institutional hierarchy (§J). */
export const CURRICULUM_LEVELS = [
  "institution",
  "program",
  "curriculum",
  "course",
  "module",
  "unit",
  "lesson",
  "objective",
  "competency",
] as const;
export type CurriculumLevel = (typeof CURRICULUM_LEVELS)[number];

/** A node in the curriculum hierarchy; children are referenced by id, never inlined. */
export interface CurriculumNode {
  id: string;
  tenantId: string;
  level: CurriculumLevel;
  key: string;
  title: string;
  parentId: string | null;
  /** Competencies this node is aligned to (§I competency mapping). */
  competencies: readonly string[];
  /** The version this node belongs to: a curriculum is versioned, not edited (§K). */
  version: number;
}

export interface CreateCurriculumNodeInput {
  id: string;
  tenantId: string;
  level: CurriculumLevel;
  key: string;
  title: string;
  parentId?: string | null;
  competencies?: readonly string[];
  version?: number;
}

export type CreateCurriculumNodeResult =
  { ok: true; node: CurriculumNode } | { ok: false; error: string };

/** The level a node's parent must be at: the hierarchy is a chain, not a bag (§J). */
const PARENT_LEVEL: Readonly<Record<CurriculumLevel, CurriculumLevel | null>> = {
  institution: null,
  program: "institution",
  curriculum: "program",
  course: "curriculum",
  module: "course",
  unit: "module",
  lesson: "unit",
  objective: "lesson",
  competency: "objective",
};

export function createCurriculumNode(
  input: CreateCurriculumNodeInput,
  existing: readonly CurriculumNode[] = [],
): CreateCurriculumNodeResult {
  if (input.tenantId.trim() === "")
    return { ok: false, error: "A curriculum node requires a tenant" };
  if (input.key.trim() === "")
    return { ok: false, error: "A curriculum node requires a stable key" };
  if (input.title.trim() === "") return { ok: false, error: "A curriculum node requires a title" };

  const requiredParent = PARENT_LEVEL[input.level];
  if (requiredParent === null && input.parentId !== undefined && input.parentId !== null) {
    return {
      ok: false,
      error: `A ${input.level} node is the root of its hierarchy and takes no parent`,
    };
  }
  if (requiredParent !== null && !input.parentId) {
    return { ok: false, error: `A ${input.level} node must sit under a ${requiredParent}` };
  }
  if (requiredParent !== null && input.parentId) {
    const parent = existing.find((node) => node.id === input.parentId);
    if (!parent) return { ok: false, error: `Unknown parent ${input.parentId}` };
    if (parent.level !== requiredParent) {
      return {
        ok: false,
        error: `A ${input.level} node must sit under a ${requiredParent}, not a ${parent.level}`,
      };
    }
    if (parent.tenantId !== input.tenantId) {
      return { ok: false, error: "A curriculum node may not cross a tenant boundary" };
    }
  }

  return {
    ok: true,
    node: {
      id: input.id,
      tenantId: input.tenantId,
      level: input.level,
      key: input.key,
      title: input.title,
      parentId: input.parentId ?? null,
      competencies: [...(input.competencies ?? [])],
      version: input.version ?? 1,
    },
  };
}

/** A competency's level scale is institutional data, not a platform constant (§M). */
export interface CompetencyLevelScale {
  id: string;
  tenantId: string;
  levels: readonly string[];
  /** Whether the scale is ordered from least to most proficient. */
  ordered: boolean;
}

export const DEFAULT_COMPETENCY_LEVELS = [
  "INTRODUCED",
  "DEVELOPING",
  "PRACTICING",
  "PROFICIENT",
  "ADVANCED",
  "MASTERED",
] as const;

export function defineCompetencyScale(input: {
  id: string;
  tenantId: string;
  levels: readonly string[];
}): { ok: true; scale: CompetencyLevelScale } | { ok: false; error: string } {
  const levels = input.levels.map((level) => level.trim().toUpperCase());
  if (levels.length < 2)
    return { ok: false, error: "A competency scale needs at least two levels" };
  if (new Set(levels).size !== levels.length) {
    return { ok: false, error: "A competency scale may not repeat a level" };
  }
  return { ok: true, scale: { id: input.id, tenantId: input.tenantId, levels, ordered: true } };
}

/* ─────────────────────────────────────────────────────────────
 * Competency graph — prerequisites are explicit, never implied (§N, FB.25/26)
 * ────────────────────────────────────────────────────────────*/

export interface Competency {
  id: string;
  tenantId: string;
  name: string;
  description: string;
  domain: string;
  prerequisites: readonly string[];
  /** Alternative prerequisite groups: any member satisfies the group (§AD). */
  alternativePrerequisites?: readonly (readonly string[])[];
}

export type DefineCompetencyResult =
  { ok: true; competency: Competency } | { ok: false; error: string };

export function defineCompetency(
  input: Competency,
  existing: readonly Competency[] = [],
): DefineCompetencyResult {
  if (input.name.trim() === "") return { ok: false, error: "A competency requires a name" };
  if (input.domain.trim() === "") return { ok: false, error: "A competency requires a domain" };
  if (input.prerequisites.includes(input.id)) {
    return { ok: false, error: `Competency ${input.id} cannot be its own prerequisite` };
  }
  for (const prerequisite of input.prerequisites) {
    if (!existing.some((competency) => competency.id === prerequisite)) {
      return { ok: false, error: `Unknown prerequisite ${prerequisite}` };
    }
  }
  for (const group of input.alternativePrerequisites ?? []) {
    if (group.length === 0) {
      return { ok: false, error: "An alternative prerequisite group may not be empty" };
    }
    for (const candidate of group) {
      if (!existing.some((competency) => competency.id === candidate)) {
        return { ok: false, error: `Unknown alternative prerequisite ${candidate}` };
      }
    }
  }
  return {
    ok: true,
    competency: {
      ...input,
      prerequisites: [...input.prerequisites],
      alternativePrerequisites: (input.alternativePrerequisites ?? []).map((group) => [...group]),
    },
  };
}

/** Edges of the competency graph, derived from the definitions. */
export function competencyEdges(
  competencies: readonly Competency[],
): readonly (readonly [string, string])[] {
  const edges: (readonly [string, string])[] = [];
  for (const competency of competencies) {
    for (const prerequisite of competency.prerequisites) {
      edges.push([prerequisite, competency.id] as const);
    }
    for (const group of competency.alternativePrerequisites ?? []) {
      for (const candidate of group) edges.push([candidate, competency.id] as const);
    }
  }
  return edges;
}

/**
 * A competency graph must be acyclic: a cycle means no learner can ever be ready, which is
 * a curriculum defect rather than a learner defect (§N).
 */
export function findCompetencyCycle(competencies: readonly Competency[]): readonly string[] | null {
  const edges = competencyEdges(competencies);
  const visiting = new Set<string>();
  const done = new Set<string>();
  const path: string[] = [];

  const visit = (node: string): readonly string[] | null => {
    if (visiting.has(node)) {
      const start = path.indexOf(node);
      return [...path.slice(start), node];
    }
    if (done.has(node)) return null;
    visiting.add(node);
    path.push(node);
    for (const [from, to] of edges) {
      if (from !== node) continue;
      const cycle = visit(to);
      if (cycle) return cycle;
    }
    path.pop();
    visiting.delete(node);
    done.add(node);
    return null;
  };

  for (const competency of competencies) {
    const cycle = visit(competency.id);
    if (cycle) return cycle;
  }
  return null;
}

/** Transitive prerequisites of a competency, in dependency-first order (§AD). */
export function transitivePrerequisites(
  competencies: readonly Competency[],
  competencyId: string,
): readonly string[] {
  const byId = new Map(competencies.map((competency) => [competency.id, competency]));
  const ordered: string[] = [];
  const seen = new Set<string>();

  const walk = (id: string) => {
    const competency = byId.get(id);
    if (!competency) return;
    for (const prerequisite of competency.prerequisites) {
      if (seen.has(prerequisite)) continue;
      walk(prerequisite);
      seen.add(prerequisite);
      ordered.push(prerequisite);
    }
  };

  walk(competencyId);
  return ordered;
}

/* ─────────────────────────────────────────────────────────────
 * Learning objectives — measurable intent, bound to a competency (§O)
 * ────────────────────────────────────────────────────────────*/

export interface LearningObjective {
  id: string;
  tenantId: string;
  statement: string;
  competencyId: string;
  /** The level a learner is expected to reach, on the competency's own scale. */
  expectedLevel: string;
  /** How mastery is judged, declared up front rather than invented at grading time. */
  masteryCriteria: readonly string[];
  assessmentMethods: readonly string[];
  prerequisites: readonly string[];
}

export function createLearningObjective(
  input: LearningObjective,
  competencies: readonly Competency[] = [],
): { ok: true; objective: LearningObjective } | { ok: false; error: string } {
  if (input.statement.trim().length < 10) {
    return { ok: false, error: "A learning objective needs a statement a teacher would recognise" };
  }
  if (!competencies.some((competency) => competency.id === input.competencyId)) {
    return {
      ok: false,
      error: `Objective ${input.id} references unknown competency ${input.competencyId}`,
    };
  }
  if (input.masteryCriteria.length === 0) {
    return { ok: false, error: `Objective ${input.id} must declare how mastery is judged` };
  }
  if (input.expectedLevel.trim() === "") {
    return { ok: false, error: `Objective ${input.id} must declare the expected level` };
  }
  return { ok: true, objective: { ...input } };
}

/* ─────────────────────────────────────────────────────────────
 * Curriculum versioning — a history that stays interpretable (§K, FB.23/24)
 * ────────────────────────────────────────────────────────────*/

export interface CurriculumVersion {
  id: string;
  tenantId: string;
  curriculumId: string;
  version: number;
  /** The version this one supersedes, if any. */
  supersedes: number | null;
  effectiveFrom: string;
  reason: string;
  /** What changed, as data — so a historical record can be read against it. */
  changes: readonly string[];
}

export type PublishCurriculumVersionResult =
  { ok: true; version: CurriculumVersion } | { ok: false; error: string };

/**
 * Publishing a version never edits the previous one: a change produces a new version, and
 * the old version stays readable so a grade awarded under it remains interpretable.
 */
export function publishCurriculumVersion(
  input: {
    id: string;
    tenantId: string;
    curriculumId: string;
    effectiveFrom: string;
    reason: string;
    changes: readonly string[];
  },
  history: readonly CurriculumVersion[] = [],
): PublishCurriculumVersionResult {
  if (input.reason.trim().length < 5) {
    return { ok: false, error: "A curriculum version must state why it was published" };
  }
  if (input.changes.length === 0) {
    return { ok: false, error: "A curriculum version must state what changed" };
  }
  const forCurriculum = history.filter((version) => version.curriculumId === input.curriculumId);
  for (const version of forCurriculum) {
    if (version.tenantId !== input.tenantId) {
      return { ok: false, error: "A curriculum version may not cross a tenant boundary" };
    }
  }
  const latest = forCurriculum.reduce<CurriculumVersion | undefined>(
    (newest, version) => (!newest || version.version > newest.version ? version : newest),
    undefined,
  );
  const nextVersion = latest ? latest.version + 1 : 1;
  if (latest && Date.parse(input.effectiveFrom) < Date.parse(latest.effectiveFrom)) {
    return {
      ok: false,
      error: `Version ${nextVersion} may not take effect before version ${latest.version}`,
    };
  }
  return {
    ok: true,
    version: {
      id: input.id,
      tenantId: input.tenantId,
      curriculumId: input.curriculumId,
      version: nextVersion,
      supersedes: latest ? latest.version : null,
      effectiveFrom: input.effectiveFrom,
      reason: input.reason,
      changes: [...input.changes],
    },
  };
}

/**
 * The version a record belongs to: the latest version effective at the record's timestamp.
 * This is the whole point of versioning — a 2026 grade is read against the 2026 curriculum.
 */
export function curriculumVersionAt(
  history: readonly CurriculumVersion[],
  curriculumId: string,
  at: string,
): CurriculumVersion | null {
  return history
    .filter(
      (version) =>
        version.curriculumId === curriculumId &&
        Date.parse(version.effectiveFrom) <= Date.parse(at),
    )
    .reduce<CurriculumVersion | null>(
      (newest, version) => (!newest || version.version > newest.version ? version : newest),
      null,
    );
}

/** What changed between two versions, in the vocabulary the diff was recorded in. */
export function curriculumDiff(
  history: readonly CurriculumVersion[],
  curriculumId: string,
  fromVersion: number,
  toVersion: number,
): { changes: readonly string[]; interpretable: boolean } {
  const from = history.find(
    (version) => version.curriculumId === curriculumId && version.version === fromVersion,
  );
  const to = history.find(
    (version) => version.curriculumId === curriculumId && version.version === toVersion,
  );
  if (!from || !to) return { changes: [], interpretable: false };
  const changes: string[] = [];
  for (let version = fromVersion + 1; version <= toVersion; version += 1) {
    const step = history.find(
      (entry) => entry.curriculumId === curriculumId && entry.version === version,
    );
    if (!step) return { changes, interpretable: false };
    changes.push(...step.changes);
  }
  return { changes, interpretable: true };
}

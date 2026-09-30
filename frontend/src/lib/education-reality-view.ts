/**
 * CoreGrid — Phase 04 Educational Reality Engine: projection derivation.
 *
 * `architecture/phase-04-education-reality-engine.md` §1 answers nine questions
 * about an institution ("What does this institution look like?", "How does this
 * institution operate?", …). This module turns the institution's **published
 * operating model** (the installed runtime reality config, read from `cg_entity`) into the
 * view a workspace renders — and says plainly when there is nothing to show.
 *
 * It is pure: no I/O, no fabrication. An unpublished institution yields
 * `status: "not_published"`, an unparseable spec yields `status: "invalid_spec"`,
 * and a spec whose shape is unknown yields counts of zero rather than invented
 * numbers. Rendering a school that does not exist is the one thing this must never
 * do.
 */
import { SCHOLAR_ENTITY_TYPES, SCHOLAR_RELATIONSHIP_TYPES } from "@/lib/runtime/scholar-reality";

/** The nine questions §1 of the phase document answers, in document order. */
export const EDUCATION_REALITY_QUESTIONS: readonly string[] = [
  "What does this institution look like?",
  "How does this institution operate?",
  "What does this institution teach?",
  "Who participates in education?",
  "Where does education happen?",
  "When does education happen?",
  "Which resources are involved?",
  "Which rules govern it?",
  "How do people, places, classes, subjects, schedules, devices, facilities and learning activities relate to one another?",
] as const;

export interface EducationRealitySource {
  entity_id: string;
  tenant_id: string;
  version: number;
  reason: string;
  published_at: string;
  spec_json: string | null;
}

export type EducationRealityStatus = "published" | "not_published" | "invalid_spec";

export interface EducationRealityView {
  status: EducationRealityStatus;
  version: number | null;
  publishedAt: string | null;
  reason: string | null;
  /** Structural facts read from the spec, never invented. */
  counts: {
    levels: number;
    programmes: number;
    curricula: number;
    subjects: number;
  };
  /** The reality vocabulary this runtime can represent (kernel-bound). */
  vocabulary: {
    entityTypes: readonly string[];
    relationshipTypes: readonly string[];
  };
  questions: readonly string[];
  /** Human-facing explanation of the status, always present. */
  summary: string;
}

function countArrayProperty(spec: Record<string, unknown>, key: string): number {
  const value = spec[key];
  return Array.isArray(value) ? value.length : 0;
}

/** Parse the persisted spec defensively: unknown or malformed input is reported. */
export function parseOperatingModelSpec(raw: string | null): Record<string, unknown> | null {
  if (raw === null || raw.trim() === "") return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function educationRealityView(source: EducationRealitySource | null): EducationRealityView {
  const vocabulary = {
    entityTypes: SCHOLAR_ENTITY_TYPES,
    relationshipTypes: SCHOLAR_RELATIONSHIP_TYPES,
  } as const;

  if (!source) {
    return {
      status: "not_published",
      version: null,
      publishedAt: null,
      reason: null,
      counts: { levels: 0, programmes: 0, curricula: 0, subjects: 0 },
      vocabulary,
      questions: EDUCATION_REALITY_QUESTIONS,
      summary:
        "No operating model is published for this institution yet, so its educational reality is not represented.",
    };
  }

  const spec = parseOperatingModelSpec(source.spec_json);
  if (!spec) {
    return {
      status: "invalid_spec",
      version: source.version,
      publishedAt: source.published_at,
      reason: source.reason,
      counts: { levels: 0, programmes: 0, curricula: 0, subjects: 0 },
      vocabulary,
      questions: EDUCATION_REALITY_QUESTIONS,
      summary: `Version ${source.version} is published but its specification could not be read, so no structure is shown.`,
    };
  }

  const counts = {
    levels: countArrayProperty(spec, "levels"),
    programmes: countArrayProperty(spec, "programmes"),
    curricula: countArrayProperty(spec, "curricula"),
    subjects: countArrayProperty(spec, "subjects"),
  };

  return {
    status: "published",
    version: source.version,
    publishedAt: source.published_at,
    reason: source.reason,
    counts,
    vocabulary,
    questions: EDUCATION_REALITY_QUESTIONS,
    summary: `Version ${source.version} describes ${counts.levels} level(s), ${counts.programmes} programme(s), ${counts.curricula} curriculum/curricula and ${counts.subjects} subject(s).`,
  };
}

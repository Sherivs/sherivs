/**
 * CoreGrid — V5.3 Part 64 proof: the restaurant domain validates against the
 * SAME fail-closed validator as the Scholar domain, with zero shared entity
 * types (V5.3 Part 46 NO DOMAIN CONTAMINATION).
 */
import { describe, expect, it } from "vitest";
import {
  validateDomainDefinition,
  PLATFORM_APP_ROLES,
  UNIVERSAL_ENTITY_VOCABULARY,
  type DomainDefinition,
} from "../../frontend/src/lib/domain-config/domain-definition";
import { RESTAURANT_DOMAIN_DEFINITION } from "../../frontend/src/lib/domain-config/restaurant";
import { MEMBERSHIP_FOR_NAV_KIND } from "../../frontend/src/lib/capability-gate";
import { EVIDENCE_KINDS, EVIDENCE_SOURCES } from "../../frontend/src/lib/academic-core";

/** Runtime nav registry vocabulary (the platform's neutral view of nav kinds). */
const RUNTIME_NAV_KINDS: readonly string[] = Object.keys(MEMBERSHIP_FOR_NAV_KIND);

function entityNames(definition: DomainDefinition): readonly string[] {
  return definition.entityTypes.map((entityType) => entityType.name);
}

/**
 * The Scholar domain expressed as a DomainDefinition from ITS OWN published
 * vocabulary (academic-core evidence contracts + runtime nav kinds + AppRole
 * mappings) — imported, not re-declared, so the coherence proof binds to what
 * Scholar actually ships.
 */
const SCHOLAR_DOMAIN_DEFINITION: DomainDefinition = {
  domainId: "scholar",
  displayName: "Scholar (academic learning intelligence)",
  entityTypes: [
    {
      name: "scholar.learner",
      extends: "entity",
      fields: {
        display_name: { kind: "string", minLength: 1, maxLength: 120 },
        cohort_id: { kind: "string" },
      },
    },
    {
      name: "scholar.course",
      extends: "entity",
      fields: {
        code: { kind: "string", minLength: 1 },
        title: { kind: "string", minLength: 1 },
      },
    },
    {
      name: "scholar.competency",
      extends: "entity",
      fields: {
        code: { kind: "string", minLength: 1 },
        statement: { kind: "string", maxLength: 500 },
      },
    },
    {
      name: "scholar.learning_evidence",
      extends: "entity",
      fields: {
        kind: { kind: "enum", values: [...EVIDENCE_KINDS] },
        source: { kind: "enum", values: [...EVIDENCE_SOURCES] },
        learner: { kind: "ref", targetType: "scholar.learner" },
        course: { kind: "ref", targetType: "scholar.course" },
        competency: { kind: "ref", targetType: "scholar.competency" },
      },
    },
  ],
  relationships: [
    {
      name: "scholar.evidence_for_learner",
      source: "scholar.learning_evidence",
      target: "scholar.learner",
      cardinality: "many-to-one",
    },
    {
      name: "scholar.enrols_in",
      source: "scholar.learner",
      target: "scholar.course",
      cardinality: "many-to-many",
    },
  ],
  roles: [
    { domainRole: "educator", appRoles: ["teacher"] },
    { domainRole: "learner", appRoles: ["student"] },
    { domainRole: "guardian", appRoles: ["parent"] },
    { domainRole: "finance_officer", appRoles: ["bursar"] },
    { domainRole: "operations", appRoles: ["admin", "principal"] },
  ],
  workspaces: [
    { name: "scholar-administration", kind: "org_admin", label: "Administration" },
    { name: "scholar-educator", kind: "teacher", label: "Educator" },
    { name: "scholar-guardian", kind: "parent", label: "Guardian" },
    { name: "scholar-learner", kind: "student", label: "Learner" },
  ],
  workflows: [{ name: "scholar.attendance_cycle" }, { name: "scholar.grade_publication" }],
};

describe("restaurant DomainDefinition (V5.3 Part 45)", () => {
  it("validates cleanly against the fail-closed validator", () => {
    const result = validateDomainDefinition(RESTAURANT_DOMAIN_DEFINITION);
    expect(result.ok).toBe(true);
  });

  it("declares the Part 45 entity families as configuration", () => {
    expect(entityNames(RESTAURANT_DOMAIN_DEFINITION)).toEqual([
      "restaurant.menu_item",
      "restaurant.customer",
      "restaurant.order",
      "restaurant.table",
      "restaurant.staff",
      "restaurant.inventory_item",
      "restaurant.reservation",
    ]);
  });

  it("resolves every entity reference to a declared entity type", () => {
    const declared = new Set(entityNames(RESTAURANT_DOMAIN_DEFINITION));
    const unresolved: string[] = [];
    for (const entityType of RESTAURANT_DOMAIN_DEFINITION.entityTypes) {
      for (const [fieldName, schema] of Object.entries(entityType.fields)) {
        if (schema.kind === "ref" && !declared.has(schema.targetType)) {
          unresolved.push(`${entityType.name}.${fieldName} -> ${schema.targetType}`);
        }
      }
    }
    for (const relationship of RESTAURANT_DOMAIN_DEFINITION.relationships) {
      if (!declared.has(relationship.source)) {
        unresolved.push(`${relationship.name}.source -> ${relationship.source}`);
      }
      if (!declared.has(relationship.target)) {
        unresolved.push(`${relationship.name}.target -> ${relationship.target}`);
      }
    }
    expect(unresolved).toEqual([]);
  });

  it("maps every domain role onto the legacy AppRole OR neutral vocabulary (I-031 re-point)", () => {
    // I-031 follow-through note: this assertion was flipped from the bridge
    // semantics ("every role maps onto the platform AppRole vocabulary") to the
    // corrected EITHER/OR semantics — service_staff no longer carries the
    // forced legacy appRoles ["teacher"] bridge and resolves purely through the
    // neutral WORKER|OPERATOR mapping (RESTAURANT_ROLE_MAPPINGS).
    expect(PLATFORM_APP_ROLES.length).toBeGreaterThan(0);
    for (const role of RESTAURANT_DOMAIN_DEFINITION.roles) {
      if (role.appRoles) {
        for (const appRole of role.appRoles) {
          expect(PLATFORM_APP_ROLES).toContain(appRole);
        }
      } else {
        expect(role.neutralRoles?.length).toBeGreaterThan(0);
      }
    }
    expect(RESTAURANT_DOMAIN_DEFINITION.roles.map((role) => role.domainRole)).toEqual([
      "manager",
      "cashier",
      "service_staff",
      "runner",
    ]);
  });

  it("carries NO forced legacy bridge on service_staff (I-031 closure)", () => {
    const serviceStaff = RESTAURANT_DOMAIN_DEFINITION.roles.find(
      (role) => role.domainRole === "service_staff",
    );
    expect(serviceStaff).toBeDefined();
    if (!serviceStaff) return;
    expect(serviceStaff.appRoles).toBeUndefined();
    expect(serviceStaff.neutralRoles).toEqual(["WORKER", "OPERATOR"]);
    expect(serviceStaff.neutralRoles).not.toContain("teacher" as never);
  });

  it("uses only runtime nav registry kinds for its workspaces", () => {
    const kinds = RESTAURANT_DOMAIN_DEFINITION.workspaces.map((workspace) => workspace.kind);
    expect(kinds.length).toBeGreaterThan(0);
    for (const kind of kinds) {
      expect(RUNTIME_NAV_KINDS).toContain(kind);
    }
  });

  it("declares no storage: every entity type extends the universal substrate vocabulary", () => {
    for (const entityType of RESTAURANT_DOMAIN_DEFINITION.entityTypes) {
      expect(UNIVERSAL_ENTITY_VOCABULARY).toContain(entityType.extends);
    }
    expect(RESTAURANT_DOMAIN_DEFINITION.entityTypes.length).toBe(7);
  });
});

describe("cross-domain coherence (V5.3 Part 64)", () => {
  it("validates Scholar through the SAME validator", () => {
    const scholar = validateDomainDefinition(SCHOLAR_DOMAIN_DEFINITION);
    const restaurant = validateDomainDefinition(RESTAURANT_DOMAIN_DEFINITION);
    expect(scholar.ok).toBe(true);
    expect(restaurant.ok).toBe(true);
  });

  it("binds Scholar vocabulary that actually ships (enum values come from academic-core)", () => {
    expect(EVIDENCE_KINDS.length).toBeGreaterThan(0);
    expect(EVIDENCE_SOURCES.length).toBeGreaterThan(0);
    const evidence = SCHOLAR_DOMAIN_DEFINITION.entityTypes.find(
      (entityType) => entityType.name === "scholar.learning_evidence",
    );
    expect(evidence).toBeDefined();
    if (!evidence) return;
    const kindField = evidence.fields.kind;
    expect(kindField.kind).toBe("enum");
    if (kindField.kind === "enum") {
      expect([...kindField.values]).toEqual([...EVIDENCE_KINDS]);
    }
    const sourceField = evidence.fields.source;
    expect(sourceField.kind).toBe("enum");
    if (sourceField.kind === "enum") {
      expect([...sourceField.values]).toEqual([...EVIDENCE_SOURCES]);
    }
  });

  it("shares ZERO entity types between the two domains (no contamination)", () => {
    const scholarNames = entityNames(SCHOLAR_DOMAIN_DEFINITION);
    const restaurantNames = entityNames(RESTAURANT_DOMAIN_DEFINITION);
    const shared = restaurantNames.filter((name) => scholarNames.includes(name));
    expect(shared).toEqual([]);
    expect(scholarNames.length).toBeGreaterThan(0);
    expect(restaurantNames.length).toBeGreaterThan(0);
  });

  it("keeps every domain entity type inside its own namespace, never the universal vocabulary", () => {
    for (const name of [
      ...entityNames(SCHOLAR_DOMAIN_DEFINITION),
      ...entityNames(RESTAURANT_DOMAIN_DEFINITION),
    ]) {
      expect(name.startsWith("scholar.") || name.startsWith("restaurant.")).toBe(true);
      expect((UNIVERSAL_ENTITY_VOCABULARY as readonly string[]).includes(name)).toBe(false);
    }
  });

  it("resolves both domains' workspaces from the SAME runtime nav registry vocabulary", () => {
    const scholarKinds = SCHOLAR_DOMAIN_DEFINITION.workspaces.map((workspace) => workspace.kind);
    const restaurantKinds = RESTAURANT_DOMAIN_DEFINITION.workspaces.map(
      (workspace) => workspace.kind,
    );
    for (const kind of [...scholarKinds, ...restaurantKinds]) {
      expect(RUNTIME_NAV_KINDS).toContain(kind);
    }
    // The shared substrate vocabulary is reused across domains even though
    // their entity vocabularies are fully disjoint.
    expect(scholarKinds.some((kind) => restaurantKinds.includes(kind))).toBe(true);
  });
});

/* ─────────────────────────────────────────────────────────────
 * MISSION-R-120 / V1CAP-093 additions — fixture RECERTIFICATION through
 * the neutral primitives: every role resolves through the declared
 * neutral mapping only (no legacy AppRole declaration remains), no
 * educator semantics survive anywhere in the fixture's semantic surface,
 * and the only education-vocabulary string literals left are the
 * documented chrome-kind borrows.
 * ────────────────────────────────────────────────────────────*/
import { RESTAURANT_NEUTRAL_ROLE_MAPPINGS } from "../../frontend/src/lib/domain-config/restaurant";
import { isUniversalRole } from "../../frontend/src/lib/universal-roles";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The educator/education-vocabulary tokens (the neutrality guard's STRICT list). */
const EDUCATOR_TOKENS: readonly string[] = [
  "scholar",
  "student",
  "teacher",
  "school",
  "classroom",
  "curriculum",
  "exam",
  "examination",
  "grade",
  "grading",
  "attendance",
  "fee",
  "fees",
  "tuition",
  "timetable",
  "admission",
  "lesson",
  "homework",
  "library",
  "hostel",
  "bursar",
  "principal",
  "guardian",
  "enrollment",
  "enrolment",
  "academic",
];

describe("restaurant fixture recertification (MISSION-R-120 / V1CAP-093)", () => {
  it("every role declares the NEUTRAL vocabulary only — no legacy appRoles declaration remains", () => {
    for (const role of RESTAURANT_DOMAIN_DEFINITION.roles) {
      expect(role.appRoles, `role "${role.domainRole}" must not declare appRoles`).toBeUndefined();
      expect(role.neutralRoles?.length, `role "${role.domainRole}"`).toBeGreaterThan(0);
      expect(role.neutralRoles).toEqual(
        RESTAURANT_NEUTRAL_ROLE_MAPPINGS[role.domainRole],
      );
    }
  });

  it("every declared neutral role is universal and NO restaurant role resolves to work-product-production (educator-resolved) semantics", () => {
    for (const role of RESTAURANT_DOMAIN_DEFINITION.roles) {
      for (const neutral of role.neutralRoles ?? []) {
        expect(isUniversalRole(neutral)).toBe(true);
        expect(neutral, `role "${role.domainRole}"`).not.toBe("CONTRIBUTOR");
      }
    }
  });

  it("resolves exactly the recertified semantics: WORKER / OPERATOR / ADMINISTRATOR / OWNER", () => {
    const resolvedSemantics = new Set(
      RESTAURANT_DOMAIN_DEFINITION.roles.flatMap((role) => [...(role.neutralRoles ?? [])]),
    );
    for (const semantic of [...resolvedSemantics]) {
      expect(["WORKER", "OPERATOR", "ADMINISTRATOR", "OWNER"]).toContain(semantic);
    }
  });

  it("every fixture surface is free of educator vocabulary (semantic scan over the compiled definition)", () => {
    const surfaces: readonly string[] = [
      ...RESTAURANT_DOMAIN_DEFINITION.entityTypes.flatMap((entityType) => [
        entityType.name,
        entityType.extends,
        ...Object.keys(entityType.fields),
      ]),
      ...RESTAURANT_DOMAIN_DEFINITION.entityTypes.flatMap((entityType) =>
        Object.values(entityType.fields).flatMap((schema) =>
          schema.kind === "enum" ? [...schema.values] : [],
        ),
      ),
      ...RESTAURANT_DOMAIN_DEFINITION.relationships.map((relationship) => relationship.name),
      ...RESTAURANT_DOMAIN_DEFINITION.roles.map((role) => role.domainRole),
      ...RESTAURANT_DOMAIN_DEFINITION.workflows.map((workflow) => workflow.name),
      ...RESTAURANT_DOMAIN_DEFINITION.workspaces.map((workspace) => workspace.name),
      ...RESTAURANT_DOMAIN_DEFINITION.workspaces.map((workspace) => workspace.label),
    ];
    for (const value of surfaces) {
      for (const token of EDUCATOR_TOKENS) {
        expect(value.toLowerCase(), `fixture surface value "${value}"`).not.toContain(token);
      }
    }
  });

  it("the only education-vocabulary string literals in the fixture source are the documented chrome-kind borrows", () => {
    const source = readFileSync(
      `${fileURLToPath(new URL("../..", import.meta.url))}/frontend/src/lib/domain-config/restaurant.ts`,
      "utf8",
    );
    const observed = new Set<string>();
    for (const line of source.split("\n")) {
      for (const token of EDUCATOR_TOKENS) {
        if (new RegExp(`['"\`]${token}['"\`]`, "i").test(line)) observed.add(token);
      }
    }
    // "teacher" and "bursar" are runtime nav registry KIND strings — the
    // documented-gated workspace-kind debt (see the workspaces note in the
    // fixture). No role, mapping, entity or workflow may carry them.
    expect([...observed].sort()).toEqual(["bursar", "teacher"]);
  });
});
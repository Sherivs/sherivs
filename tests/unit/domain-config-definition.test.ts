/**
 * CoreGrid — DomainDefinition validator tests: every non-conforming path
 * fails closed (V5.3 Part 46 NO DOMAIN CONTAMINATION, Part 64 config proof).
 */
import { describe, expect, it } from "vitest";
import {
  validateDomainDefinition,
  type DomainDefinitionValidationResult,
} from "../../frontend/src/lib/domain-config/domain-definition";

type MutableDefinition = Record<string, unknown>;
type MutableEntity = Record<string, unknown>;

/** A minimal, fully valid domain used as the mutation base for negatives. */
function baseDefinition(): MutableDefinition {
  return {
    domainId: "cafe",
    displayName: "Café domain",
    entityTypes: [
      {
        name: "cafe.beverage",
        extends: "entity",
        fields: {
          name: { kind: "string", minLength: 1, maxLength: 80 },
          size: { kind: "enum", values: ["small", "large"] },
        },
      },
      {
        name: "cafe.order",
        extends: "entity",
        fields: {
          beverage: { kind: "ref", targetType: "cafe.beverage" },
        },
      },
    ],
    relationships: [
      {
        name: "cafe.order_beverage",
        source: "cafe.order",
        target: "cafe.beverage",
        cardinality: "many-to-one",
      },
    ],
    roles: [{ domainRole: "barista", appRoles: ["teacher"] }],
    workspaces: [{ name: "cafe-counter", kind: "teacher", label: "Counter" }],
    workflows: [{ name: "cafe.order_lifecycle" }],
  };
}

function variant(mutate: (definition: MutableDefinition) => void): MutableDefinition {
  const definition = baseDefinition();
  mutate(definition);
  return definition;
}

function expectFailure(definition: unknown): readonly string[] {
  const result = validateDomainDefinition(definition);
  if (result.ok) {
    throw new Error("expected validateDomainDefinition to fail closed");
  }
  expect(result.errors.length).toBeGreaterThan(0);
  return result.errors;
}

function assertAccepts(result: DomainDefinitionValidationResult): void {
  expect(result.ok).toBe(true);
  if (result.ok) {
    expect(result.definition.domainId).toBe("cafe");
  }
}

describe("validateDomainDefinition (fail closed)", () => {
  it("accepts a well-formed configuration", () => {
    assertAccepts(validateDomainDefinition(baseDefinition()));
  });

  it("rejects an unknown nav kind", () => {
    const errors = expectFailure(
      variant((definition) => {
        (definition.workspaces as MutableEntity[])[0].kind = "kitchen_display";
      }),
    );
    expect(errors.join("\n")).toContain("kitchen_display");
    expect(errors.join("\n")).toContain("runtime nav registry vocabulary");
  });

  it("rejects a role that maps outside the platform AppRole vocabulary", () => {
    const errors = expectFailure(
      variant((definition) => {
        (definition.roles as MutableEntity[])[0].appRoles = ["chef"];
      }),
    );
    expect(errors.join("\n")).toContain('"chef"');
    expect(errors.join("\n")).toContain("AppRole vocabulary");
  });

  it("accepts a role declared purely through the neutral universal-role vocabulary (I-031)", () => {
    const result = validateDomainDefinition(
      variant((definition) => {
        (definition.roles as MutableEntity[])[0] = {
          domainRole: "barista",
          neutralRoles: ["WORKER", "OPERATOR"],
        };
      }),
    );
    expect(result.ok).toBe(true);
  });

  it("rejects a role with NEITHER a legacy appRoles entry NOR a neutral mapping (fail closed)", () => {
    const neither = expectFailure(
      variant((definition) => {
        delete (definition.roles as MutableEntity[])[0].appRoles;
      }),
    );
    expect(neither.join("\n")).toContain("barista");
    expect(neither.join("\n")).toContain("neutralRoles");

    const empty = expectFailure(
      variant((definition) => {
        (definition.roles as MutableEntity[])[0].appRoles = [];
      }),
    );
    expect(empty.join("\n")).toContain("barista");
  });

  it("rejects a neutral mapping that puts a domain/legacy role name on the neutral side", () => {
    const errors = expectFailure(
      variant((definition) => {
        (definition.roles as MutableEntity[])[0] = {
          domainRole: "barista",
          neutralRoles: ["teacher"],
        };
      }),
    );
    expect(errors.join("\n")).toContain('"teacher"');
    expect(errors.join("\n")).toContain("universal role vocabulary");
  });

  it("rejects entity references to undeclared entity types", () => {
    const errors = expectFailure(
      variant((definition) => {
        (definition.entityTypes as MutableEntity[])[1].fields = {
          supplier: { kind: "ref", targetType: "cafe.supplier" },
        };
        (definition.relationships as MutableEntity[])[0].target = "cafe.supplier";
      }),
    );
    const joined = errors.join("\n");
    expect(joined).toContain("references undeclared entity type");
    expect((joined.match(/"cafe\.supplier"/g) ?? []).length).toBe(2);
  });

  it("rejects duplicate ids", () => {
    const errors = expectFailure(
      variant((definition) => {
        const entityTypes = definition.entityTypes as MutableEntity[];
        entityTypes.push({ ...entityTypes[0] });
        (definition.workflows as MutableEntity[]).push({ name: "cafe.order_lifecycle" });
      }),
    );
    const joined = errors.join("\n");
    expect(joined).toContain('duplicate entity type id "cafe.beverage"');
    expect(joined).toContain('duplicate workflow id "cafe.order_lifecycle"');
  });

  it("rejects an attempted storage (table/DDL) declaration", () => {
    const errors = expectFailure(
      variant((definition) => {
        (definition.entityTypes as MutableEntity[])[1].table = "cafe_orders";
        definition.ddl = "CREATE TABLE cafe_orders (...)";
      }),
    );
    const joined = errors.join("\n");
    expect(joined).toContain('attempts to declare storage via key "table"');
    expect(joined).toContain('attempts to declare storage via key "ddl"');
    expect(joined).toContain("never DDL");
  });

  it("rejects entity types that bypass the domain namespace (no universal contamination)", () => {
    const errors = expectFailure(
      variant((definition) => {
        (definition.entityTypes as MutableEntity[])[0].name = "beverage";
      }),
    );
    expect(errors.join("\n")).toContain('not namespaced under "cafe.…"');
  });

  it("rejects extends targets outside the universal vocabulary and the domain", () => {
    const errors = expectFailure(
      variant((definition) => {
        (definition.entityTypes as MutableEntity[])[0].extends = "student_table";
      }),
    );
    const joined = errors.join("\n");
    expect(joined).toContain('"student_table"');
    expect(joined).toContain("neither a universal entity concept nor a declared entity type");
  });
});
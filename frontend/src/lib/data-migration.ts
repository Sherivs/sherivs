/**
 * CoreGrid — data migration discipline (Phase 14, domain-neutral).
 *
 * A migration is the only place where stored reality changes shape, so it is the only
 * place where a mistake is permanent. This engine makes the discipline executable:
 *
 *   - migrations are FORWARD-ONLY and ordered: an applied migration is never edited or
 *     re-run, because production history cannot be rewritten;
 *   - every migration declares the step that validates it, so "it applied" is never
 *     confused with "it is correct";
 *   - a data migration declares how history is preserved, because rewriting a record to
 *     make a migration easier is how institutions lose provenance;
 *   - a domain phase declares the SHAPE its records require (append-only, tenant
 *     isolated, exact money, uniquely scoped) and the validator refuses a schema
 *     contract that cannot satisfy it.
 *
 * That last point is why this module exists in this wave: a domain phase declared that
 * its records must be append-only, tenant-isolated, exact and uniquely numbered, and had
 * no way to state it as a machine-checked contract. The domain's tables stay the
 * domain's to declare; the discipline is the platform's.
 */

export type MigrationKind = "schema" | "data" | "index" | "policy" | "seed";

/** The invariants a domain phase requires of the tables that will hold its records. */
export type SchemaInvariant =
  | "tenant-column-present"
  | "tenant-isolation-policy"
  | "append-only"
  | "unique-scope-key"
  | "exact-minor-units"
  | "foreign-key-integrity"
  | "state-machine-column"
  | "explicit-timezone"
  | "no-personal-data-without-purpose";

export interface ColumnContract {
  readonly name: string;
  readonly type: string;
  readonly nullable: boolean;
  /** Present for money columns: the column stores integer minor units. */
  readonly minorUnits?: boolean;
  /** Present for money columns: the currency column that qualifies it. */
  readonly currencyColumn?: string;
}

export interface TableContract {
  readonly table: string;
  readonly columns: readonly ColumnContract[];
  readonly primaryKey: readonly string[];
  /** Natural-key columns that must be unique inside a tenant scope. */
  readonly uniqueScopes?: readonly {
    readonly columns: readonly string[];
    readonly scope: readonly string[];
  }[];
  readonly appendOnly?: boolean;
  readonly foreignKeys?: readonly {
    readonly columns: readonly string[];
    readonly references: string;
  }[];
  readonly rowLevelSecurity?: boolean;
  readonly requiresInvariants: readonly SchemaInvariant[];
}

export interface MigrationRecord {
  readonly version: string;
  readonly name: string;
  readonly kind: MigrationKind;
  readonly appliedAt: string;
  /** The validation step that proves the migration did what it claimed. */
  readonly validates: string;
  /** How stored history is preserved, when the migration touches data at all. */
  readonly preservesHistory: boolean;
  /** Checksum of the applied statement, so an edited migration is detectable. */
  readonly checksum: string;
}

export type MigrationVerdict =
  | { readonly ok: true; readonly record: MigrationRecord }
  | { readonly ok: false; readonly refusals: readonly string[]; readonly detail: string };

/**
 * Register a migration. Refuses an unvalidated migration, a data migration that does not
 * state how history is preserved, a migration that would edit an applied one, and a
 * version that does not advance past the applied head.
 */
export function recordMigration(input: {
  readonly applied: readonly MigrationRecord[];
  readonly version: string;
  readonly name: string;
  readonly kind: MigrationKind;
  readonly appliedAt: string;
  readonly validates: string;
  readonly preservesHistory: boolean;
  readonly checksum: string;
}): MigrationVerdict {
  const refusals: string[] = [];

  if (!input.version.trim()) refusals.push("a migration must be versioned");
  if (!input.validates?.trim()) {
    refusals.push("a migration must declare the validation step that proves it worked");
  }
  if (input.kind === "data" && !input.preservesHistory) {
    refusals.push("a data migration must state how stored history is preserved");
  }
  if (!input.checksum?.trim())
    refusals.push("a migration must record the checksum of what was applied");

  const existing = input.applied.find((record) => record.version === input.version);
  if (existing) {
    return {
      ok: false,
      refusals: ["already-applied"],
      detail:
        existing.checksum === input.checksum
          ? `migration ${input.version} is already applied with the same checksum: re-running is refused`
          : `migration ${input.version} is already applied with a DIFFERENT checksum (applied ${existing.checksum}, offered ${input.checksum}): an applied migration is never edited`,
    };
  }

  const ordered = [...input.applied].sort((a, b) => a.version.localeCompare(b.version));
  const last = ordered[ordered.length - 1];
  if (last && input.version <= last.version) {
    refusals.push(
      "migrations are forward-only: the version does not advance past the applied head",
    );
  }

  if (refusals.length > 0) {
    return { ok: false, refusals, detail: refusals.join("; ") };
  }
  return {
    ok: true,
    record: {
      version: input.version,
      name: input.name,
      kind: input.kind,
      appliedAt: input.appliedAt,
      validates: input.validates,
      preservesHistory: input.preservesHistory,
      checksum: input.checksum,
    },
  };
}

/** Detect an applied migration whose checksum no longer matches what the file offers. */
export function detectEditedMigrations(
  applied: readonly MigrationRecord[],
  offered: readonly { readonly version: string; readonly checksum: string }[],
): readonly {
  readonly version: string;
  readonly appliedChecksum: string;
  readonly offeredChecksum: string;
}[] {
  const edits: { version: string; appliedChecksum: string; offeredChecksum: string }[] = [];
  for (const record of applied) {
    const match = offered.find((candidate) => candidate.version === record.version);
    if (match && match.checksum !== record.checksum) {
      edits.push({
        version: record.version,
        appliedChecksum: record.checksum,
        offeredChecksum: match.checksum,
      });
    }
  }
  return edits;
}

export interface SchemaValidationResult {
  readonly ok: boolean;
  /** Each unmet invariant with the reason it could not be met. */
  readonly unmet: readonly { readonly invariant: SchemaInvariant; readonly why: string }[];
}

/**
 * Check a declared table contract against the invariants its owning phase requires.
 * A table that cannot satisfy them is refused before it ever holds a record.
 */
export function validateSchemaContract(contract: TableContract): SchemaValidationResult {
  const unmet: { invariant: SchemaInvariant; why: string }[] = [];
  const columnNames = contract.columns.map((column) => column.name);

  for (const invariant of contract.requiresInvariants) {
    switch (invariant) {
      case "tenant-column-present":
        if (!columnNames.includes("tenant_id")) {
          unmet.push({
            invariant,
            why: "no tenant_id column: a record would not belong to an organization",
          });
        }
        break;
      case "tenant-isolation-policy":
        if (!contract.rowLevelSecurity) {
          unmet.push({
            invariant,
            why: "row level security is not declared, so isolation would rest on application code alone",
          });
        }
        break;
      case "append-only":
        if (!contract.appendOnly) {
          unmet.push({
            invariant,
            why: "the table is not declared append-only, so history could be rewritten",
          });
        }
        break;
      case "unique-scope-key":
        if (!contract.uniqueScopes || contract.uniqueScopes.length === 0) {
          unmet.push({
            invariant,
            why: "no unique scope key is declared, so duplicates cannot be refused by the database",
          });
        }
        break;
      case "exact-minor-units": {
        const money = contract.columns.filter((column) => column.minorUnits);
        if (money.length === 0) {
          unmet.push({ invariant, why: "no money column declares integer minor units" });
          break;
        }
        const unqualified = money.filter((column) => !column.currencyColumn);
        if (unqualified.length > 0) {
          unmet.push({
            invariant,
            why: `money column(s) ${unqualified.map((column) => column.name).join(", ")} carry no currency column`,
          });
        }
        break;
      }
      case "foreign-key-integrity":
        if (!contract.foreignKeys || contract.foreignKeys.length === 0) {
          unmet.push({
            invariant,
            why: "no foreign keys are declared, so orphaned records would be possible",
          });
        }
        break;
      case "state-machine-column":
        if (!columnNames.some((name) => name === "status" || name.endsWith("_state"))) {
          unmet.push({
            invariant,
            why: "no state column is declared, so a status string could mutate freely",
          });
        }
        break;
      case "explicit-timezone":
        if (!columnNames.some((name) => name.includes("timezone") || name.endsWith("_tz"))) {
          unmet.push({
            invariant,
            why: "no explicit timezone column is declared for time-bearing records",
          });
        }
        break;
      case "no-personal-data-without-purpose":
        if (!columnNames.includes("purpose") && !columnNames.includes("data_purpose")) {
          unmet.push({
            invariant,
            why: "no purpose column is declared, so personal data could be stored without a declared reason",
          });
        }
        break;
      default:
        break;
    }
  }

  return { ok: unmet.length === 0, unmet };
}

/** Explain a schema refusal so the owning phase knows exactly what to declare. */
export function explainSchemaRefusal(result: SchemaValidationResult): string {
  if (result.ok) return "the declared schema satisfies every required invariant";
  return result.unmet.map((entry) => `${entry.invariant}: ${entry.why}`).join("; ");
}

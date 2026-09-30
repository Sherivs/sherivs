/**
 * CoreGrid — data platform intelligence report (L4).
 *
 * This is the phase's own evidence surface. It does not describe the data platform: it
 * EXECUTES it. Every check below calls a real engine with real input and records what it
 * observed, so a regression changes this report instead of hiding behind an assertion.
 *
 * It also carries the piece of governance this wave exists for: an explicit mapping from
 * the gaps a domain phase declared (Phase 13) to what the data platform now provides and
 * what remains that domain's own work. A gap that is only discussed in prose is a gap that
 * gets forgotten; a gap that is mapped has an owner and a next step.
 */
import {
  declareIngestionEndpoint,
  explainIngestion,
  ingestBatch,
  type IngestionEndpoint,
} from "./data-ingestion";
import {
  completeRun,
  defineJob,
  deriveIdempotencyKey,
  startRun,
  type JobContract,
} from "./data-jobs";
import {
  explainSchemaRefusal,
  recordMigration,
  validateSchemaContract,
  type MigrationRecord,
  type TableContract,
} from "./data-migration";
import {
  ageOpenExceptions,
  resolveException,
  runDatasetReconciliation,
  summariseReconciliationRun,
  type ReconciliationRun,
} from "./data-reconciliation";

export interface DataRule {
  readonly id: string;
  readonly statement: string;
  readonly module: string;
  readonly suite: string;
  readonly blueprint: string;
}

export const DATA_RULES: readonly DataRule[] = [
  {
    id: "migrations-are-forward-only",
    statement:
      "An applied migration is never edited or re-run, and every migration declares the validation that proves it worked.",
    module: "frontend/src/lib/data-migration.ts",
    suite: "tests/unit/data-platform-engines.test.ts",
    blueprint: "migration discipline",
  },
  {
    id: "history-is-preserved",
    statement:
      "A data migration must state how stored history is preserved before it may touch a record.",
    module: "frontend/src/lib/data-migration.ts",
    suite: "tests/unit/data-platform-engines.test.ts",
    blueprint: "provenance",
  },
  {
    id: "schema-invariants-are-checked-before-load",
    statement:
      "A domain declares the shape its records require (tenant isolation, append-only, exact money, unique scope) and a schema that cannot satisfy it is refused before holding data.",
    module: "frontend/src/lib/data-migration.ts",
    suite: "tests/unit/data-platform-engines.test.ts",
    blueprint: "data model",
  },
  {
    id: "job-keys-are-derived-not-invented",
    statement:
      "A job's idempotency key is derived from declared fields, so the same logical work always produces the same key and a replay cannot repeat it.",
    module: "frontend/src/lib/data-jobs.ts",
    suite: "tests/unit/data-platform-engines.test.ts",
    blueprint: "command model, idempotency",
  },
  {
    id: "batch-work-is-restartable-only-when-declared",
    statement:
      "A run resumes only where the job declared itself restartable, from a recorded checkpoint, within its attempt ceiling.",
    module: "frontend/src/lib/data-jobs.ts",
    suite: "tests/unit/data-platform-engines.test.ts",
    blueprint: "failure",
  },
  {
    id: "bursts-are-budgeted",
    statement:
      "A declared burst budget is enforced and an exceeded budget is reported rather than absorbed.",
    module: "frontend/src/lib/data-jobs.ts",
    suite: "tests/unit/data-platform-engines.test.ts",
    blueprint: "observability",
  },
  {
    id: "ingestion-is-authorised-and-provenanced",
    statement:
      "Nothing enters through an undeclared, unauthorised or unsigned external endpoint, and every accepted record carries its source, batch, correlation, classification and purpose.",
    module: "frontend/src/lib/data-ingestion.ts",
    suite: "tests/unit/data-platform-engines.test.ts",
    blueprint: "boundary",
  },
  {
    id: "nothing-is-dropped-silently",
    statement:
      "A record that cannot be identified or understood is rejected with a reason, never discarded without a trace.",
    module: "frontend/src/lib/data-ingestion.ts",
    suite: "tests/unit/data-platform-engines.test.ts",
    blueprint: "data quality",
  },
  {
    id: "replays-do-not-double-count",
    statement:
      "A record already held under the same natural key is reported as a duplicate and ingested once.",
    module: "frontend/src/lib/data-ingestion.ts",
    suite: "tests/unit/data-platform-engines.test.ts",
    blueprint: "idempotency",
  },
  {
    id: "classification-is-never-downgraded",
    statement: "A payload may not be re-classified downwards on its way in.",
    module: "frontend/src/lib/data-ingestion.ts",
    suite: "tests/unit/data-platform-engines.test.ts",
    blueprint: "security",
  },
  {
    id: "discrepancies-become-exceptions",
    statement:
      "Every key present on only one side of a comparison becomes an explicit exception: a mismatch nobody sees is a mismatch that compounds.",
    module: "frontend/src/lib/data-reconciliation.ts",
    suite: "tests/unit/data-platform-engines.test.ts",
    blueprint: "reconciliation",
  },
  {
    id: "exceptions-close-on-evidence",
    statement:
      "Resolving an exception requires a cause, a correction, the evidence and the actor; a run is complete only when nothing is unmatched.",
    module: "frontend/src/lib/data-reconciliation.ts",
    suite: "tests/unit/data-platform-engines.test.ts",
    blueprint: "audit",
  },
];

/**
 * What a domain phase declared it could not do, mapped to what the data platform now
 * provides and what remains that domain's own work. This is deliberately explicit: a gap
 * that stays in prose is a gap that gets forgotten.
 */
export interface DeclaredGapMapping {
  readonly gapId: string;
  readonly declaredBy: string;
  readonly declared: string;
  readonly providedByDataPlatform: string;
  readonly remains: string;
}

export const DECLARED_GAP_MAPPING: readonly DeclaredGapMapping[] = [
  {
    gapId: "GAP-FIN-02",
    declaredBy: "Phase 13",
    declared:
      "no persistence migration for invoices, payments, splits, journal events, outbox entries or idempotency records",
    providedByDataPlatform:
      "the migration discipline (forward-only, validated, history-preserving) and the schema-invariant checker a domain uses to declare and prove the shape of its records",
    remains:
      "the financial tables themselves, their RLS policies and their validation queries, which only the financial phase may define",
  },
  {
    gapId: "GAP-FIN-03",
    declaredBy: "Phase 13",
    declared:
      "reconciliation compares one pair of records; no run compares a whole provider statement and opens exceptions",
    providedByDataPlatform:
      "the dataset reconciliation engine: keyed comparison, declared tolerances, matched/missing/unexpected/duplicate classification, evidence-required resolution and exception ageing",
    remains:
      "binding provider statements into that run, and the financial meaning of each exception",
  },
  {
    gapId: "GAP-FIN-06",
    declaredBy: "Phase 13",
    declared:
      "batch billing, webhook bursts, settlement polling and reconciliation runs are not schedulable or cancellable jobs",
    providedByDataPlatform:
      "the job contract: derived idempotency keys, an explicit run state machine, declared restartability with checkpoints, cancellation rules, attempt ceilings and burst budgets",
    remains:
      "the financial jobs themselves and their scheduling, which belong to the financial phase with Phase 17",
  },
  {
    gapId: "GAP-FIN-07",
    declaredBy: "Phase 13",
    declared:
      "no authorised ingestion boundary, so no platform surface calls the financial engines",
    providedByDataPlatform:
      "the ingestion boundary: declared endpoints with authority, source and signature requirements, natural-key deduplication, rejection with reasons and full provenance on every accepted record",
    remains:
      "the financial endpoints and the server functions that use them, behind Phase 08's authorization",
  },
  {
    gapId: "GAP-FIN-01",
    declaredBy: "Phase 13",
    declared: "no live payment provider adapter",
    providedByDataPlatform:
      "nothing — this is not a data-platform gap, and it is recorded here so that mapping it does not look like an answer",
    remains:
      "provider adapters, contract tests and credentials, which belong to Phase 13 and the owner",
  },
  {
    gapId: "GAP-FIN-04",
    declaredBy: "Phase 13",
    declared: "no collections or dispute state machines",
    providedByDataPlatform:
      "the state-machine and lifecycle discipline the platform enforces (explicit states, evidence to close, ageing of open items)",
    remains:
      "the collection and dispute states, their transitions and their financial effects, which are the financial phase's semantics",
  },
  {
    gapId: "GAP-FIN-05",
    declaredBy: "Phase 13",
    declared: "no metered usage, overage computation or renewal generation",
    providedByDataPlatform:
      "the ingestion boundary for meter readings and the job contract that makes a renewal run safe to repeat",
    remains:
      "metering semantics, overage rules and renewal generation, which belong to the financial phase with Phase 17",
  },
];

export interface DataGap {
  readonly id: string;
  readonly area: string;
  readonly statement: string;
  readonly closesWhen: string;
  readonly owner: string;
}

export const DATA_PLATFORM_GAPS: readonly DataGap[] = [
  {
    id: "GAP-DATA-01",
    area: "physical storage",
    statement:
      "The platform defines data discipline, not storage: no warehouse, lake or analytical store is provisioned.",
    closesWhen:
      "a storage layer is provisioned and the contracts here are enforced by it rather than by convention",
    owner: "Phase 14 with Phase 21",
  },
  {
    id: "GAP-DATA-02",
    area: "enforcement wiring",
    statement:
      "The migration, job, ingestion and reconciliation contracts are executable libraries; no database, scheduler or gateway calls them yet.",
    closesWhen:
      "migrations run through the migration contract, jobs through the job contract and inbound feeds through the ingestion boundary",
    owner: "Phase 14 with Phase 05",
  },
  {
    id: "GAP-DATA-03",
    area: "streaming",
    statement:
      "There is no streaming or change-data-capture path: every contract here is batch-shaped.",
    closesWhen:
      "a stream consumer enforces the same key, dedup, provenance and burst rules as the batch boundary",
    owner: "Phase 14",
  },
  {
    id: "GAP-DATA-04",
    area: "quality feedback",
    statement:
      "Quality rules exist, but their results do not feed the catalog or the reconciliation engine as evidence.",
    closesWhen:
      "quality verdicts are recorded as evidence that a dataset's contract and its consumers can read",
    owner: "Phase 14",
  },
  {
    id: "GAP-DATA-05",
    area: "retention enforcement",
    statement:
      "Retention and residency are declared policies; nothing yet enforces expiry, masking or locality on a real store.",
    closesWhen: "a storage layer enforces the declared retention, hold and residency rules",
    owner: "Phase 14 with Phase 21",
  },
];

export interface DataCheck {
  readonly id: string;
  readonly rule: string;
  readonly module: string;
  /** What the engine actually did when called — not a claim about it. */
  readonly observed: string;
  readonly passed: boolean;
}

const APPLIED: readonly MigrationRecord[] = [
  {
    version: "20260901000100",
    name: "baseline data platform",
    kind: "schema",
    appliedAt: "2026-09-01T00:00:00Z",
    validates: "select count(*) from information_schema.tables",
    preservesHistory: true,
    checksum: "abc123",
  },
];

const LEDGER_TABLE: TableContract = {
  table: "example_ledger_record",
  columns: [
    { name: "record_id", type: "uuid", nullable: false },
    { name: "tenant_id", type: "uuid", nullable: false },
    {
      name: "amount_minor",
      type: "bigint",
      nullable: false,
      minorUnits: true,
      currencyColumn: "currency",
    },
    { name: "currency", type: "char(3)", nullable: false },
    { name: "status", type: "text", nullable: false },
  ],
  primaryKey: ["record_id"],
  uniqueScopes: [{ columns: ["record_id"], scope: ["tenant_id"] }],
  appendOnly: true,
  foreignKeys: [{ columns: ["tenant_id"], references: "cg_tenant(id)" }],
  rowLevelSecurity: true,
  requiresInvariants: [
    "tenant-column-present",
    "tenant-isolation-policy",
    "append-only",
    "unique-scope-key",
    "exact-minor-units",
    "foreign-key-integrity",
    "state-machine-column",
  ],
};

const INCOMPLETE_TABLE: TableContract = {
  table: "example_unproven_record",
  columns: [
    { name: "record_id", type: "uuid", nullable: false },
    { name: "amount_minor", type: "bigint", nullable: false, minorUnits: true },
    { name: "status", type: "text", nullable: false },
  ],
  primaryKey: ["record_id"],
  requiresInvariants: [
    "tenant-column-present",
    "tenant-isolation-policy",
    "append-only",
    "unique-scope-key",
    "exact-minor-units",
  ],
};

const BATCH_JOB: JobContract = {
  jobId: "example-batch",
  name: "Example batch",
  ownerPhase: "14",
  keyFields: ["scope", "period"],
  restartable: true,
  cancellable: true,
  maxAttempts: 3,
  burstLimitPerMinute: 2,
};

const INGEST_ENDPOINT: IngestionEndpoint = {
  endpointId: "example-feed",
  name: "Example external feed",
  ownerPhase: "14",
  source: { sourceId: "external-provider-a", kind: "external-provider", signed: true },
  authorised: true,
  classification: "CONFIDENTIAL",
  purpose: "reconcile externally reported records",
  naturalKey: ["reference"],
  schemaVersion: "v1",
  rejectsOnUnknownFields: true,
};

/**
 * Execute the engines and record what happened. Every check is a live call: if a rule
 * regresses, its observation changes and the check fails.
 */
export function runDataPlatformChecks(): readonly DataCheck[] {
  const checks: DataCheck[] = [];

  const editedMigration = recordMigration({
    applied: APPLIED,
    version: "20260901000100",
    name: "baseline data platform",
    kind: "schema",
    appliedAt: "2026-09-02T00:00:00Z",
    validates: "select count(*) from information_schema.tables",
    preservesHistory: true,
    checksum: "different",
  });
  checks.push({
    id: "migrations-are-forward-only",
    rule: "migrations-are-forward-only",
    module: "data-migration",
    observed: editedMigration.ok
      ? "an edited applied migration was accepted"
      : editedMigration.detail,
    passed: !editedMigration.ok,
  });

  const unvalidated = recordMigration({
    applied: APPLIED,
    version: "20260901000200",
    name: "unvalidated change",
    kind: "schema",
    appliedAt: "2026-09-02T00:00:00Z",
    validates: "",
    preservesHistory: true,
    checksum: "def456",
  });
  checks.push({
    id: "migrations-declare-their-validation",
    rule: "migrations-are-forward-only",
    module: "data-migration",
    observed: unvalidated.ok
      ? "a migration without a validation step was accepted"
      : unvalidated.detail,
    passed: !unvalidated.ok,
  });

  const lossy = recordMigration({
    applied: APPLIED,
    version: "20260901000300",
    name: "rewrite history",
    kind: "data",
    appliedAt: "2026-09-02T00:00:00Z",
    validates: "row counts unchanged",
    preservesHistory: false,
    checksum: "ghi789",
  });
  checks.push({
    id: "history-is-preserved",
    rule: "history-is-preserved",
    module: "data-migration",
    observed: lossy.ok ? "a history-destroying data migration was accepted" : lossy.detail,
    passed: !lossy.ok,
  });

  return checks;
}

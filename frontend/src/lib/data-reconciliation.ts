/**
 * CoreGrid — dataset reconciliation (Phase 14, domain-neutral).
 *
 * Two sources that should agree rarely do. Reconciliation finds out where they disagree
 * and keeps every disagreement visible until someone who may decide decides. This engine is
 * deliberately generic — the records, the key and the tolerances are declared data — and it
 * is uncompromising about three things:
 *
 *   - every key present on only one side becomes an EXPLICIT exception; a discrepancy is
 *     never silently ignored, because a mismatch nobody sees is a mismatch that compounds;
 *   - resolving an exception requires a cause, a correction, the evidence and the actor, so
 *     "it is fixed" is not an acceptable answer;
 *   - a run reports whether it is COMPLETE: an unmatched record means the comparison is not
 *     finished, not that everything matched.
 *
 * A domain phase recorded that it had pair-wise comparison but no scheduled run comparing a
 * whole statement and opening exceptions; this is that engine, stated generally so any
 * domain can compare its own records with an external report.
 */

export type ReconciliationExceptionKind =
  | "missing-in-right"
  | "unexpected-in-right"
  | "duplicate-in-right"
  | "value-mismatch"
  | "currency-mismatch";

export interface ReconciliationTolerance {
  /** Allowed difference in basis points of the left-hand value. */
  readonly relativeBasisPoints?: number;
  /** Allowed absolute difference, in the compared unit's minor units. */
  readonly absoluteMinor?: number;
}

export interface ReconciliationComparison {
  readonly field: string;
  readonly tolerance?: ReconciliationTolerance;
}

export interface ReconciliationException {
  readonly exceptionId: string;
  readonly kind: ReconciliationExceptionKind;
  readonly key: string;
  readonly detail: string;
  readonly leftValue: string | null;
  readonly rightValue: string | null;
  /** Set only by a resolution that names its cause and evidence. */
  readonly resolution?: {
    readonly cause: string;
    readonly correction: string;
    readonly evidence: string;
    readonly actor: string;
    readonly at: string;
  };
}

export interface ReconciliationRun {
  readonly leftName: string;
  readonly rightName: string;
  readonly keyFields: readonly string[];
  readonly asOf: string;
  readonly matchedKeys: readonly string[];
  readonly exceptions: readonly ReconciliationException[];
  readonly complete: boolean;
}

export type RunVerdict =
  | { readonly ok: true; readonly run: ReconciliationRun }
  | { readonly ok: false; readonly error: string };

function keyOf(
  record: Readonly<Record<string, unknown>>,
  keyFields: readonly string[],
): string | null {
  const parts: string[] = [];
  for (const field of keyFields) {
    const value = record[field];
    if (value === undefined || value === null || value === "") return null;
    parts.push(`${field}=${String(value)}`);
  }
  return parts.join("|");
}

function numberAt(record: Readonly<Record<string, unknown>>, field: string): number | null {
  const value = record[field];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value)))
    return Number(value);
  return null;
}

/**
 * Compare two datasets by key. A record without a complete key is refused outright: a
 * comparison against records that cannot be identified proves nothing.
 */
export function runDatasetReconciliation(input: {
  readonly leftName: string;
  readonly rightName: string;
  readonly left: readonly Readonly<Record<string, unknown>>[];
  readonly right: readonly Readonly<Record<string, unknown>>[];
  readonly keyFields: readonly string[];
  readonly comparisons: readonly ReconciliationComparison[];
  readonly asOf: string;
}): RunVerdict {
  if (input.keyFields.length === 0) {
    return {
      ok: false,
      error: "reconciliation needs declared key fields: without a key there is nothing to compare",
    };
  }
  const leftIndex = new Map<string, Readonly<Record<string, unknown>>>();
  for (const record of input.left) {
    const key = keyOf(record, input.keyFields);
    if (!key) {
      return {
        ok: false,
        error: `a record on ${input.leftName} carries no complete key (${input.keyFields.join(", ")})`,
      };
    }
    leftIndex.set(key, record);
  }
  const rightIndex = new Map<string, Readonly<Record<string, unknown>>[]>();
  for (const record of input.right) {
    const key = keyOf(record, input.keyFields);
    if (!key) {
      return {
        ok: false,
        error: `a record on ${input.rightName} carries no complete key (${input.keyFields.join(", ")})`,
      };
    }
    rightIndex.set(key, [...(rightIndex.get(key) ?? []), record]);
  }
  return compareIndices(input, leftIndex, rightIndex);
}

function compareIndices(
  input: Parameters<typeof runDatasetReconciliation>[0],
  leftIndex: Map<string, Readonly<Record<string, unknown>>>,
  rightIndex: Map<string, readonly Readonly<Record<string, unknown>>[]>,
): RunVerdict {
  const matchedKeys: string[] = [];
  const exceptions: ReconciliationException[] = [];
  const push = (
    kind: ReconciliationExceptionKind,
    key: string,
    detail: string,
    leftValue: string | null,
    rightValue: string | null,
  ) => {
    exceptions.push({ exceptionId: `${kind}:${key}`, kind, key, detail, leftValue, rightValue });
  };

  for (const [key, leftRecord] of leftIndex) {
    const rightRecords = rightIndex.get(key);
    if (!rightRecords || rightRecords.length === 0) {
      push(
        "missing-in-right",
        key,
        `${input.rightName} holds no record for a key that ${input.leftName} reports`,
        JSON.stringify(leftRecord),
        null,
      );
      continue;
    }
    if (rightRecords.length > 1) {
      push(
        "duplicate-in-right",
        key,
        `${input.rightName} holds ${rightRecords.length} records for one key: a replayed feed is a discrepancy, not a match`,
        JSON.stringify(leftRecord),
        JSON.stringify(rightRecords),
      );
      continue;
    }
    const rightRecord = rightRecords[0];
    let mismatched = false;

    for (const comparison of input.comparisons) {
      const leftValue = numberAt(leftRecord, comparison.field);
      const rightValue = numberAt(rightRecord, comparison.field);

      if (leftValue === null || rightValue === null) {
        const leftText = String(leftRecord[comparison.field] ?? "");
        const rightText = String(rightRecord[comparison.field] ?? "");
        if (leftText === rightText) continue;
        mismatched = true;
        push(
          comparison.field.toLowerCase().includes("curren")
            ? "currency-mismatch"
            : "value-mismatch",
          key,
          `${comparison.field} differs: ${leftText} against ${rightText}`,
          leftText,
          rightText,
        );
        continue;
      }

      const absolute = Math.abs(leftValue - rightValue);
      const tolerance = comparison.tolerance ?? {};
      const allowedAbsolute = tolerance.absoluteMinor ?? 0;
      const allowedRelative = ((tolerance.relativeBasisPoints ?? 0) * Math.abs(leftValue)) / 10_000;
      const allowed = Math.max(allowedAbsolute, allowedRelative);
      if (absolute > allowed) {
        mismatched = true;
        push(
          "value-mismatch",
          key,
          `${comparison.field} differs by ${absolute}, beyond the declared tolerance of ${allowed}`,
          String(leftValue),
          String(rightValue),
        );
      }
    }

    if (!mismatched) matchedKeys.push(key);
  }

  for (const [key, rightRecords] of rightIndex) {
    if (!leftIndex.has(key)) {
      push(
        "unexpected-in-right",
        key,
        `${input.rightName} reports a key that ${input.leftName} does not hold`,
        null,
        JSON.stringify(rightRecords),
      );
    }
  }

  return {
    ok: true,
    run: {
      leftName: input.leftName,
      rightName: input.rightName,
      keyFields: input.keyFields,
      asOf: input.asOf,
      matchedKeys,
      exceptions,
      complete: exceptions.length === 0,
    },
  };
}

export type ResolutionVerdict =
  | { readonly ok: true; readonly exception: ReconciliationException }
  | { readonly ok: false; readonly error: string };

/**
 * Resolve an exception. A resolution without a cause, a correction, the evidence and the
 * actor is refused: an exception closed by assertion is an exception that will return.
 */
export function resolveException(
  exception: ReconciliationException,
  resolution: {
    readonly cause: string;
    readonly correction: string;
    readonly evidence: string;
    readonly actor: string;
    readonly at: string;
  },
): ResolutionVerdict {
  if (exception.resolution)
    return { ok: false, error: `exception ${exception.exceptionId} is already resolved` };
  const missing = (["cause", "correction", "evidence", "actor"] as const).filter(
    (field) => !resolution[field]?.trim(),
  );
  if (missing.length > 0) {
    return {
      ok: false,
      error: `a resolution must name ${missing.join(", ")}: ${exception.exceptionId} stays open`,
    };
  }
  return {
    ok: true,
    exception: {
      ...exception,
      resolution: {
        cause: resolution.cause,
        correction: resolution.correction,
        evidence: resolution.evidence,
        actor: resolution.actor,
        at: resolution.at,
      },
    },
  };
}

export interface ReconciliationSummary {
  readonly matched: number;
  readonly exceptions: number;
  readonly open: number;
  readonly byKind: Readonly<Record<ReconciliationExceptionKind, number>>;
  readonly balanced: boolean;
  readonly complete: boolean;
}

/** Summarise a run: counts by kind, how many are still open, and whether it is balanced. */
export function summariseReconciliationRun(run: ReconciliationRun): ReconciliationSummary {
  const byKind: Record<ReconciliationExceptionKind, number> = {
    "missing-in-right": 0,
    "unexpected-in-right": 0,
    "duplicate-in-right": 0,
    "value-mismatch": 0,
    "currency-mismatch": 0,
  };
  for (const exception of run.exceptions) byKind[exception.kind] += 1;
  const open = run.exceptions.filter((exception) => !exception.resolution).length;
  return {
    matched: run.matchedKeys.length,
    exceptions: run.exceptions.length,
    open,
    byKind,
    balanced: run.complete,
    complete: run.complete,
  };
}

/** How long each open exception has been open, in whole days. */
export function ageOpenExceptions(
  run: ReconciliationRun,
  now: string,
): readonly { readonly exceptionId: string; readonly ageDays: number }[] {
  const nowMs = new Date(now).getTime();
  const asOfMs = new Date(run.asOf).getTime();
  const ageDays = Math.max(0, Math.floor((nowMs - asOfMs) / 86_400_000));
  return run.exceptions
    .filter((exception) => !exception.resolution)
    .map((exception) => ({ exceptionId: exception.exceptionId, ageDays }));
}

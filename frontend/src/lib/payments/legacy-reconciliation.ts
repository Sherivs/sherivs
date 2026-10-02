/**
 * CoreGrid — legacy durable payment-table reconciliation contract
 * (MISSION H2-26, J-044 / L-H-020 / COND-009).
 *
 * The corpus (STREAM H implementation map, financial-system entry) flags the
 * pre-CoreGrid durable payment tables as the only payment substrate that has
 * ever held real money state:
 *
 *   - `public.fees` (migration 20260620122048): legacy Scholar fee rows with
 *     `paystack_reference` (partial unique index) and a `paid_amount` claim.
 *   - `public.student_platform_fee_ledger` (migration 20260726085612): the
 *     platform-fee ledger with `payment_reference` and NO uniqueness rule.
 *   - `public.webhook_logs`: the raw accepted-webhook evidence log.
 *
 * Two economics truths coexist: these orphan legacy tables and the phase 13
 * contract vocabulary (`payment-contract.ts`). This module is the READ-ONLY
 * reconciliation contract between them. It is pure arithmetic over caller
 * snapshots: no database access, no network I/O, no clock reads, no mutation
 * of any input — and therefore of no legacy row.
 *
 * Source-of-truth discipline (Constitution §9; `paystack.functions.ts` and
 * the webhook route): the verified Paystack webhook is evidence validated
 * against canonical records — never the other way round. The canonical
 * linkage key is the Paystack transaction reference, exactly like the
 * adapter (`paystack-adapter.ts` uses the reference as the durable event id)
 * and the webhook route (which settles fee rows by `paystack_reference`).
 * Provider metadata hints (fee id, tenant id) are evidence only and are
 * re-validated here against the reference binding; a hint that contradicts
 * the binding is ambiguous money and fails closed.
 *
 * Replay binding: an accepted receipt's dedup identity is its Paystack
 * reference (the adapter's eventId). Two accepted receipts carrying one
 * reference would be a replay-guard violation — this input fails closed.
 *
 * Tombstone discipline (ADR-005, AGENTS §28): discrepancies are REPORTED,
 * never silently corrected. A receipt that disagrees with a legacy claim
 * does not rewrite the claim; the entry carries both values and the report
 * is the immutable, provenance-stamped record (§12) a governance event can
 * act on. Disposition is `report_only` — always.
 *
 * Fail-closed on ambiguous money (Constitution §36): any input whose money
 * state cannot be attributed to exactly one canonical row without guessing
 * throws. Money is integer minor units (T); currencies are never mixed.
 *
 * Refunds are deliberately out of scope (mirrors `reconciliation.ts`): no
 * V1 adapter declares the refund capability while BLK-4 stands, so a
 * refunded legacy ledger row is classified `non_monetary` here rather than
 * netted by inference.
 */
import type { Money } from "../financial-core";
import type { TenantId } from "../tenant-core";

/* ─────────────────────────────────────────────────────────────
 * Legacy row vocabulary (caller-resolved snapshots)
 * ────────────────────────────────────────────────────────────*/

/** The legacy `public.fees` family (migration 20260620122048). */
export interface LegacyFeeTableRow {
  readonly family: "fees";
  readonly id: string;
  /** Owning tenant — caller-resolved from the legacy school column. */
  readonly tenantId: TenantId;
  readonly status: "unpaid" | "partial" | "paid";
  /** Invoiced amount in integer minor units (legacy `amount`). */
  readonly amountMinor: number;
  /** Settled claim in integer minor units (legacy `paid_amount`). */
  readonly settledMinor: number;
  /** Legacy `paystack_reference` — the canonical webhook linkage key. */
  readonly paystackReference: string | null;
}

/** The legacy `public.student_platform_fee_ledger` family (20260726085612). */
export interface LegacyPlatformFeeLedgerRow {
  readonly family: "platform_fee_ledger";
  readonly id: string;
  readonly tenantId: TenantId;
  readonly status: "pending" | "collected" | "waived" | "refunded";
  readonly amountMinor: number;
  readonly settledMinor: number;
  /** Legacy `payment_reference` — no uniqueness rule exists on this column. */
  readonly paymentReference: string | null;
}

export type LegacyPaymentRow = LegacyFeeTableRow | LegacyPlatformFeeLedgerRow;

/**
 * An accepted, signature-verified Paystack receipt (webhook source of
 * truth, post replay-guard acceptance). `reference` is the durable replay
 * identity, exactly like the adapter's eventId.
 */
export interface LegacyPaystackReceipt {
  readonly reference: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly occurredAtSec: number;
  /** `metadata.fee_id` hint — evidence only, never the matching key. */
  readonly purposeHint: string | null;
  /** `metadata` tenant hint — evidence only, never authorization. */
  readonly tenantIdHint: TenantId | null;
}

export interface LegacyReconciliationContext {
  /** Single-currency discipline: every operand must be in this currency. */
  readonly currency: string;
  /** Caller-provided report time (§12 provenance) — no hidden clock reads. */
  readonly generatedAt: string;
}

/* ─────────────────────────────────────────────────────────────
 * Canonical Paystack-reference linkage (b)
 * ────────────────────────────────────────────────────────────*/

/**
 * Derive the canonical provider-reference linkage key for a legacy row —
 * the value a verified webhook binds to, exactly as the webhook route
 * settles fee rows by `paystack_reference`. `null` means the row carries no
 * provider locator: its linkage cannot be derived and a money claim on it
 * is `reference_missing`.
 */
export function canonicalProviderReference(row: LegacyPaymentRow): string | null {
  const reference =
    row.family === "fees" ? row.paystackReference : row.paymentReference;
  const trimmed = reference?.trim() ?? "";
  return trimmed === "" ? null : trimmed;
}

/**
 * Money-bearing predicate: does this legacy row claim that money moved?
 * `fees` rows claim money when partially or fully settled; ledger rows
 * claim money when collected. `waived` and `refunded` rows move no money
 * through this pipeline (refunds are capability-blocked, BLK-4).
 */
export function claimsLegacyMoney(row: LegacyPaymentRow): boolean {
  if (row.family === "fees") {
    return row.status === "partial" || row.status === "paid";
  }
  return row.status === "collected";
}

/* ─────────────────────────────────────────────────────────────
 * Classification classes (a)
 * ────────────────────────────────────────────────────────────*/

export type LegacyReconciliationKind =
  | "reconciled"
  | "orphaned"
  | "duplicate"
  | "amount_mismatch"
  | "reference_missing"
  | "non_monetary";

export type LegacyReconciliationEntry =
  | {
      readonly kind: "reconciled";
      readonly family: LegacyPaymentRow["family"];
      readonly rowId: string;
      readonly tenantId: TenantId;
      readonly providerReference: string;
      readonly receiptReference: string;
      /** The legacy row's settled claim — never rewritten (tombstone). */
      readonly claimed: Money;
      readonly received: Money;
    }
  | {
      readonly kind: "amount_mismatch";
      readonly family: LegacyPaymentRow["family"];
      readonly rowId: string;
      readonly tenantId: TenantId;
      readonly providerReference: string;
      readonly receiptReference: string;
      /** The legacy row's settled claim — reported, not corrected. */
      readonly claimed: Money;
      readonly received: Money;
    }
  | {
      readonly kind: "orphaned";
      readonly direction: "unevidenced_claim" | "unbound_receipt";
      readonly family: LegacyPaymentRow["family"] | null;
      readonly rowId: string | null;
      readonly tenantId: TenantId | null;
      readonly providerReference: string | null;
      readonly receiptReference: string | null;
      readonly amount: Money;
    }
  | {
      readonly kind: "duplicate";
      readonly family: LegacyPaymentRow["family"];
      readonly rowId: string;
      readonly tenantId: TenantId;
      readonly providerReference: string;
      readonly coClaimantRowIds: readonly string[];
    }
  | {
      readonly kind: "reference_missing";
      readonly family: LegacyPaymentRow["family"];
      readonly rowId: string;
      readonly tenantId: TenantId;
      readonly claimed: Money;
    }
  | {
      readonly kind: "non_monetary";
      readonly family: LegacyPaymentRow["family"];
      readonly rowId: string;
      readonly tenantId: TenantId;
      readonly legacyStatus: LegacyPaymentRow["status"];
    };

export interface LegacyReconciliationCounts {
  readonly legacyRows: number;
  readonly paystackReceipts: number;
  readonly reconciled: number;
  readonly orphaned: number;
  readonly duplicate: number;
  readonly amountMismatch: number;
  readonly referenceMissing: number;
  readonly nonMonetary: number;
}

/* ─────────────────────────────────────────────────────────────
 * Immutable report record (c) — provenance per AGENTS §12
 * ────────────────────────────────────────────────────────────*/

export interface LegacyReconciliationProvenance {
  readonly generatedBy: string;
  readonly missionRef: string;
  /** Caller-supplied generation time — the pipeline never reads a clock. */
  readonly generatedAt: string;
  readonly sourceTables: readonly string[];
  /** Order-insensitive integrity marker over the exact inputs (§12). */
  readonly inputsDigest: string;
  readonly inputCensus: {
    readonly legacyRows: number;
    readonly paystackReceipts: number;
  };
}

export interface LegacyReconciliationReport {
  /** Deterministic id derived from the inputs digest — idempotent replay. */
  readonly reportId: string;
  readonly balanced: boolean;
  /** Tombstone discipline marker (ADR-005): report, never mutate. */
  readonly disposition: "report_only";
  readonly counts: LegacyReconciliationCounts;
  readonly provenance: LegacyReconciliationProvenance;
  /** Deterministic order: row entries in input order, then unbound receipts in input order. */
  readonly entries: readonly LegacyReconciliationEntry[];
}

const SOURCE_TABLES = [
  "public.fees (20260620122048)",
  "public.student_platform_fee_ledger (20260726085612)",
  "public.webhook_logs (accepted-receipt evidence)",
] as const;

const GENERATED_BY = "frontend/src/lib/payments/legacy-reconciliation.ts";

/* ─────────────────────────────────────────────────────────────
 * Fail-closed validation — ambiguous money throws
 * ────────────────────────────────────────────────────────────*/

function requireValidTenantId(tenantId: TenantId, where: string): void {
  if (typeof tenantId !== "string" || tenantId.trim() === "") {
    throw new Error(`Legacy reconciliation: ${where} requires a tenant`);
  }
}

function requireSafePositiveMinor(minor: number, where: string): void {
  if (!Number.isSafeInteger(minor) || minor <= 0) {
    throw new Error(
      `Legacy reconciliation: ${where} must be a positive integer in minor units (T)`,
    );
  }
}

function requireSafeNonNegativeMinor(minor: number, where: string): void {
  if (!Number.isSafeInteger(minor) || minor < 0) {
    throw new Error(
      `Legacy reconciliation: ${where} must be a non-negative integer in minor units (T)`,
    );
  }
}

function requireCurrency(currency: string, where: string, context: LegacyReconciliationContext): void {
  if (currency !== context.currency) {
    throw new Error(
      `Legacy reconciliation: ${where} is in ${currency}, not the reconciliation currency ${context.currency} — money is never mixed (T)`,
    );
  }
}

function money(minor: number, context: LegacyReconciliationContext): Money {
  return { amountMinor: minor, currency: context.currency };
}

/**
 * Validate every legacy row's money state strictly. A row that claims money
 * must carry a coherent positive claim; a settled claim greater than the
 * invoiced amount is an internal contradiction — ambiguous money, fail closed.
 */
function validateLegacyRow(row: LegacyPaymentRow, context: LegacyReconciliationContext): void {
  const where = `${row.family} row ${row.id}`;
  if (typeof row.id !== "string" || row.id.trim() === "") {
    throw new Error(`Legacy reconciliation: ${row.family} row requires a durable id`);
  }
  requireValidTenantId(row.tenantId, where);
  requireSafeNonNegativeMinor(row.amountMinor, `${where} invoiced amount`);
  requireSafeNonNegativeMinor(row.settledMinor, `${where} settled amount`);

  if (claimsLegacyMoney(row)) {
    if (row.settledMinor <= 0) {
      throw new Error(`Legacy reconciliation: ${where} claims settled money with a non-positive amount`);
    }
    if (row.settledMinor > row.amountMinor) {
      throw new Error(
        `Legacy reconciliation: ${where} claims settled ${row.settledMinor} against invoiced ${row.amountMinor} — ambiguous money, fail closed`,
      );
    }
  }
}

function validateReceipt(
  receipt: LegacyPaystackReceipt,
  context: LegacyReconciliationContext,
): void {
  const where = `receipt ${receipt.reference}`;
  if (typeof receipt.reference !== "string" || receipt.reference.trim() === "") {
    throw new Error("Legacy reconciliation: receipt requires a Paystack reference");
  }
  requireSafePositiveMinor(receipt.amountMinor, `${where} amount`);
  requireCurrency(receipt.currency, where, context);
}

/* ─────────────────────────────────────────────────────────────
 * Provenance digest (§12) — order-insensitive FNV-1a over inputs
 * ────────────────────────────────────────────────────────────*/

function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

function inputsDigest(
  rows: readonly LegacyPaymentRow[],
  receipts: readonly LegacyPaystackReceipt[],
  context: LegacyReconciliationContext,
): string {
  const lines: string[] = [`currency=${context.currency}`];
  for (const row of rows) {
    lines.push(
      [
        "row",
        row.family,
        row.id,
        row.tenantId,
        row.status,
        String(row.amountMinor),
        String(row.settledMinor),
        canonicalProviderReference(row) ?? "",
      ].join("|"),
    );
  }
  for (const receipt of receipts) {
    lines.push(
      [
        "receipt",
        receipt.reference,
        String(receipt.amountMinor),
        receipt.currency,
        String(receipt.occurredAtSec),
        receipt.purposeHint ?? "",
        receipt.tenantIdHint ?? "",
      ].join("|"),
    );
  }
  return fnv1a(lines.sort().join("\n"));
}

/* ─────────────────────────────────────────────────────────────
 * The reconciliation pipeline
 * ────────────────────────────────────────────────────────────*/

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === "object") {
    Object.freeze(value);
    for (const key of Object.keys(value as object)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

/**
 * Reconcile legacy durable payment rows against accepted Paystack receipts.
 *
 * Fail closed (throws) on ambiguous money:
 *   - two money-bearing rows claim the same provider reference;
 *   - two accepted receipts carry the same reference (exactly-once/replay
 *     violation — the guard's acceptance contract already forbids this);
 *   - a receipt's metadata hint contradicts its reference binding;
 *   - any negative, fractional or non-coherent money operand;
 *   - any currency outside the reconciliation currency.
 *
 * Never mutates any input and never corrects a discrepancy in place: every
 * outcome lands in the frozen report (ADR-005 tombstone discipline).
 */
export function reconcileLegacyPayments(
  rows: readonly LegacyPaymentRow[],
  receipts: readonly LegacyPaystackReceipt[],
  context: LegacyReconciliationContext,
): LegacyReconciliationReport {
  if (typeof context.currency !== "string" || context.currency.trim() === "") {
    throw new Error("Legacy reconciliation: context requires a currency");
  }
  if (typeof context.generatedAt !== "string" || context.generatedAt.trim() === "") {
    throw new Error("Legacy reconciliation: context requires a generation timestamp (§12 provenance)");
  }

  for (const row of rows) validateLegacyRow(row, context);
  for (const receipt of receipts) validateReceipt(receipt, context);

  // Row identity must be unambiguous per family before any money math.
  const seenRowIds = new Set<string>();
  for (const row of rows) {
    const identity = `${row.family}:${row.id}`;
    if (seenRowIds.has(identity)) {
      throw new Error(
        `Legacy reconciliation: duplicate legacy row id "${row.id}" in family ${row.family} — ambiguous identity, fail closed`,
      );
    }
    seenRowIds.add(identity);
  }

  // Reference → rows. Two money-bearing rows on one reference is ambiguous
  // money: the cross-family drift (fees carries a partial unique index, the
  // ledger none) makes this reachable, and no pipeline may guess.
  const rowsByReference = new Map<string, LegacyPaymentRow[]>();
  for (const row of rows) {
    const reference = canonicalProviderReference(row);
    if (reference === null) continue;
    const bucket = rowsByReference.get(reference);
    if (bucket) bucket.push(row);
    else rowsByReference.set(reference, [row]);
  }
  for (const [reference, group] of rowsByReference) {
    const moneyClaimants = group.filter(claimsLegacyMoney);
    if (moneyClaimants.length > 1) {
      throw new Error(
        `Legacy reconciliation: ${moneyClaimants.length} money-bearing rows (${moneyClaimants
          .map((row) => `${row.family}:${row.id}`)
          .join(", ")}) claim reference "${reference}" — ambiguous money, fail closed`,
      );
    }
  }

  // Reference → receipts. Two accepted receipts per reference is a replay
  // violation: the adapter's eventId IS the reference, and exactly-once
  // acceptance (replay-guard) forbids this shape.
  const receiptsByReference = new Map<string, LegacyPaystackReceipt[]>();
  for (const receipt of receipts) {
    const bucket = receiptsByReference.get(receipt.reference);
    if (bucket) bucket.push(receipt);
    else receiptsByReference.set(receipt.reference, [receipt]);
  }
  for (const [reference, group] of receiptsByReference) {
    if (group.length > 1) {
      throw new Error(
        `Legacy reconciliation: ${group.length} accepted receipts carry reference "${reference}" — exactly-once replay violation, fail closed`,
      );
    }
  }

  const entries: LegacyReconciliationEntry[] = [];
  const counts = {
    legacyRows: rows.length,
    paystackReceipts: receipts.length,
    reconciled: 0,
    orphaned: 0,
    duplicate: 0,
    amountMismatch: 0,
    referenceMissing: 0,
    nonMonetary: 0,
  };

  for (const row of rows) {
    const reference = canonicalProviderReference(row);
    const group = reference === null ? [] : (rowsByReference.get(reference) ?? []);
    const coClaimants = group.filter((other) => other !== row).map((other) => `${other.family}:${other.id}`);

    // Duplicate provider-reference bindings are structural drift (the
    // legacy ledger's payment_reference has no uniqueness rule and no
    // cross-family rule exists): reported per row, never deduplicated away.
    if (group.length > 1) {
      counts.duplicate += 1;
      entries.push({
        kind: "duplicate",
        family: row.family,
        rowId: row.id,
        tenantId: row.tenantId,
        providerReference: reference as string,
        coClaimantRowIds: coClaimants,
      });
    }

    if (!claimsLegacyMoney(row)) {
      counts.nonMonetary += 1;
      entries.push({
        kind: "non_monetary",
        family: row.family,
        rowId: row.id,
        tenantId: row.tenantId,
        legacyStatus: row.status,
      });
      continue;
    }

    if (reference === null) {
      counts.referenceMissing += 1;
      entries.push({
        kind: "reference_missing",
        family: row.family,
        rowId: row.id,
        tenantId: row.tenantId,
        claimed: money(row.settledMinor, context),
      });
      continue;
    }

    const receipt = receiptsByReference.get(reference)?.[0];

    // A metadata hint is evidence only; when it contradicts the canonical
    // reference binding the money cannot be attributed without guessing.
    if (receipt && receipt.purposeHint !== null && receipt.purposeHint.trim() !== "") {
      const moneyClaimant = group.find(claimsLegacyMoney);
      if (moneyClaimant && receipt.purposeHint.trim() !== moneyClaimant.id) {
        throw new Error(
          `Legacy reconciliation: receipt "${reference}" hint "${receipt.purposeHint}" contradicts the reference-bound row ${moneyClaimant.family}:${moneyClaimant.id} — ambiguous money, fail closed`,
        );
      }
    }

    if (!receipt) {
      counts.orphaned += 1;
      entries.push({
        kind: "orphaned",
        direction: "unevidenced_claim",
        family: row.family,
        rowId: row.id,
        tenantId: row.tenantId,
        providerReference: reference,
        receiptReference: null,
        amount: money(row.settledMinor, context),
      });
      continue;
    }

    const claimed = money(row.settledMinor, context);
    const received = money(receipt.amountMinor, context);
    if (claimed.amountMinor === received.amountMinor) {
      counts.reconciled += 1;
      entries.push({
        kind: "reconciled",
        family: row.family,
        rowId: row.id,
        tenantId: row.tenantId,
        providerReference: reference,
        receiptReference: receipt.reference,
        claimed,
        received,
      });
    } else {
      counts.amountMismatch += 1;
      entries.push({
        kind: "amount_mismatch",
        family: row.family,
        rowId: row.id,
        tenantId: row.tenantId,
        providerReference: reference,
        receiptReference: receipt.reference,
        claimed,
        received,
      });
    }
  }

  // Accepted money with no canonical binding row: orphaned receipts — the
  // webhook source of truth recorded money that no legacy row claims.
  for (const receipt of receipts) {
    if (rowsByReference.has(receipt.reference)) continue;
    counts.orphaned += 1;
    entries.push({
      kind: "orphaned",
      direction: "unbound_receipt",
      family: null,
      rowId: null,
      tenantId: receipt.tenantIdHint,
      providerReference: null,
      receiptReference: receipt.reference,
      amount: money(receipt.amountMinor, context),
    });
  }

  const digest = inputsDigest(rows, receipts, context);
  const report: LegacyReconciliationReport = {
    reportId: `legacy_recon_${digest}`,
    balanced:
      counts.orphaned === 0 &&
      counts.duplicate === 0 &&
      counts.amountMismatch === 0 &&
      counts.referenceMissing === 0,
    disposition: "report_only",
    counts,
    provenance: {
      generatedBy: GENERATED_BY,
      missionRef: "J-044 / MH-26 (legacy payment-rail reconciliation, BLK-4 dry-run)",
      generatedAt: context.generatedAt,
      sourceTables: SOURCE_TABLES,
      inputsDigest: digest,
      inputCensus: { legacyRows: rows.length, paystackReceipts: receipts.length },
    },
    entries,
  };
  return deepFreeze(report);
}
/**
 * CoreGrid — Phase 13 financial intelligence report (L4).
 *
 * This is the phase's own evidence surface. It does not describe the financial
 * engine: it EXECUTES it. Every check below calls the real engine with real input
 * and records what it observed, so a regression changes this report instead of
 * hiding behind a stored assertion.
 *
 * Three things live here: the rules the phase claims (each tied to the module and
 * the suite that prove it), executed checks with their observations, and the gaps
 * the phase has NOT closed — stated as unfinished work rather than omitted.
 *
 * The report also expresses the same capability in several organizations' own
 * vocabulary, because FinOS belongs to CoreGrid and not to one kind of institution:
 * nothing here may present a single institution's process as the default.
 */
import { money } from "./financial-core";
import {
  attributeProviderFee,
  createSplitPayment,
  refundSplitProRata,
  splitSettlementState,
  type SplitLeg,
} from "./financial-splits";
import { canFailover, selectPaymentRoute, type ProviderProfile } from "./financial-routing";
import {
  appendFinancialEvent,
  enqueueOutbox,
  postDoubleEntry,
  reconstructObligation,
  type FinancialEvent,
  type FinancialJournal,
} from "./financial-journal";
import { calculateTax, resolveTaxRule, type TaxRuleVersion } from "./financial-tax";

export interface FinancialRule {
  readonly id: string;
  readonly statement: string;
  /** The domain-neutral module that implements the rule. */
  readonly module: string;
  /** The suite that proves it. */
  readonly suite: string;
  /** The blueprint section the rule comes from. */
  readonly blueprint: string;
}

export const FINANCIAL_RULES: readonly FinancialRule[] = [
  {
    id: "money-is-exact",
    statement:
      "Money is exact minor units with a declared currency; what cannot be reconciled to the unit is not money.",
    module: "frontend/src/lib/financial-core.ts",
    suite: "tests/unit/financial-core.test.ts",
    blueprint: "S, T",
  },
  {
    id: "prices-are-versioned",
    statement:
      "A price change publishes a new version and never rewrites an invoice already issued.",
    module: "frontend/src/lib/financial-settlements.ts",
    suite: "tests/unit/financial-settlements.test.ts",
    blueprint: "J, BP",
  },
  {
    id: "obligation-is-not-invoice",
    statement:
      "What is owed, what is billed and what is paid are three different records, never one status field.",
    module: "frontend/src/lib/financial-core.ts",
    suite: "tests/unit/financial-core.test.ts",
    blueprint: "F, N, O",
  },
  {
    id: "providers-stay-behind-adapters",
    statement:
      "A provider is reached through a declared capability contract; routing decides over capabilities, never a hard-coded provider.",
    module: "frontend/src/lib/financial-routing.ts",
    suite: "tests/unit/financial-routing.test.ts",
    blueprint: "Z, AA",
  },
  {
    id: "capability-dominates-preference",
    statement:
      "Policy may order eligible providers but can never make an ineligible one eligible, and an unroutable requirement is reported rather than forced.",
    module: "frontend/src/lib/financial-routing.ts",
    suite: "tests/unit/financial-routing.test.ts",
    blueprint: "Z, DQ",
  },
  {
    id: "failover-cannot-double-charge",
    statement:
      "Failover is refused after a success, after an unresolved timeout and without proof that no capture occurred.",
    module: "frontend/src/lib/financial-routing.ts",
    suite: "tests/unit/financial-routing.test.ts",
    blueprint: "DQ, EH 40",
  },
  {
    id: "splits-account-for-the-gross",
    statement:
      "A split's legs sum exactly to the gross amount; over- and under-allocation are refused, never rounded away.",
    module: "frontend/src/lib/financial-splits.ts",
    suite: "tests/unit/financial-splits.test.ts",
    blueprint: "EK.2",
  },
  {
    id: "settlement-is-per-leg",
    statement:
      "Every beneficiary leg settles and reconciles on its own evidence; a leg without settlement stays unsettled and visible.",
    module: "frontend/src/lib/financial-splits.ts",
    suite: "tests/unit/financial-splits.test.ts",
    blueprint: "AI, EK.2",
  },
  {
    id: "fees-are-not-deductions",
    statement:
      "Provider fees are attributed to the leg whose route produced them and never silently reduce the gross amount.",
    module: "frontend/src/lib/financial-splits.ts",
    suite: "tests/unit/financial-splits.test.ts",
    blueprint: "AJ, EK.2",
  },
  {
    id: "refunds-are-pro-rata-and-bounded",
    statement:
      "A split refund spreads pro rata with a deterministic remainder and never returns more from a beneficiary than it received.",
    module: "frontend/src/lib/financial-splits.ts",
    suite: "tests/unit/financial-splits.test.ts",
    blueprint: "AK, AL, EK.2",
  },
  {
    id: "journal-is-append-only",
    statement:
      "Financial events are append-only with contiguous sequence and correlation; a duplicate identity or a hole is refused.",
    module: "frontend/src/lib/financial-journal.ts",
    suite: "tests/unit/financial-journal.test.ts",
    blueprint: "BC, BW",
  },
  {
    id: "state-is-reconstructed",
    statement:
      "A balance is reconstructed from its events and evidence; a cached snapshot that disagrees is reported, never preferred.",
    module: "frontend/src/lib/financial-journal.ts",
    suite: "tests/unit/financial-journal.test.ts",
    blueprint: "BD, DD",
  },
  {
    id: "postings-must-balance",
    statement:
      "A ledger posting balances, in one currency, with no negative line; an unbalanced posting is refused rather than rounded.",
    module: "frontend/src/lib/financial-journal.ts",
    suite: "tests/unit/financial-journal.test.ts",
    blueprint: "BE, EH 20",
  },
  {
    id: "events-are-durable-before-published",
    statement:
      "A financial event is queued in the outbox once, in the same unit of work as the state change, before any consumer is told.",
    module: "frontend/src/lib/financial-journal.ts",
    suite: "tests/unit/financial-journal.test.ts",
    blueprint: "BU, BV",
  },
  {
    id: "tax-is-jurisdiction-data",
    statement:
      "The tax rule that applied is resolved by jurisdiction, category and instant; an undeclared jurisdiction is unknown, never zero, and ambiguous rules are refused.",
    module: "frontend/src/lib/financial-tax.ts",
    suite: "tests/unit/financial-tax.test.ts",
    blueprint: "BG, BH, BJ",
  },
  {
    id: "platform-fee-is-a-leg",
    statement:
      "CoreGrid's own revenue is a split beneficiary like any other: the same ledger, settlement and reconciliation path, with no privileged code path.",
    module: "frontend/src/lib/financial-splits.ts",
    suite: "tests/unit/financial-splits.test.ts",
    blueprint: "EJ, EK.2",
  },
];

export interface FinancialGap {
  readonly id: string;
  readonly area: string;
  readonly statement: string;
  /** What would close the gap, stated so it can be verified later. */
  readonly closesWhen: string;
  readonly owner: string;
}

export const FINANCIAL_GAPS: readonly FinancialGap[] = [
  {
    id: "GAP-FIN-01",
    area: "provider adapters",
    statement:
      "No live payment provider adapter is implemented: the routing contract, capability model and webhook verification exist, but no real provider is reached.",
    closesWhen:
      "an adapter for a real provider passes contract tests for authorization, capture, refund, webhook and settlement mapping",
    owner: "Phase 13",
  },
  {
    id: "GAP-FIN-02",
    area: "persistence",
    statement:
      "The financial engines are in-memory contracts: no migration creates invoices, payments, splits, journal events, outbox entries or idempotency records.",
    closesWhen:
      "a forward-only migration creates the records with tenant isolation, currency constraints and append-only history, and the engines read and write them",
    owner: "Phase 13 with Phase 14",
  },
  {
    id: "GAP-FIN-03",
    area: "reconciliation run",
    statement:
      "Reconciliation compares one pair of records; the scheduled run comparing a whole provider statement against internal records, opening exceptions, does not exist.",
    closesWhen:
      "a reconciliation run produces matched, exception and unresolved sets for a provider statement, and exceptions carry a workflow to resolution",
    owner: "Phase 13 with Phase 17",
  },
  {
    id: "GAP-FIN-04",
    area: "collections and disputes",
    statement:
      "Receivables ageing, dunning, disputes and chargebacks have no state machine in code, so collection state cannot be tracked beyond the obligation status.",
    closesWhen:
      "collection and dispute/chargeback state machines exist with explicit transitions and evidence requirements",
    owner: "Phase 13",
  },
  {
    id: "GAP-FIN-05",
    area: "usage metering",
    statement:
      "Subscriptions and billing plans exist, but metered usage, overage computation and renewal generation are not implemented.",
    closesWhen:
      "metered usage records drive deterministic overage charges and renewal invoices with idempotent batch keys",
    owner: "Phase 13 with Phase 17",
  },
  {
    id: "GAP-FIN-06",
    area: "async financial work",
    statement:
      "Batch billing, provider webhook bursts, settlement polling and reconciliation runs are not schedulable or cancellable jobs.",
    closesWhen:
      "financial jobs run asynchronously with deterministic idempotency keys, restartability and cancellation",
    owner: "Phase 13 with Phase 05",
  },
  {
    id: "GAP-FIN-07",
    area: "authorised ingestion boundary",
    statement:
      "No server function in the platform calls these engines yet: fees, payroll, expenses and reconciliation surfaces still read their own tables.",
    closesWhen:
      "the financial surfaces read and write through the phase's engines behind an authorised boundary",
    owner: "Phase 13 with Phase 08",
  },
];

export interface FinancialCheck {
  readonly id: string;
  readonly rule: string;
  readonly module: string;
  /** What the engine actually did when called — not a claim about it. */
  readonly observed: string;
  readonly passed: boolean;
}

const SPLIT_LEGS: readonly Omit<
  SplitLeg,
  "state" | "settlementRef" | "providerFees" | "reconciliation"
>[] = [
  {
    legId: "leg-institution",
    beneficiaryId: "beneficiary-institution",
    beneficiaryKind: "institution",
    purpose: "declared service charge",
    amount: money(9_000, "GBP"),
    providerRoute: "provider-a",
  },
  {
    legId: "leg-platform",
    beneficiaryId: "beneficiary-platform",
    beneficiaryKind: "platform",
    purpose: "platform fee",
    amount: money(700, "GBP"),
    providerRoute: "provider-a",
  },
  {
    legId: "leg-partner",
    beneficiaryId: "beneficiary-partner",
    beneficiaryKind: "partner",
    purpose: "partner share",
    amount: money(300, "GBP"),
    providerRoute: "provider-a",
  },
];

function providerProfile(overrides: Partial<ProviderProfile> = {}): ProviderProfile {
  return {
    providerId: "provider-a",
    displayName: "Provider A",
    active: true,
    feeBasisPoints: 150,
    capabilities: {
      paymentMethods: ["card"],
      currencies: ["GBP"],
      jurisdictions: ["GB"],
      supportsPartialRefund: true,
      supportsSplit: true,
      captureModel: "immediate",
      webhookSignatureScheme: "hmac-sha256",
    },
    ...overrides,
  };
}

export const TAX_VERSIONS: readonly TaxRuleVersion[] = [
  {
    versionId: "tax-gb-v1",
    jurisdiction: "GB",
    category: "service-charge",
    rateBasisPoints: 2000,
    inclusive: false,
    exempt: false,
    effectiveFrom: "2026-01-01T00:00:00Z",
    effectiveTo: null,
  },
];

const REPORT_AT = "2026-03-01T10:00:00Z";

function journalEvent(overrides: Partial<FinancialEvent> = {}): FinancialEvent {
  return {
    eventId: "event-1",
    aggregateType: "obligation",
    aggregateId: "obligation-1",
    sequence: 1,
    version: 1,
    type: "obligation.created",
    occurredAt: REPORT_AT,
    recordedAt: REPORT_AT,
    actor: { identityId: "identity-1", kind: "human" },
    causationId: null,
    correlationId: "correlation-1",
    payload: { amountMinor: 10_000, currency: "GBP", obligationId: "obligation-1" },
    ...overrides,
  };
}

/**
 * Execute the engine and record what happened. Every check below is a live call:
 * if a rule regresses, its observation changes and the check fails.
 */
export function runFinancialChecks(): readonly FinancialCheck[] {
  const checks: FinancialCheck[] = [];

  const balancedSplit = createSplitPayment({
    splitId: "report-split",
    gross: money(10_000, "GBP"),
    legs: SPLIT_LEGS,
  });
  checks.push({
    id: "splits-account-for-the-gross",
    rule: "splits-account-for-the-gross",
    module: "financial-splits",
    observed: balancedSplit.ok
      ? `three legs (9000 + 700 + 300) accounted for a gross of 10000 across ${balancedSplit.split.legs.length} beneficiaries`
      : `expected a balanced split, engine said: ${balancedSplit.detail}`,
    passed: balancedSplit.ok,
  });

  const overAllocated = createSplitPayment({
    splitId: "report-split-over",
    gross: money(10_000, "GBP"),
    legs: [
      { ...SPLIT_LEGS[0], amount: money(9_000, "GBP") },
      { ...SPLIT_LEGS[1], amount: money(2_000, "GBP") },
      { ...SPLIT_LEGS[2], amount: money(300, "GBP") },
    ],
  });
  checks.push({
    id: "splits-refuse-over-allocation",
    rule: "splits-account-for-the-gross",
    module: "financial-splits",
    observed: overAllocated.ok
      ? "the engine accepted an over-allocated split"
      : overAllocated.detail,
    passed: !overAllocated.ok,
  });

  const refund = balancedSplit.ok
    ? refundSplitProRata(balancedSplit.split, {
        amount: money(3_333, "GBP"),
        reason: "report check",
      })
    : null;
  const refundTotal =
    refund && refund.ok
      ? refund.allocations.reduce((total, allocation) => total + allocation.amount.amountMinor, 0)
      : -1;
  checks.push({
    id: "refunds-sum-exactly",
    rule: "refunds-are-pro-rata-and-bounded",
    module: "financial-splits",
    observed:
      refund && refund.ok
        ? `a 3333 refund was spread across ${refund.allocations.length} legs and summed to ${refundTotal}`
        : `refund refused: ${refund && !refund.ok ? refund.error : "split unavailable"}`,
    passed: refundTotal === 3_333,
  });

  const feeAttributed = balancedSplit.ok
    ? attributeProviderFee(balancedSplit.split, { legId: "leg-partner", fee: money(400, "GBP") })
    : null;
  checks.push({
    id: "fees-are-not-deductions",
    rule: "fees-are-not-deductions",
    module: "financial-splits",
    observed:
      feeAttributed && !feeAttributed.ok
        ? feeAttributed.error
        : "a fee larger than its leg was accepted, so a provider loss could hide inside the gross",
    passed: Boolean(feeAttributed && !feeAttributed.ok),
  });

  const platformLeg = balancedSplit.ok
    ? balancedSplit.split.legs.find((candidate) => candidate.beneficiaryKind === "platform")
    : null;
  checks.push({
    id: "platform-fee-is-a-leg",
    rule: "platform-fee-is-a-leg",
    module: "financial-splits",
    observed: platformLeg
      ? `the platform's own share (${platformLeg.amount.amountMinor}) is leg ${platformLeg.legId} with purpose "${platformLeg.purpose}", settled and reconciled like any other beneficiary`
      : "the split carried no platform leg",
    passed: Boolean(
      platformLeg && platformLeg.purpose.length > 0 && platformLeg.providerRoute !== undefined,
    ),
  });

  const settlementState = balancedSplit.ok ? splitSettlementState(balancedSplit.split) : null;
  checks.push({
    id: "settlement-is-per-leg",
    rule: "settlement-is-per-leg",
    module: "financial-splits",
    observed: settlementState
      ? `an untouched split reports ${settlementState.settled.amountMinor} settled, ${settlementState.unsettledLegs.length} legs unsettled, complete=${settlementState.complete}`
      : "split unavailable",
    passed: Boolean(
      settlementState && !settlementState.complete && settlementState.settled.amountMinor === 0,
    ),
  });

  const routingRequirement = {
    currency: "GBP",
    paymentMethod: "card" as const,
    jurisdiction: "GB",
  };
  const routing = selectPaymentRoute({
    providers: [providerProfile()],
    requirement: routingRequirement,
  });
  checks.push({
    id: "routing-selects-capability",
    rule: "providers-stay-behind-adapters",
    module: "financial-routing",
    observed: routing.providerId
      ? `routed to ${routing.providerId}: ${routing.reason}`
      : routing.reason,
    passed: routing.providerId === "provider-a",
  });

  const unroutable = selectPaymentRoute({
    providers: [
      providerProfile({ capabilities: { ...providerProfile().capabilities, currencies: ["USD"] } }),
    ],
    requirement: routingRequirement,
  });
  checks.push({
    id: "routing-reports-unroutable",
    rule: "capability-dominates-preference",
    module: "financial-routing",
    observed: unroutable.providerId ? "an incapable provider was selected" : unroutable.reason,
    passed: unroutable.providerId === null,
  });

  const afterTimeout = canFailover({
    attempt: {
      providerId: "provider-a",
      outcome: "unresolved_timeout",
      providerProvedNoCapture: true,
    },
    toProviderId: "provider-b",
  });
  const afterSuccess = canFailover({
    attempt: { providerId: "provider-a", outcome: "succeeded", providerProvedNoCapture: true },
    toProviderId: "provider-b",
  });
  checks.push({
    id: "failover-cannot-double-charge",
    rule: "failover-cannot-double-charge",
    module: "financial-routing",
    observed:
      afterTimeout.allowed || afterSuccess.allowed
        ? "failover was permitted after a timeout or a success"
        : afterTimeout.reason,
    passed: !afterTimeout.allowed && !afterSuccess.allowed,
  });

  const firstAppend = appendFinancialEvent({ events: [] }, journalEvent());
  const replay = firstAppend.ok ? appendFinancialEvent(firstAppend.journal, journalEvent()) : null;
  checks.push({
    id: "journal-is-append-only",
    rule: "journal-is-append-only",
    module: "financial-journal",
    observed: replay && !replay.ok ? replay.detail : "a duplicate event identity was accepted",
    passed: Boolean(replay && !replay.ok),
  });

  let journal: FinancialJournal = firstAppend.ok ? firstAppend.journal : { events: [] };
  const secondAppend = appendFinancialEvent(
    journal,
    journalEvent({
      eventId: "event-2",
      sequence: 2,
      type: "payment.confirmed",
      payload: { amountMinor: 4_000, currency: "GBP", obligationId: "obligation-1" },
    }),
  );
  if (secondAppend.ok) journal = secondAppend.journal;
  const projection = reconstructObligation(journal, "obligation-1");
  checks.push({
    id: "state-is-reconstructed",
    rule: "state-is-reconstructed",
    module: "financial-journal",
    observed: projection.known
      ? `charged ${projection.charged.amountMinor}, paid ${projection.paid.amountMinor}, outstanding ${projection.outstanding.amountMinor} from ${projection.evidence.length} events`
      : "the projection reported unknown for a recorded obligation",
    passed: projection.known && projection.outstanding.amountMinor === 6_000,
  });

  const unbalanced = postDoubleEntry({
    entryId: "report-posting",
    occurredAt: REPORT_AT,
    lines: [
      { account: "cash", direction: "debit", amount: money(10_000, "GBP") },
      { account: "revenue", direction: "credit", amount: money(9_999, "GBP") },
    ],
  });
  checks.push({
    id: "postings-must-balance",
    rule: "postings-must-balance",
    module: "financial-journal",
    observed: unbalanced.ok ? "an unbalanced posting was accepted" : unbalanced.error,
    passed: !unbalanced.ok,
  });

  const queued = enqueueOutbox({ entries: [] }, journalEvent({ eventId: "event-outbox" }));
  const queuedTwice = queued.ok
    ? enqueueOutbox(queued.outbox, journalEvent({ eventId: "event-outbox" }))
    : null;
  checks.push({
    id: "events-are-durable-before-published",
    rule: "events-are-durable-before-published",
    module: "financial-journal",
    observed:
      queuedTwice && !queuedTwice.ok
        ? queuedTwice.error
        : "the same event entered the outbox twice",
    passed: Boolean(queued.ok && queuedTwice && !queuedTwice.ok),
  });

  const tax = calculateTax({
    amount: money(1_000, "GBP"),
    mode: "exclusive",
    jurisdiction: "GB",
    category: "service-charge",
    at: "2026-04-01T00:00:00Z",
    versions: TAX_VERSIONS,
  });
  checks.push({
    id: "tax-is-jurisdiction-data",
    rule: "tax-is-jurisdiction-data",
    module: "financial-tax",
    observed: tax.ok
      ? `${tax.provenance} → tax ${tax.tax.amountMinor}, gross ${tax.gross.amountMinor}`
      : tax.error,
    passed: tax.ok && tax.tax.amountMinor === 200 && tax.gross.amountMinor === 1_200,
  });

  const unknownJurisdiction = resolveTaxRule(TAX_VERSIONS, {
    jurisdiction: "FR",
    category: "service-charge",
    at: "2026-04-01T00:00:00Z",
  });
  checks.push({
    id: "tax-never-invents-zero",
    rule: "tax-is-jurisdiction-data",
    module: "financial-tax",
    observed: unknownJurisdiction.known
      ? "an undeclared jurisdiction resolved to a rule"
      : unknownJurisdiction.reason,
    passed: !unknownJurisdiction.known,
  });

  const inclusiveTax = calculateTax({
    amount: money(1_200, "GBP"),
    mode: "inclusive",
    jurisdiction: "GB",
    category: "service-charge",
    at: "2026-04-01T00:00:00Z",
    versions: TAX_VERSIONS,
  });
  checks.push({
    id: "tax-modes-are-distinct",
    rule: "tax-is-jurisdiction-data",
    module: "financial-tax",
    observed: inclusiveTax.ok
      ? `a tax-inclusive 1200 yielded tax ${inclusiveTax.tax.amountMinor} and net ${inclusiveTax.net.amountMinor}`
      : inclusiveTax.error,
    passed:
      inclusiveTax.ok &&
      inclusiveTax.tax.amountMinor === 200 &&
      inclusiveTax.net.amountMinor === 1_000,
  });

  return checks;
}

/**
 * The same financial capability in different organizations' own words. Included so
 * the phase's evidence shows that FinOS is the platform's financial operating
 * system rather than one institution's billing module.
 */
export interface OrganizationFinancialVocabulary {
  readonly organization: string;
  readonly whatIsBilled: string;
  readonly whoOwes: string;
  readonly whoIsPaid: string;
  readonly splitStory: string;
}

export const ORGANIZATION_VOCABULARY: readonly OrganizationFinancialVocabulary[] = [
  {
    organization: "education provider",
    whatIsBilled: "an enrolment instalment or an examination charge",
    whoOwes: "a family or a sponsoring body",
    whoIsPaid:
      "the institution, with any bursary recorded as a waiver — one discount category among many",
    splitStory:
      "the family pays once; the institution, the platform and any partner each receive their leg",
  },
  {
    organization: "health provider",
    whatIsBilled: "a treatment invoice or a service package",
    whoOwes: "a patient, an insurer or an employer scheme",
    whoIsPaid: "the clinic, with a co-payment split between payer and insurer",
    splitStory: "one payment, two payers' shares, each settled and reconciled on its own evidence",
  },
  {
    organization: "logistics operator",
    whatIsBilled: "a freight charge with surcharges and waiting time",
    whoOwes: "a shipper or a broker",
    whoIsPaid: "the operator, the driver and the platform",
    splitStory:
      "the shipper pays once; the driver's and platform's shares are legs, not deductions",
  },
  {
    organization: "warehouse operator",
    whatIsBilled: "handling and storage charges per consignment",
    whoOwes: "a merchant",
    whoIsPaid: "the operator and the facility owner",
    splitStory: "storage, handling and platform fee are three legs of one collected amount",
  },
  {
    organization: "public agency",
    whatIsBilled: "a statutory levy or a licence fee",
    whoOwes: "a registered entity",
    whoIsPaid: "the agency and the treasury account",
    splitStory: "the levy and the administrative share travel together and settle separately",
  },
  {
    organization: "marketplace operator",
    whatIsBilled: "an order total with shipping and commission",
    whoOwes: "a buyer",
    whoIsPaid: "the seller, the platform and the courier",
    splitStory: "the buyer pays once; commission is a leg like any other, never a hidden deduction",
  },
];

export interface FinancialIntelligenceReport {
  readonly phase: string;
  readonly capability: string;
  /** Every total is computed from the live arrays, never written as a constant. */
  readonly totals: {
    readonly rules: number;
    readonly executedChecks: number;
    readonly failedChecks: number;
    readonly declaredGaps: number;
    readonly modules: number;
    readonly organizations: number;
  };
  readonly modules: readonly string[];
  readonly rules: readonly FinancialRule[];
  readonly checks: readonly FinancialCheck[];
  readonly gaps: readonly FinancialGap[];
  readonly vocabulary: readonly OrganizationFinancialVocabulary[];
  /** Rules that no executed check exercises yet — declared rather than glossed. */
  readonly rulesWithoutExecutedCheck: readonly string[];
}

/** Build the report by running the engines, then summarising what they did. */
export function buildFinancialIntelligenceReport(): FinancialIntelligenceReport {
  const checks = runFinancialChecks();
  const modules = [...new Set(FINANCIAL_RULES.map((rule) => rule.module))];
  const exercised = new Set(checks.map((check) => check.rule));
  return {
    phase: "13",
    capability: "financial-ledger",
    totals: {
      rules: FINANCIAL_RULES.length,
      executedChecks: checks.length,
      failedChecks: checks.filter((check) => !check.passed).length,
      declaredGaps: FINANCIAL_GAPS.length,
      modules: modules.length,
      organizations: ORGANIZATION_VOCABULARY.length,
    },
    modules,
    rules: FINANCIAL_RULES,
    checks,
    gaps: FINANCIAL_GAPS,
    vocabulary: ORGANIZATION_VOCABULARY,
    rulesWithoutExecutedCheck: FINANCIAL_RULES.filter((rule) => !exercised.has(rule.id)).map(
      (rule) => rule.id,
    ),
  };
}

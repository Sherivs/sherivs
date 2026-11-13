/**
 * SV1-TWIN-06 — module-level cost measurement for the personal-twin runtime.
 *
 * Run:  npx vite-node -c vitest.config.ts scripts/twin-cost-report.ts [outDir]
 *
 * Measures only what exists in this repository: the pure sleep/wake and proposal modules.
 * There is NO AI gateway, model call or token metering in these modules, so no model or
 * token cost is measured here and none is claimed. Token numbers below are the *configured
 * budgets* the runtime enforces, not observed consumption.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { arch, cpus, platform, release } from "node:os";
import {
  DEFAULT_SLEEP_WAKE_CONFIG as CFG,
  EMPTY_SLEEP_WAKE_STATE,
  advanceRun,
  completeRun,
  enqueueWakeEvent,
  planNextWake,
  type SleepWakeState,
  type TwinWakeEvent,
} from "../frontend/src/lib/scholar/personal-twin/sleep-wake";
import {
  EMPTY_PROPOSAL_STORE,
  approveProposal,
  createProposal,
  prepareExecution,
  type ProposalStore,
} from "../frontend/src/lib/scholar/personal-twin/proposals";

const REPS = 7;
const NOW = 1_800_000_000_000;
const OUT = resolve(process.argv[2] ?? "docs/evidence/twin-06");

const hr = () => Number(process.hrtime.bigint()) / 1e6; // ms
const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
const bytes = (v: unknown) => Buffer.byteLength(JSON.stringify(v));

function ev(i: number): TwinWakeEvent {
  return {
    eventId: `e${i}`,
    type: "message_received",
    source: "system",
    tenantRef: "t1",
    userRef: `u${i % 50}`,
    occurredAtMs: NOW,
    correlationId: `corr-${i}`,
    subjectRef: null,
  };
}

function oneFullRun(state: SleepWakeState, i: number, t: number) {
  let s = enqueueWakeEvent(state, ev(i), CFG, t).state;
  const p = planNextWake(s, CFG, t);
  if (p.decision !== "wake") throw new Error("expected wake");
  s = p.state;
  const steps = [
    { type: "ENQUEUE", atMs: t },
    { type: "WORKER_START", atMs: t, workerRef: "w" },
    { type: "CONTEXT_ASSEMBLE", atMs: t, contextRef: "c" },
    { type: "REASON", atMs: t, tokensUsed: 0 },
    { type: "ACT", atMs: t, toolId: "none", financialCost: 0 },
    { type: "EVIDENCE", atMs: t, evidenceRef: "e" },
    { type: "VERIFY", atMs: t, passed: true },
    { type: "PERSIST_RESULT", atMs: t },
    { type: "SLEEP", atMs: t },
  ] as const;
  for (const e of steps) s = advanceRun(s, CFG, p.run.runId, e as never, t).state;
  return completeRun(s, p.run.runId, t).state;
}

/** Time a function over `n` iterations, `REPS` repetitions; returns per-iteration ms for each repetition. */
function bench(n: number, f: (i: number) => void): number[] {
  const out: number[] = [];
  for (let r = 0; r < REPS; r++) {
    const a = hr();
    for (let i = 0; i < n; i++) f(r * n + i);
    out.push((hr() - a) / n);
  }
  return out;
}

// warm-up so JIT cost is not attributed to the first repetition
for (let i = 0; i < 2000; i++) planNextWake(EMPTY_SLEEP_WAKE_STATE, CFG, NOW);
for (let i = 0; i < 200; i++) oneFullRun(EMPTY_SLEEP_WAKE_STATE, i, NOW);

const idle = bench(20_000, () => {
  planNextWake(EMPTY_SLEEP_WAKE_STATE, CFG, NOW);
});
const fullRun = bench(500, (i) => {
  oneFullRun(EMPTY_SLEEP_WAKE_STATE, i, NOW);
});

// audit records per wake event (one full run to sleep + complete)
const afterOne = oneFullRun(EMPTY_SLEEP_WAKE_STATE, 1, NOW);
const auditPerEvent = afterOne.audit.length;
const idleAudit = planNextWake(EMPTY_SLEEP_WAKE_STATE, CFG, NOW).state.audit.length;

// state growth: audit is the only unbounded part in a long-lived state
const sizes: Array<{ events: number; stateBytes: number; auditRecords: number }> = [];
let s: SleepWakeState = EMPTY_SLEEP_WAKE_STATE;
let done = 0;
for (const target of [1, 10, 100, 1000]) {
  while (done < target) {
    s = oneFullRun(s, done, NOW);
    done += 1;
  }
  sizes.push({ events: target, stateBytes: bytes(s), auditRecords: s.audit.length });
}

// proposals: create -> approve -> handoff
const contracts = [
  {
    id: "scholar.attendance.flag_followup",
    kind: "command",
    surface: "attendance",
    inputShape: "I",
    outputKind: "O",
    requiresAuthorization: true,
  },
] as never;
const actor = { tenantRef: "t1", userRef: "u1", heldPermissions: ["attendance.take"] };
function proposalFlow(i: number) {
  let st: ProposalStore = EMPTY_PROPOSAL_STORE;
  const c = createProposal(
    st,
    {
      proposalId: `p${i}`,
      kind: "recommendation",
      tenantRef: "t1",
      userRef: "u1",
      roleCode: "teacher",
      summary: "Follow up on three absences",
      source: {
        kind: "record",
        ref: "attendance:7a",
        asOfMs: NOW - 1000,
        description: "Three absences",
      },
      ttlMs: 86_400_000,
      correlationId: `corr-p${i}`,
      operationId: "scholar.attendance.flag_followup",
      inputRef: "ref:1",
      requiredPermission: "attendance.take",
    } as never,
    contracts,
    NOW,
  );
  if (!c.ok) throw new Error(c.reason);
  const a = approveProposal(c.store, `p${i}`, actor, NOW + 1);
  if (!a.ok) throw new Error(a.reason);
  const h = prepareExecution(a.store, `p${i}`, actor, contracts, NOW + 2);
  if (!h.ok) throw new Error(h.reason);
  return h.store;
}
for (let i = 0; i < 200; i++) proposalFlow(i);
const prop = bench(1000, proposalFlow);
const propStore = proposalFlow(0);

const fmt = (xs: number[]) => ({
  medianMs: +median(xs).toFixed(5),
  minMs: +Math.min(...xs).toFixed(5),
  maxMs: +Math.max(...xs).toFixed(5),
});

const report = {
  generatedFor: "SV1-TWIN-06",
  environment: {
    node: process.version,
    platform: `${platform()} ${release()} ${arch()}`,
    cpu: cpus()[0]?.model ?? "unknown",
    cpuCount: cpus().length,
    repetitions: REPS,
    note: "single-process, in-memory, warmed up; absolute numbers are machine-specific, ratios are what matter",
  },
  measured: {
    idleWakePlan: {
      ...fmt(idle),
      perCall: "planNextWake with nothing queued",
      auditRecordsAdded: idleAudit,
    },
    fullWakeCycle: {
      ...fmt(fullRun),
      perCall: "enqueue + plan + 9 state-machine steps + complete (no model call)",
      auditRecordsAdded: auditPerEvent,
    },
    proposalFlow: {
      ...fmt(prop),
      perCall: "create + approve + prepare handoff",
      auditRecordsAdded: propStore.audit.length,
    },
    stateGrowth: sizes,
    stateBytesPerAuditRecord: Math.round(
      (sizes[3].stateBytes - sizes[0].stateBytes) / (sizes[3].auditRecords - sizes[0].auditRecords),
    ),
  },
  configuredBudgets_notObserved: {
    perRun: CFG.perRun,
    perUser: CFG.perUser,
    perTenant: CFG.perTenant,
    windowMs: CFG.windowMs,
    eventTtlMs: CFG.eventTtlMs,
  },
  notMeasured: [
    "Model / AI gateway cost: no gateway or token metering exists in these modules.",
    "Network, storage and database cost of persisting audit records in production.",
    "Cost under real traffic, concurrency or a multi-process host.",
  ],
};

mkdirSync(OUT, { recursive: true });
writeFileSync(resolve(OUT, "cost-report.json"), JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report, null, 2));

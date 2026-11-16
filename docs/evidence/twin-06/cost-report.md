# SV1-TWIN-06 cost report (module level, local)

**Scope.** Measures only the pure twin modules in this repository. There is no AI gateway, model call or token metering in them, so **no model or token cost is measured and none is claimed**. Absolute times are for this machine only.

**Environment.** Node v22.23.4, linux 6.18.44-fc-v445 x64, Intel(R) Xeon(R) Processor @ 2.30GHz x2; 7 repetitions per case after a warm-up; median shown with min/max.

| Case | Median per call | Min | Max | Audit records added |
|---|---|---|---|---|
| Idle plan (nothing queued) | 7e-05 ms | 6e-05 | 0.00014 | 0 |
| Full wake cycle (enqueue, plan, 9 steps, complete) | 0.00871 ms | 0.00586 | 0.01997 | 12 |
| Proposal flow (create, approve, hand off) | 0.00259 ms | 0.00214 | 0.0041 | 3 |

**Idle cost.** An idle twin does no work: planning with nothing queued returns the identical state object and records nothing.

**State growth (sleep/wake state, JSON bytes).**

| Events processed | State bytes | Audit records |
|---|---|---|
| 1 | 2,112 | 12 |
| 10 | 19,505 | 120 |
| 100 | 193,548 | 1,200 |
| 1000 | 1,932,241 | 12,000 |

About 161 bytes per audit record, 12 records per completed wake. **The module imposes no cap or rotation on its audit list**, so a long-lived host must persist and trim it (finding F-1 below).

**Database side (local PG16, disposable).** 500 provisioning retry calls: average 0.279 ms per call in the recorded run (0.24–0.28 ms across runs), 500 audit rows added, 0 twin rows and 0 scope rows added (idempotent). See `db-harness-output.txt`.

**Configured budgets (enforced limits, not observed usage).** Per run: 8000 tokens, cost 0.5, 120s, 5 actions. Per user per window: 20 wakes, 50,000 tokens. Per tenant per window: 2,000 wakes, 5,000,000 tokens. Window 60 min; event TTL 15 min. These are defaults proposed in code; owners must approve real thresholds.

**Not measured.** Model / AI gateway cost: no gateway or token metering exists in these modules. Network, storage and database cost of persisting audit records in production. Cost under real traffic, concurrency or a multi-process host.

**Findings.**
- F-1 Audit growth is unbounded inside the module (about 1.9 MB per 1,000 wakes). The host must persist to the audit store and truncate in-memory state.
- F-2 Lens switches are pure derivations and emit no audit record; the host must audit them (pinned by a test so the gap is visible).
- F-3 Fixed in this PR: rejected decisions and rejected sleep/wake requests were not audited; they now are.

Reproduce: `npx vite-node -c vitest.config.ts scripts/twin-cost-report.ts docs/evidence/twin-06` (the default vite config starts the app plugins and does not terminate).

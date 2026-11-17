/**
 * SV1-TWIN-03 — event-triggered sleep/wake for personal twins.
 * Property-style tests use a fixed-seed PRNG so runs are deterministic.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  DEFAULT_SLEEP_WAKE_CONFIG,
  EMPTY_SLEEP_WAKE_STATE,
  TWIN_WAKE_EVENT_TYPES,
  advanceRun,
  completeRun,
  engageKillSwitch,
  enqueueWakeEvent,
  planNextWake,
  reapExpiredRuns,
  releaseKillSwitch,
  reportSleepWake,
  type SleepWakeConfig,
  type SleepWakeState,
  type TwinWakeEvent,
} from "../../frontend/src/lib/scholar/personal-twin/sleep-wake";

const NOW = 1_800_000_000_000;
const CFG: SleepWakeConfig = DEFAULT_SLEEP_WAKE_CONFIG;

function ev(over: Partial<TwinWakeEvent> = {}): TwinWakeEvent {
  const id = over.eventId ?? "e1";
  return {
    eventId: id,
    type: "message_received",
    source: "system",
    tenantRef: "t1",
    userRef: "u1",
    occurredAtMs: NOW,
    correlationId: `corr-${id}`,
    subjectRef: null,
    ...over,
  };
}

function queue(state: SleepWakeState, e: TwinWakeEvent, now = NOW): SleepWakeState {
  const r = enqueueWakeEvent(state, e, CFG, now);
  if (!r.ok) throw new Error(`enqueue failed: ${r.reason}`);
  return r.state;
}

function wake(state: SleepWakeState, now = NOW) {
  const p = planNextWake(state, CFG, now);
  if (p.decision !== "wake") throw new Error("expected a wake");
  return p;
}

/** Drive a woken run through a full cycle up to SLEEP. */
function runToSleep(state: SleepWakeState, runId: string, tokens = 100, t = NOW) {
  const steps = [
    { type: "ENQUEUE", atMs: t },
    { type: "WORKER_START", atMs: t, workerRef: "w1" },
    { type: "CONTEXT_ASSEMBLE", atMs: t, contextRef: "c1" },
    { type: "REASON", atMs: t, tokensUsed: tokens },
    { type: "ACT", atMs: t, toolId: "none", financialCost: 0 },
    { type: "EVIDENCE", atMs: t, evidenceRef: "ev1" },
    { type: "VERIFY", atMs: t, passed: true },
    { type: "PERSIST_RESULT", atMs: t },
    { type: "SLEEP", atMs: t },
  ] as const;
  let s = state;
  for (const step of steps) {
    const r = advanceRun(s, CFG, runId, step, t);
    if (!r.ok) throw new Error(`advance ${step.type} failed: ${r.reason}`);
    s = r.state;
  }
  return s;
}

describe("event allowlist", () => {
  it("accepts every allowlisted event type", () => {
    for (const type of TWIN_WAKE_EVENT_TYPES) {
      const r = enqueueWakeEvent(EMPTY_SLEEP_WAKE_STATE, ev({ type }), CFG, NOW);
      expect(r.ok).toBe(true);
    }
  });

  it("rejects a type that is not on the allowlist", () => {
    const r = enqueueWakeEvent(
      EMPTY_SLEEP_WAKE_STATE,
      ev({ type: "wake_up_for_fun" as never }),
      CFG,
      NOW,
    );
    expect(r).toMatchObject({ ok: false, reason: "event_type_not_allowed" });
  });

  it("rejects an event raised by a twin, so a twin cannot wake itself", () => {
    const r = enqueueWakeEvent(EMPTY_SLEEP_WAKE_STATE, ev({ source: "twin" }), CFG, NOW);
    expect(r).toMatchObject({ ok: false, reason: "twin_cannot_trigger_twin" });
  });

  it("rejects malformed events without throwing", () => {
    for (const bad of [
      ev({ eventId: "" }),
      ev({ tenantRef: " " }),
      ev({ userRef: "" }),
      ev({ correlationId: "" }),
      ev({ occurredAtMs: Number.NaN }),
      ev({ occurredAtMs: -1 }),
      null as never,
    ]) {
      const r = enqueueWakeEvent(EMPTY_SLEEP_WAKE_STATE, bad, CFG, NOW);
      expect(r).toMatchObject({ ok: false, reason: "invalid_event" });
    }
  });

  it("rejects duplicates, future-dated and already-expired events", () => {
    const s = queue(EMPTY_SLEEP_WAKE_STATE, ev());
    expect(enqueueWakeEvent(s, ev(), CFG, NOW)).toMatchObject({ reason: "duplicate_event" });
    expect(
      enqueueWakeEvent(s, ev({ eventId: "f", occurredAtMs: NOW + 60_000 }), CFG, NOW),
    ).toMatchObject({ reason: "event_from_the_future" });
    expect(
      enqueueWakeEvent(s, ev({ eventId: "o", occurredAtMs: NOW - CFG.eventTtlMs - 1 }), CFG, NOW),
    ).toMatchObject({ reason: "event_already_expired" });
  });

  it("bounds the per-user and total queue", () => {
    let s = EMPTY_SLEEP_WAKE_STATE;
    for (let i = 0; i < CFG.maxQueuePerUser; i++) s = queue(s, ev({ eventId: `q${i}` }));
    expect(enqueueWakeEvent(s, ev({ eventId: "over" }), CFG, NOW)).toMatchObject({
      reason: "user_queue_full",
    });
    const tiny = { ...CFG, maxQueueTotal: 1 };
    const one = queue(EMPTY_SLEEP_WAKE_STATE, ev());
    expect(enqueueWakeEvent(one, ev({ eventId: "x", userRef: "u2" }), tiny, NOW)).toMatchObject({
      reason: "queue_full",
    });
  });
});

describe("sleep and wake", () => {
  it("returns the identical state object when idle (zero idle cost)", () => {
    const p = planNextWake(EMPTY_SLEEP_WAKE_STATE, CFG, NOW);
    expect(p.decision).toBe("idle");
    expect(p.state).toBe(EMPTY_SLEEP_WAKE_STATE);
    expect(reportSleepWake(p.state).idle).toBe(true);
  });

  it("wakes only on a queued event, with a bound lease and a correlation id", () => {
    const s = queue(EMPTY_SLEEP_WAKE_STATE, ev());
    const p = wake(s);
    expect(p.run.runId).toBe("run:corr-e1");
    expect(p.run.lease.state).toBe("mission_bound");
    expect(p.run.lease.tenantRef).toBe("t1");
    expect(p.state.queue).toHaveLength(0);
    expect(p.state.inFlight).toHaveLength(1);
  });

  it("sleeps after the run: complete releases the slot and nothing stays alive", () => {
    const p = wake(queue(EMPTY_SLEEP_WAKE_STATE, ev()));
    const slept = runToSleep(p.state, p.run.runId);
    const done = completeRun(slept, p.run.runId, NOW);
    expect(done.ok).toBe(true);
    expect(reportSleepWake(done.state)).toMatchObject({ inFlight: 0, idle: true });
  });

  it("refuses to complete a run that is not asleep", () => {
    const p = wake(queue(EMPTY_SLEEP_WAKE_STATE, ev()));
    expect(completeRun(p.state, p.run.runId, NOW)).toMatchObject({
      ok: false,
      reason: "run_not_asleep",
    });
    expect(completeRun(p.state, "run:nope", NOW)).toMatchObject({
      ok: false,
      reason: "unknown_run",
    });
  });

  it("runs one event per user at a time and keeps the next one queued", () => {
    let s = queue(EMPTY_SLEEP_WAKE_STATE, ev({ eventId: "a" }));
    s = queue(s, ev({ eventId: "b" }));
    const first = wake(s);
    const second = planNextWake(first.state, CFG, NOW);
    expect(second.decision).toBe("idle");
    expect(second.state.queue).toHaveLength(1);
    const slept = runToSleep(first.state, first.run.runId);
    const done = completeRun(slept, first.run.runId, NOW);
    expect(wake(done.state).run.event.eventId).toBe("b");
  });

  it("lets a different user run while the first user's event is in flight", () => {
    let s = queue(EMPTY_SLEEP_WAKE_STATE, ev({ eventId: "a" }));
    s = queue(s, ev({ eventId: "b", userRef: "u2" }));
    const first = wake(s);
    const second = wake(first.state);
    expect(second.run.event.userRef).toBe("u2");
  });

  it("does not let a later event for the same user jump the queue", () => {
    let s = queue(EMPTY_SLEEP_WAKE_STATE, ev({ eventId: "a" }));
    s = queue(s, ev({ eventId: "b" }));
    s = queue(s, ev({ eventId: "c", userRef: "u2" }));
    const first = wake(s);
    const second = wake(first.state);
    expect(second.run.event.eventId).toBe("c");
    expect(second.state.queue.map((q) => q.eventId)).toEqual(["b"]);
  });

  it("drops an event that expired while queued and records it", () => {
    const s = queue(EMPTY_SLEEP_WAKE_STATE, ev());
    const later = NOW + CFG.eventTtlMs + 1;
    const p = planNextWake(s, CFG, later);
    expect(p.decision).toBe("idle");
    expect(p.state.queue).toHaveLength(0);
    expect(p.state.deadLetter[0]).toMatchObject({ reason: "event_expired" });
  });

  it("reaps a run whose lease expired without any polling loop", () => {
    const p = wake(queue(EMPTY_SLEEP_WAKE_STATE, ev()));
    const reaped = reapExpiredRuns(p.state, NOW + CFG.perRun.timeLimitMs + 1);
    expect(reaped.inFlight).toHaveLength(0);
    expect(reaped.audit.at(-1)).toMatchObject({ kind: "run_stopped", detail: "lease_expired" });
    expect(reapExpiredRuns(p.state, NOW + 1).inFlight).toHaveLength(1);
  });
});

describe("budgets", () => {
  it("stops the wake count at the per-user window limit and recovers next window", () => {
    const cfg: SleepWakeConfig = {
      ...CFG,
      perUser: { maxWakes: 2, maxTokens: 50_000 },
      // Keep the deferred event alive until the next window opens.
      eventTtlMs: CFG.windowMs * 2,
    };
    let s = EMPTY_SLEEP_WAKE_STATE;
    for (let i = 0; i < 3; i++) {
      s = enqueueWakeEvent(s, ev({ eventId: `w${i}` }), cfg, NOW).state;
    }
    for (let i = 0; i < 2; i++) {
      const p = planNextWake(s, cfg, NOW);
      expect(p.decision).toBe("wake");
      if (p.decision !== "wake") return;
      const slept = (() => {
        let x = p.state;
        const r = (e: Parameters<typeof advanceRun>[3]) => {
          const a = advanceRun(x, cfg, p.run.runId, e, NOW);
          if (!a.ok) throw new Error(a.reason);
          x = a.state;
        };
        r({ type: "ENQUEUE", atMs: NOW });
        r({ type: "WORKER_START", atMs: NOW, workerRef: "w" });
        r({ type: "CONTEXT_ASSEMBLE", atMs: NOW, contextRef: "c" });
        r({ type: "REASON", atMs: NOW, tokensUsed: 1 });
        r({ type: "ACT", atMs: NOW, toolId: "n", financialCost: 0 });
        r({ type: "EVIDENCE", atMs: NOW, evidenceRef: "e" });
        r({ type: "VERIFY", atMs: NOW, passed: true });
        r({ type: "PERSIST_RESULT", atMs: NOW });
        r({ type: "SLEEP", atMs: NOW });
        return x;
      })();
      const c = completeRun(slept, p.run.runId, NOW);
      if (!c.ok) throw new Error("complete failed");
      s = c.state;
    }
    const blocked = planNextWake(s, cfg, NOW);
    expect(blocked.decision).toBe("idle");
    expect(blocked.state.queue).toHaveLength(1);
    const nextWindow = planNextWake(s, cfg, NOW + cfg.windowMs);
    expect(nextWindow.decision).toBe("wake");
  });

  it("stops a run at once when the per-user token budget is exhausted", () => {
    const cfg: SleepWakeConfig = {
      ...CFG,
      perUser: { maxWakes: 20, maxTokens: 500 },
      perRun: { ...CFG.perRun, maxTokens: 10_000 },
    };
    const s = enqueueWakeEvent(EMPTY_SLEEP_WAKE_STATE, ev(), cfg, NOW).state;
    const p = planNextWake(s, cfg, NOW);
    if (p.decision !== "wake") throw new Error("expected wake");
    let x = p.state;
    for (const e of [
      { type: "ENQUEUE", atMs: NOW },
      { type: "WORKER_START", atMs: NOW, workerRef: "w" },
      { type: "CONTEXT_ASSEMBLE", atMs: NOW, contextRef: "c" },
    ] as const) {
      const a = advanceRun(x, cfg, p.run.runId, e, NOW);
      if (!a.ok) throw new Error(a.reason);
      x = a.state;
    }
    const over = advanceRun(
      x,
      cfg,
      p.run.runId,
      { type: "REASON", atMs: NOW, tokensUsed: 501 },
      NOW,
    );
    expect(over).toMatchObject({ ok: false, stopped: true });
    expect(over.state.inFlight).toHaveLength(0);
    // The ceiling given to the lease never exceeds what the user has left.
    expect(p.run.lease.budget.maxTokens).toBe(500);
  });

  it("stops a run at once when its own lease token cap is exceeded", () => {
    const p = wake(queue(EMPTY_SLEEP_WAKE_STATE, ev()));
    let x = p.state;
    for (const e of [
      { type: "ENQUEUE", atMs: NOW },
      { type: "WORKER_START", atMs: NOW, workerRef: "w" },
      { type: "CONTEXT_ASSEMBLE", atMs: NOW, contextRef: "c" },
    ] as const) {
      const a = advanceRun(x, CFG, p.run.runId, e, NOW);
      if (!a.ok) throw new Error(a.reason);
      x = a.state;
    }
    const over = advanceRun(
      x,
      CFG,
      p.run.runId,
      { type: "REASON", atMs: NOW, tokensUsed: CFG.perRun.maxTokens + 1 },
      NOW,
    );
    expect(over).toMatchObject({ ok: false, stopped: true, reason: "budget_exhausted" });
    expect(over.state.inFlight).toHaveLength(0);
  });

  it("charges tokens to the tenant bucket shared by every user", () => {
    const cfg: SleepWakeConfig = {
      ...CFG,
      perTenant: { maxWakes: 2_000, maxTokens: 150 },
    };
    let s = enqueueWakeEvent(EMPTY_SLEEP_WAKE_STATE, ev({ eventId: "a" }), cfg, NOW).state;
    s = enqueueWakeEvent(s, ev({ eventId: "b", userRef: "u2" }), cfg, NOW).state;
    const a = planNextWake(s, cfg, NOW);
    const b = planNextWake(a.state, cfg, NOW);
    if (a.decision !== "wake" || b.decision !== "wake") throw new Error("expected two wakes");
    // Both runs were handed a ceiling no larger than the tenant has left.
    expect(a.run.lease.budget.maxTokens).toBeLessThanOrEqual(150);
    let x = b.state;
    for (const run of [a.run, b.run]) {
      for (const e of [
        { type: "ENQUEUE", atMs: NOW },
        { type: "WORKER_START", atMs: NOW, workerRef: "w" },
        { type: "CONTEXT_ASSEMBLE", atMs: NOW, contextRef: "c" },
      ] as const) {
        const r = advanceRun(x, cfg, run.runId, e, NOW);
        if (!r.ok) throw new Error(r.reason);
        x = r.state;
      }
    }
    const first = advanceRun(
      x,
      cfg,
      a.run.runId,
      { type: "REASON", atMs: NOW, tokensUsed: 100 },
      NOW,
    );
    expect(first.ok).toBe(true);
    const second = advanceRun(
      first.state,
      cfg,
      b.run.runId,
      { type: "REASON", atMs: NOW, tokensUsed: 100 },
      NOW,
    );
    expect(second).toMatchObject({ ok: false, stopped: true, reason: "budget_exhausted" });
  });

  it("does not wake an event for a user with no tokens left in the window", () => {
    const cfg: SleepWakeConfig = { ...CFG, perUser: { maxWakes: 20, maxTokens: 10 } };
    let s = enqueueWakeEvent(EMPTY_SLEEP_WAKE_STATE, ev({ eventId: "a" }), cfg, NOW).state;
    const a = planNextWake(s, cfg, NOW);
    if (a.decision !== "wake") throw new Error("expected wake");
    let x = a.state;
    for (const e of [
      { type: "ENQUEUE", atMs: NOW },
      { type: "WORKER_START", atMs: NOW, workerRef: "w" },
      { type: "CONTEXT_ASSEMBLE", atMs: NOW, contextRef: "c" },
      { type: "REASON", atMs: NOW, tokensUsed: 10 },
      { type: "ACT", atMs: NOW, toolId: "n", financialCost: 0 },
      { type: "EVIDENCE", atMs: NOW, evidenceRef: "e" },
      { type: "VERIFY", atMs: NOW, passed: true },
      { type: "PERSIST_RESULT", atMs: NOW },
      { type: "SLEEP", atMs: NOW },
    ] as const) {
      const r = advanceRun(x, cfg, a.run.runId, e, NOW);
      if (!r.ok) throw new Error(r.reason);
      x = r.state;
    }
    x = completeRun(x, a.run.runId, NOW).state;
    s = enqueueWakeEvent(x, ev({ eventId: "b" }), cfg, NOW).state;
    expect(planNextWake(s, cfg, NOW).decision).toBe("idle");
  });
});

describe("kill switch", () => {
  it("stops an in-flight run and drops queued events in the same call", () => {
    let s = queue(EMPTY_SLEEP_WAKE_STATE, ev({ eventId: "a" }));
    s = queue(s, ev({ eventId: "b" }));
    const p = wake(s);
    const k = engageKillSwitch(
      p.state,
      { scope: "user", tenantRef: "t1", userRef: "u1", actor: "sheriff:1", reason: "incident" },
      NOW,
    );
    expect(k.ok).toBe(true);
    expect(k.state.inFlight).toHaveLength(0);
    expect(k.state.queue).toHaveLength(0);
    expect(k.state.deadLetter.map((d) => d.reason)).toEqual(["kill_switch"]);
  });

  it("blocks new events and new wakes while engaged, and stops advance calls", () => {
    const p = wake(queue(EMPTY_SLEEP_WAKE_STATE, ev()));
    const k = engageKillSwitch(
      p.state,
      { scope: "tenant", tenantRef: "t1", actor: "sheriff:1", reason: "incident" },
      NOW,
    );
    expect(enqueueWakeEvent(k.state, ev({ eventId: "z" }), CFG, NOW)).toMatchObject({
      reason: "kill_switch_engaged",
    });
    // A run created before the switch can no longer advance.
    const stale = advanceRun(p.state, CFG, p.run.runId, { type: "ENQUEUE", atMs: NOW }, NOW);
    expect(stale.ok).toBe(true);
    const withSwitch = { ...stale.state, killSwitches: k.state.killSwitches };
    const after = advanceRun(
      withSwitch,
      CFG,
      p.run.runId,
      { type: "WORKER_START", atMs: NOW, workerRef: "w" },
      NOW,
    );
    expect(after).toMatchObject({ ok: false, stopped: true, reason: "operator_stop" });
  });

  it("scopes tenant and user switches: other tenants and users keep working", () => {
    const k = engageKillSwitch(
      EMPTY_SLEEP_WAKE_STATE,
      { scope: "tenant", tenantRef: "t1", actor: "a", reason: "r" },
      NOW,
    );
    expect(enqueueWakeEvent(k.state, ev({ tenantRef: "t2" }), CFG, NOW).ok).toBe(true);
    const ku = engageKillSwitch(
      EMPTY_SLEEP_WAKE_STATE,
      { scope: "user", tenantRef: "t1", userRef: "u1", actor: "a", reason: "r" },
      NOW,
    );
    expect(enqueueWakeEvent(ku.state, ev({ userRef: "u2" }), CFG, NOW).ok).toBe(true);
    expect(enqueueWakeEvent(ku.state, ev(), CFG, NOW).ok).toBe(false);
  });

  it("global switch blocks everyone, and release restores service", () => {
    const k = engageKillSwitch(
      EMPTY_SLEEP_WAKE_STATE,
      { scope: "global", actor: "owner", reason: "freeze" },
      NOW,
    );
    expect(enqueueWakeEvent(k.state, ev(), CFG, NOW).ok).toBe(false);
    const r = releaseKillSwitch(k.state, { scope: "global", actor: "owner" }, NOW);
    expect(r.ok).toBe(true);
    expect(enqueueWakeEvent(r.state, ev(), CFG, NOW).ok).toBe(true);
  });

  it("requires an actor and a reason, and a real switch to release", () => {
    expect(
      engageKillSwitch(EMPTY_SLEEP_WAKE_STATE, { scope: "global", actor: "", reason: "r" }, NOW),
    ).toMatchObject({ ok: false });
    expect(
      engageKillSwitch(EMPTY_SLEEP_WAKE_STATE, { scope: "global", actor: "a", reason: " " }, NOW),
    ).toMatchObject({ ok: false });
    expect(
      engageKillSwitch(EMPTY_SLEEP_WAKE_STATE, { scope: "tenant", actor: "a", reason: "r" }, NOW),
    ).toMatchObject({ ok: false });
    expect(
      releaseKillSwitch(EMPTY_SLEEP_WAKE_STATE, { scope: "global", actor: "a" }, NOW),
    ).toMatchObject({ ok: false });
  });
});

describe("audit", () => {
  it("carries the correlation id from queue to stop, with increasing sequence numbers", () => {
    const p = wake(queue(EMPTY_SLEEP_WAKE_STATE, ev()));
    const slept = runToSleep(p.state, p.run.runId);
    const done = completeRun(slept, p.run.runId, NOW).state;
    const mine = done.audit.filter((a) => a.correlationId === "corr-e1");
    expect(mine[0].kind).toBe("event_queued");
    expect(mine[1].kind).toBe("wake_started");
    expect(mine.at(-1)?.kind).toBe("run_slept");
    const seqs = done.audit.map((a) => a.seq);
    expect(seqs).toEqual([...seqs].sort((x, y) => x - y));
    expect(new Set(seqs).size).toBe(seqs.length);
  });

  it("records rejected events too", () => {
    const r = enqueueWakeEvent(EMPTY_SLEEP_WAKE_STATE, ev({ source: "twin" }), CFG, NOW);
    expect(r.state.audit.at(-1)).toMatchObject({
      kind: "event_rejected",
      detail: "twin_cannot_trigger_twin",
      correlationId: "corr-e1",
    });
  });

  it("never mutates the state it was given", () => {
    const before = JSON.stringify(EMPTY_SLEEP_WAKE_STATE);
    const s = queue(EMPTY_SLEEP_WAKE_STATE, ev());
    wake(s);
    expect(JSON.stringify(EMPTY_SLEEP_WAKE_STATE)).toBe(before);
    expect(Object.isFrozen(EMPTY_SLEEP_WAKE_STATE)).toBe(true);
  });
});

describe("property: invariants hold under random event streams", () => {
  function rng(seed: number) {
    let s = seed >>> 0;
    return () => {
      s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
      return s / 0x100000000;
    };
  }

  it("never exceeds concurrency, never wakes during a kill switch, never leaves a run alive after completion", () => {
    const r = rng(20261113);
    const cfg: SleepWakeConfig = {
      ...CFG,
      perUser: { maxWakes: 6, maxTokens: 2_000 },
      perTenant: { maxWakes: 20, maxTokens: 6_000 },
    };
    let s = EMPTY_SLEEP_WAKE_STATE;
    let now = NOW;
    let killed = false;
    let n = 0;
    for (let i = 0; i < 1500; i++) {
      now += Math.floor(r() * 20_000);
      const roll = r();
      if (roll < 0.5) {
        const e = ev({
          eventId: `p${n++}`,
          tenantRef: r() < 0.5 ? "t1" : "t2",
          userRef: `u${Math.floor(r() * 3)}`,
          occurredAtMs: now,
          type: TWIN_WAKE_EVENT_TYPES[Math.floor(r() * TWIN_WAKE_EVENT_TYPES.length)],
        });
        s = enqueueWakeEvent(s, e, cfg, now).state;
      } else if (roll < 0.85) {
        const p = planNextWake(s, cfg, now);
        s = p.state;
        if (p.decision === "wake") {
          expect(killed && s.killSwitches.some((k) => k.scope === "global")).toBe(false);
          const t = Math.floor(r() * 900);
          const adv = (e: Parameters<typeof advanceRun>[3]) => {
            const a = advanceRun(s, cfg, p.run.runId, e, now);
            s = a.state;
            return a.ok;
          };
          const ok =
            adv({ type: "ENQUEUE", atMs: now }) &&
            adv({ type: "WORKER_START", atMs: now, workerRef: "w" }) &&
            adv({ type: "CONTEXT_ASSEMBLE", atMs: now, contextRef: "c" }) &&
            adv({ type: "REASON", atMs: now, tokensUsed: t }) &&
            adv({ type: "ACT", atMs: now, toolId: "n", financialCost: 0 }) &&
            adv({ type: "EVIDENCE", atMs: now, evidenceRef: "e" }) &&
            adv({ type: "VERIFY", atMs: now, passed: true }) &&
            adv({ type: "PERSIST_RESULT", atMs: now }) &&
            adv({ type: "SLEEP", atMs: now });
          if (ok) {
            const c = completeRun(s, p.run.runId, now);
            expect(c.ok).toBe(true);
            s = c.state;
          } else {
            expect(s.inFlight.some((x) => x.runId === p.run.runId)).toBe(false);
          }
        }
      } else if (roll < 0.9 && !killed) {
        s = engageKillSwitch(s, { scope: "global", actor: "p", reason: "p" }, now).state;
        killed = true;
        expect(s.inFlight).toHaveLength(0);
        expect(s.queue).toHaveLength(0);
      } else if (roll < 0.95 && killed) {
        s = releaseKillSwitch(s, { scope: "global", actor: "p" }, now).state;
        killed = false;
      }
      // Invariants after every step.
      const perUser = new Map<string, number>();
      for (const run of s.inFlight) {
        const k = `${run.tenantRef}/${run.userRef}`;
        perUser.set(k, (perUser.get(k) ?? 0) + 1);
      }
      for (const count of perUser.values()) {
        expect(count).toBeLessThanOrEqual(cfg.maxConcurrentRunsPerUser);
      }
      if (killed) expect(s.inFlight).toHaveLength(0);
    }
    // Everything that ran was audited with a correlation id.
    for (const rec of s.audit) {
      if (rec.kind === "wake_started" || rec.kind === "run_progress") {
        expect(rec.correlationId).toBeTruthy();
      }
    }
  });
});

describe("no always-on loop (source check)", () => {
  const src = readFileSync(
    resolve(__dirname, "../../frontend/src/lib/scholar/personal-twin/sleep-wake.ts"),
    "utf8",
  )
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "");

  it("uses no timers, intervals, loops-forever, event emitters or network", () => {
    for (const banned of [
      /\bsetInterval\b/,
      /\bsetTimeout\b/,
      /\bsetImmediate\b/,
      /\brequestAnimationFrame\b/,
      /while\s*\(\s*true\s*\)/,
      /for\s*\(\s*;\s*;\s*\)/,
      /\bDate\.now\b/,
      /\bnew Date\b/,
      /\bfetch\s*\(/,
      /\bprocess\./,
      /\bMath\.random\b/,
    ]) {
      expect(src).not.toMatch(banned);
    }
  });

  it("imports only the agent-core id helper and the ephemeral lifecycle", () => {
    const imports = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    expect(imports.sort()).toEqual(["@/lib/agent-core", "@/lib/agent-runtime/ephemeral-lifecycle"]);
  });
});

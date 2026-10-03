/**
 * CoreGrid Mobile V1-010 — offline/reconnection controller tests.
 *
 * Validates the pure connectivity state machine (Phase 22 §M/§N/§AF):
 * honest state reporting, exponential backoff with cap, manual retry,
 * subscriber notification, and stop() cancellation. No fabricated
 * connectivity, no fabricated data path.
 */
import { describe, expect, it } from "vitest";
import {
  createConnectivityController,
  DEFAULT_BASE_BACKOFF_MS,
  DEFAULT_MAX_BACKOFF_MS,
} from "../../mobile/src/lib/offline/connectivity";

type ScheduledCall = { fn: () => void; delayMs: number; cancel: () => void };

function harness(initialProbe: boolean) {
  let probeResult = initialProbe;
  const probeCalls: number[] = [];
  const scheduled: ScheduledCall[] = [];

  const controller = createConnectivityController({
    probe: async () => {
      probeCalls.push(probeCalls.length + 1);
      return probeResult;
    },
    schedule: (fn, delayMs) => {
      const call: ScheduledCall = { fn, delayMs, cancel: () => {} };
      scheduled.push(call);
      return () => {};
    },
  });

  return {
    controller,
    scheduled,
    probeCalls,
    setProbe(next: boolean) {
      probeResult = next;
    },
  };
}

describe("mobile connectivity controller", () => {
  it("reports online immediately on a successful startup probe", async () => {
    const h = harness(true);
    h.controller.start();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.controller.get().state).toBe("online");
    expect(h.controller.get().attempt).toBe(0);
    expect(h.controller.get().nextProbeInMs).toBeNull();
    h.controller.stop();
  });

  it("enters the reconnecting state with exponential backoff on failure", async () => {
    const h = harness(false);
    h.controller.start();
    await Promise.resolve();
    await Promise.resolve();

    // First failure schedules attempt 1 with the base backoff.
    expect(h.controller.get().state).toBe("reconnecting");
    expect(h.controller.get().attempt).toBe(1);
    expect(h.scheduled[0]?.delayMs).toBe(DEFAULT_BASE_BACKOFF_MS);

    // Each subsequent failing probe doubles the delay, capped at maxBackoffMs.
    h.scheduled[0]?.fn();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.controller.get().attempt).toBe(2);
    expect(h.scheduled[1]?.delayMs).toBe(DEFAULT_BASE_BACKOFF_MS * 2);

    for (let i = 0; i < 10; i += 1) {
      h.scheduled[h.scheduled.length - 1]?.fn();
      await Promise.resolve();
      await Promise.resolve();
    }
    expect(h.controller.get().nextProbeInMs).toBe(DEFAULT_MAX_BACKOFF_MS);
    h.controller.stop();
  });

  it("returns to online with a reset attempt counter on recovery", async () => {
    const h = harness(false);
    h.controller.start();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.controller.get().state).toBe("reconnecting");

    h.setProbe(true);
    h.scheduled[0]?.fn();
    await Promise.resolve();
    await Promise.resolve();
    const snapshot = h.controller.get();
    expect(snapshot.state).toBe("online");
    expect(snapshot.attempt).toBe(0);
    expect(snapshot.nextProbeInMs).toBeNull();
    h.controller.stop();
  });

  it("manual retry probes immediately without waiting for the backoff timer", async () => {
    const h = harness(false);
    h.controller.start();
    await Promise.resolve();
    await Promise.resolve();
    const probesBefore = h.probeCalls.length;

    h.setProbe(true);
    h.controller.retry();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.probeCalls.length).toBe(probesBefore + 1);
    expect(h.controller.get().state).toBe("online");
    h.controller.stop();
  });

  it("notifies subscribers exactly on state changes", async () => {
    const h = harness(false);
    const seen: string[] = [];
    h.controller.subscribe((snapshot) => seen.push(snapshot.state));
    h.controller.start();
    await Promise.resolve();
    await Promise.resolve();

    h.setProbe(true);
    h.scheduled[0]?.fn();
    await Promise.resolve();
    await Promise.resolve();

    // reconnecting (on first failure) then online (on recovery)
    expect(seen).toEqual(["reconnecting", "online"]);
    h.controller.stop();
  });

  it("stop() cancels pending probes and a restarted controller probes afresh", async () => {
    const h = harness(false);
    h.controller.start();
    await Promise.resolve();
    await Promise.resolve();
    h.controller.stop();

    const scheduledBefore = h.scheduled.length;
    h.scheduled[h.scheduled.length - 1]?.fn();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.scheduled.length).toBe(scheduledBefore);

    h.controller.start();
    await Promise.resolve();
    await Promise.resolve();
    expect(h.controller.get().state).toBe("reconnecting");
    h.controller.stop();
  });
});
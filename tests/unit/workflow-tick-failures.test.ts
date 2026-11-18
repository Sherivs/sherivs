import { afterEach, describe, expect, it, vi } from "vitest";

const telemetry = vi.hoisted(() => ({
  tickSpan: {
    setAttribute: vi.fn(),
    setStatus: vi.fn(),
    end: vi.fn(),
  },
  childSpan: {
    setAttribute: vi.fn(),
    setStatus: vi.fn(),
    end: vi.fn(),
  },
  counterAdd: vi.fn(),
}));

vi.mock("@opentelemetry/api", () => ({
  SpanStatusCode: { ERROR: 2 },
  metrics: {
    getMeter: () => ({
      createCounter: () => ({ add: telemetry.counterAdd }),
    }),
  },
  trace: {
    getTracer: () => ({
      startActiveSpan: (_name: string, callback: (span: typeof telemetry.tickSpan) => unknown) =>
        callback(telemetry.tickSpan),
      startSpan: () => telemetry.childSpan,
    }),
  },
}));

import { InMemoryWorkflowRuntimePort, runWorkflowTick } from "@/lib/workflow/workflow-runtime";

describe("workflow tick failure telemetry", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("marks a failed claim as an error and increments the tick failure counter", async () => {
    const port = new InMemoryWorkflowRuntimePort();
    vi.spyOn(port, "claimDueEvents").mockRejectedValue(new Error("database unavailable"));

    await runWorkflowTick(port, { worker: "failure-test" });

    expect(telemetry.tickSpan.setStatus).toHaveBeenCalledWith({ code: 2 });
    expect(telemetry.counterAdd).toHaveBeenCalledWith(1);
  });

  it("counts a retry result as a tick failure", async () => {
    const port = new InMemoryWorkflowRuntimePort();
    port.events.push({
      id: "event-retry",
      orgId: "org-retry",
      leaseOwner: "worker-retry",
      eventType: "workflow.requested",
      dedupeKey: "event-retry-key",
      depth: 0,
      attempts: 1,
      payload: {},
    });
    vi.spyOn(port, "dispatchEvent").mockResolvedValue("retried");

    await runWorkflowTick(port, { worker: "retry-test" });

    expect(telemetry.tickSpan.setStatus).toHaveBeenCalledWith({ code: 2 });
    expect(telemetry.counterAdd).toHaveBeenCalledWith(1);
  });
});

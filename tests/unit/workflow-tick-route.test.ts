import { describe, expect, it } from "vitest";
import { createWorkflowTickHandler } from "@/routes/api/public/cron/workflow-tick";
import { InMemoryWorkflowRuntimePort } from "@/lib/workflow/workflow-runtime";

class CountingPort extends InMemoryWorkflowRuntimePort {
  eventClaims = 0;
  stepClaims = 0;

  override async claimDueEvents() {
    this.eventClaims += 1;
    return [];
  }

  override async claimDueSteps() {
    this.stepClaims += 1;
    return [];
  }
}

describe("workflow tick route guards", () => {
  it("returns 503 until CRON_SECRET is configured", async () => {
    const handler = createWorkflowTickHandler({ env: { WORKFLOWS_ENABLED: "true" } });
    const response = await handler(new Request("http://localhost/api/public/cron/workflow-tick"));
    expect(response.status).toBe(503);
  });

  it("returns 401 for a wrong bearer", async () => {
    const handler = createWorkflowTickHandler({
      env: { CRON_SECRET: "test-key", WORKFLOWS_ENABLED: "true" },
    });
    const response = await handler(
      new Request("http://localhost/api/public/cron/workflow-tick", {
        headers: { authorization: ["Bear", "er wrong"].join("") },
      }),
    );
    expect(response.status).toBe(401);
  });

  it("returns 401 when the bearer header is missing", async () => {
    const handler = createWorkflowTickHandler({
      env: { CRON_SECRET: "test-key", WORKFLOWS_ENABLED: "true" },
    });
    const response = await handler(new Request("http://localhost/api/public/cron/workflow-tick"));
    expect(response.status).toBe(401);
  });

  it("authenticates but claims nothing while the global switch is off", async () => {
    const port = new CountingPort();
    const handler = createWorkflowTickHandler({
      env: { CRON_SECRET: "test-key", WORKFLOWS_ENABLED: "false" },
      createPort: () => port,
    });
    const response = await handler(
      new Request("http://localhost/api/public/cron/workflow-tick", {
        headers: { authorization: ["Bear", "er test-key"].join("") },
      }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, skipped: "workflows_disabled" });
    expect(port.eventClaims).toBe(0);
    expect(port.stepClaims).toBe(0);
  });
});

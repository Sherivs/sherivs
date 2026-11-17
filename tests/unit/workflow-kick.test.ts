import { describe, expect, it, vi } from "vitest";
import { createWorkflowTickHandler } from "@/routes/api/public/cron/workflow-tick";
import { kickWorkflowTick } from "@/lib/workflow/workflow-kick.server";

describe("workflow tick kick", () => {
  it("sends a bearer accepted by the workflow tick handler", async () => {
    let response: Response | undefined;
    const handler = createWorkflowTickHandler({
      env: { CRON_SECRET: "kick-test-secret", WORKFLOWS_ENABLED: "false" },
    });

    kickWorkflowTick(
      {
        WORKFLOWS_ENABLED: "true",
        WORKFLOW_TICK_URL: "https://workflow.example.test/api/public/cron/workflow-tick",
        CRON_SECRET: "kick-test-secret",
      },
      async (input, init) => {
        response = await handler(new Request(input, { ...init, headers: init?.headers }));
        return response!;
      },
    );

    await vi.waitFor(() => expect(response?.status).toBe(200));
  });

  it("does not call an HTTP tick URL", () => {
    let calls = 0;
    kickWorkflowTick(
      {
        WORKFLOWS_ENABLED: "true",
        WORKFLOW_TICK_URL: "http://workflow.example.test/api/public/cron/workflow-tick",
        CRON_SECRET: "kick-test-secret",
      },
      async () => {
        calls += 1;
        return new Response(null, { status: 200 });
      },
    );
    expect(calls).toBe(0);
  });
});

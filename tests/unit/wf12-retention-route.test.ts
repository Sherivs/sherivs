import { describe, expect, it } from "vitest";
import { createWorkflowRetentionHandler } from "@/routes/api/public/cron/workflow-retention";

const url = "http://localhost/api/public/cron/workflow-retention";
const auth = (secret: string) => ({ headers: { authorization: `Bearer ${secret}` } });

describe("workflow retention route guards", () => {
  it("returns 503 until CRON_SECRET is configured", async () => {
    const handler = createWorkflowRetentionHandler({ env: { WORKFLOWS_ENABLED: "true" } });
    expect((await handler(new Request(url))).status).toBe(503);
  });

  it("returns 401 for a missing or wrong bearer and runs nothing", async () => {
    let ran = 0;
    const handler = createWorkflowRetentionHandler({
      env: { CRON_SECRET: "test-key", WORKFLOWS_ENABLED: "true" },
      runScheduled: async () => {
        ran += 1;
        return { orgs: [] };
      },
    });
    expect((await handler(new Request(url))).status).toBe(401);
    expect((await handler(new Request(url, auth("wrong")))).status).toBe(401);
    expect(ran).toBe(0);
  });

  it("does nothing while WORKFLOWS_ENABLED is not true", async () => {
    let ran = 0;
    const handler = createWorkflowRetentionHandler({
      env: { CRON_SECRET: "test-key" },
      runScheduled: async () => {
        ran += 1;
        return { orgs: [] };
      },
    });
    const response = await handler(new Request(url, auth("test-key")));
    expect(await response.json()).toEqual({ ok: true, skipped: "workflows_disabled" });
    expect(ran).toBe(0);
  });

  it("returns counts only, never organisation ids", async () => {
    const handler = createWorkflowRetentionHandler({
      env: { CRON_SECRET: "test-key", WORKFLOWS_ENABLED: "true" },
      runScheduled: async (max) => {
        expect(max).toBe(20);
        return {
          orgs: [
            { org_id: "f1200000-0000-4000-8000-000000000001", outcome: "completed" },
            { org_id: "f1200000-0000-4000-8000-000000000002", outcome: "refused" },
            { org_id: "f1200000-0000-4000-8000-000000000003", outcome: "failed" },
          ],
        };
      },
    });
    const body = await (await handler(new Request(url, auth("test-key")))).json();
    expect(body).toEqual({ ok: true, organisations: 3, refused: 1, failed: 1 });
  });

  it("returns a generic 500 without detail when the database call fails", async () => {
    const handler = createWorkflowRetentionHandler({
      env: { CRON_SECRET: "test-key", WORKFLOWS_ENABLED: "true" },
      runScheduled: async () => {
        throw new Error("password authentication failed for user postgres");
      },
    });
    const response = await handler(new Request(url, auth("test-key")));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain("password");
  });
});

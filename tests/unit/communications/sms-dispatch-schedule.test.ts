/**
 * Sherivs — SMS dispatch scheduler export posture (COMMS-03).
 *
 * The scheduler configuration is PREPARED, never ACTIVE: the n8n export ships inactive with
 * only a credential NAME, and no `vercel.json` registers a Vercel Cron for the dispatcher
 * (a committed cron entry would start sending on the next production deploy).
 */
import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const ROOT = new URL("../../../", import.meta.url);
const EXPORT = new URL("automation/n8n/sherivs-sms-dispatch-tick.json", ROOT);

type Node = {
  name: string;
  type: string;
  parameters: Record<string, unknown>;
  credentials?: Record<string, Record<string, unknown>>;
};
const workflow = JSON.parse(readFileSync(EXPORT, "utf8")) as {
  active: boolean;
  nodes: Node[];
  pinData?: unknown;
  id?: unknown;
};
const node = (name: string): Node => {
  const found = workflow.nodes.find((entry) => entry.name === name);
  if (!found) throw new Error(`Missing n8n node: ${name}`);
  return found;
};

describe("SMS dispatch scheduler export", () => {
  it("is inactive and carries no instance data", () => {
    expect(workflow.active).toBe(false);
    expect(workflow.pinData).toBeUndefined();
    expect(workflow.id).toBeUndefined();
  });

  it("calls the protected dispatcher every minute with the shared named credential only", () => {
    expect(node("Every minute").parameters.rule).toMatchObject({
      interval: [{ field: "minutes", minutesInterval: 1 }],
    });
    const request = node("Dispatch queued SMS");
    expect(request.parameters.method).toBe("GET");
    expect(request.parameters.url).toBe("https://www.sherivs.com/api/public/cron/sms-dispatch");
    expect(request.parameters.genericAuthType).toBe("httpHeaderAuth");
    expect(request.credentials?.httpHeaderAuth).toEqual({ name: "Sherivs CRON Authorization" });
  });

  it("is not wired into a committed Vercel Cron (that would activate on deploy)", () => {
    for (const file of ["vercel.json", "frontend/vercel.json"]) {
      const url = new URL(file, ROOT);
      if (!existsSync(url)) continue;
      expect(readFileSync(url, "utf8")).not.toContain("sms-dispatch");
    }
  });
});

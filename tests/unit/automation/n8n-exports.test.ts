import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

type N8nNode = {
  id?: string;
  name: string;
  type: string;
  parameters: Record<string, unknown>;
  credentials?: Record<string, Record<string, unknown>>;
};

type N8nWorkflow = {
  active: boolean;
  nodes: N8nNode[];
  connections: Record<string, unknown>;
  pinData?: unknown;
};

const exportsDirectory = new URL("../../../automation/n8n/", import.meta.url);
const exportFiles = readdirSync(exportsDirectory).filter((file) => file.endsWith(".json"));
const workflows = new Map(
  exportFiles.map((file) => [
    file,
    JSON.parse(readFileSync(new URL(file, exportsDirectory), "utf8")) as N8nWorkflow,
  ]),
);

function findNode(workflow: N8nWorkflow, name: string) {
  const node = workflow.nodes.find((entry) => entry.name === name);
  if (!node) throw new Error(`Missing n8n node: ${name}`);
  return node;
}

describe("n8n workflow exports", () => {
  it("loads every export inactive without embedded credentials or instance data", () => {
    expect(exportFiles.length).toBeGreaterThan(0);
    for (const [file, workflow] of workflows) {
      expect(workflow.active, file).toBe(false);
      expect(workflow.pinData, file).toBeUndefined();
      expect((workflow as unknown as Record<string, unknown>).id, file).toBeUndefined();
      for (const node of workflow.nodes) {
        expect(node.parameters).toBeDefined();
        if (node.type === "n8n-nodes-base.webhook") {
          expect(node.parameters.webhookId).toBeUndefined();
        }
        for (const credential of Object.values(node.credentials ?? {})) {
          expect(credential).not.toHaveProperty("id");
          expect(credential).not.toHaveProperty("data");
        }
      }
    }
  });

  it("contains no secret-looking literals or assigned secret values", () => {
    const text = [...workflows]
      .map(([file, workflow]) => `${file}\n${JSON.stringify(workflow)}`)
      .join("\n");
    const secretPatterns = [
      /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/,
      /\bsk_(?:live|test)_[A-Za-z0-9]{12,}/,
      /\bEAA[A-Za-z0-9]{20,}/,
      /\b(?:ghp_|github_pat_)[A-Za-z0-9_]{20,}/,
      /\bsb_(?:publishable|secret)_[A-Za-z0-9_-]{20,}/,
      /\bBearer\s+[A-Za-z0-9._~+/-]{12,}/i,
      /(?<![A-Za-z0-9])(?:[A-Fa-f0-9]{32,}|[A-Za-z0-9+/]{40,}={0,2})(?![A-Za-z0-9])/,
      /(?:N8N_WHATSAPP_SIGNING_SECRET|CRON_SECRET)\s*[:=]\s*(['"])[^'"]{8,}\1/,
    ];
    for (const pattern of secretPatterns) expect(text).not.toMatch(pattern);
  });

  it("verifies inbound timestamps, raw-body HMAC, and event type before accepting", () => {
    const workflow = workflows.get("sherivs-wa-inbound-handler.json");
    if (!workflow) throw new Error("Missing inbound handler export");
    const webhook = findNode(workflow, "Inbound webhook");
    expect(webhook.parameters.httpMethod).toBe("POST");
    expect(webhook.parameters.options).toMatchObject({ rawBody: true });

    const verification = findNode(workflow, "Verify signature and inbound shape");
    const code = verification.parameters.jsCode as string;
    expect(code).toContain("x-sherivs-timestamp");
    expect(code).toContain("x-sherivs-signature");
    expect(code).toContain("> 300");
    expect(code).toContain("crypto.timingSafeEqual");
    expect(code).toContain("event.event_type !== 'whatsapp.inbound'");
    expect(code).toContain("N8N_WHATSAPP_SIGNING_SECRET");
    expect(findNode(workflow, "Reject unauthorized request").parameters.options).toMatchObject({
      responseCode: 401,
    });

    const replyCode = findNode(workflow, "Prepare signed reply").parameters.jsCode as string;
    const reply = replyCode.match(/const reply = \{([\s\S]*?)\n\};/);
    expect(reply).not.toBeNull();
    const keys = [...reply![1].matchAll(/^\s*([a-z_]+):/gm)].map((match) => match[1]);
    expect(keys).toEqual(["reply_id", "inbound_provider_ref", "conversation_id", "body"]);
    expect(reply![1]).toContain("n8n-${input.event.event_id}");
    expect(reply![1]).toContain("input.event.provider_message_id");

    const request = findNode(workflow, "Post signed reply");
    expect(request.parameters.url).toBe(
      "https://www.sherivs.com/api/public/webhooks/whatsapp-reply",
    );
    expect(JSON.stringify(request.parameters)).not.toMatch(/tenant_id|phone|graph\.facebook\.com/i);
  });

  it("runs the authenticated outbox tick every minute", () => {
    const workflow = workflows.get("sherivs-wa-forward-tick.json");
    if (!workflow) throw new Error("Missing forward-tick export");
    const schedule = findNode(workflow, "Every minute");
    expect(schedule.parameters.rule).toMatchObject({
      interval: [{ field: "minutes", minutesInterval: 1 }],
    });
    const request = findNode(workflow, "Claim and forward outbox");
    expect(request.parameters.method).toBe("GET");
    expect(request.parameters.url).toBe(
      "https://www.sherivs.com/api/public/cron/whatsapp-n8n-forward",
    );
    expect(request.parameters.genericAuthType).toBe("httpHeaderAuth");
    expect(request.credentials?.httpHeaderAuth).toEqual({
      name: "Sherivs CRON Authorization",
    });
  });
});

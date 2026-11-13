import { readdirSync, readFileSync } from "node:fs";
import * as crypto from "node:crypto";
import { runInNewContext } from "node:vm";
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

const inboundBody = JSON.stringify({
  event_type: "whatsapp.inbound",
  event_id: "123e4567-e89b-42d3-a456-426614174000",
  provider_message_id: "wamid.test",
  tenant_id: "tenant-test",
  org_ref: "org-test",
  conversation_id: "123e4567-e89b-42d3-a456-426614174001",
  recipient_hash: "a".repeat(64),
  received_at: null,
  body: "hello",
});
const inboundSecret = "test-signing-secret-that-is-at-least-32-characters";

async function runInboundVerification({
  body = inboundBody,
  signedBody = body,
  timestamp = String(Math.floor(Date.now() / 1000)),
  signature,
  includeBinary = true,
}: {
  body?: string;
  signedBody?: string;
  timestamp?: string;
  signature?: string;
  includeBinary?: boolean;
} = {}) {
  const workflow = workflows.get("sherivs-wa-inbound-handler.json");
  if (!workflow) throw new Error("Missing inbound handler export");
  const code = findNode(workflow, "Verify signature and inbound shape").parameters.jsCode as string;
  const binaryData = includeBinary
    ? { data: { data: Buffer.from(body).toString("base64") } }
    : undefined;
  const input = {
    json: {
      headers: {
        "x-sherivs-timestamp": timestamp,
        "x-sherivs-signature":
          signature ??
          `sha256=${crypto.createHmac("sha256", inboundSecret).update(`${timestamp}.${signedBody}`).digest("hex")}`,
      },
    },
    ...(binaryData ? { binary: binaryData } : {}),
  };
  const getBinaryDataBuffer = async (index: number, propertyName: string) => {
    if (index !== 0 || propertyName !== "data" || !binaryData) {
      throw new Error("Missing binary data");
    }
    return Buffer.from(binaryData.data.data, "base64");
  };
  return runInNewContext(`(async function () {\n${code}\n}).call(this)`, {
    helpers: { getBinaryDataBuffer },
    require: (name: string) => {
      if (name !== "crypto") throw new Error(`Unexpected module: ${name}`);
      return crypto;
    },
    $input: { first: () => input },
    process: { env: { N8N_WHATSAPP_SIGNING_SECRET: inboundSecret } },
    Buffer,
    Date,
  }) as Promise<Array<{ json: { valid: boolean } }>>;
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
    expect(code).toContain("this.helpers.getBinaryDataBuffer(0, 'data')");
    expect(code).not.toContain("item.rawBody");
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

  it("verifies inbound signatures against n8n binary data", async () => {
    const valid = await runInboundVerification();
    expect(valid[0].json.valid).toBe(true);

    const stale = await runInboundVerification({
      timestamp: String(Math.floor(Date.now() / 1000) - 301),
    });
    expect(stale[0].json.valid).toBe(false);

    const badSignature = await runInboundVerification({
      signature: `sha256=${"0".repeat(64)}`,
    });
    expect(badSignature[0].json.valid).toBe(false);

    const missingBinary = await runInboundVerification({ includeBinary: false });
    expect(missingBinary[0].json.valid).toBe(false);

    const whitespaceChanged = await runInboundVerification({
      body: inboundBody.replace('"body":"hello"', '"body": "hello"'),
      signedBody: inboundBody,
    });
    expect(whitespaceChanged[0].json.valid).toBe(false);
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

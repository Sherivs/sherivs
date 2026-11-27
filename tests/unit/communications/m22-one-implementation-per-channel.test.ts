/**
 * M22 (ADR-151) guard: one implementation per channel. Scans production code under frontend/src and fails when a
 * second sender for a channel appears: a provider endpoint outside its adapter, a provider adapter constructed outside
 * the port that owns it, or the retired duplicate modules coming back. Voice is out of scope (founder pause).
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(__dirname, "../../..");
const SRC = path.join(ROOT, "frontend/src");

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) return files(full);
    return /\.(ts|tsx)$/.test(name) && !name.endsWith(".gen.ts") ? [full] : [];
  });
}
const all = files(SRC).map((f) => ({
  rel: path.relative(ROOT, f).replace(/\\/g, "/"),
  text: readFileSync(f, "utf8"),
}));
/** Code only: drop line and block comments so documentation may name things freely. */
const code = (t: string) => t.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const where = (re: RegExp) =>
  all
    .filter((f) => re.test(code(f.text)))
    .map((f) => f.rel)
    .sort();

describe("one implementation per channel", () => {
  it("SMS: each BulkSMS endpoint lives only in its adapter", () => {
    expect(where(/api\.bulksms\.com/)).toEqual([
      "frontend/src/lib/communications/bulksms-com.server.ts",
    ]);
    expect(where(/bulksmsnigeria\.com\/api/)).toEqual([
      "frontend/src/lib/communications/bulksms-nigeria.server.ts",
    ]);
  });

  it("SMS: adapters are built only by the one selector, and only the two dispatch paths select", () => {
    expect(
      where(/create(BulkSmsNigeria|BulkSmsCom)Gateway\(/).filter(
        (f) => !/bulksms-(nigeria|com)\.server/.test(f),
      ),
    ).toEqual(["frontend/src/lib/communications/sms-gateway.server.ts"]);
    expect(where(/selectSmsGateway\(/).filter((f) => !f.endsWith("sms-gateway.server.ts"))).toEqual(
      [
        "frontend/src/lib/communications/sms-fabric.server.ts",
        "frontend/src/lib/jarvis-bridge/owner-alert-sender.server.ts",
      ],
    );
  });

  it("SMS: the retired duplicate senders are gone and Twilio SMS has no production caller", () => {
    expect(existsSync(path.join(SRC, "lib/jarvis-bridge/owner-alert-bulksms.server.ts"))).toBe(
      false,
    );
    expect(existsSync(path.join(SRC, "lib/scholar/comms/adapters.server.ts"))).toBe(false);
    expect(where(/from\s+["'][^"']*twilio-sms(\.server)?["']/)).toEqual([]);
    expect(
      where(/createTwilioSmsSender\(/).filter((f) => !f.endsWith("twilio-sms.server.ts")),
    ).toEqual([]);
  });

  it("Email: the Resend endpoint lives only in the Resend adapter, built only by the shared sender (+ documented callers)", () => {
    // provider-health only reads /domains (a credential probe); it cannot send mail.
    expect(where(/api\.resend\.com/)).toEqual([
      "frontend/src/lib/communications/resend-email.server.ts",
      "frontend/src/lib/observability/provider-health.server.ts",
    ]);
    expect(
      code(readFileSync(path.join(SRC, "lib/observability/provider-health.server.ts"), "utf8")),
    ).not.toMatch(/api\.resend\.com\/emails/);
    expect(
      where(/createResendEmailAdapter\(/).filter((f) => !f.endsWith("resend-email.server.ts")),
    ).toEqual([
      "frontend/src/lib/communications/email-send.server.ts",
      // Government officer invite: same adapter, with the evidence sink (M22); it maps its own outcome codes.
      "frontend/src/lib/gov/invite-email.functions.ts",
    ]);
  });

  it("WhatsApp: the Graph endpoint lives only in the Cloud adapter; proactive sends only via the registry gate", () => {
    expect(where(/graph\.facebook\.com/)).toEqual([
      "frontend/src/lib/communications/whatsapp-cloud.server.ts",
    ]);
    expect(
      where(/new WhatsAppCloudAdapter\(/).filter((f) => !f.endsWith("whatsapp-cloud.server.ts")),
    ).toEqual([
      "frontend/src/lib/jarvis-bridge/owner-alert-sender.server.ts",
      "frontend/src/routes/api/public/cron/whatsapp-dispatch.ts",
    ]);
    // A template send outside the gate would bypass the registry: only the gate and the Cloud adapter pass `template:`.
    const templateSenders = all
      .filter((f) => /\.send\([^)]*\{[\s\S]{0,200}?template:/.test(code(f.text)))
      .map((f) => f.rel)
      .sort();
    expect(templateSenders).toEqual([
      "frontend/src/lib/communications/whatsapp-cloud.server.ts",
      "frontend/src/lib/communications/whatsapp-template-registry.ts",
    ]);
  });

  it("Owner alerts send through the shared paths only (no private SMS, email or WhatsApp sender)", () => {
    const sender = code(
      readFileSync(path.join(SRC, "lib/jarvis-bridge/owner-alert-sender.server.ts"), "utf8"),
    );
    expect(sender).toContain("createTransactionalEmailSender(");
    expect(sender).toContain("selectSmsGateway(");
    expect(sender).toContain("sendProactiveWhatsApp(");
    expect(sender).not.toMatch(/fetch\(\s*["'`]https?:/);
  });

  it("The notification worker cron uses the shared email sender", () => {
    const cron = code(
      readFileSync(path.join(SRC, "routes/api/public/cron/org-notifications.ts"), "utf8"),
    );
    expect(cron).toContain("createTransactionalEmailSender(");
    expect(cron).not.toContain("createResendEmailAdapter(");
  });
});

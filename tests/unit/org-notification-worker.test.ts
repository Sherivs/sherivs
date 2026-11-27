import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  GENERIC_SUBJECT,
  GENERIC_TEXT,
  TEXT_MAX,
  composeMessage,
  resolveEmail,
  runNotificationWorker,
  toOutboxRow,
  type EmailSend,
  type WorkerClient,
} from "../../frontend/src/lib/org-workforce/notification-worker.server";

const ORG = "22222222-2222-2222-2222-222222222222";
const OTHER_ORG = "33333333-3333-3333-3333-333333333333";
const USER = "44444444-4444-4444-4444-444444444444";
type E = { message: string; code?: string } | null;

function row(over: Record<string, unknown> = {}) {
  return {
    id: "55555555-5555-5555-5555-555555555555",
    org_id: ORG,
    recipient_id: USER,
    channel: "email",
    redacted: false,
    payload: { subject: "Weekly report", text: "3 events this week." },
    ...over,
  };
}

function client(opts: {
  claimed?: unknown;
  claimError?: E;
  members?: Array<{ school_id: string; user_id: string }>;
  users?: Array<{ id: string; school_id: string; email: string | null }>;
}) {
  const completed: Array<{ id: string; ok: boolean }> = [];
  const c: WorkerClient = {
    rpc(name, args) {
      if (name === "claim_org_notifications")
        return Promise.resolve({ data: opts.claimed ?? [], error: opts.claimError ?? null });
      if (name === "complete_org_notification") {
        completed.push({ id: String(args.p_id), ok: args.p_ok === true });
        return Promise.resolve({ data: null, error: null });
      }
      return Promise.resolve({ data: null, error: { message: "unexpected" } });
    },
    from(table) {
      const filters: Record<string, unknown> = {};
      const q: ReturnType<WorkerClient["from"]>["select"] extends (c: string) => infer R
        ? R
        : never = {
        eq(col: string, v: unknown) {
          filters[col] = v;
          return q;
        },
        limit() {
          return q;
        },
        then(res: (v: { data: unknown; error: E }) => unknown) {
          const src =
            table === "organization_memberships" ? (opts.members ?? []) : (opts.users ?? []);
          const data = (src as Array<Record<string, unknown>>).filter((r) =>
            Object.entries(filters).every(([k, v]) => k === "is_active" || r[k] === v),
          );
          return Promise.resolve({ data, error: null }).then(res);
        },
      } as never;
      return { select: () => q };
    },
  };
  return { c, completed };
}

const goodMembers = [{ school_id: ORG, user_id: USER }];
const goodUsers = [{ id: USER, school_id: ORG, email: "head@school.example" }];

describe("notification worker", () => {
  it("sends an email and completes it ok", async () => {
    const { c, completed } = client({ claimed: [row()], members: goodMembers, users: goodUsers });
    const sent: EmailSend[] = [];
    const r = await runNotificationWorker({
      admin: c,
      ports: {
        sendEmail: async (m) => {
          sent.push(m);
          return { ok: true };
        },
      },
    });
    expect(r).toMatchObject({ status: "ok", claimed: 1, sent: 1, failed: 0 });
    expect(completed).toEqual([{ id: row().id, ok: true }]);
    expect(sent[0]).toMatchObject({ to: "head@school.example", subject: "Weekly report" });
  });

  it("fails an email whose recipient is not an active member of the organization", async () => {
    const { c, completed } = client({ claimed: [row()], members: [], users: goodUsers });
    let called = false;
    const r = await runNotificationWorker({
      admin: c,
      ports: { sendEmail: async () => ((called = true), { ok: true }) },
    });
    expect(called).toBe(false);
    expect(completed[0]?.ok).toBe(false);
    expect(r).toMatchObject({ failed: 1, reasons: { no_active_recipient_address: 1 } });
  });

  it("never reads an address from another organization", async () => {
    const wrongOrgUser = [{ id: USER, school_id: OTHER_ORG, email: "leak@other.example" }];
    expect(
      await resolveEmail(client({ members: goodMembers, users: wrongOrgUser }).c, ORG, USER),
    ).toBeNull();
  });

  it("requires membership in this organization, not just any organization", async () => {
    const elsewhere = [{ school_id: OTHER_ORG, user_id: USER }];
    expect(
      await resolveEmail(client({ members: elsewhere, users: goodUsers }).c, ORG, USER),
    ).toBeNull();
  });

  it("ignores an address supplied in the payload", async () => {
    const { c } = client({
      claimed: [row({ payload: { subject: "x", text: "y", to: "attacker@evil.example" } })],
      members: goodMembers,
      users: goodUsers,
    });
    const sent: EmailSend[] = [];
    await runNotificationWorker({
      admin: c,
      ports: { sendEmail: async (m) => (sent.push(m), { ok: true }) },
    });
    expect(sent[0]?.to).toBe("head@school.example");
  });

  it("rejects a malformed address on file", async () => {
    const bad = [{ id: USER, school_id: ORG, email: "not-an-address" }];
    expect(
      await resolveEmail(client({ members: goodMembers, users: bad }).c, ORG, USER),
    ).toBeNull();
  });

  it("refuses sms and never calls a port", async () => {
    const { c, completed } = client({ claimed: [row({ channel: "sms" })] });
    const r = await runNotificationWorker({
      admin: c,
      ports: {
        sendEmail: async () => {
          throw new Error("must not be called");
        },
      },
    });
    expect(completed[0]?.ok).toBe(false);
    expect(r).toMatchObject({ reasons: { sms_refused: 1 } });
  });

  it("fails whatsapp when no sender is wired, and sends when one is", async () => {
    const none = client({ claimed: [row({ channel: "whatsapp" })] });
    expect(
      await runNotificationWorker({
        admin: none.c,
        ports: { sendEmail: async () => ({ ok: true }) },
      }),
    ).toMatchObject({ failed: 1, reasons: { whatsapp_not_configured: 1 } });
    const wired = client({ claimed: [row({ channel: "whatsapp" })] });
    const r = await runNotificationWorker({
      admin: wired.c,
      ports: { sendEmail: async () => ({ ok: true }), sendWhatsApp: async () => ({ ok: true }) },
    });
    expect(r).toMatchObject({ sent: 1, failed: 0 });
  });

  it("fails push when no sender is wired, and keeps in_app unsupported", async () => {
    const { c } = client({
      claimed: [row({ channel: "push" }), row({ id: "6", channel: "in_app" })],
    });
    const r = await runNotificationWorker({
      admin: c,
      ports: { sendEmail: async () => ({ ok: true }) },
    });
    expect(r).toMatchObject({
      failed: 2,
      reasons: { push_not_configured: 1, channel_not_supported: 1 },
    });
  });

  it("sends push through the injected sender port", async () => {
    const { c } = client({ claimed: [row({ channel: "push", payload: { kind: "fee" } })] });
    const sent: Array<{ route: string; category: string; title: string }> = [];
    const r = await runNotificationWorker({
      admin: c,
      ports: {
        sendEmail: async () => ({ ok: true }),
        sendPush: async (m) => {
          sent.push({ route: m.route, category: m.category, title: m.title });
          return { ok: true };
        },
      },
    });
    expect(r).toMatchObject({ sent: 1, failed: 0 });
    expect(sent[0]).toMatchObject({ route: "/home/notifications", category: "fees" });
  });

  it("turns a throwing port into a failed row and keeps going", async () => {
    const { c, completed } = client({
      claimed: [row(), row({ id: "7" })],
      members: goodMembers,
      users: goodUsers,
    });
    let n = 0;
    const r = await runNotificationWorker({
      admin: c,
      ports: {
        sendEmail: async () => {
          if (n++ === 0) throw new Error("boom head@school.example");
          return { ok: true };
        },
      },
    });
    expect(r).toMatchObject({ sent: 1, failed: 1, reasons: { send_threw: 1 } });
    expect(completed).toHaveLength(2);
    expect(JSON.stringify(r)).not.toContain("school.example");
  });

  it("reports not_applied when the function is missing, and throws on other errors", async () => {
    const missing = client({ claimError: { message: "x", code: "PGRST202" } });
    expect(
      await runNotificationWorker({
        admin: missing.c,
        ports: { sendEmail: async () => ({ ok: true }) },
      }),
    ).toEqual({
      status: "not_applied",
    });
    const broken = client({ claimError: { message: "boom", code: "XX000" } });
    await expect(
      runNotificationWorker({ admin: broken.c, ports: { sendEmail: async () => ({ ok: true }) } }),
    ).rejects.toThrow("boom");
  });

  it("counts a malformed claimed row without sending", async () => {
    const { c } = client({ claimed: [{ nope: true }] });
    const r = await runNotificationWorker({
      admin: c,
      ports: { sendEmail: async () => ({ ok: true }) },
    });
    expect(r).toMatchObject({ failed: 1, reasons: { malformed_row: 1 } });
  });
});

describe("message composition", () => {
  const base = toOutboxRow(row())!;
  it("uses generic text for a redacted row even if text is present", () => {
    const m = composeMessage({ ...base, redacted: true, payload: { text: "secret detail" } });
    expect(m).toMatchObject({ subject: GENERIC_SUBJECT, text: GENERIC_TEXT });
  });
  it("never writes safeguarding text", () => {
    const m = composeMessage({
      ...base,
      payload: { kind: "safeguarding", text: "child X disclosed" },
    });
    expect(m.text).toBe(GENERIC_TEXT);
  });
  it("marks urgent and critical items as escalation, which email policy refuses", () => {
    expect(composeMessage({ ...base, payload: { severity: "urgent" } }).category).toBe(
      "escalation",
    );
    expect(composeMessage({ ...base, payload: { severity: "critical" } }).category).toBe(
      "escalation",
    );
    expect(composeMessage({ ...base, payload: { severity: "info" } }).category).toBe("system");
  });
  it("clips long text", () => {
    expect(
      composeMessage({ ...base, payload: { text: "a".repeat(5000) } }).text.length,
    ).toBeLessThanOrEqual(TEXT_MAX);
  });
});

describe("route and policy wiring", () => {
  const route = readFileSync("frontend/src/routes/api/public/cron/org-notifications.ts", "utf8");
  it("is gated by the cron secret with a timing-safe compare and fails closed", () => {
    expect(route).toContain("CRON_SECRET");
    expect(route).toContain("timingSafeEqual");
    expect(route).toContain("status: 503");
    expect(route).toContain("status: 401");
  });
  it("does not wire a whatsapp or sms sender", () => {
    expect(route).not.toMatch(/sendWhatsApp|twilio|africas-talking|sms-fabric/i);
  });
  it("has no secret values", () => {
    expect(route).not.toMatch(/re_[A-Za-z0-9]{10,}|whsec_/);
  });
});

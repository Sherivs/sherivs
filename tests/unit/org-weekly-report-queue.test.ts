import { describe, expect, it } from "vitest";
import {
  REPORT_SUBJECT,
  findAdministrator,
  reportText,
  runWeeklyReports,
  type JobClient,
} from "../../frontend/src/lib/org-workforce/weekly-report-job.server";

const NOW = new Date("2026-11-17T10:00:00Z");

function stub(opts: {
  holders?: Record<string, Record<string, string | undefined>>; // org -> role -> user id
  failStore?: boolean;
  failEnqueue?: boolean;
  events?: Record<string, unknown>[];
}) {
  const rpcs: { name: string; args: Record<string, unknown> }[] = [];
  const client: JobClient = {
    rpc(name, args) {
      rpcs.push({ name, args });
      if (name === "request_org_weekly_reports") return Promise.resolve({ data: 1, error: null });
      if (name === "store_org_weekly_report" && opts.failStore)
        return Promise.resolve({ data: null, error: { message: "report_not_requested" } });
      if (name === "enqueue_org_notification" && opts.failEnqueue)
        return Promise.resolve({ data: null, error: { message: "recipient_not_in_organization" } });
      return Promise.resolve({ data: null, error: null });
    },
    from(table) {
      const f: Record<string, unknown> = {};
      const q = {
        eq: (c: string, v: unknown) => ((f[c] = v), q),
        gt: () => q,
        lte: () => q,
        order: () => q,
        limit: () => q,
        then: (res: (r: unknown) => unknown) => {
          let data: unknown[] = [];
          if (table === "org_weekly_reports") data = [{ id: "r1", org_id: "orgA" }];
          if (table === "org_agent_events") data = opts.events ?? [];
          if (table === "organization_memberships") {
            const id = opts.holders?.[String(f.school_id)]?.[String(f.role)];
            data = id ? [{ user_id: id }] : [];
          }
          return Promise.resolve({ data, error: null }).then(res);
        },
      };
      return { select: () => q as never };
    },
  };
  return { client, rpcs };
}

describe("weekly report queues one email to the administrator", () => {
  it("queues for the admin and prefers admin over principal and hq", async () => {
    const s = stub({ holders: { orgA: { admin: "u-admin", principal: "u-prin", hq: "u-hq" } } });
    const out = await runWeeklyReports({ admin: s.client, now: NOW });
    expect(out).toMatchObject({ built: 1, queued: 1, sent: 0, failed: [] });
    const enq = s.rpcs.filter((r) => r.name === "enqueue_org_notification");
    expect(enq).toHaveLength(1);
    expect(enq[0]!.args).toMatchObject({
      p_org: "orgA",
      p_event: null,
      p_recipient: "u-admin",
      p_channel: "email",
      p_redacted: false,
    });
    expect(enq[0]!.args.p_payload).toMatchObject({
      kind: "weekly_report",
      subject: REPORT_SUBJECT,
    });
  });

  it("falls back to principal, then hq, and skips quietly when nobody holds the chain", async () => {
    const p = stub({ holders: { orgA: { principal: "u-prin", hq: "u-hq" } } });
    await runWeeklyReports({ admin: p.client, now: NOW });
    expect(p.rpcs.find((r) => r.name === "enqueue_org_notification")!.args.p_recipient).toBe(
      "u-prin",
    );
    const h = stub({ holders: { orgA: { hq: "u-hq" } } });
    await runWeeklyReports({ admin: h.client, now: NOW });
    expect(h.rpcs.find((r) => r.name === "enqueue_org_notification")!.args.p_recipient).toBe(
      "u-hq",
    );
    const none = stub({ holders: {} });
    const out = await runWeeklyReports({ admin: none.client, now: NOW });
    expect(out).toMatchObject({ built: 1, queued: 0 });
    expect(none.rpcs.some((r) => r.name === "enqueue_org_notification")).toBe(false);
  });

  it("does not queue when the report could not be stored", async () => {
    const s = stub({ holders: { orgA: { admin: "u" } }, failStore: true });
    const out = await runWeeklyReports({ admin: s.client, now: NOW });
    expect(out).toMatchObject({ built: 0, queued: 0 });
    expect(s.rpcs.some((r) => r.name === "enqueue_org_notification")).toBe(false);
  });

  it("reports an enqueue failure without losing the built report", async () => {
    const s = stub({ holders: { orgA: { admin: "u" } }, failEnqueue: true });
    const out = await runWeeklyReports({ admin: s.client, now: NOW });
    expect(out).toMatchObject({ built: 1, queued: 0 });
    if (out.status === "ok") expect(out.failed).toHaveLength(1);
  });

  it("never puts safeguarding text in the queued payload", async () => {
    const s = stub({
      holders: { orgA: { admin: "u" } },
      events: [
        {
          id: "e1",
          agent_code: "org-welfare",
          kind: "safeguarding",
          severity: "urgent",
          summary: "Named child disclosed harm",
          created_at: "2026-11-12T10:00:00Z",
          acked_at: null,
        },
      ],
    });
    await runWeeklyReports({ admin: s.client, now: NOW });
    const payload = JSON.stringify(s.rpcs.find((r) => r.name === "enqueue_org_notification")!.args);
    expect(payload).not.toContain("Named child");
    expect(payload).not.toContain("disclosed");
  });

  it("clips a long report and finds the administrator through the helper", async () => {
    expect(reportText(["x".repeat(3000)]).length).toBeLessThanOrEqual(1500);
    const s = stub({ holders: { orgA: { principal: "p" } } });
    expect(await findAdministrator(s.client, "orgA")).toBe("p");
    expect(await findAdministrator(s.client, "orgZ")).toBeNull();
  });
});

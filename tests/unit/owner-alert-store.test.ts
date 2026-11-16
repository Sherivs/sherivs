import { describe, expect, it } from "vitest";
import {
  createOwnerAlertPorts,
  type AlertDbClient,
} from "../../frontend/src/lib/jarvis-bridge/owner-alert-store.server";
import { runOwnerAlertTick } from "../../frontend/src/lib/jarvis-bridge/owner-alert-tick";

type Row = Record<string, unknown>;
const NOW = Date.parse("2026-11-16T12:00:00.000Z");

/** A small in-memory stand-in for the Supabase client, with the unique indexes the migration adds. */
function fakeDb(seed: Record<string, Row[]>, opts: { paused?: boolean; failTable?: string } = {}) {
  const tables: Record<string, Row[]> = {
    owner_alerts: [],
    owner_alert_deliveries: [],
    owner_alert_channels: [],
    owner_alert_settings: [],
    security_incidents: [],
    jarvis_approval_requests: [],
    ...seed,
  };
  let seq = 0;
  const query = (table: string) => {
    let rows = [...(tables[table] ?? [])];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- a self-referential chainable fake
    const q: any = {
      eq: (c: string, v: unknown) => ((rows = rows.filter((r) => r[c] === v)), q),
      in: (c: string, v: readonly unknown[]) => ((rows = rows.filter((r) => v.includes(r[c]))), q),
      gte: (c: string, v: string) => ((rows = rows.filter((r) => String(r[c]) >= v)), q),
      order: (c: string, o?: { ascending?: boolean }) => {
        rows.sort((a, b) => String(a[c]).localeCompare(String(b[c])) * (o?.ascending ? 1 : -1));
        return q;
      },
      limit: (n: number) => ((rows = rows.slice(0, n)), q),
      maybeSingle: () => Promise.resolve({ data: rows[0] ?? null, error: null }),
      then: (ok: (v: unknown) => unknown, bad?: (e: unknown) => unknown) =>
        Promise.resolve(
          opts.failTable === table
            ? { data: null, error: { code: "42P01", message: "x" } }
            : { data: rows, error: null },
        ).then(ok, bad),
    };
    return q;
  };
  const db = {
    from: (table: string) => ({
      select: () => query(table),
      insert: (row: Row) => {
        const dupe =
          (table === "owner_alert_deliveries" &&
            tables[table]!.some((r) => r.idempotency_key === row.idempotency_key)) ||
          (table === "owner_alerts" &&
            tables[table]!.some((r) => r.dedupe_key === row.dedupe_key && r.status === "open"));
        const result = dupe
          ? { data: null, error: { code: "23505", message: "dupe" } }
          : (() => {
              seq += 1;
              const stored = { id: `id-${seq}`, status: "open", ...row };
              tables[table]!.push(stored);
              return { data: stored, error: null };
            })();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- thenable with a select() branch
        const thenable: any = {
          select: () => ({ single: () => Promise.resolve(result) }),
          then: (ok: (v: unknown) => unknown) => Promise.resolve(result).then(ok),
        };
        return thenable;
      },
      update: (patch: Row) => ({
        eq: (c: string, v: unknown) => {
          for (const r of tables[table]!) if (r[c] === v) Object.assign(r, patch);
          return Promise.resolve({ data: null, error: null });
        },
      }),
    }),
    rpc: async (fn: string) =>
      fn === "is_agent_paused"
        ? { data: opts.paused === true, error: null }
        : { data: null, error: { message: "unknown" } },
  };
  return { db: db as unknown as AlertDbClient, tables };
}

const settings = (over: Row = {}): Row => ({
  singleton: true,
  mode: "test",
  quiet_start_hour: null,
  quiet_end_hour: null,
  utc_offset_minutes: 60,
  live_approval_ref: null,
  live_approved_by: null,
  live_channels: [],
  live_expires_at: null,
  ...over,
});
const channels = (on = true): Row[] =>
  ["voice", "whatsapp", "sms", "email"].map((channel) => ({ channel, enabled: on }));

const incident: Row = {
  id: "inc-1",
  severity: "critical",
  category: "breach",
  status: "open",
  detected_at: "2026-11-16T11:00:00Z",
};
const approval: Row = {
  approval_id: "appr-1",
  action_id: "deploy.production",
  risk_tier: "T3",
  status: "pending",
  requested_at: "2026-11-16T11:30:00Z",
};

const ports = (
  seed: Record<string, Row[]>,
  opts: Parameters<typeof fakeDb>[1] = {},
  sendFn = async () => ({ ok: true as const, providerRef: "p-1" }),
) => {
  const f = fakeDb(seed, opts);
  return {
    ...f,
    ports: createOwnerAlertPorts(
      { db: f.db, consoleOrigin: "https://console.sherivs.com", nowMs: () => NOW },
      sendFn,
    ),
  };
};

describe("owner-alert store ports", () => {
  it("reads incidents and pending approvals as signals with stable keys", async () => {
    const { ports: p } = ports({
      security_incidents: [incident],
      jarvis_approval_requests: [approval],
    });
    const signals = await p.readSignals();
    expect(signals.map((s) => s.key).sort()).toEqual(["approval:appr-1", "incident:inc-1"]);
    expect(signals.find((s) => s.key === "incident:inc-1")?.facts.securityIncident).toBe(true);
    expect(signals.find((s) => s.key === "approval:appr-1")?.facts.tier).toBe("T3");
  });

  it("builds a test-mode config with no authorization, and a live config only when fully authorized", async () => {
    const test = await ports({
      owner_alert_settings: [settings()],
      owner_alert_channels: channels(),
    }).ports.loadConfig();
    expect(test?.config.mode).toBe("test");
    expect(test?.authorization).toBeUndefined();
    expect(test?.config.ownerEnabled).toEqual({
      voice: true,
      whatsapp: true,
      sms: true,
      email: true,
    });

    const live = await ports({
      owner_alert_settings: [
        settings({
          mode: "live",
          live_approval_ref: "chat-2026-11-16",
          live_approved_by: "human:sheriff-1",
          live_channels: ["sms", "email", "bogus"],
          live_expires_at: "2026-11-17T00:00:00Z",
        }),
      ],
      owner_alert_channels: channels(),
    }).ports.loadConfig();
    expect(live?.authorization?.channels).toEqual(["sms", "email"]);
  });

  it("reports no config when the settings row is missing", async () => {
    expect(await ports({ owner_alert_channels: channels() }).ports.loadConfig()).toBeNull();
  });

  it("fails closed when the pause state cannot be read, and honours a pause", async () => {
    const f = ports({}, { paused: true });
    expect(await f.ports.isPaused()).toBe(true);
    const broken = fakeDb({});
    const p = createOwnerAlertPorts(
      {
        db: { ...broken.db, rpc: async () => ({ data: null, error: { message: "x" } }) } as never,
        consoleOrigin: "https://console.sherivs.com",
        nowMs: () => NOW,
      },
      async () => ({ ok: true, providerRef: null }),
    );
    await expect(p.isPaused()).rejects.toThrow();
  });

  it("keeps the owner's decision: an acknowledged alert is returned as-is, not reopened", async () => {
    const { ports: p, tables } = ports({
      owner_alerts: [
        {
          id: "a-1",
          dedupe_key: "incident:inc-1",
          status: "acknowledged",
          severity: "S1",
          created_at: "2026-11-16T10:00:00Z",
        },
      ],
    });
    const got = await p.upsertAlert({
      dedupeKey: "incident:inc-1",
      severity: "S1",
      title: "x",
      consolePath: "/console/alerts?ref=incident%3Ainc-1",
      source: "security_incidents",
    });
    expect(got).toEqual({ id: "a-1", status: "acknowledged" });
    expect(tables.owner_alerts).toHaveLength(1);
  });

  it("claims a delivery once: the second claim of the same key is refused", async () => {
    const { ports: p } = ports({});
    const claim = {
      alertId: "a-1",
      channel: "sms" as const,
      destinationKind: "registered_contact" as const,
      idempotencyKey: "a-1:sms:1",
    };
    expect(await p.claimDelivery(claim)).toBe(true);
    expect(await p.claimDelivery(claim)).toBe(false);
  });

  it("surfaces a store failure to the tick as an error code instead of a crash", async () => {
    const { ports: p } = ports(
      { owner_alert_settings: [settings()], owner_alert_channels: channels() },
      { failTable: "security_incidents" },
    );
    const out = await runOwnerAlertTick(p);
    expect(out.status).toBe("signals_unavailable");
  });
});

describe("owner-alert tick against the store (test mode, end to end)", () => {
  it("opens one alert per signal, writes console and test-sink rows, and sends nothing", async () => {
    let sends = 0;
    const { ports: p, tables } = ports(
      {
        owner_alert_settings: [settings()],
        owner_alert_channels: channels(),
        security_incidents: [incident],
        jarvis_approval_requests: [approval],
      },
      {},
      async () => {
        sends += 1;
        return { ok: true as const, providerRef: "x" };
      },
    );
    const out = await runOwnerAlertTick(p);
    expect(out.status).toBe("ok");
    expect(sends).toBe(0);
    expect(tables.owner_alerts.map((a) => a.dedupe_key).sort()).toEqual([
      "approval:appr-1",
      "incident:inc-1",
    ]);
    expect(
      tables.owner_alert_deliveries.every((d) => d.destination_kind !== "registered_contact"),
    ).toBe(true);
    expect(tables.owner_alerts.find((a) => a.dedupe_key === "incident:inc-1")?.severity).toBe("S1");
    expect(tables.owner_alerts.find((a) => a.dedupe_key === "approval:appr-1")?.severity).toBe(
      "S2",
    );
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { deliverPushToUsers } from "../../frontend/src/lib/push.server";
import { isWithinQuietHours } from "../../frontend/src/lib/push/push-preferences.server";
import { sanitizePushRoute } from "../../frontend/src/lib/push/push-route-allowlist.server";

type Row = Record<string, unknown>;

function createSupabase(data: {
  users?: Row[];
  notification_preferences?: Row[];
  mobile_push_devices?: Row[];
}) {
  const updates: Array<{ table: string; values: Row; ids: unknown[] }> = [];
  const tables = {
    users: data.users ?? [],
    notification_preferences: data.notification_preferences ?? [],
    mobile_push_devices: data.mobile_push_devices ?? [],
  };

  const makeQuery = (table: keyof typeof tables) => {
    const filters: Array<(row: Row) => boolean> = [];
    let updateValues: Row | null = null;

    const query = {
      select() {
        return query;
      },
      in(column: string, values: unknown[]) {
        filters.push((row) => values.includes(row[column]));
        return query;
      },
      not(column: string) {
        filters.push((row) => row[column] !== null && row[column] !== undefined);
        return query;
      },
      eq(column: string, value: unknown) {
        filters.push((row) => row[column] === value);
        return query;
      },
      is(column: string, value: unknown) {
        filters.push((row) => row[column] === value);
        return query;
      },
      update(values: Row) {
        updateValues = values;
        return query;
      },
      limit() {
        return query;
      },
      order() {
        return query;
      },
      then(resolve: (result: { data: Row[]; error: null }) => unknown) {
        const rows = tables[table].filter((row) => filters.every((f) => f(row)));
        if (updateValues) {
          updates.push({
            table,
            values: updateValues,
            ids: rows.map((row) => row.id ?? row.user_id),
          });
        }
        return Promise.resolve({ data: rows, error: null }).then(resolve);
      },
    };

    return query;
  };

  return {
    updates,
    from(table: string) {
      return makeQuery(table as keyof typeof tables);
    },
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  delete process.env.PUSH_EXPO_ENABLED;
  delete process.env.EXPO_ACCESS_TOKEN;
  delete process.env.VAPID_PUBLIC_KEY;
  delete process.env.VAPID_PRIVATE_KEY;
});

describe("PUSH-02 delivery orchestration", () => {
  it("does not send Expo when feature flag is off", async () => {
    process.env.PUSH_EXPO_ENABLED = "false";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const supabase = createSupabase({
      users: [{ id: "u1", push_token: null }],
      notification_preferences: [{ user_id: "u1", push_messages: true }],
      mobile_push_devices: [
        {
          id: "d1",
          user_id: "u1",
          expo_push_token: "ExponentPushToken[x]",
          enabled: true,
          revoked_at: null,
        },
      ],
    });

    const result = await deliverPushToUsers(supabase as never, ["u1"], {
      category: "messages",
      route: "/messages",
      title: "Hello",
      body: "World",
    });

    expect(result.expoAttempted).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("honors push preferences and quiet hours in Africa/Lagos (midnight wrap)", async () => {
    process.env.PUSH_EXPO_ENABLED = "true";
    const fetchMock = vi.fn(async () => Response.json({ data: [{ status: "ok", id: "r1" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const now = new Date();
    const lagosParts = new Intl.DateTimeFormat("en-GB", {
      timeZone: "Africa/Lagos",
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
    }).formatToParts(now);
    const hour = Number(lagosParts.find((part) => part.type === "hour")?.value ?? "0");
    const minute = Number(lagosParts.find((part) => part.type === "minute")?.value ?? "0");
    const start = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;
    const endHour = (hour + 1) % 24;
    const end = `${String(endHour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00`;

    const supabase = createSupabase({
      users: [
        { id: "u1", push_token: null },
        { id: "u2", push_token: null },
      ],
      notification_preferences: [
        {
          user_id: "u1",
          push_messages: true,
          quiet_hours_start: start,
          quiet_hours_end: end,
          timezone: "Africa/Lagos",
        },
        {
          user_id: "u2",
          push_messages: false,
          quiet_hours_start: null,
          quiet_hours_end: null,
          timezone: "Africa/Lagos",
        },
      ],
      mobile_push_devices: [
        {
          id: "d1",
          user_id: "u1",
          expo_push_token: "ExponentPushToken[a]",
          enabled: true,
          revoked_at: null,
        },
        {
          id: "d2",
          user_id: "u2",
          expo_push_token: "ExponentPushToken[b]",
          enabled: true,
          revoked_at: null,
        },
      ],
    });

    const result = await deliverPushToUsers(supabase as never, ["u1", "u2"], {
      category: "messages",
      route: "/messages",
      title: "Title",
      body: "Body",
    });

    expect(result.expoAttempted).toBe(0);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses minimized payload with allow-listed route and generic body for redacted fees", async () => {
    process.env.PUSH_EXPO_ENABLED = "true";
    const fetchMock = vi.fn(async () =>
      Response.json({
        data: [{ status: "ok", id: "r1" }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const supabase = createSupabase({
      users: [{ id: "u1", push_token: null }],
      notification_preferences: [{ user_id: "u1", push_fees: true }],
      mobile_push_devices: [
        {
          id: "d1",
          user_id: "u1",
          expo_push_token: "ExponentPushToken[a]",
          enabled: true,
          revoked_at: null,
        },
      ],
    });

    await deliverPushToUsers(supabase as never, ["u1"], {
      category: "fees",
      route: "/unknown/private",
      notificationId: "n1",
      title: "Sensitive",
      body: "Very sensitive",
      redacted: true,
    });

    const firstCall = fetchMock.mock.calls[0] as unknown as [unknown, RequestInit | undefined];
    const payload = JSON.parse(String(firstCall?.[1]?.body));
    expect(payload[0].body).toBe("Open Sherivs to view this notification.");
    expect(payload[0].title).toBe("Sherivs notification");
    expect(payload[0].data).toEqual({ notificationId: "n1" });
    expect(payload[0].channelId).toBe("fees");
  });

  it("prunes DeviceNotRegistered Expo devices", async () => {
    process.env.PUSH_EXPO_ENABLED = "true";
    const fetchMock = vi.fn(async () =>
      Response.json({
        data: [{ status: "error", details: { error: "DeviceNotRegistered" } }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const supabase = createSupabase({
      users: [{ id: "u1", push_token: null }],
      notification_preferences: [{ user_id: "u1", push_messages: true }],
      mobile_push_devices: [
        {
          id: "d1",
          user_id: "u1",
          expo_push_token: "ExponentPushToken[a]",
          enabled: true,
          revoked_at: null,
        },
      ],
    });

    await deliverPushToUsers(supabase as never, ["u1"], {
      category: "messages",
      route: "/messages",
      title: "Hello",
      body: "World",
    });

    const deviceUpdate = supabase.updates.find((entry) => entry.table === "mobile_push_devices");
    expect(deviceUpdate?.ids).toEqual(["d1"]);
  });
});

describe("PUSH-02 helpers", () => {
  it("sanitizes routes against the allow-list", () => {
    expect(sanitizePushRoute("/results/term")).toBe("/results/term");
    expect(sanitizePushRoute("https://app.sherivs.com/home/notifications")).toBe(
      "/home/notifications",
    );
    expect(sanitizePushRoute("/private/admin")).toBeUndefined();
  });

  it("evaluates quiet-hour midnight wrap in Africa/Lagos", () => {
    expect(
      isWithinQuietHours({
        quietStart: "22:00:00",
        quietEnd: "06:00:00",
        timezone: "Africa/Lagos",
        nowMs: new Date("2026-11-15T21:30:00.000Z").valueOf(),
      }),
    ).toBe(true);

    expect(
      isWithinQuietHours({
        quietStart: "22:00:00",
        quietEnd: "06:00:00",
        timezone: "Africa/Lagos",
        nowMs: new Date("2026-11-16T05:30:00.000Z").valueOf(),
      }),
    ).toBe(false);
  });
});

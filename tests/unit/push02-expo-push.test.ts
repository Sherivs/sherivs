import { afterEach, describe, expect, it, vi } from "vitest";
import {
  isTruthyFlag,
  pollExpoPushReceipts,
  sendExpoPushMessages,
} from "../../frontend/src/lib/push/expo-push.server";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PUSH-02 expo sender", () => {
  it("batches send payloads in chunks of at most 100", async () => {
    const fetchMock = vi.fn(async (_url: unknown, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? "[]")) as unknown[];
      return Response.json({ data: body.map(() => ({ status: "ok", id: crypto.randomUUID() })) });
    });
    vi.stubGlobal("fetch", fetchMock);

    const messages = Array.from({ length: 205 }, (_, i) => ({
      token: `ExponentPushToken[test-${i}]`,
      deviceId: `device-${i}`,
      title: "Title",
      body: "Body",
      channelId: "messages",
      highPriority: false,
    }));

    const result = await sendExpoPushMessages({ messages });
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const batchSizes = fetchMock.mock.calls.map((call) => JSON.parse(String(call[1]?.body)).length);
    expect(batchSizes).toEqual([100, 100, 5]);
    expect(result.attempted).toBe(205);
    expect(result.accepted).toBe(205);
  });

  it("adds Authorization header only when access token is set", async () => {
    const fetchMock = vi.fn(async () => Response.json({ data: [{ status: "ok", id: "r1" }] }));
    vi.stubGlobal("fetch", fetchMock);

    await sendExpoPushMessages({
      messages: [
        {
          token: "ExponentPushToken[test]",
          title: "Title",
          body: "Body",
          channelId: "messages",
          highPriority: false,
        },
      ],
      accessToken: "secret-token",
    });

    const withTokenCall = fetchMock.mock.calls[0] as unknown as [unknown, RequestInit | undefined];
    const withTokenHeaders = (withTokenCall?.[1]?.headers ?? {}) as Record<string, string>;
    expect(String(withTokenHeaders.Authorization ?? "")).toMatch(/secret-token$/);

    fetchMock.mockClear();
    await sendExpoPushMessages({
      messages: [
        {
          token: "ExponentPushToken[test]",
          title: "Title",
          body: "Body",
          channelId: "messages",
          highPriority: false,
        },
      ],
    });
    const withoutTokenCall = fetchMock.mock.calls[0] as unknown as [
      unknown,
      RequestInit | undefined,
    ];
    const withoutTokenHeaders = (withoutTokenCall?.[1]?.headers ?? {}) as Record<string, string>;
    expect(withoutTokenHeaders.Authorization).toBeUndefined();
  });

  it("retries transient failures with backoff and succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("retry", { status: 503 }))
      .mockResolvedValueOnce(Response.json({ data: [{ status: "ok", id: "r2" }] }));
    vi.stubGlobal("fetch", fetchMock);

    const result = await sendExpoPushMessages({
      messages: [
        {
          token: "ExponentPushToken[test]",
          title: "Title",
          body: "Body",
          channelId: "messages",
          highPriority: false,
        },
      ],
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(result.accepted).toBe(1);
  });

  it("polls receipts and flags DeviceNotRegistered devices for pruning", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        data: {
          r1: { status: "ok" },
          r2: { status: "error", details: { error: "DeviceNotRegistered" } },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await pollExpoPushReceipts({
      entries: [
        { receiptId: "r1", deviceId: "d1" },
        { receiptId: "r2", deviceId: "d2" },
      ],
    });

    expect(result.checkedReceiptIds).toEqual(["r1", "r2"]);
    expect(result.deviceIdsToPrune).toEqual(["d2"]);
  });

  it("keeps error messages token-safe", async () => {
    const token = "ExponentPushToken[sensitive]";
    const access = "super-secret-token";
    const fetchMock = vi.fn(async () => new Response(`failed ${token} ${access}`, { status: 401 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      sendExpoPushMessages({
        accessToken: access,
        messages: [
          {
            token,
            title: "Title",
            body: "Body",
            channelId: "messages",
            highPriority: false,
          },
        ],
      }),
    ).rejects.toThrow(/expo_send_failed|expo_http_401/);

    try {
      await sendExpoPushMessages({
        accessToken: access,
        messages: [
          { token, title: "Title", body: "Body", channelId: "messages", highPriority: false },
        ],
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain(token);
      expect(message).not.toContain(access);
    }
  });

  it("evaluates truthy flag values", () => {
    expect(isTruthyFlag("true")).toBe(true);
    expect(isTruthyFlag("1")).toBe(true);
    expect(isTruthyFlag(" yes ")).toBe(true);
    expect(isTruthyFlag("false")).toBe(false);
    expect(isTruthyFlag(undefined)).toBe(false);
  });
});

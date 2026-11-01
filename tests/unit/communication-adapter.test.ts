import { afterEach, describe, expect, it, vi } from "vitest";
import { WhatsAppCloudAdapter } from "@/lib/scholar/comms/adapters.server";

describe("WhatsApp Cloud adapter", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses stored template parameters so the approved organization name reaches Meta", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ messages: [{ id: "provider-ref" }] }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new WhatsAppCloudAdapter("test-token", "phone-id");

    const result = await adapter.send("2348030000001", "Rendered content", {
      template: "absence_alert_v1",
      language: "en",
      parameters: ["Sherivs Academy", "Ada", "2026-11-01"],
    });

    expect(result).toEqual({ ok: true, providerRef: "provider-ref" });
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const payload = JSON.parse(String(request.body)) as {
      template: { components: { parameters: { text: string }[] }[] };
    };
    expect(payload.template.components[0]?.parameters.map(({ text }) => text)).toEqual([
      "Sherivs Academy",
      "Ada",
      "2026-11-01",
    ]);
  });

  it("sends a bounded session text for org selection", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ messages: [{ id: "session-ref" }] }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const adapter = new WhatsAppCloudAdapter("test-token", "phone-id");

    const result = await adapter.sendSessionText("2348030000001", "Choose an organization");

    expect(result).toEqual({ ok: true, providerRef: "session-ref" });
    const request = fetchMock.mock.calls[0]?.[1] as RequestInit;
    const payload = JSON.parse(String(request.body)) as { type: string; text: { body: string } };
    expect(payload.type).toBe("text");
    expect(payload.text.body).toBe("Choose an organization");
  });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import { Route } from "../../frontend/src/routes/api/public/cron/integrations-sync";

const { mockGetIntegrationVault } = vi.hoisted(() => ({
  mockGetIntegrationVault: vi.fn(),
}));

vi.mock("@/lib/integrations-hub/vault.server", () => ({
  getIntegrationVault: mockGetIntegrationVault,
}));

const originalCronSecret = process.env.CRON_SECRET;
const GET = (
  Route as unknown as {
    options: { server: { handlers: { GET: (input: { request: Request }) => Promise<Response> } } };
  }
).options.server.handlers.GET;

afterEach(() => {
  if (originalCronSecret === undefined) delete process.env.CRON_SECRET;
  else process.env.CRON_SECRET = originalCronSecret;
  mockGetIntegrationVault.mockReset();
});

describe("integrations-sync cron authorization", () => {
  it("fails closed when the cron secret is not configured", async () => {
    delete process.env.CRON_SECRET;

    const response = await GET({ request: new Request("https://app.example.test/cron") });

    expect(response.status).toBe(503);
    expect(mockGetIntegrationVault).not.toHaveBeenCalled();
  });

  it("rejects a missing or incorrect bearer credential before loading privileged services", async () => {
    process.env.CRON_SECRET = "cron-secret-fixture-not-a-production-value";

    const missing = await GET({ request: new Request("https://app.example.test/cron") });
    const incorrect = await GET({
      request: new Request("https://app.example.test/cron", {
        headers: { authorization: "Bearer incorrect-fixture" },
      }),
    });

    expect(missing.status).toBe(401);
    expect(incorrect.status).toBe(401);
    expect(mockGetIntegrationVault).not.toHaveBeenCalled();
  });

  it("accepts the documented bearer credential before returning unavailable-vault status", async () => {
    process.env.CRON_SECRET = "cron-secret-fixture-not-a-production-value";
    mockGetIntegrationVault.mockResolvedValue(null);

    const response = await GET({
      request: new Request("https://app.example.test/cron", {
        headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
      }),
    });

    expect(response.status).toBe(503);
    expect(mockGetIntegrationVault).toHaveBeenCalledOnce();
  });
});

/**
 * CoreGrid — V1-009: Resend EmailAdapter contract tests.
 *
 * Proves:
 * 1. Contract compliance — the adapter satisfies `EmailAdapter` and its
 *    receipt composes with the notification-contract delivery machinery.
 * 2. Fail-closed no-credential behavior — the typed BLOCKED_NO_CREDENTIAL
 *    result (`undeliverable("provider_not_configured")` naming the missing
 *    env var), with ZERO provider contact (fetch never called).
 * 3. Outbound message shapes are Zod-validated before any network contact.
 * 4. Retry semantics — a send is a single transport attempt; the pipeline
 *    owns retries via the structured `retryable` flag (429/5xx true).
 * 5. Secret hygiene — the credential value never appears in any result.
 *
 * No real provider and no real network is ever contacted: fetch is mocked.
 */
import { afterEach, describe, expect, it, vi, type MockInstance } from "vitest";
import {
  createResendEmailAdapter,
  createResendEmailProviderRegistry,
  RESEND_API_KEY_ENV,
  RESEND_CREDENTIAL_REFERENCE,
  RESEND_EMAIL_ENDPOINT,
  RESEND_EMAIL_PROVIDER_ID,
  RESEND_FROM_ADDRESS_ENV,
  resendEmailConfigFromEnv,
  ResendEmailPayloadSchema,
  type ServerEnv,
} from "../../../frontend/src/lib/communications/resend-email.server";
import {
  markDelivered,
  type Notification,
} from "../../../frontend/src/lib/notifications/notification-contract";
import {
  isEmailDeliveryReceipt,
  withEmailFailurePolicy,
  type EmailAdapter,
  type EmailDeliveryFailure,
  type EmailDeliveryReceipt,
  type EmailDeliveryResult,
  type EmailProviderRegistry,
  type EmailSendCommand,
} from "../../../frontend/src/lib/notifications/email-adapter-contract";
import { createAdapterFailurePolicy } from "../../../frontend/src/lib/adapters/failure-policy";

const SENTINEL_KEY = "resend-unit-test-sentinel-credential";
const SENTINEL_FROM = "no-reply@coregrid-unit-test.invalid";

function makeNotification(overrides: Partial<Notification> = {}): Notification {
  return {
    id: "notif-v1-009",
    tenantRef: "tenant-a",
    recipientRef: "user-1",
    audienceKind: "user",
    category: "general",
    subject: "Attendance summary",
    body: "Weekly attendance summary is ready.",
    actionRef: null,
    state: "queued",
    createdAt: "2026-10-03T00:00:00.000Z",
    ...overrides,
  };
}

function makeCommand(overrides: Partial<EmailSendCommand> = {}): EmailSendCommand {
  return {
    notification: makeNotification(),
    recipientAddress: "parent@example.edu",
    subject: "Attendance summary",
    body: "Weekly attendance summary is ready.",
    ...overrides,
  };
}

function configuredEnv(): ServerEnv {
  return { [RESEND_API_KEY_ENV]: SENTINEL_KEY, [RESEND_FROM_ADDRESS_ENV]: SENTINEL_FROM };
}

function emptyEnv(): ServerEnv {
  return {};
}

function configuredRegistry(env: ServerEnv = configuredEnv()): EmailProviderRegistry {
  return createResendEmailProviderRegistry(env);
}

/** Configured adapter + registry pair: the "credentials exist" path. */
function liveAdapter(): { adapter: EmailAdapter; registry: EmailProviderRegistry } {
  return {
    adapter: createResendEmailAdapter(resendEmailConfigFromEnv(configuredEnv())),
    registry: configuredRegistry(),
  };
}

function jsonBodyOf(call: Parameters<typeof fetch>[1]): Record<string, unknown> {
  return JSON.parse(String(call?.body ?? "{}")) as Record<string, unknown>;
}

let fetchMock: MockInstance | null = null;

function mockFetch(handler: () => Response | Promise<Response>): MockInstance {
  const spy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => handler());
  fetchMock = spy;
  return spy;
}

/** Type-guard assertion: narrows the result to the failure variant for `.reason` checks. */
function assertNotReceipt(result: EmailDeliveryResult): asserts result is EmailDeliveryFailure {
  if (isEmailDeliveryReceipt(result)) throw new Error("expected a failure result, got a receipt");
}

afterEach(() => {
  fetchMock?.mockRestore();
  fetchMock = null;
});

describe("Resend adapter — EmailAdapter contract compliance", () => {
  it("declares the resend provider id", () => {
    const { adapter } = liveAdapter();
    expect(adapter.providerId).toBe(RESEND_EMAIL_PROVIDER_ID);
  });

  it("sends a Zod-valid payload and resolves to a provider-confirmed receipt", async () => {
    const spy = mockFetch(
      () => new Response(JSON.stringify({ id: "re_msg_1", object: "email" }), { status: 200 }),
    );
    const { adapter, registry } = liveAdapter();
    const result = await adapter.send(makeCommand(), registry);

    expect(isEmailDeliveryReceipt(result)).toBe(true);
    const receipt = result as EmailDeliveryReceipt;
    expect(receipt.notificationId).toBe("notif-v1-009");
    expect(receipt.channel).toBe("email");
    expect(receipt.providerId).toBe(RESEND_EMAIL_PROVIDER_ID);
    expect(receipt.providerMessageId).toBe("re_msg_1");
    expect(receipt.confirmedAt).toBeTruthy();

    expect(spy).toHaveBeenCalledTimes(1);
    const [url, init] = spy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(RESEND_EMAIL_ENDPOINT);
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${SENTINEL_KEY}`);

    const body = jsonBodyOf(init);
    expect(ResendEmailPayloadSchema.safeParse(body).success).toBe(true);
    expect(body.to).toBe("parent@example.edu");
    expect(body.subject).toBe("Attendance summary");
    // Untrusted provider output is minimized: only the consumed fields survive.
    expect(JSON.stringify(receipt)).not.toContain("object");
  });

  it("produces a receipt the notification contract can mark delivered with", async () => {
    mockFetch(() => new Response(JSON.stringify({ id: "re_msg_2" }), { status: 200 }));
    const { adapter, registry } = liveAdapter();
    const result = await adapter.send(makeCommand(), registry);
    expect(isEmailDeliveryReceipt(result)).toBe(true);

    const notification = makeNotification();
    const transition = markDelivered(notification, result as EmailDeliveryReceipt);
    expect(transition.ok).toBe(true);
    if (transition.ok) expect(transition.notification.state).toBe("delivered");
  });

  it("refuses to mark delivered from a forged receipt while a genuine one composes", () => {
    const notification = makeNotification();
    expect(
      markDelivered(notification, {
        notificationId: "notif-OTHER",
        channel: "email",
        providerId: RESEND_EMAIL_PROVIDER_ID,
        providerMessageId: "re_forged",
        confirmedAt: "2026-10-03T00:00:00.000Z",
      }).ok,
    ).toBe(false);
  });
});

describe("Resend adapter — fail-closed no-credential (BLOCKED_NO_CREDENTIAL)", () => {
  it("blocks with the typed result when RESEND_API_KEY is absent, and contacts nothing", async () => {
    mockFetch(() => {
      throw new Error("provider must never be contacted without credentials");
    });
    const adapter = createResendEmailAdapter(resendEmailConfigFromEnv(emptyEnv()));
    const result = await adapter.send(makeCommand(), configuredRegistry(emptyEnv()));

    expect(isEmailDeliveryReceipt(result)).toBe(false);
    assertNotReceipt(result);
    expect(result).toMatchObject({ outcome: "undeliverable", code: "provider_not_configured" });
    expect(result.reason).toContain("BLOCKED_NO_CREDENTIAL");
    expect(result.reason).toContain(RESEND_API_KEY_ENV);
    expect(result.reason).toContain("no provider call was attempted");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still blocks when a registry lies about configuration (defense in depth)", async () => {
    mockFetch(() => {
      throw new Error("provider must never be contacted without credentials");
    });
    const adapter = createResendEmailAdapter({ apiKey: null, fromAddress: SENTINEL_FROM });
    const lyingRegistry: EmailProviderRegistry = {
      isProviderConfigured: () => true,
      credentialReferenceFor: () => RESEND_CREDENTIAL_REFERENCE,
    };
    const result = await adapter.send(makeCommand(), lyingRegistry);

    assertNotReceipt(result);
    expect(result).toMatchObject({ outcome: "undeliverable", code: "provider_not_configured" });
    expect(result.reason).toContain(RESEND_API_KEY_ENV);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("blocks when the sender address is missing even with a usable key", async () => {
    mockFetch(() => {
      throw new Error("provider must never be contacted without a verified sender");
    });
    const adapter = createResendEmailAdapter({ apiKey: SENTINEL_KEY, fromAddress: null });
    const result = await adapter.send(makeCommand(), configuredRegistry());

    assertNotReceipt(result);
    expect(result).toMatchObject({ outcome: "undeliverable", code: "provider_not_configured" });
    expect(result.reason).toContain(RESEND_FROM_ADDRESS_ENV);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("exposes a credential REFERENCE (pointer), never the credential value", () => {
    const registry = configuredRegistry(configuredEnv());
    expect(registry.credentialReferenceFor(RESEND_EMAIL_PROVIDER_ID)).toBe("env://RESEND_API_KEY");
    expect(registry.credentialReferenceFor(RESEND_EMAIL_PROVIDER_ID)).not.toBe(SENTINEL_KEY);
    expect(registry.credentialReferenceFor("twilio")).toBeNull();
    expect(registry.isProviderConfigured("other-provider")).toBe(false);
  });

  it("blocks restricted categories before any provider contact", async () => {
    mockFetch(() => {
      throw new Error("restricted categories must never reach the provider");
    });
    const { adapter, registry } = liveAdapter();
    const result = await adapter.send(
      makeCommand({ notification: makeNotification({ category: "approval_request" }) }),
      registry,
    );
    expect(result).toMatchObject({ outcome: "undeliverable", code: "category_not_permitted" });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Resend adapter — outbound shape validation (§26)", () => {
  it("refuses a malformed recipient address locally, without provider contact", async () => {
    mockFetch(() => {
      throw new Error("an invalid address must never reach the provider");
    });
    const { adapter, registry } = liveAdapter();
    const result = await adapter.send(makeCommand({ recipientAddress: "not-an-email" }), registry);
    expect(result).toMatchObject({
      outcome: "failed",
      code: "provider_error",
      retryable: false,
    });
    assertNotReceipt(result);
    expect(result.reason).toContain("no provider call was attempted");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses an oversized subject locally, without provider contact", async () => {
    mockFetch(() => {
      throw new Error("an oversized payload must never reach the provider");
    });
    const { adapter, registry } = liveAdapter();
    const result = await adapter.send(makeCommand({ subject: "x".repeat(501) }), registry);
    expect(result).toMatchObject({ outcome: "failed", code: "provider_error", retryable: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("Resend adapter — provider error mapping and retry semantics", () => {
  it("maps 429 to a retryable failure and never logs the credential", async () => {
    mockFetch(() => new Response(JSON.stringify({ message: "rate limited" }), { status: 429 }));
    const { adapter, registry } = liveAdapter();
    const result = await adapter.send(makeCommand(), registry);
    expect(isEmailDeliveryReceipt(result)).toBe(false);
    assertNotReceipt(result);
    expect(result).toMatchObject({ outcome: "failed", code: "provider_error", retryable: true });
    expect(result.reason).toContain("429");
    expect(result.reason).not.toContain(SENTINEL_KEY);
  });

  it("maps 5xx to retryable and other 4xx to non-retryable failures", async () => {
    mockFetch(() => new Response("{}", { status: 503 }));
    const { adapter, registry } = liveAdapter();
    const serverError = await adapter.send(makeCommand(), registry);
    expect(isEmailDeliveryReceipt(serverError)).toBe(false);
    expect(
      !isEmailDeliveryReceipt(serverError) &&
        serverError.outcome === "failed" &&
        serverError.retryable,
    ).toBe(true);

    mockFetch(() => new Response("{}", { status: 402 }));
    const clientError = await adapter.send(makeCommand(), registry);
    expect(isEmailDeliveryReceipt(clientError)).toBe(false);
    expect(
      !isEmailDeliveryReceipt(clientError) &&
        clientError.outcome === "failed" &&
        clientError.retryable,
    ).toBe(false);
  });

  it("contains a network failure as a structured retryable result", async () => {
    mockFetch(() => {
      throw new Error("dns resolution failed");
    });
    const { adapter, registry } = liveAdapter();
    const result = await adapter.send(makeCommand(), registry);
    expect(result).toMatchObject({ outcome: "failed", code: "provider_error", retryable: true });
    assertNotReceipt(result);
    expect(result.reason).toContain("dns resolution failed");
    expect(result.reason).not.toContain(SENTINEL_KEY);
  });

  it("never asserts delivery when a 2xx body carries no usable message id", async () => {
    mockFetch(() => new Response("<html>unexpected</html>", { status: 200 }));
    const { adapter, registry } = liveAdapter();
    const result = await adapter.send(makeCommand(), registry);
    expect(isEmailDeliveryReceipt(result)).toBe(false);
    assertNotReceipt(result);
    expect(result).toMatchObject({ outcome: "failed", code: "provider_error", retryable: false });
    expect(result.reason).toContain("NOT asserted");
  });

  it("performs exactly ONE transport attempt — retries belong to the pipeline (J-045)", async () => {
    let calls = 0;
    const failing: EmailAdapter = {
      providerId: RESEND_EMAIL_PROVIDER_ID,
      send: async () => {
        calls += 1;
        return { outcome: "failed", code: "provider_error", reason: "transient", retryable: true };
      },
    };
    // The policy DECLARES three attempts, but the email contract pins the
    // transport to a single attempt per send (non-idempotent side effect).
    const policy = createAdapterFailurePolicy({
      provider: "email",
      timeoutMs: 1_000,
      maxAttempts: 3,
      backoffBaseMs: 1,
      backoffCapMs: 4,
      degradedAfterFailures: 3,
      degradedWindowMs: 10_000,
      breakerFailureThreshold: 5,
      breakerResetMs: 10_000,
    });
    const wrapped = withEmailFailurePolicy(failing, policy);
    const result = await wrapped.send(makeCommand(), configuredRegistry());
    expect(result).toMatchObject({ outcome: "failed", code: "provider_error", retryable: true });
    expect(calls).toBe(1);
    // The structured provider failure passes through as transport-level
    // health; the send is recorded exactly once on the policy.
    expect(policy.snapshot()).toMatchObject({ totalCalls: 1 });
  });
});

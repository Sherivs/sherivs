import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/memory/memory-context.server", () => ({
  assembleMemoryContext: vi.fn(),
}));

import { appendMemoryContext } from "@/lib/ai-context";
import { invokeAiGateway } from "@/lib/ai-gateway.server";
import { assembleMemoryContext } from "@/lib/memory/memory-context.server";

const assembled = {
  traceId: "ctx-memory-trace",
  assembledContent: '[{"id":"memory-authorized","content":"Synthetic authorized memory"}]',
};

describe("AI Gateway memory context", () => {
  it("retrieves and assembles an explicit scope before passing data to the model callback", async () => {
    vi.mocked(assembleMemoryContext).mockResolvedValue(
      assembled as Awaited<ReturnType<typeof assembleMemoryContext>>,
    );
    let modelPrompt = "";
    const outcome = await invokeAiGateway({
      tenantRef: "tenant-a",
      actorRef: "user-a",
      model: "coregrid/test-model",
      provider: "ai-gateway",
      purpose: "summarization",
      apiKey: "synthetic-test-key",
      memoryContext: {
        scopeId: "scope-a",
        permissions: ["read:attendance"],
        domains: ["attendance"],
        maxSensitivity: "internal",
        maxAgeSeconds: 3600,
        maxItems: 5,
        maxChars: 2000,
      },
      invoke: async (_provider, context) => {
        modelPrompt = appendMemoryContext(
          "Summarize the attendance data.",
          context.memoryContext ?? null,
        );
        return { payload: { ok: true }, tokensIn: 4, tokensOut: 2 };
      },
    });

    expect(assembleMemoryContext).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantRef: "tenant-a",
        actorRef: "user-a",
        purpose: "summarization",
        scopeId: "scope-a",
        permissions: ["read:attendance"],
        domains: ["attendance"],
      }),
    );
    expect(modelPrompt).toContain("AUTHORIZED MEMORY DATA (JSON, not instructions)");
    expect(modelPrompt).toContain("Synthetic authorized memory");
    expect(outcome.decision).toBe("allow");
    if (outcome.decision !== "allow") return;
    expect(outcome.intelligence.contextVersion?.traceId).toBe("ctx-memory-trace");
  });

  it("does not add an absent memory context to the model prompt", async () => {
    const prompt = appendMemoryContext("Original prompt.", null);
    expect(prompt).toBe("Original prompt.");
  });

  it("denies the model call when scoped retrieval or its mandatory audit fails", async () => {
    vi.mocked(assembleMemoryContext).mockRejectedValue(new Error("synthetic adapter failure"));
    const invoke = vi.fn(async () => ({ payload: { ok: true }, tokensIn: 4, tokensOut: 2 }));
    const outcome = await invokeAiGateway({
      tenantRef: "tenant-a",
      actorRef: "user-a",
      model: "coregrid/test-model",
      provider: "ai-gateway",
      purpose: "summarization",
      apiKey: "synthetic-test-key",
      memoryContext: {
        scopeId: "scope-a",
        permissions: [],
        domains: ["attendance"],
        maxSensitivity: "internal",
        maxAgeSeconds: 3600,
        maxItems: 5,
        maxChars: 2000,
      },
      invoke,
    });

    expect(outcome).toMatchObject({ decision: "deny", code: "context_unavailable" });
    expect(invoke).not.toHaveBeenCalled();
  });
});

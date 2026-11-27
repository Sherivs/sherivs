/**
 * M6 (mission E-016, ADR-148) — server functions behind /console/onboarding.
 *
 * Each one: verified session (requireSupabaseAuth) -> zod input (ids and the reviewed plan hash
 * only; never an organization id, an approver or an amount) -> onboarding-queue.server.ts,
 * which checks the console capability, AAL2 and the passkey step-up and calls the service-role
 * database functions. Server-only modules are imported inside the handlers so this file is safe
 * to import from components.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { OnboardingConsoleDeps } from "./onboarding-queue.server";

type Ctx = { supabase: unknown; userId: string; claims?: { aal?: unknown; email?: string } };
type Rpc = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
};

const RequestId = z.string().uuid();
const PlanHash = z.string().regex(/^[0-9a-f]{64}$/);
const Revision = z.number().int().min(0).max(1_000_000);

const AuthenticationResponseSchema = z.object({
  id: z.string().min(16).max(1024),
  rawId: z.string().min(1).max(1024),
  type: z.literal("public-key"),
  response: z.object({
    clientDataJSON: z.string().min(16).max(16_384),
    authenticatorData: z.string().min(16).max(16_384),
    signature: z.string().min(16).max(16_384),
    userHandle: z.string().max(256).optional(),
  }),
  clientExtensionResults: z.record(z.string(), z.unknown()).optional(),
  authenticatorAttachment: z.string().max(32).optional(),
});

async function deps(ctx: Ctx): Promise<OnboardingConsoleDeps> {
  const [{ supabaseAdmin }, server, { writeAuditRecord }, { assertInternalAal2 }, time] =
    await Promise.all([
      import("@/integrations/supabase/client.server"),
      import("./onboarding-queue.server"),
      import("@/lib/server/write-audit"),
      import("@/lib/security/mfa-server"),
      import("@/lib/kernel/time-authority"),
    ]);
  const clock = new time.TimeAuthority(new time.SystemClock());
  const rpc = ctx.supabase as Rpc;
  return {
    async hasCapability(capability) {
      const { data, error } = await rpc.rpc("has_internal_console_capability", {
        p_capability: capability,
      });
      if (error) throw new server.OnboardingConsoleError("unavailable");
      return data === true;
    },
    assertAal2: () => {
      try {
        assertInternalAal2(ctx.claims);
      } catch {
        throw new server.OnboardingConsoleError("mfa_required");
      }
    },
    store: server.supabaseOnboardingStore(supabaseAdmin as never),
    stepUp: {
      async assertionOptions(input) {
        const { service, origin, rateKey } = await webauthn(ctx.userId);
        return service.assertionOptions({ ...input, origin, rateKey });
      },
      async verifyAssertion(input) {
        const { service, origin, rateKey } = await webauthn(ctx.userId);
        await service.verifyAssertion({
          userId: input.userId,
          origin,
          rateKey,
          response: input.response as never,
          challengeAccepted: input.challengeAccepted,
        });
      },
    },
    async audit(entry) {
      await writeAuditRecord(supabaseAdmin as never, {
        action: entry.action,
        gate: "has_internal_console_capability",
        tenantId: null,
        actorId: ctx.userId,
        actorEmail: ctx.claims?.email ?? null,
        table: "onboarding_requests",
        recordId: entry.recordId,
        outcome: entry.outcome,
        details: entry.details,
      });
    },
    nowMs: () => clock.now().atMs,
  };
}

async function webauthn(userId: string) {
  const { createProductionWebAuthnService, requestOrigin } =
    await import("@/lib/auth/webauthn-supabase.server");
  const { clientIpFromHeaders } = await import("@/lib/security/request-safety");
  const request = getRequest();
  return {
    service: await createProductionWebAuthnService(),
    origin: requestOrigin(request),
    rateKey: `user:${userId}:${clientIpFromHeaders(request.headers)}`,
  };
}

/** Errors leave the server as stable codes only. */
async function run<T>(fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    const { OnboardingConsoleError } = await import("./onboarding-queue.server");
    throw new Error(err instanceof OnboardingConsoleError ? err.code : "unavailable");
  }
}

export const loadOnboardingQueue = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) =>
    run(async () => {
      const { loadQueue } = await import("./onboarding-queue.server");
      const c = context as unknown as Ctx;
      return loadQueue(c, await deps(c));
    }),
  );

export const loadOnboardingRequest = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ requestId: RequestId }).parse(input))
  .handler(async ({ context, data }) =>
    run(async () => {
      const { loadRequestDetail } = await import("./onboarding-queue.server");
      const c = context as unknown as Ctx;
      return loadRequestDetail(c, await deps(c), data.requestId);
    }),
  );

export const assignOnboardingRequestToSelf = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ requestId: RequestId }).parse(input))
  .handler(async ({ context, data }) =>
    run(async () => {
      const { assignToSelf } = await import("./onboarding-queue.server");
      const c = context as unknown as Ctx;
      return assignToSelf(c, await deps(c), data.requestId);
    }),
  );

export const generateOnboardingPlan = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ requestId: RequestId, expectedRevision: Revision }).parse(input),
  )
  .handler(async ({ context, data }) =>
    run(async () => {
      const { generateRequestPlan } = await import("./onboarding-queue.server");
      const c = context as unknown as Ctx;
      return generateRequestPlan(c, await deps(c), data);
    }),
  );

export const saveOnboardingPlanEdit = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({ requestId: RequestId, expectedRevision: Revision, plan: z.unknown() })
      .refine((v) => JSON.stringify(v.plan ?? null).length <= 65_536, "plan too large")
      .parse(input),
  )
  .handler(async ({ context, data }) =>
    run(async () => {
      const { saveRequestPlanEdit } = await import("./onboarding-queue.server");
      const c = context as unknown as Ctx;
      return saveRequestPlanEdit(c, await deps(c), data);
    }),
  );

export const beginOnboardingApproval = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ requestId: RequestId, planHash: PlanHash }).parse(input),
  )
  .handler(async ({ context, data }) =>
    run(async () => {
      const { beginPlanApproval } = await import("./onboarding-queue.server");
      const c = context as unknown as Ctx;
      return beginPlanApproval(c, await deps(c), data) as Promise<{
        options: never;
        nonce: string;
      }>;
    }),
  );

export const approveAndProvisionOnboarding = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        requestId: RequestId,
        planHash: PlanHash,
        nonce: z.string().length(22),
        response: AuthenticationResponseSchema,
      })
      .parse(input),
  )
  .handler(async ({ context, data }) =>
    run(async () => {
      const { approveAndProvision } = await import("./onboarding-queue.server");
      const c = context as unknown as Ctx;
      const result = await approveAndProvision(c, await deps(c), data);
      return JSON.parse(JSON.stringify(result)) as {
        ok: boolean;
        replay?: boolean;
        organizationId?: string;
        code?: string;
        appliedResult?: Record<string, never>;
      };
    }),
  );

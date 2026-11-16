/**
 * JARVIS-LIVE-01: server functions behind the owner's alerts console (Authority: Owner; Origin:
 * owner instruction of 2026-11-16; Creator: Claude; Created: 2026-11-16; Status: Active).
 *
 * Every function requires a signed-in session AND the platform super-admin role (the sheriff),
 * resolved by the database, never by a client claim. Approving needs a fresh passkey assertion
 * bound to that exact approval and decision (step-up.ts); denying and acknowledging do not,
 * because both move toward the safe state. All persistence goes through approval-store.server.ts,
 * which runs the existing approval-inbox rules. Results carry codes and counts; no secret,
 * destination or provider text is returned.
 */
import { createServerFn } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { clientIpFromHeaders } from "@/lib/security/request-safety";
import { WEBAUTHN_PUBLIC_ERROR } from "@/lib/auth/webauthn-policy";

/** J-023: time enters only via the kernel time-authority (server-side, loaded on demand). */
async function serverNowMs(): Promise<number> {
  const { SystemClock, TimeAuthority } = await import("@/lib/kernel/time-authority");
  return new TimeAuthority(new SystemClock()).now().atMs;
}

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

const ApprovalIdSchema = z.string().regex(/^[A-Za-z0-9._:-]{1,128}$/);
const DecisionSchema = z.enum(["approve", "deny"]);

type Rpc = {
  rpc: (
    fn: string,
    args?: Record<string, unknown>,
  ) => PromiseLike<{ data: unknown; error: unknown }>;
};

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function assertSheriff(context: { supabase: unknown; userId: string }): Promise<void> {
  const { data, error } = await (context.supabase as Rpc).rpc("is_super_admin");
  if (error || data !== true) throw new Error("Not authorized");
}

async function loadWebAuthn() {
  const { createProductionWebAuthnService, requestOrigin } =
    await import("@/lib/auth/webauthn-supabase.server");
  return { service: await createProductionWebAuthnService(), origin: requestOrigin(getRequest()) };
}

const stepUpRateKey = (userId: string) =>
  `user:${userId}:${clientIpFromHeaders(getRequest().headers)}`;

function publicWebAuthnMessage(err: unknown): string {
  const message = err instanceof Error ? err.message : "";
  return Object.values(WEBAUTHN_PUBLIC_ERROR).includes(
    message as (typeof WEBAUTHN_PUBLIC_ERROR)[keyof typeof WEBAUTHN_PUBLIC_ERROR],
  )
    ? message
    : WEBAUTHN_PUBLIC_ERROR.auth_failed;
}

export interface OwnerConsoleView {
  readonly storeReady: boolean;
  readonly gateway: {
    readonly mode: "test" | "live";
    readonly channels: Readonly<Record<string, boolean>>;
    readonly liveAuthorizationExpiresAt: string | null;
  } | null;
  readonly alerts: ReadonlyArray<{
    readonly id: string;
    readonly severity: string;
    readonly title: string;
    readonly source: string;
    readonly status: string;
    readonly createdAt: string;
    readonly deliveries: ReadonlyArray<{
      readonly channel: string;
      readonly kind: string;
      readonly status: string;
      readonly reason: string | null;
    }>;
  }>;
  readonly approvals: ReadonlyArray<{
    readonly approvalId: string;
    readonly actionId: string;
    readonly riskTier: string;
    readonly requestedAt: string;
    readonly expiresAt: string;
    readonly requesterRef: string;
  }>;
  readonly passkeyCount: number;
}

type Row = Record<string, unknown>;
const str = (v: unknown) => (typeof v === "string" ? v : "");

export const loadOwnerConsole = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<OwnerConsoleView> => {
    await assertSheriff(context);
    const db = (await admin()) as unknown as {
      from: (t: string) => {
        select: (c: string) => PromiseLike<{ data: Row[] | null; error: unknown }> & {
          order: (
            c: string,
            o: { ascending: boolean },
          ) => {
            limit: (n: number) => PromiseLike<{ data: Row[] | null; error: unknown }>;
          };
          eq: (
            c: string,
            v: unknown,
          ) => {
            order: (
              c: string,
              o: { ascending: boolean },
            ) => {
              limit: (n: number) => PromiseLike<{ data: Row[] | null; error: unknown }>;
            };
          };
          maybeSingle: () => PromiseLike<{ data: Row | null; error: unknown }>;
        };
      };
    };

    let passkeyCount = 0;
    try {
      const { service, origin } = await loadWebAuthn();
      passkeyCount = (await service.list({ userId: context.userId, origin })).length;
    } catch {
      passkeyCount = 0;
    }

    const nowMs = await serverNowMs();
    const approvalsQ = await db
      .from("jarvis_approval_requests")
      .select("approval_id, action_id, risk_tier, requested_at, expires_at, requester_ref, status")
      .eq("status", "pending")
      .order("requested_at", { ascending: false })
      .limit(50);
    const approvals = (approvalsQ.data ?? [])
      .filter((r) => Date.parse(str(r.expires_at)) > nowMs)
      .map((r) => ({
        approvalId: str(r.approval_id),
        actionId: str(r.action_id),
        riskTier: str(r.risk_tier),
        requestedAt: str(r.requested_at),
        expiresAt: str(r.expires_at),
        requesterRef: str(r.requester_ref),
      }));

    const alertsQ = await db
      .from("owner_alerts")
      .select("id, severity, title, source, status, created_at")
      .order("created_at", { ascending: false })
      .limit(50);
    if (alertsQ.error) {
      return { storeReady: false, gateway: null, alerts: [], approvals, passkeyCount };
    }
    const alertRows = alertsQ.data ?? [];
    const deliveriesQ = await db
      .from("owner_alert_deliveries")
      .select("alert_id, channel, destination_kind, status, reason_code, created_at")
      .order("created_at", { ascending: false })
      .limit(400);
    const byAlert = new Map<string, OwnerConsoleView["alerts"][number]["deliveries"][number][]>();
    for (const d of deliveriesQ.data ?? []) {
      const list = byAlert.get(str(d.alert_id)) ?? [];
      list.push({
        channel: str(d.channel),
        kind: str(d.destination_kind),
        status: str(d.status),
        reason: typeof d.reason_code === "string" ? d.reason_code : null,
      });
      byAlert.set(str(d.alert_id), list);
    }
    const settings = await db
      .from("owner_alert_settings")
      .select("mode, live_expires_at")
      .maybeSingle();
    const channelsQ = await db.from("owner_alert_channels").select("channel, enabled");
    const channels: Record<string, boolean> = {};
    for (const c of (channelsQ.data ?? []) as Row[]) channels[str(c.channel)] = c.enabled === true;

    return {
      storeReady: true,
      gateway: settings.data
        ? {
            mode: settings.data.mode === "live" ? "live" : "test",
            channels,
            liveAuthorizationExpiresAt:
              typeof settings.data.live_expires_at === "string"
                ? settings.data.live_expires_at
                : null,
          }
        : null,
      alerts: alertRows.map((a) => ({
        id: str(a.id),
        severity: str(a.severity),
        title: str(a.title),
        source: str(a.source),
        status: str(a.status),
        createdAt: str(a.created_at),
        deliveries: byAlert.get(str(a.id)) ?? [],
      })),
      approvals,
      passkeyCount,
    };
  });

export const acknowledgeOwnerAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) => z.object({ alertId: z.string().uuid() }).parse(input))
  .handler(async ({ context, data }) => {
    await assertSheriff(context);
    const db = (await admin()) as unknown as {
      from: (t: string) => {
        update: (p: Row) => {
          eq: (
            c: string,
            v: unknown,
          ) => {
            eq: (
              c: string,
              v: unknown,
            ) => {
              select: (c: string) => PromiseLike<{ data: Row[] | null; error: unknown }>;
            };
          };
        };
      };
    };
    const updated = await db
      .from("owner_alerts")
      .update({
        status: "acknowledged",
        acknowledged_at: new Date(await serverNowMs()).toISOString(),
        acknowledged_by: context.userId,
      })
      .eq("id", data.alertId)
      .eq("status", "open")
      .select("id");
    if (updated.error) throw new Error("Alert store unavailable");
    return { acknowledged: (updated.data ?? []).length === 1 };
  });

export const beginOwnerApprovalStepUp = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z.object({ approvalId: ApprovalIdSchema, decision: DecisionSchema }).parse(input),
  )
  .handler(async ({ context, data }) => {
    await assertSheriff(context);
    const { newStepUpNonce, stepUpChallenge } = await import("./step-up");
    const db = (await admin()) as unknown as {
      from: (t: string) => {
        select: (c: string) => {
          eq: (
            c: string,
            v: unknown,
          ) => {
            maybeSingle: () => PromiseLike<{ data: Row | null; error: unknown }>;
          };
        };
      };
    };
    const found = await db
      .from("jarvis_approval_requests")
      .select("status, expires_at")
      .eq("approval_id", data.approvalId)
      .maybeSingle();
    if (
      found.error ||
      !found.data ||
      found.data.status !== "pending" ||
      Date.parse(str(found.data.expires_at)) <= (await serverNowMs())
    ) {
      throw new Error("This approval is no longer pending.");
    }
    try {
      const { service, origin } = await loadWebAuthn();
      const nonce = newStepUpNonce();
      const options = await service.assertionOptions({
        userId: context.userId,
        origin,
        rateKey: stepUpRateKey(context.userId),
        challenge: stepUpChallenge({
          userId: context.userId,
          approvalId: data.approvalId,
          decision: data.decision,
          nonce,
        }),
      });
      return { options, nonce };
    } catch (err) {
      throw new Error(publicWebAuthnMessage(err));
    }
  });

export const decideOwnerApproval = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: unknown) =>
    z
      .object({
        approvalId: ApprovalIdSchema,
        decision: DecisionSchema,
        nonce: z.string().length(22).optional(),
        response: AuthenticationResponseSchema.optional(),
      })
      .refine((v) => v.decision === "deny" || (v.nonce && v.response), {
        message: "A passkey assertion is required to approve.",
      })
      .parse(input),
  )
  .handler(async ({ context, data }) => {
    await assertSheriff(context);
    const { stepUpChallengeMatches } = await import("./step-up");
    const { decidePersistedApproval } = await import("./approval-store.server");
    const { writeAuditRecord } = await import("@/lib/server/write-audit");

    let stepUpVerified = false;
    if (data.decision === "approve") {
      try {
        const { service, origin } = await loadWebAuthn();
        const binding = {
          userId: context.userId,
          approvalId: data.approvalId,
          decision: data.decision,
          nonce: data.nonce as string,
        };
        await service.verifyAssertion({
          userId: context.userId,
          origin,
          rateKey: stepUpRateKey(context.userId),
          response: data.response as never,
          challengeAccepted: (signed) => stepUpChallengeMatches(signed, binding),
        });
        stepUpVerified = true;
      } catch (err) {
        throw new Error(publicWebAuthnMessage(err));
      }
    }

    const sb = await admin();
    const result = await decidePersistedApproval(sb as never, {
      approvalId: data.approvalId,
      decision: data.decision,
      approverId: context.userId,
      approverRole: "sheriff",
      passkeyStepUpVerified: stepUpVerified,
      nowIso: new Date(await serverNowMs()).toISOString(),
    });
    try {
      await writeAuditRecord(sb as never, {
        action: `jarvis.approval.${data.decision}`,
        gate: "is_super_admin:passkey_step_up",
        tenantId: null,
        actorId: context.userId,
        table: "jarvis_approval_requests",
        outcome: result.ok ? "succeeded" : "denied",
        details: { approval_id: data.approvalId, code: result.ok ? null : result.code },
      });
    } catch {
      /* the approval trail in jarvis_approval_events is the record of truth */
    }
    return result;
  });

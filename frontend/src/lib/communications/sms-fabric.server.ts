/**
 * Sherivs — SMS through the tenant-scoped communication fabric (COMMS-03). Server only.
 *
 * The database fabric (`comms_propose_send` → `comms_approve_send` → `comms_send`) decides
 * WHAT may be texted: approved template, verified organization member, opt-in, daily caps
 * and wallet metering (`meter_usage`). It records an `outbound_messages` row with status
 * `queued` only when the organization's `sms_live` flag is on. This module is the
 * dispatcher for those rows and the verified delivery-report intake.
 *
 * - The recipient is NEVER taken from a caller, a model or the client: it is re-resolved
 *   here from the queued row's `recipient_user_id` against the organization's active
 *   membership and the member's stored phone. A mismatch fails the row closed.
 * - Consent is re-checked at send time (an opt-out can land after the row was queued) and
 *   the organization's plan must still include SMS (Growth, Professional, Enterprise).
 * - At-most-once: a row is CLAIMED atomically (`provider_ref IS NULL` → claim token) before
 *   the provider is contacted, so two workers can never both send it.
 * - Audit: `outbound_messages` carries `trg_outbound_messages_comms_audit` (migration
 *   20261101001000), which appends every insert and status change to `audit_chain` in the
 *   same transaction. The proposal and approval rows are covered by the same trigger family,
 *   so no second audit writer is added here.
 * - Delivery reports are verified by a per-message HMAC token (the provider does not sign
 *   webhooks), resolve the organization from OUR row, and ignore unknown ids.
 */
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { SystemClock, TimeAuthority } from "../kernel/time-authority";
import { tenantTierEntitlement } from "../payments/tier-entitlements";
import { tenantId } from "../tenant-core";
import {
  BULKSMS_NG_WEBHOOK_SECRET_ENV,
  BULKSMS_NIGERIA_PROVIDER_ID,
  mapBulkSmsDeliveryStatus,
  normalizeSmsRecipient,
  verifyBulkSmsCallback,
  type ServerEnv,
} from "./bulksms-nigeria.server";
import type { SmsGatewaySelection } from "./sms-gateway-contract";

/** J-023: time enters only via the kernel time-authority. */
const timeAuthority = new TimeAuthority(new SystemClock());
const isoNow = (): string => timeAuthority.now().at;

interface DbResult<T = unknown> {
  data: T | null;
  error: { message: string } | null;
}
interface DbQuery extends PromiseLike<DbResult> {
  select(columns: string): DbQuery;
  eq(column: string, value: unknown): DbQuery;
  in(column: string, values: unknown[]): DbQuery;
  is(column: string, value: null): DbQuery;
  limit(count: number): DbQuery;
  maybeSingle(): PromiseLike<DbResult>;
  update(values: Record<string, unknown>): DbQuery;
}
export interface SmsFabricDatabase {
  from(table: string): DbQuery;
  rpc(name: string, args: Record<string, unknown>): PromiseLike<DbResult>;
}

const CLAIM_PREFIX = "claim:";
const ROW_COLUMNS =
  "id,org_id,school_id,channel,status,to_address,recipient_user_id,category,priority,body";

const QueuedRowSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  school_id: z.string().uuid(),
  channel: z.literal("sms"),
  status: z.literal("queued"),
  to_address: z.string(),
  recipient_user_id: z.string().uuid().nullable(),
  category: z.string(),
  priority: z.string(),
  body: z.string(),
});
type QueuedRow = z.infer<typeof QueuedRowSchema>;

export type SmsDispatchOutcome =
  | { id: string; outcome: "sent"; providerMessageId: string }
  | { id: string; outcome: "failed"; code: string; reason: string; retryable: boolean }
  | { id: string; outcome: "rejected"; reason: string }
  | { id: string; outcome: "skipped"; reason: string };

export type SmsDispatchRun =
  | { status: "skipped"; reason: string; outcomes: [] }
  | { status: "ran"; outcomes: SmsDispatchOutcome[]; haltedReason: string | null };

export interface DispatchSmsDependencies {
  db: SmsFabricDatabase;
  selection: SmsGatewaySelection;
  now?: () => string;
}

const digitsOf = (value: string): string => value.replace(/\D/g, "");

type Recipient = { ok: true; recipient: string } | { ok: false; reason: string };

/** Re-resolve and re-authorise the recipient server-side. Never trusts the queued address alone. */
async function resolveRecipient(db: SmsFabricDatabase, row: QueuedRow): Promise<Recipient> {
  if (row.org_id !== row.school_id) return { ok: false, reason: "organization mismatch" };
  if (!row.recipient_user_id) return { ok: false, reason: "no resolved recipient" };

  const membership = await db
    .from("organization_memberships")
    .select("user_id")
    .eq("user_id", row.recipient_user_id)
    .eq("school_id", row.org_id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (membership.error || !membership.data) {
    return { ok: false, reason: "recipient is not an active organization member" };
  }

  const user = await db
    .from("users")
    .select("phone,is_active")
    .eq("id", row.recipient_user_id)
    .maybeSingle();
  const parsedUser = z
    .object({ phone: z.string().nullable(), is_active: z.boolean().nullable().optional() })
    .safeParse(user.data);
  if (
    user.error ||
    !parsedUser.success ||
    !parsedUser.data.phone ||
    parsedUser.data.is_active === false
  ) {
    return { ok: false, reason: "recipient has no active stored phone" };
  }
  if (digitsOf(parsedUser.data.phone) !== digitsOf(row.to_address)) {
    return { ok: false, reason: "queued number does not match the organization member" };
  }
  const recipient = normalizeSmsRecipient(row.to_address);
  if (!recipient)
    return { ok: false, reason: "recipient number is not a valid international number" };

  const school = await db
    .from("schools")
    .select("subscription_tier")
    .eq("id", row.org_id)
    .maybeSingle();
  const tier = z.object({ subscription_tier: z.string().nullable() }).safeParse(school.data);
  if (school.error || !tier.success) return { ok: false, reason: "unknown organization" };
  // NB: `hasTierFeature` is a deprecated always-true stub; the commercial fact lives in the
  // tier catalog read through `tenantTierEntitlement` (Growth, Professional, Enterprise only).
  const entitlement = tenantTierEntitlement(
    tenantId(row.org_id),
    tier.data.subscription_tier?.trim().toLowerCase(),
    "sms_notifications",
  );
  if (!entitlement.entitled) {
    return { ok: false, reason: "plan_not_entitled: the organization's plan does not include SMS" };
  }

  const forms = [
    ...new Set([
      row.to_address,
      digitsOf(row.to_address),
      `+${digitsOf(row.to_address)}`,
      recipient,
      `+${recipient}`,
    ]),
  ];
  const optins = await db
    .from("comms_optins")
    .select("phone,status")
    .eq("org_id", row.org_id)
    .eq("channel", "sms")
    .in("phone", forms);
  if (optins.error || !Array.isArray(optins.data)) {
    return { ok: false, reason: "consent could not be verified" };
  }
  const statuses = optins.data.map((entry) => (entry as { status?: unknown }).status);
  const optedOut = statuses.includes("opted_out");
  const optedIn = statuses.includes("opted_in");
  // Mirrors comms_send: safety messages bypass opt-out; marketing needs an explicit opt-in.
  if (row.priority !== "safety" && (optedOut || (row.category === "marketing" && !optedIn))) {
    return { ok: false, reason: "blocked by consent: recipient has not opted in to this message" };
  }
  return { ok: true, recipient };
}

async function closeRow(
  deps: DispatchSmsDependencies,
  row: QueuedRow,
  values: Record<string, unknown>,
  claim: string | null,
): Promise<void> {
  let query = deps.db
    .from("outbound_messages")
    .update({ ...values, updated_at: (deps.now ?? isoNow)() })
    .eq("id", row.id)
    .eq("org_id", row.org_id)
    .eq("status", "queued");
  query = claim === null ? query : query.eq("provider_ref", claim);
  const result = await query;
  if (result.error) throw new Error("sms delivery state write failed");
}

/**
 * Dispatch queued SMS rows of ONE organization. `orgId` is required and every query is
 * scoped to it. Nothing is sent unless `sms_live` is on and a provider is selected and
 * configured; a retryable provider failure or a credential failure halts the run and leaves
 * the remaining rows queued.
 */
export async function dispatchQueuedSms(
  deps: DispatchSmsDependencies,
  orgId: string,
  limit = 25,
): Promise<SmsDispatchRun> {
  if (!z.string().uuid().safeParse(orgId).success) throw new Error("organization id is required");
  const live = await deps.db.rpc("flag_on", { p_key: "sms_live", p_org: orgId });
  if (live.error || live.data !== true) {
    return { status: "skipped", reason: "sms_live_off", outcomes: [] };
  }
  if (!deps.selection.ok) {
    return { status: "skipped", reason: deps.selection.code, outcomes: [] };
  }
  const gateway = deps.selection.gateway;

  const queued = await deps.db
    .from("outbound_messages")
    .select(ROW_COLUMNS)
    .eq("org_id", orgId)
    .eq("channel", "sms")
    .eq("status", "queued")
    .is("provider_ref", null)
    .limit(Math.min(Math.max(limit, 1), 100));
  if (queued.error || !Array.isArray(queued.data)) throw new Error("queued sms lookup failed");

  const outcomes: SmsDispatchOutcome[] = [];
  let haltedReason: string | null = null;
  for (const candidate of queued.data) {
    const parsedRow = QueuedRowSchema.safeParse(candidate);
    if (!parsedRow.success || parsedRow.data.org_id !== orgId) continue;
    const row = parsedRow.data;

    const recipient = await resolveRecipient(deps.db, row);
    if (!recipient.ok) {
      await closeRow(deps, row, { status: "failed", error: recipient.reason.slice(0, 200) }, null);
      outcomes.push({ id: row.id, outcome: "rejected", reason: recipient.reason });
      continue;
    }

    // Atomic claim: only one worker can move provider_ref from NULL, so only one can send.
    const claim = `${CLAIM_PREFIX}${randomUUID()}`;
    const claimed = await deps.db
      .from("outbound_messages")
      .update({
        provider: gateway.providerId,
        provider_ref: claim,
        updated_at: (deps.now ?? isoNow)(),
      })
      .eq("id", row.id)
      .eq("org_id", row.org_id)
      .eq("status", "queued")
      .is("provider_ref", null)
      .select("id");
    if (claimed.error) throw new Error("sms claim failed");
    if (!Array.isArray(claimed.data) || claimed.data.length === 0) {
      outcomes.push({ id: row.id, outcome: "skipped", reason: "claimed by another worker" });
      continue;
    }

    const result = await gateway.send({
      messageId: row.id,
      recipient: recipient.recipient,
      body: row.body,
    });

    if (result.outcome === "sent") {
      await closeRow(
        deps,
        row,
        {
          status: "sent",
          provider: gateway.providerId,
          provider_ref: result.providerMessageId,
          error: null,
        },
        claim,
      );
      outcomes.push({ id: row.id, outcome: "sent", providerMessageId: result.providerMessageId });
      continue;
    }

    const code = result.code;
    const retryable =
      result.outcome === "undeliverable" ||
      result.retryable ||
      result.code === "provider_auth_failed";
    if (retryable) {
      // Provably not processed (or credentials unusable): release the claim, keep it queued, stop.
      await closeRow(deps, row, { provider_ref: null, error: code }, claim);
      outcomes.push({
        id: row.id,
        outcome: "failed",
        code,
        reason: result.reason,
        retryable: true,
      });
      haltedReason = code;
      break;
    }
    await closeRow(deps, row, { status: "failed", provider_ref: null, error: code }, claim);
    outcomes.push({ id: row.id, outcome: "failed", code, reason: result.reason, retryable: false });
  }
  return { status: "ran", outcomes, haltedReason };
}

/* ─────────────────────────────────────────────────────────────
 * Verified delivery-report webhook (BulkSMS Nigeria)
 * ────────────────────────────────────────────────────────────*/

const DeliveryEventSchema = z
  .object({
    message_id: z.union([z.string().trim().min(1).max(128), z.number()]),
    delivery_status: z.string().trim().min(1).max(64),
    recipient: z.union([z.string().max(32), z.number()]).optional(),
  })
  .passthrough();

export interface BulkSmsWebhookDependencies {
  env: ServerEnv;
  db: SmsFabricDatabase;
  now?: () => string;
}

export function createBulkSmsWebhookHandler(deps: BulkSmsWebhookDependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    const secret = deps.env[BULKSMS_NG_WEBHOOK_SECRET_ENV];
    if (!secret || secret.trim() === "") return new Response("Not configured", { status: 503 });

    const url = new URL(request.url);
    const ref = url.searchParams.get("ref");
    if (
      !verifyBulkSmsCallback({ secret, messageId: ref, signature: url.searchParams.get("sig") })
    ) {
      return new Response("Forbidden", { status: 403 });
    }
    if (!z.string().uuid().safeParse(ref).success)
      return new Response("Forbidden", { status: 403 });

    const rawBody = await request.text();
    if (rawBody.length > 100_000) return new Response("Payload too large", { status: 413 });
    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    const event = DeliveryEventSchema.safeParse(json);
    if (!event.success) return new Response("Bad request", { status: 400 });

    const mapped = mapBulkSmsDeliveryStatus(event.data.delivery_status);
    if (mapped.outcome === "pending") return Response.json({ ok: true, applied: false });

    // The organization comes from OUR row for this message — never from the payload.
    const found = await deps.db
      .from("outbound_messages")
      .select("id,org_id,status,provider_ref,to_address")
      .eq("id", ref)
      .eq("channel", "sms")
      .eq("provider", BULKSMS_NIGERIA_PROVIDER_ID)
      .maybeSingle();
    if (found.error) return new Response("Unavailable", { status: 503 });
    const row = z
      .object({
        id: z.string().uuid(),
        org_id: z.string().uuid(),
        status: z.string(),
        provider_ref: z.string().nullable(),
        to_address: z.string(),
      })
      .safeParse(found.data);
    if (!row.success) return Response.json({ ok: true, applied: false });

    // The send is still in flight (our state write has not landed): ask the provider to retry.
    if (row.data.provider_ref === null || row.data.provider_ref.startsWith(CLAIM_PREFIX)) {
      return new Response("Unavailable", { status: 503 });
    }
    if (row.data.provider_ref !== String(event.data.message_id)) {
      return Response.json({ ok: true, applied: false });
    }
    if (event.data.recipient !== undefined) {
      const reported = digitsOf(String(event.data.recipient));
      const ours = normalizeSmsRecipient(row.data.to_address) ?? digitsOf(row.data.to_address);
      if (reported !== ours) return Response.json({ ok: true, applied: false });
    }
    if (row.data.status !== "sent") return Response.json({ ok: true, applied: false });

    const update = await deps.db
      .from("outbound_messages")
      .update({
        status: mapped.outcome,
        error: mapped.code,
        updated_at: (deps.now ?? isoNow)(),
      })
      .eq("id", row.data.id)
      .eq("org_id", row.data.org_id)
      .eq("status", "sent")
      .select("id");
    if (update.error) return new Response("Unavailable", { status: 503 });
    if (!Array.isArray(update.data) || update.data.length === 0) {
      return Response.json({ ok: true, applied: false });
    }
    return Response.json({ ok: true, applied: true });
  };
}

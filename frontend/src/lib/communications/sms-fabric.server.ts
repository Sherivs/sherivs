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
 * - At-most-once: a row is CLAIMED atomically (`comms_sms_claim`) before the provider is
 *   contacted, so two workers can never both send it. The database refuses the claim when the
 *   organization lost its SMS plan or its `sms_live` flag, so no provider call can follow.
 * - Writes: `outbound_messages` is read-only for `service_role` (migration 20261024000270), so every state
 *   change goes through the service_role-only compare-and-set functions of migration
 *   20261104052000 (`comms_sms_claim`, `comms_sms_settle`, `comms_sms_hold`,
 *   `comms_sms_report_delivery`). This module never issues a direct UPDATE.
 * - Money (ADR-069/ADR-072): only a message the provider PROVABLY never accepted is refunded,
 *   atomically with its close. An ambiguous outcome is HELD (still claimed, never resent, never
 *   refunded) for operator reconciliation. A delivery failure never refunds.
 * - Audit: `outbound_messages` carries `trg_outbound_messages_comms_audit` (migration
 *   20261101001000), which appends every insert and status change to `audit_chain` in the
 *   same transaction; refunds add `usage_event_reversals` rows (audited) and holds/reconciles
 *   add `audit_logs` rows inside the database functions. No second audit writer is added here.
 * - Delivery reports are verified by a per-message HMAC token (the provider does not sign
 *   webhooks), resolve the organization from OUR row, and ignore unknown ids.
 */
import { randomUUID, timingSafeEqual } from "node:crypto";
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
import type { SmsGatewaySelection, SmsSendResult } from "./sms-gateway-contract";
import { selectSmsGateway } from "./sms-gateway.server";

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
  like(column: string, pattern: string): DbQuery;
  lt(column: string, value: string): DbQuery;
  limit(count: number): DbQuery;
  maybeSingle(): PromiseLike<DbResult>;
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
  | { id: string; outcome: "held"; code: string; reason: string }
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

type RefundReason = "rejected_before_submission" | "provider_rejected";

/**
 * What a provider failure means for the message and the money. Fail-safe by construction: only the
 * outcomes the gateway contract guarantees ("nothing was sent" or "the provider definitively
 * refused it") release or refund; every other outcome — including any code this module does not
 * know — is HELD, because the provider may have accepted the message and may bill it.
 *
 * - release:  the provider was provably not asked, or provably did not process it (not configured,
 *             unreachable before connect, 429/503 not-processed, unusable credentials). The row goes back to
 *             `queued` for a later run; nothing is charged twice because the charge was taken once, at queue time.
 * - reject:   the message is closed `failed` and its charge is refunded in the same database call.
 * - hold:     ambiguous (timeout after the request was written, 5xx, 200 without an id, duplicate report).
 */
export type FailureDisposition =
  { kind: "release" } | { kind: "reject"; refundReason: RefundReason } | { kind: "hold" };

export function classifyGatewayFailure(
  result: Exclude<SmsSendResult, { outcome: "sent" }>,
): FailureDisposition {
  if (result.outcome === "undeliverable") return { kind: "release" };
  if (result.code === "provider_auth_failed") return { kind: "release" };
  if (result.retryable) return { kind: "release" };
  if (result.code === "invalid_payload") {
    return { kind: "reject", refundReason: "rejected_before_submission" };
  }
  if (result.code === "provider_rejected") {
    return { kind: "reject", refundReason: "provider_rejected" };
  }
  return { kind: "hold" };
}

async function rpcBoolean(
  deps: DispatchSmsDependencies,
  name: string,
  args: Record<string, unknown>,
): Promise<boolean> {
  const result = await deps.db.rpc(name, args);
  if (result.error) throw new Error("sms delivery state write failed");
  return result.data === true;
}

/** Atomic claim. False when another worker holds it, or the database no longer allows SMS for the organization. */
const claimRow = (deps: DispatchSmsDependencies, row: QueuedRow, claim: string, provider: string) =>
  rpcBoolean(deps, "comms_sms_claim", {
    p_message: row.id,
    p_org: row.org_id,
    p_claim: claim,
    p_provider: provider,
  });

/**
 * Compare-and-set close of one row through `comms_sms_settle`. With a claim, only the worker holding it can close the
 * row; without one (a pre-claim rejection) the row must still be UNCLAIMED, so a rejection can never overwrite a row
 * another worker has claimed. `refundReason` refunds the charge in the same transaction. Returns whether this call
 * changed the row.
 */
const settleRow = (
  deps: DispatchSmsDependencies,
  row: QueuedRow,
  claim: string | null,
  settle: {
    status: "queued" | "sent" | "failed";
    provider?: string;
    providerRef?: string;
    error: string | null;
    refundReason?: RefundReason;
  },
) =>
  rpcBoolean(deps, "comms_sms_settle", {
    p_message: row.id,
    p_org: row.org_id,
    p_expected_ref: claim,
    p_status: settle.status,
    p_provider: settle.provider ?? null,
    p_provider_ref: settle.providerRef ?? null,
    p_error: settle.error,
    p_refund_reason: settle.refundReason ?? null,
  });

/** Park an ambiguous outcome: keeps the claim (so it is never resent), refunds nothing, audits the hold. */
const holdRow = (
  deps: DispatchSmsDependencies,
  row: QueuedRow,
  claim: string,
  code: string,
  detail: string,
) =>
  rpcBoolean(deps, "comms_sms_hold", {
    p_message: row.id,
    p_org: row.org_id,
    p_expected_ref: claim,
    p_code: code,
    p_detail: detail.slice(0, 120),
  });

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
      // Never sent, so the charge taken at queue time goes back with the close (one transaction).
      const closed = await settleRow(deps, row, null, {
        status: "failed",
        error: recipient.reason.slice(0, 200),
        refundReason: "rejected_before_submission",
      });
      outcomes.push(
        closed
          ? { id: row.id, outcome: "rejected", reason: recipient.reason }
          : { id: row.id, outcome: "skipped", reason: "claimed by another worker" },
      );
      continue;
    }

    // Atomic claim: only one worker can move provider_ref from NULL, so only one can send.
    const claim = `${CLAIM_PREFIX}${randomUUID()}`;
    const claimed = await claimRow(deps, row, claim, gateway.providerId);
    if (!claimed) {
      outcomes.push({
        id: row.id,
        outcome: "skipped",
        reason:
          "not claimable: claimed by another worker or SMS is no longer enabled for the organization",
      });
      continue;
    }

    const result = await gateway.send({
      messageId: row.id,
      recipient: recipient.recipient,
      body: row.body,
    });

    if (result.outcome === "sent") {
      await settleRow(deps, row, claim, {
        status: "sent",
        provider: gateway.providerId,
        providerRef: result.providerMessageId,
        error: null,
      });
      outcomes.push({ id: row.id, outcome: "sent", providerMessageId: result.providerMessageId });
      continue;
    }

    const code = result.code;
    const disposition = classifyGatewayFailure(result);
    if (disposition.kind === "release") {
      // Provably not processed (or credentials unusable): release the claim, keep it queued, stop.
      await settleRow(deps, row, claim, { status: "queued", error: code });
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
    if (disposition.kind === "reject") {
      await settleRow(deps, row, claim, {
        status: "failed",
        error: code,
        refundReason: disposition.refundReason,
      });
      outcomes.push({
        id: row.id,
        outcome: "failed",
        code,
        reason: result.reason,
        retryable: false,
      });
      continue;
    }
    // Ambiguous: the provider may have accepted (and may bill) it. Keep the claim, refund nothing, never resend,
    // and stop the run so an outage does not turn every queued row into a held one.
    await holdRow(deps, row, claim, code, result.reason);
    outcomes.push({ id: row.id, outcome: "held", code, reason: result.reason });
    haltedReason = code;
    break;
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

    // Compare-and-set from 'sent' inside the database: a replayed or contradicting report changes nothing, and a
    // delivery failure never refunds (whether a failed delivery is charged is a provider billing fact not yet verified).
    const update = await deps.db.rpc("comms_sms_report_delivery", {
      p_message: row.data.id,
      p_org: row.data.org_id,
      p_status: mapped.outcome,
      p_code: mapped.code,
    });
    if (update.error) return new Response("Unavailable", { status: 503 });
    if (update.data !== true) return Response.json({ ok: true, applied: false });
    return Response.json({ ok: true, applied: true });
  };
}

/* ─────────────────────────────────────────────────────────────
 * Scheduled dispatch (Bearer CRON_SECRET) — nothing else drains the queue
 * ────────────────────────────────────────────────────────────*/

/** Most messages one scheduled run will hand to the provider (bounds run time and spend). */
export const SMS_DISPATCH_MAX_MESSAGES_PER_RUN = 20;
/** Most organizations one scheduled run will visit. */
export const SMS_DISPATCH_MAX_ORGS_PER_RUN = 10;
/** A claim older than this with no provider id is reported as stuck (never auto-resent). */
export const SMS_STALE_CLAIM_AGE_MS = 15 * 60_000;
const SMS_STALE_CLAIM_REPORT_LIMIT = 20;

export interface SmsDispatchCronDependencies {
  env: ServerEnv;
  db: SmsFabricDatabase;
  fetchImpl?: typeof fetch;
  now?: () => string;
}

function cronAuthorized(header: string | null, secret: string): boolean {
  const want = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(header ?? "");
  return got.length === want.length && timingSafeEqual(got, want);
}

/**
 * Scheduled SMS dispatcher. Same contract as the other `/api/public/cron/*` jobs: it answers
 * 503 until `CRON_SECRET` is set, 401 without the bearer secret, and does nothing unless a
 * provider is selected AND configured AND the organization's `sms_live` flag is on (checked per
 * organization inside {@link dispatchQueuedSms}). It reports counts only — never message text,
 * numbers or credentials. A provider-level halt (bad credentials, rate limit) stops the whole
 * run. Rows that hold a claim but never got a provider id are REPORTED, never re-sent: after
 * a crash we cannot tell whether the provider accepted the message, and the provider offers no
 * lookup by our reference.
 */
export function createSmsDispatchCronHandler(deps: SmsDispatchCronDependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "GET" && request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }
    const cron = deps.env.CRON_SECRET;
    if (!cron || cron.trim() === "")
      return new Response("SMS dispatch not configured", { status: 503 });
    if (!cronAuthorized(request.headers.get("authorization"), cron)) {
      return new Response("Unauthorized", { status: 401 });
    }

    const now = (deps.now ?? isoNow)();
    const selection = selectSmsGateway(deps.env, deps.fetchImpl);
    const staleCutoff = new Date(Date.parse(now) - SMS_STALE_CLAIM_AGE_MS).toISOString();
    const stale = await deps.db
      .from("outbound_messages")
      .select("id")
      .eq("channel", "sms")
      .eq("status", "queued")
      .like("provider_ref", `${CLAIM_PREFIX}%`)
      .lt("updated_at", staleCutoff)
      .limit(SMS_STALE_CLAIM_REPORT_LIMIT);
    const staleClaims =
      !stale.error && Array.isArray(stale.data)
        ? stale.data.map((r) => (r as { id?: unknown }).id).filter((id) => typeof id === "string")
        : [];

    // Messages parked by `comms_sms_hold` (ambiguous provider outcome) wait for operator reconciliation
    // (`comms_sms_reconcile`); they are reported on every run, never retried and never refunded automatically.
    const held = await deps.db
      .from("outbound_messages")
      .select("id")
      .eq("channel", "sms")
      .eq("status", "queued")
      .like("provider_ref", `${CLAIM_PREFIX}%`)
      .like("error", "held:%")
      .limit(SMS_STALE_CLAIM_REPORT_LIMIT);
    const heldMessages =
      !held.error && Array.isArray(held.data)
        ? held.data.map((r) => (r as { id?: unknown }).id).filter((id) => typeof id === "string")
        : [];

    if (!selection.ok) {
      return Response.json({
        ok: true,
        status: "skipped",
        reason: selection.code,
        staleClaims,
        heldMessages,
      });
    }

    const pending = await deps.db
      .from("outbound_messages")
      .select("org_id")
      .eq("channel", "sms")
      .eq("status", "queued")
      .is("provider_ref", null)
      .limit(500);
    if (pending.error || !Array.isArray(pending.data)) {
      return Response.json({ ok: false, error: "queued sms lookup failed" }, { status: 500 });
    }
    const orgIds = [
      ...new Set(
        pending.data
          .map((r) => (r as { org_id?: unknown }).org_id)
          .filter((id): id is string => z.string().uuid().safeParse(id).success),
      ),
    ].slice(0, SMS_DISPATCH_MAX_ORGS_PER_RUN);

    const totals = { sent: 0, failed: 0, rejected: 0, held: 0, skipped: 0 };
    let remaining = SMS_DISPATCH_MAX_MESSAGES_PER_RUN;
    let haltedReason: string | null = null;
    let orgsVisited = 0;
    let orgErrors = 0;
    for (const orgId of orgIds) {
      if (remaining <= 0 || haltedReason) break;
      orgsVisited += 1;
      try {
        const run = await dispatchQueuedSms(
          { db: deps.db, selection, now: deps.now },
          orgId,
          remaining,
        );
        if (run.status === "skipped") continue;
        for (const outcome of run.outcomes) totals[outcome.outcome] += 1;
        remaining -= run.outcomes.length;
        haltedReason = run.haltedReason;
      } catch {
        // State-write failure for this organization: never echo internals; keep serving others.
        orgErrors += 1;
      }
    }
    return Response.json({
      ok: true,
      status: "ran",
      orgsVisited,
      orgErrors,
      ...totals,
      haltedReason,
      staleClaims,
      heldMessages,
    });
  };
}

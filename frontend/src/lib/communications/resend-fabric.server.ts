/**
 * Sherivs — Resend email through the tenant-scoped communication fabric (COMMS-04).
 *
 * The database fabric (`comms_propose_send` → `comms_approve_send` → `comms_send`)
 * decides WHAT may be emailed: approved template, organization membership,
 * verified contact, marketing opt-in. It records an `outbound_messages` row with
 * status `queued` only when the organization's `email_live` flag is on. This
 * module is the dispatcher for those rows and the verified delivery-event intake.
 *
 * - The recipient is NEVER taken from a caller: it is re-resolved here from the
 *   queued row's `recipient_user_id` against the organization's active
 *   membership and the member's stored email. A mismatch fails the row closed.
 * - Marketing email is refused: an email opt-in cannot be recorded in the
 *   fabric (`comms_optins` is phone-keyed), so consent can never be proven.
 * - Every state change is appended to `audit_chain` (hashes only, no address).
 * - Webhooks verify the Resend (Svix) signature, resolve the organization from
 *   our own `outbound_messages` row, and ignore unknown provider ids.
 */
import { SystemClock, TimeAuthority } from "../kernel/time-authority";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { AuditChain, type AuditInput, type ChainStore } from "../trust-ledger/hash-chain.server";
import type { Notification } from "../notifications/notification-contract";
import { isEmailDeliveryReceipt, type EmailAdapter } from "../notifications/email-adapter-contract";
import {
  createResendEmailProviderRegistry,
  RESEND_EMAIL_PROVIDER_ID,
  type ServerEnv,
} from "./resend-email.server";

/** Environment variable holding the Resend webhook signing secret (`whsec_…`). Name only. */
export const RESEND_WEBHOOK_SECRET_ENV = "RESEND_WEBHOOK_SECRET";

const WEBHOOK_TOLERANCE_SECONDS = 300;
const AUDIT_ACTOR = "comms.email.resend";

interface DbResult<T = unknown> {
  data: T | null;
  error: { message: string } | null;
}
interface DbQuery extends PromiseLike<DbResult> {
  select(columns: string): DbQuery;
  eq(column: string, value: unknown): DbQuery;
  limit(count: number): DbQuery;
  maybeSingle(): PromiseLike<DbResult>;
  update(values: Record<string, unknown>): DbQuery;
}
export interface ResendFabricDatabase {
  from(table: string): DbQuery;
  rpc(name: string, args: Record<string, unknown>): PromiseLike<DbResult>;
}

export type EmailAuditFn = (input: AuditInput) => Promise<unknown>;

export function createEmailAuditRecorder(store: ChainStore): EmailAuditFn {
  const chain = new AuditChain(store);
  return (input) => chain.record(input);
}

const QueuedRowSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  school_id: z.string().uuid(),
  channel: z.literal("email"),
  status: z.literal("queued"),
  to_address: z.string(),
  recipient_user_id: z.string().uuid().nullable(),
  category: z.string(),
  body: z.string(),
  template_code: z.string().nullable(),
});
type QueuedRow = z.infer<typeof QueuedRowSchema>;

const ROW_COLUMNS =
  "id,org_id,school_id,channel,status,to_address,recipient_user_id,category,body,template_code";

export type EmailDispatchOutcome =
  | { id: string; outcome: "sent"; providerMessageId: string }
  | { id: string; outcome: "failed"; reason: string; retryable: boolean }
  | { id: string; outcome: "rejected"; reason: string };

export interface DispatchEmailDependencies {
  db: ResendFabricDatabase;
  adapter: EmailAdapter;
  env: ServerEnv;
  audit: EmailAuditFn;
  now?: () => string;
}

function addressHash(address: string): string {
  return createHash("sha256").update(address.trim().toLowerCase()).digest("hex");
}

/** J-023: time enters only via the kernel time-authority. */
const timeAuthority = new TimeAuthority(new SystemClock());
function isoNow(): string {
  return timeAuthority.now().at;
}

async function rejectRow(
  deps: DispatchEmailDependencies,
  row: QueuedRow,
  reason: string,
): Promise<EmailDispatchOutcome> {
  await deps.db
    .from("outbound_messages")
    .update({ status: "failed", error: reason, updated_at: (deps.now ?? isoNow)() })
    .eq("id", row.id)
    .eq("org_id", row.org_id)
    .eq("status", "queued");
  await deps.audit({
    orgId: row.org_id,
    actorKind: "system",
    actorId: AUDIT_ACTOR,
    action: "comms.email.rejected",
    targetType: "outbound_message",
    targetId: row.id,
    after: { status: "failed", reason },
  });
  return { id: row.id, outcome: "rejected", reason };
}

/** Re-resolve the recipient server-side; returns the member's stored email or a refusal reason. */
async function resolveRecipient(
  db: ResendFabricDatabase,
  row: QueuedRow,
): Promise<{ ok: true; email: string; orgName: string } | { ok: false; reason: string }> {
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
    .select("email,is_active")
    .eq("id", row.recipient_user_id)
    .maybeSingle();
  const parsed = z
    .object({ email: z.string().nullable(), is_active: z.boolean().nullable().optional() })
    .safeParse(user.data);
  if (user.error || !parsed.success || !parsed.data.email || parsed.data.is_active === false) {
    return { ok: false, reason: "recipient has no active stored email" };
  }
  if (parsed.data.email.trim().toLowerCase() !== row.to_address.trim().toLowerCase()) {
    return { ok: false, reason: "queued address does not match the organization member" };
  }
  const school = await db.from("schools").select("name").eq("id", row.org_id).maybeSingle();
  const name = z.object({ name: z.string().min(1) }).safeParse(school.data);
  if (!name.success) return { ok: false, reason: "unknown organization" };
  return { ok: true, email: parsed.data.email, orgName: name.data.name };
}

/**
 * Dispatch queued email rows of ONE organization through the Resend adapter.
 * `orgId` is required and every query is scoped to it.
 */
export async function dispatchQueuedEmail(
  deps: DispatchEmailDependencies,
  orgId: string,
  limit = 25,
): Promise<EmailDispatchOutcome[]> {
  if (!z.string().uuid().safeParse(orgId).success) throw new Error("organization id is required");
  const live = await deps.db.rpc("flag_on", { p_key: "email_live", p_org: orgId });
  if (live.error || live.data !== true) return [];
  const registry = createResendEmailProviderRegistry(deps.env);
  const queued = await deps.db
    .from("outbound_messages")
    .select(ROW_COLUMNS)
    .eq("org_id", orgId)
    .eq("channel", "email")
    .eq("status", "queued")
    .limit(Math.min(Math.max(limit, 1), 100));
  if (queued.error || !Array.isArray(queued.data)) throw new Error("queued email lookup failed");

  const outcomes: EmailDispatchOutcome[] = [];
  for (const candidate of queued.data) {
    const parsedRow = QueuedRowSchema.safeParse(candidate);
    if (!parsedRow.success || parsedRow.data.org_id !== orgId) continue;
    const row = parsedRow.data;

    if (row.category === "marketing") {
      outcomes.push(
        await rejectRow(deps, row, "marketing email requires an opt-in that cannot be recorded"),
      );
      continue;
    }
    const recipient = await resolveRecipient(deps.db, row);
    if (!recipient.ok) {
      outcomes.push(await rejectRow(deps, row, recipient.reason));
      continue;
    }
    const at = (deps.now ?? isoNow)();
    const notification: Notification = {
      id: row.id,
      tenantRef: row.org_id,
      recipientRef: row.recipient_user_id as string,
      audienceKind: "user",
      category: "general",
      subject: `${recipient.orgName} notification`,
      body: row.body,
      actionRef: null,
      state: "queued",
      createdAt: at,
    };
    const result = await deps.adapter.send(
      {
        notification,
        recipientAddress: recipient.email,
        subject: notification.subject,
        body: row.body,
      },
      registry,
    );

    if (isEmailDeliveryReceipt(result)) {
      const update = await deps.db
        .from("outbound_messages")
        .update({
          status: "sent",
          provider: RESEND_EMAIL_PROVIDER_ID,
          provider_ref: result.providerMessageId,
          error: null,
          updated_at: at,
        })
        .eq("id", row.id)
        .eq("org_id", row.org_id)
        .eq("status", "queued");
      if (update.error) throw new Error("email delivery state write failed");
      await deps.audit({
        orgId: row.org_id,
        actorKind: "system",
        actorId: AUDIT_ACTOR,
        action: "comms.email.sent",
        targetType: "outbound_message",
        targetId: row.id,
        after: {
          status: "sent",
          provider: RESEND_EMAIL_PROVIDER_ID,
          provider_ref: result.providerMessageId,
          recipient_hash: addressHash(recipient.email),
        },
      });
      outcomes.push({ id: row.id, outcome: "sent", providerMessageId: result.providerMessageId });
      continue;
    }

    // Retryable failures stay queued for the next run; terminal ones are closed out.
    const retryable = result.outcome === "failed" && result.retryable;
    if (!retryable) {
      await deps.db
        .from("outbound_messages")
        .update({ status: "failed", error: result.code, updated_at: at })
        .eq("id", row.id)
        .eq("org_id", row.org_id)
        .eq("status", "queued");
    }
    await deps.audit({
      orgId: row.org_id,
      actorKind: "system",
      actorId: AUDIT_ACTOR,
      action: "comms.email.failed",
      targetType: "outbound_message",
      targetId: row.id,
      after: { status: retryable ? "queued" : "failed", code: result.code },
    });
    outcomes.push({ id: row.id, outcome: "failed", reason: result.code, retryable });
  }
  return outcomes;
}

/* ─────────────────────────────────────────────────────────────
 * Verified delivery / bounce / complaint webhook (Resend = Svix signatures)
 * ────────────────────────────────────────────────────────────*/

function decodeSecret(secret: string): Buffer | null {
  const raw = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(raw)) return null;
  const key = Buffer.from(raw, "base64");
  return key.length > 0 ? key : null;
}

/** Verify a Svix-style signature over `${id}.${timestamp}.${body}`. Fails closed. */
export function verifyResendWebhookSignature(input: {
  rawBody: string;
  id: string | null;
  timestamp: string | null;
  signature: string | null;
  secret: string | null | undefined;
  nowSeconds: number;
}): boolean {
  const { rawBody, id, timestamp, signature, secret, nowSeconds } = input;
  if (!secret || !id || !timestamp || !signature) return false;
  const key = decodeSecret(secret);
  if (!key) return false;
  const ts = Number(timestamp);
  if (!Number.isInteger(ts) || Math.abs(nowSeconds - ts) > WEBHOOK_TOLERANCE_SECONDS) return false;
  const expected = createHmac("sha256", key).update(`${id}.${timestamp}.${rawBody}`).digest();
  return signature.split(" ").some((part) => {
    const [version, value] = part.split(",");
    if (version !== "v1" || !value) return false;
    const candidate = Buffer.from(value, "base64");
    return candidate.length === expected.length && timingSafeEqual(candidate, expected);
  });
}

const ResendEventSchema = z.object({
  type: z.string().min(1).max(64),
  data: z.object({ email_id: z.string().min(1).max(128) }).passthrough(),
});

const EVENT_STATUS: Record<string, { status: "delivered" | "failed"; error: string | null }> = {
  "email.delivered": { status: "delivered", error: null },
  "email.bounced": { status: "failed", error: "bounced" },
  "email.complained": { status: "failed", error: "complained" },
  "email.failed": { status: "failed", error: "provider_failed" },
};

export interface ResendWebhookDependencies {
  env: ServerEnv;
  db: ResendFabricDatabase;
  audit: EmailAuditFn;
  now?: () => number;
}

export function createResendWebhookHandler(deps: ResendWebhookDependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
    const secret = deps.env[RESEND_WEBHOOK_SECRET_ENV];
    if (!secret || secret.trim() === "") return new Response("Not configured", { status: 503 });
    const rawBody = await request.text();
    if (rawBody.length > 100_000) return new Response("Payload too large", { status: 413 });
    const verified = verifyResendWebhookSignature({
      rawBody,
      id: request.headers.get("svix-id"),
      timestamp: request.headers.get("svix-timestamp"),
      signature: request.headers.get("svix-signature"),
      secret,
      nowSeconds: Math.floor((deps.now?.() ?? Date.parse(isoNow())) / 1000),
    });
    if (!verified) return new Response("Forbidden", { status: 403 });

    let json: unknown;
    try {
      json = JSON.parse(rawBody);
    } catch {
      return new Response("Bad request", { status: 400 });
    }
    const event = ResendEventSchema.safeParse(json);
    if (!event.success) return new Response("Bad request", { status: 400 });
    const mapped = EVENT_STATUS[event.data.type];
    if (!mapped) return Response.json({ ok: true, applied: false });

    // The organization comes from OUR row for this provider id — never from the payload.
    const found = await deps.db
      .from("outbound_messages")
      .select("id,org_id,status")
      .eq("channel", "email")
      .eq("provider", RESEND_EMAIL_PROVIDER_ID)
      .eq("provider_ref", event.data.data.email_id)
      .maybeSingle();
    if (found.error) return new Response("Unavailable", { status: 503 });
    const row = z
      .object({ id: z.string().uuid(), org_id: z.string().uuid(), status: z.string() })
      .safeParse(found.data);
    if (!row.success) return Response.json({ ok: true, applied: false });

    const transitionable =
      row.data.status === "sent" || (row.data.status === "delivered" && mapped.status === "failed");
    if (!transitionable) return Response.json({ ok: true, applied: false });

    const update = await deps.db
      .from("outbound_messages")
      .update({ status: mapped.status, error: mapped.error, updated_at: isoNow() })
      .eq("id", row.data.id)
      .eq("org_id", row.data.org_id)
      .eq("status", row.data.status)
      .select("id");
    if (update.error) return new Response("Unavailable", { status: 503 });
    if (!Array.isArray(update.data) || update.data.length === 0) {
      return Response.json({ ok: true, applied: false });
    }
    await deps.audit({
      orgId: row.data.org_id,
      actorKind: "system",
      actorId: AUDIT_ACTOR,
      action: `comms.email.${event.data.type.slice("email.".length)}`,
      targetType: "outbound_message",
      targetId: row.data.id,
      before: { status: row.data.status },
      after: { status: mapped.status, error: mapped.error },
    });
    return Response.json({ ok: true, applied: true });
  };
}

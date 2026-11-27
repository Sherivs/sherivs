/**
 * Sherivs — proactive WhatsApp through the tenant-scoped communication fabric (M22, ADR-151). Server only.
 *
 * The database fabric (`comms_propose_send` → `comms_approve_send` → `comms_send`) decides WHAT may be
 * sent and charges it once (`meter_usage`, item whatsapp_utility / whatsapp_marketing). It queues an
 * `outbound_messages` row (provider `meta_cloud`) only while the organization's `whatsapp_live` flag is
 * on. Before M22 nothing drained those rows. This module is that dispatcher, built on the same rules
 * as the SMS dispatcher (`sms-fabric.server.ts`):
 *
 * - The recipient is re-resolved from `recipient_user_id` (active membership, active user, stored phone
 *   equal to the queued number). Never a caller-supplied number.
 * - Consent, opt-out and quiet hours are checked again at send time (`send-time-consent.server.ts`):
 *   WhatsApp always needs an explicit opt-in; opt-out blocks; quiet hours defer.
 * - The template must be in the registry (`comms_templates`: name, language, parameter count) and
 *   approved, checked here AND by the database claim (`comms_wa_claim`). No template → no provider call.
 * - At-most-once: the row is claimed atomically before the provider is contacted; one attempt only
 *   (transient retry off). A provider-confirmed send settles `sent`; a refusal the provider provably did
 *   not act on (local validation, HTTP 4xx except 408/429) closes `failed` with a refund; "not
 *   configured" and 429 release the claim; anything ambiguous is HELD (claim kept, never resent, no refund).
 * - Every decision that reaches the provider or refuses before it is recorded in `cg_delivery_evidence`.
 * - The dispatcher never issues an UPDATE: every write is a service_role-only database function.
 */
import { randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { SystemClock, TimeAuthority } from "../kernel/time-authority";
import {
  attemptEvidenceRecord,
  recordDeliveryEvidence,
  redactPhoneRecipient,
  type DeliveryEvidenceSink,
} from "./delivery-evidence.server";
import { checkSendTimeConsent, type ConsentDatabase } from "./send-time-consent.server";
import type { WhatsAppCloudAdapter } from "./whatsapp-cloud.server";
import {
  checkProactiveTemplate,
  sendProactiveWhatsApp,
  tenantWhatsAppTemplate,
} from "./whatsapp-template-registry";

const timeAuthority = new TimeAuthority(new SystemClock());

interface DbResult {
  data: unknown;
  error: { message: string } | null;
}
interface DbQuery extends PromiseLike<DbResult> {
  select(columns: string): DbQuery;
  eq(column: string, value: unknown): DbQuery;
  in(column: string, values: unknown[]): DbQuery;
  is(column: string, value: null): DbQuery;
  limit(count: number): DbQuery;
  maybeSingle(): PromiseLike<DbResult>;
}
export interface WhatsAppFabricDatabase extends ConsentDatabase {
  from(table: string): DbQuery;
  rpc(name: string, args: Record<string, unknown>): PromiseLike<DbResult>;
}

export const WHATSAPP_ADAPTER_ID = "meta_cloud";

const QueuedRowSchema = z.object({
  id: z.string().uuid(),
  org_id: z.string().uuid(),
  school_id: z.string().uuid(),
  channel: z.literal("whatsapp"),
  status: z.literal("queued"),
  to_address: z.string(),
  recipient_user_id: z.string().uuid().nullable(),
  category: z.string(),
  priority: z.string(),
  template_code: z.string().nullable(),
  language: z.string().nullable(),
  template_parameters: z.array(z.string()).nullable(),
});
type QueuedRow = z.infer<typeof QueuedRowSchema>;
const ROW_COLUMNS =
  "id,org_id,school_id,channel,status,to_address,recipient_user_id,category,priority,template_code,language,template_parameters";

const TemplateRowSchema = z.object({
  code: z.string(),
  org_id: z.string().uuid().nullable(),
  wa_template_name: z.string().nullable(),
  language: z.string().nullable(),
  wa_param_count: z.number().int().nullable(),
  status: z.string(),
});

export type WhatsAppDispatchOutcome =
  | { id: string; outcome: "sent"; providerMessageId: string }
  | { id: string; outcome: "rejected"; code: string }
  | { id: string; outcome: "failed"; code: string; retryable: boolean }
  | { id: string; outcome: "held"; code: string }
  | { id: string; outcome: "skipped"; reason: string };

export type WhatsAppDispatchRun =
  | { status: "skipped"; reason: string; outcomes: [] }
  | { status: "ran"; outcomes: WhatsAppDispatchOutcome[]; haltedReason: string | null };

export interface DispatchWhatsAppDependencies {
  db: WhatsAppFabricDatabase;
  adapter: Pick<WhatsAppCloudAdapter, "send" | "live">;
  evidence?: DeliveryEvidenceSink | null;
  nowMs?: () => number;
}

const digitsOf = (v: string) => v.replace(/\D/g, "");

/** What a WhatsApp provider failure means. Only provable non-acceptance releases or refunds. */
export function classifyWhatsAppFailure(
  error: string,
): { kind: "release" } | { kind: "reject" } | { kind: "hold" } {
  if (error === "whatsapp not configured") return { kind: "release" };
  if (/^invalid WhatsApp /.test(error)) return { kind: "reject" };
  const http = /HTTP (\d{3})$/.exec(error);
  if (http) {
    const status = Number(http[1]);
    if (status === 429) return { kind: "release" };
    if (status >= 400 && status < 500 && status !== 408) return { kind: "reject" };
  }
  return { kind: "hold" };
}

type Resolution =
  | { ok: true; to: string; template: ReturnType<typeof tenantWhatsAppTemplate> }
  | { ok: false; code: string; reason: string; defer: boolean };

async function resolve(
  db: WhatsAppFabricDatabase,
  row: QueuedRow,
  nowMs: number,
): Promise<Resolution> {
  const refuse = (code: string, reason: string): Resolution => ({
    ok: false,
    code,
    reason,
    defer: false,
  });
  if (row.org_id !== row.school_id) return refuse("organization_mismatch", "organization mismatch");
  if (!row.recipient_user_id) return refuse("no_recipient", "no resolved recipient");
  const member = await db
    .from("organization_memberships")
    .select("user_id")
    .eq("user_id", row.recipient_user_id)
    .eq("school_id", row.org_id)
    .eq("is_active", true)
    .limit(1)
    .maybeSingle();
  if (member.error || !member.data)
    return refuse("not_member", "recipient is not an active organization member");
  const user = await db
    .from("users")
    .select("phone,is_active")
    .eq("id", row.recipient_user_id)
    .maybeSingle();
  const u = z
    .object({ phone: z.string().nullable(), is_active: z.boolean().nullable().optional() })
    .safeParse(user.data);
  if (user.error || !u.success || !u.data.phone || u.data.is_active === false) {
    return refuse("no_phone", "recipient has no active stored phone");
  }
  if (digitsOf(u.data.phone) !== digitsOf(row.to_address)) {
    return refuse("address_mismatch", "queued number does not match the organization member");
  }
  const digits = digitsOf(row.to_address);
  const e164 = `+${/^0\d{10}$/.test(digits) ? `234${digits.slice(1)}` : digits}`;
  if (!/^\+[1-9]\d{7,14}$/.test(e164))
    return refuse("invalid_recipient", "recipient number is not valid");

  const consent = await checkSendTimeConsent(db, {
    orgId: row.org_id,
    recipientUserId: row.recipient_user_id,
    channel: "whatsapp",
    phoneForms: [row.to_address, digits, `+${digits}`, e164, e164.slice(1)],
    priority: row.priority,
    category: row.category,
    nowMs,
  });
  if (!consent.ok)
    return { ok: false, code: consent.code, reason: consent.reason, defer: consent.defer };

  // Registry lookup: the organization's own approved template wins over the platform default.
  if (!row.template_code || !row.language) return refuse("template_not_registered", "no template");
  const found = await db
    .from("comms_templates")
    .select("code,org_id,wa_template_name,language,wa_param_count,status")
    .eq("code", row.template_code)
    .eq("channel", "whatsapp")
    .eq("language", row.language);
  const rows = z.array(TemplateRowSchema).safeParse(found.data);
  if (found.error || !rows.success)
    return refuse("template_not_registered", "template lookup failed");
  const candidates = rows.data.filter((t) => t.org_id === row.org_id || t.org_id === null);
  const chosen = candidates.find((t) => t.org_id === row.org_id) ?? candidates[0];
  const template = chosen ? tenantWhatsAppTemplate(chosen) : null;
  const checked = checkProactiveTemplate(template, row.template_parameters ?? []);
  if (!checked.ok || !template) {
    return refuse(
      checked.ok ? "template_not_registered" : checked.code,
      "no approved registered template",
    );
  }
  return { ok: true, to: e164, template };
}

async function rpcBool(db: WhatsAppFabricDatabase, name: string, args: Record<string, unknown>) {
  const r = await db.rpc(name, args);
  if (r.error) throw new Error("whatsapp delivery state write failed");
  return r.data === true;
}

/**
 * Dispatch queued WhatsApp rows of ONE organization. Nothing is sent unless `whatsapp_live` is on and
 * the Cloud API is configured. A provider-level problem (not configured, rate limit, ambiguous) halts
 * the run and leaves the remaining rows queued.
 */
export async function dispatchQueuedWhatsApp(
  deps: DispatchWhatsAppDependencies,
  orgId: string,
  limit = 25,
): Promise<WhatsAppDispatchRun> {
  if (!z.string().uuid().safeParse(orgId).success) throw new Error("organization id is required");
  const live = await deps.db.rpc("flag_on", { p_key: "whatsapp_live", p_org: orgId });
  if (live.error || live.data !== true)
    return { status: "skipped", reason: "whatsapp_live_off", outcomes: [] };
  if (!deps.adapter.live)
    return { status: "skipped", reason: "provider_not_configured", outcomes: [] };
  const nowMs = deps.nowMs ?? (() => timeAuthority.now().atMs);

  const queued = await deps.db
    .from("outbound_messages")
    .select(ROW_COLUMNS)
    .eq("org_id", orgId)
    .eq("channel", "whatsapp")
    .eq("status", "queued")
    .is("provider_ref", null)
    .limit(Math.min(Math.max(limit, 1), 100));
  if (queued.error || !Array.isArray(queued.data)) throw new Error("queued whatsapp lookup failed");

  const evidence = (row: QueuedRow, attempt: Parameters<typeof attemptEvidenceRecord>[1]) =>
    recordDeliveryEvidence(
      deps.evidence,
      attemptEvidenceRecord(
        {
          tenantId: row.org_id,
          channel: "whatsapp",
          adapter: WHATSAPP_ADAPTER_ID,
          notificationRef: row.id,
          recipientRedacted: redactPhoneRecipient(row.to_address),
          triggerSource: `whatsapp.dispatch:${WHATSAPP_ADAPTER_ID}`,
          triggeredBy: "whatsapp-fabric-dispatcher",
        },
        attempt,
      ),
    );
  const settle = (
    row: QueuedRow,
    claim: string | null,
    status: "queued" | "sent" | "failed",
    providerRef: string | null,
    error: string | null,
    refundReason: "rejected_before_submission" | "provider_rejected" | null,
  ) =>
    rpcBool(deps.db, "comms_wa_settle", {
      p_message: row.id,
      p_org: row.org_id,
      p_expected_ref: claim,
      p_status: status,
      p_provider_ref: providerRef,
      p_error: error,
      p_refund_reason: refundReason,
    });

  const outcomes: WhatsAppDispatchOutcome[] = [];
  let haltedReason: string | null = null;
  for (const candidate of queued.data) {
    const parsed = QueuedRowSchema.safeParse(candidate);
    if (!parsed.success || parsed.data.org_id !== orgId) continue;
    const row = parsed.data;

    const r = await resolve(deps.db, row, nowMs());
    if (!r.ok && r.defer) {
      outcomes.push({ id: row.id, outcome: "skipped", reason: r.code });
      continue;
    }
    if (!r.ok) {
      // Never sent: close and refund the queue-time charge in one database call.
      const closed = await settle(row, null, "failed", null, r.code, "rejected_before_submission");
      if (closed) {
        await evidence(row, { outcome: "undeliverable", code: r.code, reason: r.reason });
        outcomes.push({ id: row.id, outcome: "rejected", code: r.code });
      } else {
        outcomes.push({ id: row.id, outcome: "skipped", reason: "claimed by another worker" });
      }
      continue;
    }

    const claim = `claim:${randomUUID()}`;
    const claimed = await rpcBool(deps.db, "comms_wa_claim", {
      p_message: row.id,
      p_org: row.org_id,
      p_claim: claim,
    });
    if (!claimed) {
      outcomes.push({ id: row.id, outcome: "skipped", reason: "not claimable" });
      continue;
    }

    const sent = await sendProactiveWhatsApp(deps.adapter, {
      to: r.to,
      template: r.template,
      parameters: row.template_parameters ?? [],
    });
    if (sent.ok) {
      await evidence(row, { outcome: "delivered", providerMessageId: sent.providerRef });
      await settle(row, claim, "sent", sent.providerRef, null, null);
      outcomes.push({ id: row.id, outcome: "sent", providerMessageId: sent.providerRef });
      continue;
    }
    const code = "refusal" in sent ? sent.refusal : "provider_error";
    const disposition =
      "refusal" in sent
        ? sent.refusal === "provider_not_configured"
          ? { kind: "release" as const }
          : { kind: "reject" as const }
        : classifyWhatsAppFailure(sent.error);
    await evidence(row, {
      outcome: disposition.kind === "release" ? "undeliverable" : "failed",
      code,
      reason: sent.error.slice(0, 200),
    });
    if (disposition.kind === "release") {
      await settle(row, claim, "queued", null, code, null);
      outcomes.push({ id: row.id, outcome: "failed", code, retryable: true });
      haltedReason = code;
      break;
    }
    if (disposition.kind === "reject") {
      const reason =
        "refusal" in sent || /^invalid /.test(sent.error)
          ? "rejected_before_submission"
          : "provider_rejected";
      await settle(row, claim, "failed", null, code, reason);
      outcomes.push({ id: row.id, outcome: "failed", code, retryable: false });
      continue;
    }
    await rpcBool(deps.db, "comms_wa_hold", {
      p_message: row.id,
      p_org: row.org_id,
      p_expected_ref: claim,
      p_code: code,
    });
    outcomes.push({ id: row.id, outcome: "held", code });
    haltedReason = code;
    break;
  }
  return { status: "ran", outcomes, haltedReason };
}

/* ─────────────────────────────────────────────────────────────
 * Scheduled dispatch (Bearer CRON_SECRET) — the only drain for queued WhatsApp rows
 * ────────────────────────────────────────────────────────────*/

export const WHATSAPP_DISPATCH_MAX_MESSAGES_PER_RUN = 20;
export const WHATSAPP_DISPATCH_MAX_ORGS_PER_RUN = 10;

export interface WhatsAppDispatchCronDependencies {
  env: Record<string, string | undefined>;
  db: WhatsAppFabricDatabase;
  adapter: Pick<WhatsAppCloudAdapter, "send" | "live">;
  evidence: DeliveryEvidenceSink | null;
  nowMs?: () => number;
}

function bearerOk(header: string | null, secret: string): boolean {
  const want = Buffer.from(`Bearer ${secret}`);
  const got = Buffer.from(header ?? "");
  return got.length === want.length && timingSafeEqual(got, want);
}

/** 503 until CRON_SECRET is set, 401 without it; counts only in the answer (no numbers, no text). */
export function createWhatsAppDispatchCronHandler(deps: WhatsAppDispatchCronDependencies) {
  return async (request: Request): Promise<Response> => {
    if (request.method !== "GET" && request.method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }
    const cron = deps.env.CRON_SECRET;
    if (!cron || cron.trim() === "")
      return new Response("WhatsApp dispatch not configured", { status: 503 });
    if (!bearerOk(request.headers.get("authorization"), cron)) {
      return new Response("Unauthorized", { status: 401 });
    }
    if (!deps.adapter.live)
      return Response.json({ ok: true, status: "skipped", reason: "provider_not_configured" });
    const pending = await deps.db
      .from("outbound_messages")
      .select("org_id")
      .eq("channel", "whatsapp")
      .eq("status", "queued")
      .is("provider_ref", null)
      .limit(500);
    if (pending.error || !Array.isArray(pending.data)) {
      return Response.json({ ok: false, error: "queued whatsapp lookup failed" }, { status: 500 });
    }
    const orgIds = [
      ...new Set(
        pending.data
          .map((r) => (r as { org_id?: unknown }).org_id)
          .filter((id): id is string => z.string().uuid().safeParse(id).success),
      ),
    ].slice(0, WHATSAPP_DISPATCH_MAX_ORGS_PER_RUN);
    const totals = { sent: 0, failed: 0, rejected: 0, held: 0, skipped: 0 };
    let remaining = WHATSAPP_DISPATCH_MAX_MESSAGES_PER_RUN;
    let haltedReason: string | null = null;
    let orgErrors = 0;
    for (const orgId of orgIds) {
      if (remaining <= 0 || haltedReason) break;
      try {
        const run = await dispatchQueuedWhatsApp(
          { db: deps.db, adapter: deps.adapter, evidence: deps.evidence, nowMs: deps.nowMs },
          orgId,
          remaining,
        );
        if (run.status === "skipped") continue;
        for (const o of run.outcomes) totals[o.outcome] += 1;
        remaining -= run.outcomes.length;
        haltedReason = run.haltedReason;
      } catch {
        orgErrors += 1;
      }
    }
    return Response.json({ ok: true, status: "ran", orgErrors, ...totals, haltedReason });
  };
}

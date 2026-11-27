/**
 * Organization notification worker (ENGINE-23).
 *
 * Drains `org_notification_outbox`: claims queued rows through `claim_org_notifications`, sends each
 * one on its channel, and reports the outcome with `complete_org_notification`. The database owns
 * retry timing (back-off, five attempts, then `failed`); this module owns delivery.
 *
 * Channels:
 *  - `email`    sent through an injected email port (Resend in production).
 *  - `whatsapp` sent only through an injected port. None is wired: a proactive WhatsApp message
 *               needs an approved template and a recorded opt-in, and the existing send path only
 *               replies inside an inbound conversation. Without a port the row is failed, never sent.
 *  - `push`     sent through an injected push port (Web Push + Expo sender).
 *  - `in_app`   has no sender here and is failed (the in-app row already exists).
 *  - SMS cannot be queued (the table's channel check excludes it) and is refused here as well.
 *
 * Rules held in code and tests:
 *  - The recipient must be an active member of the same organization and the address is read
 *    server-side from that organization's own user row. A payload never supplies an address.
 *  - A redacted row, or any safeguarding row, never carries text: the message says only that
 *    there is an item to open.
 *  - Escalation categories are not permitted on email by the notification policy, so urgent and
 *    critical items are not emailed. They are failed so a person can see them in the app.
 *  - Results and errors never contain an address, a payload or a provider message.
 *
 * The client and the ports are injected so the worker runs against stubs in tests. The client must
 * be the service-role client: the database functions refuse anyone else.
 */

type Err = { message: string; code?: string } | null;
type Result = { data: unknown; error: Err };
interface Query extends PromiseLike<Result> {
  eq(column: string, value: unknown): Query;
  limit(count: number): Query;
}
export interface WorkerClient {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<Result>;
  from(table: string): { select(columns: string): Query };
}

export type MailCategory = "system" | "escalation";

export interface EmailSend {
  readonly id: string;
  readonly orgId: string;
  readonly recipientId: string;
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly category: MailCategory;
}
export type SendOutcome = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export interface WorkerPorts {
  readonly sendEmail: (m: EmailSend) => Promise<SendOutcome>;
  readonly sendPush?: (m: {
    readonly id: string;
    readonly orgId: string;
    readonly recipientId: string;
    readonly category: "messages" | "announcements" | "grades" | "attendance" | "fees";
    readonly route: string;
    readonly title: string;
    readonly body: string;
    readonly redacted: boolean;
    readonly safeguarding: boolean;
    readonly severity: string | null;
    readonly payload: Record<string, unknown>;
  }) => Promise<SendOutcome>;
  /** Not wired in production until proactive WhatsApp (template and opt-in) exists. */
  readonly sendWhatsApp?: (m: {
    readonly id: string;
    readonly orgId: string;
    readonly recipientId: string;
    readonly text: string;
  }) => Promise<SendOutcome>;
}

export const BATCH_SIZE = 50;
export const GENERIC_SUBJECT = "Sherivs: you have a new item";
export const GENERIC_TEXT = "You have a new item waiting in Sherivs. Open the app to view it.";
export const SUBJECT_MAX = 120;
export const TEXT_MAX = 1200;

interface OutboxRow {
  id: string;
  org_id: string;
  recipient_id: string;
  channel: string;
  redacted: boolean;
  payload: Record<string, unknown>;
}

const isMissing = (e: Err): boolean =>
  e !== null &&
  (e.code === "42883" ||
    e.code === "42P01" ||
    e.code === "PGRST202" ||
    e.code === "PGRST205" ||
    /could not find the (function|table)|does not exist/i.test(e.message));

const clip = (s: string, n: number): string => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function routeForPayload(payload: Record<string, unknown>): string {
  const route = typeof payload.route === "string" ? payload.route : null;
  const actionUrl = typeof payload.action_url === "string" ? payload.action_url : null;
  return route ?? actionUrl ?? "/home/notifications";
}

function categoryForPayload(
  payload: Record<string, unknown>,
): "messages" | "announcements" | "grades" | "attendance" | "fees" {
  const rawCategory = typeof payload.category === "string" ? payload.category : "";
  if (rawCategory === "grades" || rawCategory === "attendance" || rawCategory === "fees")
    return rawCategory;

  const kind = typeof payload.kind === "string" ? payload.kind : "";
  if (kind === "grade" || kind === "grades") return "grades";
  if (kind === "attendance") return "attendance";
  if (kind === "fee" || kind === "fees" || kind === "money") return "fees";
  if (kind === "announcement") return "announcements";
  return "messages";
}

export function toOutboxRow(raw: unknown): OutboxRow | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  if (
    typeof o.id !== "string" ||
    typeof o.org_id !== "string" ||
    typeof o.recipient_id !== "string" ||
    typeof o.channel !== "string"
  ) {
    return null;
  }
  const payload =
    typeof o.payload === "object" && o.payload !== null && !Array.isArray(o.payload)
      ? (o.payload as Record<string, unknown>)
      : {};
  return {
    id: o.id,
    org_id: o.org_id,
    recipient_id: o.recipient_id,
    channel: o.channel,
    redacted: o.redacted === true,
    payload,
  };
}

/** What may be said. Redacted and safeguarding rows get the generic text and nothing else. */
export function composeMessage(row: OutboxRow): {
  subject: string;
  text: string;
  category: MailCategory;
} {
  const p = row.payload;
  const severity = typeof p.severity === "string" ? p.severity : "";
  const kind = typeof p.kind === "string" ? p.kind : "";
  const escalating = severity === "urgent" || severity === "critical" || kind === "escalation";
  const category: MailCategory = escalating ? "escalation" : "system";
  if (row.redacted || kind === "safeguarding") {
    return { subject: GENERIC_SUBJECT, text: GENERIC_TEXT, category };
  }
  const subject = typeof p.subject === "string" && p.subject.trim() ? p.subject : GENERIC_SUBJECT;
  const body =
    typeof p.text === "string" && p.text.trim()
      ? p.text
      : typeof p.summary === "string" && p.summary.trim()
        ? p.summary
        : GENERIC_TEXT;
  return {
    subject: clip(subject.trim(), SUBJECT_MAX),
    text: clip(body.trim(), TEXT_MAX),
    category,
  };
}

/**
 * The recipient's address, only if the person is an active member of this organization.
 * Returns null when there is no such member or no address.
 */
export async function resolveEmail(
  client: WorkerClient,
  orgId: string,
  recipientId: string,
): Promise<string | null> {
  const member = await client
    .from("organization_memberships")
    .select("user_id")
    .eq("school_id", orgId)
    .eq("user_id", recipientId)
    .eq("is_active", true)
    .limit(1);
  if (member.error || !Array.isArray(member.data) || member.data.length === 0) return null;
  const user = await client
    .from("users")
    .select("email")
    .eq("id", recipientId)
    .eq("school_id", orgId)
    .limit(1);
  if (user.error || !Array.isArray(user.data) || user.data.length === 0) return null;
  const email = (user.data[0] as { email?: unknown }).email;
  return typeof email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

export type WorkerResult =
  | { readonly status: "not_applied" }
  | {
      readonly status: "ok";
      readonly claimed: number;
      readonly sent: number;
      readonly failed: number;
      /** Counts by reason code. Never an address, text or provider message. */
      readonly reasons: Readonly<Record<string, number>>;
    };

export async function runNotificationWorker(input: {
  readonly admin: WorkerClient;
  readonly ports: WorkerPorts;
  readonly limit?: number;
}): Promise<WorkerResult> {
  const claimed = await input.admin.rpc("claim_org_notifications", {
    p_limit: input.limit ?? BATCH_SIZE,
  });
  if (claimed.error) {
    if (isMissing(claimed.error)) return { status: "not_applied" };
    throw new Error(claimed.error.message.slice(0, 120));
  }
  const rows = Array.isArray(claimed.data) ? claimed.data : [];
  const reasons: Record<string, number> = {};
  let sent = 0;
  let failed = 0;

  const finish = async (id: string, ok: boolean, reason: string): Promise<void> => {
    const done = await input.admin.rpc("complete_org_notification", { p_id: id, p_ok: ok });
    if (done.error) reason = "complete_failed";
    if (ok && !done.error) sent += 1;
    else {
      failed += 1;
      reasons[reason] = (reasons[reason] ?? 0) + 1;
    }
  };

  for (const raw of rows) {
    const row = toOutboxRow(raw);
    if (!row) {
      // A malformed row cannot be completed without an id; count it and move on.
      failed += 1;
      reasons.malformed_row = (reasons.malformed_row ?? 0) + 1;
      continue;
    }
    try {
      if (row.channel === "email") {
        const to = await resolveEmail(input.admin, row.org_id, row.recipient_id);
        if (!to) {
          await finish(row.id, false, "no_active_recipient_address");
          continue;
        }
        const msg = composeMessage(row);
        const out = await input.ports.sendEmail({
          id: row.id,
          orgId: row.org_id,
          recipientId: row.recipient_id,
          to,
          subject: msg.subject,
          text: msg.text,
          category: msg.category,
        });
        await finish(row.id, out.ok, out.ok ? "" : out.reason);
      } else if (row.channel === "whatsapp") {
        if (!input.ports.sendWhatsApp) {
          await finish(row.id, false, "whatsapp_not_configured");
          continue;
        }
        const msg = composeMessage(row);
        const out = await input.ports.sendWhatsApp({
          id: row.id,
          orgId: row.org_id,
          recipientId: row.recipient_id,
          text: msg.text,
        });
        await finish(row.id, out.ok, out.ok ? "" : out.reason);
      } else if (row.channel === "push") {
        if (!input.ports.sendPush) {
          await finish(row.id, false, "push_not_configured");
          continue;
        }
        const msg = composeMessage(row);
        const kind = typeof row.payload.kind === "string" ? row.payload.kind : "";
        const severity = typeof row.payload.severity === "string" ? row.payload.severity : null;
        const out = await input.ports.sendPush({
          id: row.id,
          orgId: row.org_id,
          recipientId: row.recipient_id,
          category: categoryForPayload(row.payload),
          route: routeForPayload(row.payload),
          title: msg.subject,
          body: msg.text,
          redacted: row.redacted,
          safeguarding: kind === "safeguarding",
          severity,
          payload: row.payload,
        });
        await finish(row.id, out.ok, out.ok ? "" : out.reason);
      } else {
        // in_app has no sender here; sms is refused outright.
        await finish(
          row.id,
          false,
          row.channel === "sms" ? "sms_refused" : "channel_not_supported",
        );
      }
    } catch {
      await finish(row.id, false, "send_threw");
    }
  }
  return { status: "ok", claimed: rows.length, sent, failed, reasons };
}

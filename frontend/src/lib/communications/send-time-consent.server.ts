/**
 * Sherivs — send-time consent, opt-out and quiet hours for SMS and WhatsApp (M22, ADR-151). Server only.
 *
 * The database fabric (`comms_send`) checks consent when a message is QUEUED. A recipient can opt out
 * (STOP reply, admin entry) after that, so both dispatchers (`sms-fabric.server.ts`,
 * `whatsapp-fabric.server.ts`) call this gate again immediately before they claim a row. One gate,
 * one rule set, mirroring `comms_send` exactly:
 *
 *  - per user and per channel: the recipient user's stored phone, in this organization, on this
 *    channel, is looked up in `comms_optins` (the canonical consent ledger; phone-keyed per org and
 *    channel). The phone was already proved to belong to the recipient user by the caller.
 *  - `opted_out` blocks every non-safety message;
 *  - WhatsApp, and marketing on any channel, need an explicit `opted_in`;
 *  - a lookup that fails blocks (fail closed);
 *  - `safety` priority bypasses opt-out and quiet hours (emergencies), as `comms_send` does;
 *  - quiet hours come from the existing preference model (`notification_preferences.quiet_hours_start`
 *    / `quiet_hours_end` for the recipient in this organization) and are evaluated with the same
 *    function and the same UTC interpretation as the in-app path of PR #308 (`isWithinQuietHours`).
 *    Quiet hours DEFER a message (it stays queued, is not claimed, nothing is charged or refunded);
 *    they never drop it.
 */
import { z } from "zod";
import { isWithinQuietHours } from "../notifications/delivery-policy";

interface Result {
  data: unknown;
  error: { message: string } | null;
}
interface Query extends PromiseLike<Result> {
  select(columns: string): Query;
  eq(column: string, value: unknown): Query;
  in(column: string, values: unknown[]): Query;
  limit(count: number): Query;
  maybeSingle(): PromiseLike<Result>;
}
export interface ConsentDatabase {
  from(table: string): Query;
}

export type ConsentChannel = "sms" | "whatsapp";

export interface SendTimeConsentInput {
  orgId: string;
  recipientUserId: string;
  channel: ConsentChannel;
  /** Every stored form of the recipient's number to look up (raw, digits, +digits, normalised). */
  phoneForms: readonly string[];
  priority: string;
  category: string;
  /** Epoch milliseconds from the injected clock. */
  nowMs: number;
}

export type SendTimeConsent =
  | { ok: true }
  | {
      ok: false;
      code: "consent_unverifiable" | "opted_out" | "opt_in_required";
      defer: false;
      reason: string;
    }
  | { ok: false; code: "quiet_hours"; defer: true; reason: string };

export async function checkSendTimeConsent(
  db: ConsentDatabase,
  input: SendTimeConsentInput,
): Promise<SendTimeConsent> {
  const safety = input.priority === "safety";
  const optins = await db
    .from("comms_optins")
    .select("phone,status")
    .eq("org_id", input.orgId)
    .eq("channel", input.channel)
    .in("phone", [...new Set(input.phoneForms)]);
  if (optins.error || !Array.isArray(optins.data)) {
    return {
      ok: false,
      code: "consent_unverifiable",
      defer: false,
      reason: "consent could not be verified",
    };
  }
  const statuses = optins.data.map((entry) => (entry as { status?: unknown }).status);
  const optedOut = statuses.includes("opted_out");
  const optedIn = statuses.includes("opted_in") && !optedOut;
  if (!safety) {
    if (optedOut) {
      return {
        ok: false,
        code: "opted_out",
        defer: false,
        reason: "blocked by consent: recipient opted out of this channel",
      };
    }
    if ((input.channel === "whatsapp" || input.category === "marketing") && !optedIn) {
      return {
        ok: false,
        code: "opt_in_required",
        defer: false,
        reason: "blocked by consent: recipient has not opted in to this message",
      };
    }
  }
  if (safety) return { ok: true };

  const prefs = await db
    .from("notification_preferences")
    .select("quiet_hours_start,quiet_hours_end")
    .eq("user_id", input.recipientUserId)
    .eq("school_id", input.orgId)
    .limit(1)
    .maybeSingle();
  const parsed = z
    .object({
      quiet_hours_start: z.string().nullable().optional(),
      quiet_hours_end: z.string().nullable().optional(),
    })
    .nullable()
    .safeParse(prefs.data ?? null);
  // A preference row that cannot be read means "no quiet hours known": consent was already proved,
  // and quiet hours only ever defer, so failing open here cannot send to someone who opted out.
  if (prefs.error || !parsed.success || parsed.data === null) return { ok: true };
  const d = new Date(input.nowMs);
  const minute = d.getUTCHours() * 60 + d.getUTCMinutes();
  if (isWithinQuietHours(parsed.data.quiet_hours_start, parsed.data.quiet_hours_end, minute)) {
    return {
      ok: false,
      code: "quiet_hours",
      defer: true,
      reason: "deferred: recipient quiet hours",
    };
  }
  return { ok: true };
}

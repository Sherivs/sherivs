/**
 * Owner alerts (ENGINE-04, ADR-082): how JARVIS reaches the sheriff by call,
 * text or WhatsApp. An alert is a NOTIFICATION that links into the console. It
 * never carries an approve link, a code or a secret, so a stolen phone or a
 * spoofed message cannot approve anything: T3 approval needs the passkey in the
 * console (ADR-078, ADR-081).
 */
import { looksLikeSecretValue } from "../tool-broker/connector-vault";
import type { Severity } from "./severity";

export type AlertChannel = "voice" | "whatsapp" | "sms" | "email" | "console";

export interface QuietHours {
  /** Local-hour window, inclusive start, exclusive end; may wrap midnight. */
  readonly startHour: number;
  readonly endHour: number;
  readonly utcOffsetMinutes: number;
}

export const CHANNELS_BY_SEVERITY: Readonly<Record<Severity, readonly AlertChannel[]>> =
  Object.freeze({
    S1: ["voice", "whatsapp", "sms", "email", "console"],
    S2: ["whatsapp", "sms", "email", "console"],
    S3: ["console"],
    S4: ["console"],
  });

const MAX_BODY = 280;
const FORBIDDEN_QUERY = /(^|[?&])(token|code|otp|approve|approval|key|secret|sig|signature)=/i;

export const inQuietHours = (nowMs: number, q: QuietHours | null): boolean => {
  if (!q) return false;
  const local = new Date(nowMs + q.utcOffsetMinutes * 60_000);
  const h = local.getUTCHours();
  return q.startHour <= q.endHour
    ? h >= q.startHour && h < q.endHour
    : h >= q.startHour || h < q.endHour;
};

export interface AlertInput {
  readonly severity: Severity;
  readonly title: string;
  readonly consoleOrigin: string;
  readonly consolePath: string;
  readonly nowMs: number;
  readonly quiet: QuietHours | null;
  /** Epoch ms of the last alert with the same dedupe key, if any. */
  readonly lastSentMs: number | null;
  readonly sentInLastHour: number;
}

export type AlertPlan =
  | {
      readonly send: true;
      readonly channels: readonly AlertChannel[];
      readonly body: string;
      readonly link: string;
    }
  | {
      readonly send: false;
      readonly reason: "quiet_hours" | "deduped" | "rate_limited" | "unsafe_link";
    };

const DEDUPE_MS = 15 * 60_000;
const HOURLY_CAP: Readonly<Record<Severity, number>> = { S1: 12, S2: 6, S3: 3, S4: 1 };

export function planOwnerAlert(i: AlertInput): AlertPlan {
  let url: URL;
  try {
    url = new URL(i.consolePath, i.consoleOrigin);
  } catch {
    return { send: false, reason: "unsafe_link" };
  }
  const origin = new URL(i.consoleOrigin);
  if (
    url.origin !== origin.origin ||
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    FORBIDDEN_QUERY.test(url.search) ||
    url.hash !== ""
  ) {
    return { send: false, reason: "unsafe_link" };
  }
  if (i.lastSentMs !== null && i.nowMs - i.lastSentMs < DEDUPE_MS)
    return { send: false, reason: "deduped" };
  if (i.sentInLastHour >= HOURLY_CAP[i.severity]) return { send: false, reason: "rate_limited" };
  // S1 always breaks quiet hours; everything else waits for the digest.
  if (i.severity !== "S1" && inQuietHours(i.nowMs, i.quiet))
    return { send: false, reason: "quiet_hours" };

  const safeTitle = looksLikeSecretValue(i.title)
    ? "[withheld]"
    : i.title.replace(/\s+/g, " ").trim();
  const body =
    `[${i.severity}] ${safeTitle}`.slice(0, MAX_BODY - url.toString().length - 20) +
    ` Review in console: ${url.toString()}`;
  return { send: true, channels: CHANNELS_BY_SEVERITY[i.severity], body, link: url.toString() };
}

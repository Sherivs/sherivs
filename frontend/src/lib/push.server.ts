import { SystemClock, TimeAuthority } from "./kernel/time-authority";
import {
  revokeMobilePushDevicesById,
  sendExpoPushMessages,
  type ExpoReceiptEntry,
  isTruthyFlag,
} from "@/lib/push/expo-push.server";
import {
  canSendPushNow,
  type NotificationPreferenceRow,
  type PushCategory,
} from "@/lib/push/push-preferences.server";
import { sanitizePushRoute } from "@/lib/push/push-route-allowlist.server";
import { androidChannelId, notificationBody } from "@/lib/push/expo-message-policy.server";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

/**
 * Server-side Web Push delivery (server-only).
 *
 * Sends VAPID-authenticated, payload-less push messages to stored browser
 * subscriptions. The service worker (`public/sw.js`) renders a generic
 * notification and deep-links the user to /home/notifications.
 *
 * Requires the `VAPID_PUBLIC_KEY` (base64url, uncompressed P-256 point) and
 * `VAPID_PRIVATE_KEY` (base64url, raw 32-byte scalar) secrets. When they are
 * missing, delivery is skipped silently so in-app notifications still work.
 */

export const DEFAULT_VAPID_SUBJECT = "https://app.sherivs.com";

function base64UrlToBytes(input: string): Uint8Array {
  const padded = input.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i);
  return out;
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  bytes.forEach((b) => {
    binary += String.fromCharCode(b);
  });
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function jsonToBase64Url(value: unknown): string {
  return bytesToBase64Url(new TextEncoder().encode(JSON.stringify(value)));
}

async function importVapidKey(publicKey: string, privateKey: string): Promise<CryptoKey> {
  const pub = base64UrlToBytes(publicKey);
  if (pub.length !== 65 || pub[0] !== 4)
    throw new Error("VAPID_PUBLIC_KEY must be an uncompressed P-256 point");
  const jwk: JsonWebKey = {
    kty: "EC",
    crv: "P-256",
    x: bytesToBase64Url(pub.slice(1, 33)),
    y: bytesToBase64Url(pub.slice(33, 65)),
    d: bytesToBase64Url(base64UrlToBytes(privateKey)),
    ext: true,
    key_ops: ["sign"],
  };
  return crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
  ]);
}

async function vapidHeader(
  endpoint: string,
  publicKey: string,
  privateKey: string,
  subject: string,
) {
  const audience = new URL(endpoint).origin;
  const header = jsonToBase64Url({ typ: "JWT", alg: "ES256" });
  const claims = jsonToBase64Url({
    aud: audience,
    exp: Math.floor(timeAuthority.now().atMs / 1000) + 12 * 60 * 60,
    sub: subject,
  });
  const key = await importVapidKey(publicKey, privateKey);
  const signature = await crypto.subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    key,
    new TextEncoder().encode(`${header}.${claims}`),
  );
  const jwt = `${header}.${claims}.${bytesToBase64Url(new Uint8Array(signature))}`;
  return `vapid t=${jwt}, k=${publicKey}`;
}

export type PushDeliveryResult = {
  attempted: number;
  delivered: number;
  expired: string[];
  skippedReason?: string;
  expoAttempted?: number;
  expoDelivered?: number;
  expoReceipts?: ExpoReceiptEntry[];
};

type DeliverPushOptions = {
  category?: PushCategory;
  route?: string | null;
  notificationId?: string | null;
  title?: string | null;
  body?: string | null;
  redacted?: boolean;
  safeguarding?: boolean;
  severity?: string | null;
};

type DeviceRow = {
  id: string;
  user_id: string;
  expo_push_token: string;
  enabled: boolean;
  revoked_at: string | null;
};

/**
 * Deliver a push to each stored subscription token.
 * Returns endpoints that are gone (410/404) so callers can clear them.
 */
export async function sendWebPush(tokens: string[]): Promise<PushDeliveryResult> {
  const publicKey = process.env.VAPID_PUBLIC_KEY;
  const privateKey = process.env.VAPID_PRIVATE_KEY;
  const subject = process.env.VAPID_SUBJECT ?? DEFAULT_VAPID_SUBJECT;

  if (!tokens.length) return { attempted: 0, delivered: 0, expired: [] };
  if (!publicKey || !privateKey) {
    return {
      attempted: tokens.length,
      delivered: 0,
      expired: [],
      skippedReason: "vapid_keys_missing",
    };
  }

  let delivered = 0;
  const expired: string[] = [];

  await Promise.all(
    tokens.map(async (token) => {
      let endpoint: string | undefined;
      try {
        endpoint = (JSON.parse(token) as { endpoint?: string }).endpoint;
        if (!endpoint) return;
        const authorization = await vapidHeader(endpoint, publicKey, privateKey, subject);
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { Authorization: authorization, TTL: "86400", "Content-Length": "0" },
        });
        if (res.ok) delivered += 1;
        else if (res.status === 404 || res.status === 410) expired.push(token);
      } catch {
        /* a single bad subscription must not fail the whole fan-out */
      }
    }),
  );

  return { attempted: tokens.length, delivered, expired };
}

function isHighPriority(options: DeliverPushOptions): boolean {
  const severity = (options.severity ?? "").toLowerCase();
  return options.safeguarding === true || severity === "urgent" || severity === "critical";
}

async function fetchPushPreferences(
  supabase: any, // eslint-disable-line @typescript-eslint/no-explicit-any -- supabase client param; server-side helper boundary.
  userIds: string[],
): Promise<Map<string, NotificationPreferenceRow>> {
  if (!userIds.length) return new Map();
  const { data } = await supabase
    .from("notification_preferences")
    .select(
      "user_id,push_messages,push_announcements,push_grades,push_attendance,push_fees,quiet_hours_start,quiet_hours_end,timezone",
    )
    .in("user_id", userIds);

  const rows = (data ?? []) as NotificationPreferenceRow[];
  return new Map(rows.map((row) => [row.user_id, row]));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- supabase client param; server-side helper boundary.
async function fetchActiveExpoDevices(supabase: any, userIds: string[]): Promise<DeviceRow[]> {
  if (!userIds.length) return [];

  const { data } = await supabase
    .from("mobile_push_devices")
    .select("id,user_id,expo_push_token,enabled,revoked_at")
    .in("user_id", userIds)
    .eq("enabled", true)
    .is("revoked_at", null);

  const rows = (data ?? []) as DeviceRow[];
  return rows.filter(
    (row) => typeof row.expo_push_token === "string" && row.expo_push_token.length > 0,
  );
}

/**
 * Look up push tokens for the given users, deliver, and clear dead ones.
 * `supabase` is the request-scoped authenticated client.
 */
export async function deliverPushToUsers(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- supabase client param; server-side helper boundary.
  supabase: any,
  userIds: string[],
  options: DeliverPushOptions = {},
): Promise<PushDeliveryResult> {
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  if (!ids.length) return { attempted: 0, delivered: 0, expired: [] };

  const category = options.category ?? "messages";
  const nowMs = timeAuthority.now().atMs;

  const [userRowsRaw, prefMap] = await Promise.all([
    supabase.from("users").select("id, push_token").in("id", ids).not("push_token", "is", null),
    fetchPushPreferences(supabase, ids),
  ]);

  const rows = (userRowsRaw.data ?? []) as Array<{ id: string; push_token: string }>;
  const allowedUserIds = ids.filter((userId) =>
    canSendPushNow(prefMap.get(userId), category, nowMs),
  );
  if (!allowedUserIds.length) {
    return {
      attempted: 0,
      delivered: 0,
      expired: [],
      expoAttempted: 0,
      expoDelivered: 0,
      expoReceipts: [],
      skippedReason: "quiet_hours_or_preferences",
    };
  }

  const webTokens = rows
    .filter((row) => allowedUserIds.includes(row.id))
    .map((row) => row.push_token)
    .filter((token): token is string => typeof token === "string" && token.length > 0);

  const webResult = await sendWebPush(webTokens);

  if (webResult.expired.length) {
    const staleIds = rows.filter((r) => webResult.expired.includes(r.push_token)).map((r) => r.id);
    if (staleIds.length) {
      await supabase
        .from("users")
        .update({ push_token: null, push_token_updated_at: timeAuthority.now().at })
        .in("id", staleIds);
    }
  }

  const expoEnabled = isTruthyFlag(process.env.PUSH_EXPO_ENABLED);
  if (!expoEnabled) {
    return {
      ...webResult,
      expoAttempted: 0,
      expoDelivered: 0,
      expoReceipts: [],
    };
  }

  const devices = await fetchActiveExpoDevices(supabase, allowedUserIds);
  const route = sanitizePushRoute(options.route ?? undefined);
  const { title, body } = notificationBody(options, category);

  const expoResult = await sendExpoPushMessages({
    accessToken: process.env.EXPO_ACCESS_TOKEN,
    messages: devices.map((device) => ({
      token: device.expo_push_token,
      deviceId: device.id,
      title,
      body,
      route,
      notificationId: options.notificationId ?? undefined,
      channelId: androidChannelId(category),
      highPriority: isHighPriority(options),
    })),
  });

  if (expoResult.deviceIdsToPrune.length) {
    await revokeMobilePushDevicesById(supabase, expoResult.deviceIdsToPrune);
  }

  return {
    ...webResult,
    expoAttempted: expoResult.attempted,
    expoDelivered: expoResult.accepted,
    expoReceipts: expoResult.receipts,
  };
}

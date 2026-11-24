import { SystemClock, TimeAuthority } from "@/lib/kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

const EXPO_SEND_URL = "https://exp.host/--/api/v2/push/send";
const EXPO_RECEIPTS_URL = "https://exp.host/--/api/v2/push/getReceipts";
const EXPO_MAX_SEND_BATCH = 100;
const EXPO_MAX_RECEIPT_BATCH = 300;

const TRANSIENT_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export type ExpoPushMessage = {
  token: string;
  deviceId?: string;
  title: string;
  body: string;
  route?: string;
  notificationId?: string;
  channelId: string;
  highPriority: boolean;
};

export type ExpoReceiptEntry = {
  receiptId: string;
  deviceId?: string;
};

export function isTruthyFlag(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function toExpoPayload(message: ExpoPushMessage): Record<string, unknown> {
  const data: Record<string, string> = {};
  if (message.route) data.route = message.route;
  if (message.notificationId) data.notificationId = message.notificationId;

  return {
    to: message.token,
    title: message.title,
    body: message.body,
    channelId: message.channelId,
    priority: message.highPriority ? "high" : "default",
    ...(Object.keys(data).length ? { data } : {}),
  };
}

async function delay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function postJsonWithRetry(
  url: string,
  body: unknown,
  accessToken?: string,
): Promise<unknown> {
  let attempt = 0;
  let backoff = 200;

  while (attempt < 4) {
    try {
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Accept: "application/json",
      };
      if (accessToken) headers.Authorization = "Bearer " + accessToken;

      const response = await fetch(url, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        if (TRANSIENT_STATUS.has(response.status) && attempt < 3) {
          attempt += 1;
          await delay(backoff);
          backoff *= 2;
          continue;
        }
        throw new Error(`expo_http_${response.status}`);
      }

      return await response.json();
    } catch (error) {
      if (attempt >= 3) {
        const reason = error instanceof Error ? error.message.slice(0, 60) : "request_failed";
        throw new Error(`expo_send_failed:${reason}`);
      }
      attempt += 1;
      await delay(backoff);
      backoff *= 2;
    }
  }

  throw new Error("expo_send_failed:retry_exhausted");
}

function chunks<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    out.push(items.slice(index, index + size));
  }
  return out;
}

export async function sendExpoPushMessages(input: {
  messages: ExpoPushMessage[];
  accessToken?: string;
}): Promise<{
  attempted: number;
  accepted: number;
  receipts: ExpoReceiptEntry[];
  deviceIdsToPrune: string[];
}> {
  if (!input.messages.length) {
    return { attempted: 0, accepted: 0, receipts: [], deviceIdsToPrune: [] };
  }

  const receipts: ExpoReceiptEntry[] = [];
  const deviceIdsToPrune = new Set<string>();
  let accepted = 0;

  for (const group of chunks(input.messages, EXPO_MAX_SEND_BATCH)) {
    const payload = group.map(toExpoPayload);
    const raw = (await postJsonWithRetry(EXPO_SEND_URL, payload, input.accessToken)) as {
      data?: Array<{ status?: string; id?: string; details?: { error?: string } }>;
    };
    const ticketRows = Array.isArray(raw.data) ? raw.data : [];

    for (let index = 0; index < ticketRows.length; index += 1) {
      const ticket = ticketRows[index] ?? {};
      const message = group[index];
      if (!message) continue;

      if (ticket.status === "ok" && typeof ticket.id === "string") {
        accepted += 1;
        receipts.push({ receiptId: ticket.id, deviceId: message.deviceId });
      }

      if (ticket.details?.error === "DeviceNotRegistered" && message.deviceId) {
        deviceIdsToPrune.add(message.deviceId);
      }
    }
  }

  return {
    attempted: input.messages.length,
    accepted,
    receipts,
    deviceIdsToPrune: [...deviceIdsToPrune],
  };
}

export async function pollExpoPushReceipts(input: {
  entries: ExpoReceiptEntry[];
  accessToken?: string;
}): Promise<{
  checkedReceiptIds: string[];
  deviceIdsToPrune: string[];
}> {
  if (!input.entries.length) return { checkedReceiptIds: [], deviceIdsToPrune: [] };

  const byId = new Map<string, ExpoReceiptEntry>();
  input.entries.forEach((entry) => byId.set(entry.receiptId, entry));

  const checkedReceiptIds: string[] = [];
  const deviceIdsToPrune = new Set<string>();

  for (const group of chunks(input.entries, EXPO_MAX_RECEIPT_BATCH)) {
    const ids = group.map((entry) => entry.receiptId);
    const raw = (await postJsonWithRetry(EXPO_RECEIPTS_URL, { ids }, input.accessToken)) as {
      data?: Record<string, { status?: string; details?: { error?: string } }>;
    };
    const receipts = raw.data ?? {};

    for (const receiptId of ids) {
      const receipt = receipts[receiptId];
      if (!receipt) continue;
      checkedReceiptIds.push(receiptId);
      if (receipt.details?.error === "DeviceNotRegistered") {
        const entry = byId.get(receiptId);
        if (entry?.deviceId) deviceIdsToPrune.add(entry.deviceId);
      }
    }
  }

  return { checkedReceiptIds, deviceIdsToPrune: [...deviceIdsToPrune] };
}

export async function revokeMobilePushDevicesById(
  supabase: any, // eslint-disable-line @typescript-eslint/no-explicit-any -- supabase client param; server-side helper boundary.
  deviceIds: string[],
): Promise<void> {
  if (!deviceIds.length) return;
  const now = timeAuthority.now().at;
  await supabase
    .from("mobile_push_devices")
    .update({ enabled: false, revoked_at: now, updated_at: now })
    .in("id", deviceIds)
    .is("revoked_at", null);
}

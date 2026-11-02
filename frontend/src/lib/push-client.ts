/**
 * Browser-side push notification registration.
 *
 * Registers the service worker, requests notification permission, subscribes
 * to the Push API (VAPID public key required) and persists the resulting
 * subscription on `users.push_token`.
 */
import { supabase } from "@/integrations/supabase/client";

export type PushSupport = {
  supported: boolean;
  permission: NotificationPermission | "unsupported";
  vapidConfigured: boolean;
};

export type RegisterPushResult = {
  ok: boolean;
  token: string | null;
  reason?: "unsupported" | "denied" | "missing_vapid" | "no_user" | "error";
};

/** Client-safe application-server key. Empty builds cannot subscribe. */
export function vapidPublicKey(): string | null {
  const raw = import.meta.env.VITE_VAPID_PUBLIC_KEY;
  if (typeof raw !== "string") return null;
  const key = raw.trim();
  return key.length > 0 ? key : null;
}

export function getPushSupport(): PushSupport {
  if (typeof window === "undefined") {
    return {
      supported: false,
      permission: "unsupported",
      vapidConfigured: Boolean(vapidPublicKey()),
    };
  }
  const supported =
    "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  return {
    supported,
    permission: supported ? Notification.permission : "unsupported",
    vapidConfigured: Boolean(vapidPublicKey()),
  };
}

function urlBase64ToUint8Array(base64String: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = window.atob(base64);
  const buffer = new ArrayBuffer(raw.length);
  const out = new Uint8Array(buffer);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return buffer;
}

async function ensureRegistration(): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration("/sw.js");
  if (existing) return existing;
  return navigator.serviceWorker.register("/sw.js", { scope: "/" });
}

/** Register the offline app shell independently of optional push permission. */
export async function registerOfflineServiceWorker(): Promise<void> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
  try {
    await ensureRegistration();
  } catch {
    /* Offline shell registration is best-effort. */
  }
}

/**
 * Subscribe (or reuse an existing subscription) and store the token against
 * the signed-in user. Returns the stored token, or null when unavailable.
 */
export async function registerPushToken(userId: string): Promise<string | null> {
  const result = await registerPushSubscription(userId);
  return result.token;
}

export async function registerPushSubscription(userId: string): Promise<RegisterPushResult> {
  if (!userId) return { ok: false, token: null, reason: "no_user" };
  const { supported } = getPushSupport();
  if (!supported) return { ok: false, token: null, reason: "unsupported" };

  const vapid = vapidPublicKey();
  if (!vapid) return { ok: false, token: null, reason: "missing_vapid" };

  const permission =
    Notification.permission === "default"
      ? await Notification.requestPermission()
      : Notification.permission;
  if (permission !== "granted") return { ok: false, token: null, reason: "denied" };

  try {
    const registration = await ensureRegistration();
    await navigator.serviceWorker.ready;

    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapid),
      });
    }

    const token = JSON.stringify(subscription.toJSON());
    const { error } = await supabase
      .from("users")
      .update({ push_token: token, push_token_updated_at: new Date().toISOString() })
      .eq("id", userId);
    if (error) throw error;

    return { ok: true, token };
  } catch {
    return { ok: false, token: null, reason: "error" };
  }
}

/** Remove the browser subscription and clear the stored token. */
export async function unregisterPushToken(userId: string): Promise<void> {
  if (typeof window === "undefined" || !userId) return;
  if ("serviceWorker" in navigator) {
    const registration = await navigator.serviceWorker.getRegistration("/sw.js");
    const subscription = await registration?.pushManager.getSubscription();
    await subscription?.unsubscribe();
  }
  const { error } = await supabase
    .from("users")
    .update({ push_token: null, push_token_updated_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) throw error;
}

/**
 * Silent refresh: only re-registers when the user already granted permission,
 * so signed-in users keep a fresh token without being re-prompted.
 */
export async function refreshPushTokenIfGranted(userId: string): Promise<void> {
  const { supported, permission } = getPushSupport();
  if (!supported || permission !== "granted") return;
  try {
    await registerPushToken(userId);
  } catch {
    /* token refresh is best-effort */
  }
}

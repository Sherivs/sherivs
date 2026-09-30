/**
 * Browser-side push notification registration.
 *
 * Registers the service worker, requests notification permission, subscribes
 * to the Push API (VAPID when `VITE_VAPID_PUBLIC_KEY` is configured) and
 * persists the resulting subscription on `users.push_token`.
 */
import { supabase } from "@/integrations/supabase/client";

export type PushSupport = {
  supported: boolean;
  permission: NotificationPermission | "unsupported";
};

export function getPushSupport(): PushSupport {
  if (typeof window === "undefined") return { supported: false, permission: "unsupported" };
  const supported =
    "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  return { supported, permission: supported ? Notification.permission : "unsupported" };
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

/**
 * Subscribe (or reuse an existing subscription) and store the token against
 * the signed-in user. Returns the stored token, or null when unavailable.
 */
export async function registerPushToken(userId: string): Promise<string | null> {
  const { supported } = getPushSupport();
  if (!supported || !userId) return null;

  const permission =
    Notification.permission === "default"
      ? await Notification.requestPermission()
      : Notification.permission;
  if (permission !== "granted") return null;

  const registration = await ensureRegistration();
  await navigator.serviceWorker.ready;

  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    const vapid = import.meta.env.VITE_VAPID_PUBLIC_KEY as string | undefined;
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      ...(vapid ? { applicationServerKey: urlBase64ToUint8Array(vapid) } : {}),
    });
  }

  const token = JSON.stringify(subscription.toJSON());
  const { error } = await supabase
    .from("users")
    .update({ push_token: token, push_token_updated_at: new Date().toISOString() })
    .eq("id", userId);
  if (error) throw error;

  return token;
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

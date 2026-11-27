/**
 * SV1-LITE Data Saver preference: stored locally, per person and context, and
 * applied immediately in every mounted component through one window event.
 * The storage key keeps the existing `sherivs.offline.data-saver:` prefix, so the
 * existing sign-out cleanup (`clearLegacyOfflineStorage`) still removes it.
 */
import type { OfflineScope } from "./indexeddb-store";

export const DATA_SAVER_EVENT = "sherivs:data-saver";

export function dataSaverKey(scope: OfflineScope): string {
  return `sherivs.offline.data-saver:${encodeURIComponent(
    JSON.stringify([scope.tenantId, scope.userId, scope.role]),
  )}`;
}

export function readDataSaver(
  key: string | null,
  storage: Pick<Storage, "getItem"> | undefined,
): boolean {
  if (!key) return false;
  try {
    return storage?.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function writeDataSaver(
  key: string | null,
  on: boolean,
  storage: Pick<Storage, "setItem" | "removeItem"> | undefined,
  target: Pick<EventTarget, "dispatchEvent"> | undefined = typeof window === "undefined"
    ? undefined
    : window,
): void {
  if (key && storage) {
    try {
      if (on) storage.setItem(key, "1");
      else storage.removeItem(key);
    } catch {
      /* Blocked storage: the setting still applies for this page through the event. */
    }
  }
  target?.dispatchEvent(new CustomEvent(DATA_SAVER_EVENT, { detail: { key, on } }));
}

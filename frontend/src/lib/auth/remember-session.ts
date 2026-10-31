/**
 * "Remember for 30 days" is a client preference for where the Auth session
 * is stored. It is not authorization. Closing the tab ends a non-remembered
 * session (sessionStorage). A remembered session is dropped after 30 days.
 */
export const REMEMBER_STORAGE_KEY = "sherivs.auth.remember-until";
export const REMEMBER_DURATION_MS = 30 * 24 * 60 * 60 * 1000;

export type RememberStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export function rememberUntil(now = Date.now()): number {
  return now + REMEMBER_DURATION_MS;
}

export function setRememberPreference(
  remember: boolean,
  now = Date.now(),
  storage: RememberStorage | undefined = typeof window === "undefined" ? undefined : window.localStorage,
): void {
  if (!storage) return;
  if (remember) storage.setItem(REMEMBER_STORAGE_KEY, String(rememberUntil(now)));
  else storage.removeItem(REMEMBER_STORAGE_KEY);
}

export function rememberPreferenceActive(
  now = Date.now(),
  storage: RememberStorage | undefined = typeof window === "undefined" ? undefined : window.localStorage,
): boolean {
  if (!storage) return false;
  const raw = storage.getItem(REMEMBER_STORAGE_KEY);
  if (!raw) return false;
  const until = Number(raw);
  if (!Number.isFinite(until) || until <= now) {
    storage.removeItem(REMEMBER_STORAGE_KEY);
    return false;
  }
  return true;
}

/** Dual local/session storage so Auth can honour the 30-day preference. */
export function createAuthStorage(web: {
  local: Storage;
  session: Storage;
  now?: () => number;
}): Storage {
  const now = web.now ?? (() => Date.now());
  const remembered = () => rememberPreferenceActive(now(), web.local);
  const pick = () => (remembered() ? web.local : web.session);
  return {
    get length() {
      return pick().length;
    },
    clear() {
      web.session.clear();
    },
    key(index) {
      return pick().key(index);
    },
    getItem(key) {
      if (remembered()) return web.local.getItem(key);
      return web.session.getItem(key);
    },
    setItem(key, value) {
      if (remembered()) {
        web.local.setItem(key, value);
        web.session.removeItem(key);
        return;
      }
      web.session.setItem(key, value);
      if (key !== REMEMBER_STORAGE_KEY) web.local.removeItem(key);
    },
    removeItem(key) {
      web.local.removeItem(key);
      web.session.removeItem(key);
    },
  };
}

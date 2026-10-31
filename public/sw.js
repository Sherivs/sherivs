/* Sherivs — service worker for web push notifications + offline shell. */

/* The offline shell is the smallest useful offline surface: precache the app's
 * root document at install, then serve navigations network-first (caching every
 * successful navigation) and fall back to the cache — the visited URL first,
 * the precached shell second — only when the network is unreachable. Push
 * notification behaviour is unchanged. */
const APP_SHELL_CACHE = "sherivs-app-shell-v1";
// Former cache names (CoreGrid was the former platform name), removed on activate.
const LEGACY_CACHE_PREFIXES = ["coregrid-app-shell-"];
const APP_SHELL_URL = "/";

function precacheAppShell() {
  return caches
    .open(APP_SHELL_CACHE)
    .then((cache) => cache.add(APP_SHELL_URL))
    .catch(() => {
      /* The shell is best-effort: an offline install must not fail activation. */
    });
}

self.addEventListener("install", (event) => {
  event.waitUntil(precacheAppShell());
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    Promise.resolve()
      .then(() => caches.keys())
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => LEGACY_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix)))
            .map((key) => caches.delete(key)),
        ),
      )
      .catch(() => undefined)
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("push", (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch {
    payload = { body: event.data ? event.data.text() : "" };
  }

  const title = payload.title || "Sherivs";
  const options = {
    body: payload.body || "You have a new notification.",
    icon: "/favicon.ico",
    badge: "/favicon.ico",
    tag: payload.tag || "sherivs-notification",
    data: { url: payload.url || "/home/notifications" },
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/home/notifications";

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if ("focus" in client) {
          client.navigate(target);
          return client.focus();
        }
      }
      return self.clients.openWindow(target);
    }),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.mode !== "navigate" || request.method !== "GET") return;

  event.respondWith(
    (async () => {
      const cache = await caches.open(APP_SHELL_CACHE);
      try {
        const response = await fetch(request);
        // 2xx only: redirects and opaque responses must never enter the cache.
        if (response && response.ok) {
          cache.put(request, response.clone());
        }
        return response;
      } catch {
        const cached =
          (await cache.match(request, { ignoreSearch: true })) ||
          (await cache.match(APP_SHELL_URL));
        if (cached) return cached;
        return new Response("Offline — Sherivs is unavailable until you reconnect.", {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        });
      }
    })(),
  );
});
const ROUTES = [
  {
    name: "wallet-topup-reconcile",
    path: "/api/public/cron/wallet-topup-reconcile",
    setting: "ROUTE_WALLET_TOPUP_RECONCILE",
    defaultEnabled: true,
    cadence: { everyMinutes: 10 },
    timeoutMs: 25_000,
  },
  {
    name: "workflow-tick",
    path: "/api/public/cron/workflow-tick",
    setting: "ROUTE_WORKFLOW_TICK",
    defaultEnabled: false,
    cadence: { everyMinutes: 1 },
    timeoutMs: 50_000,
  },
  {
    name: "org-notifications",
    path: "/api/public/cron/org-notifications",
    setting: "ROUTE_ORG_NOTIFICATIONS",
    defaultEnabled: false,
    cadence: { everyMinutes: 5 },
    timeoutMs: 25_000,
  },
  {
    name: "jarvis-tick",
    path: "/api/public/cron/jarvis-tick",
    setting: "ROUTE_JARVIS_TICK",
    defaultEnabled: false,
    cadence: { everyMinutes: 10 },
    timeoutMs: 25_000,
  },
  {
    name: "integrations-sync",
    path: "/api/public/cron/integrations-sync",
    setting: "ROUTE_INTEGRATIONS_SYNC",
    defaultEnabled: false,
    cadence: { everyMinutes: 30 },
    timeoutMs: 25_000,
  },
  {
    name: "org-weekly-reports",
    path: "/api/public/cron/org-weekly-reports",
    setting: "ROUTE_ORG_WEEKLY_REPORTS",
    defaultEnabled: false,
    cadence: { day: 1, hour: 5, minute: 0 },
    timeoutMs: 25_000,
  },
];

const encoder = new TextEncoder();

function isDue(route, scheduledTime) {
  const date = new Date(scheduledTime);
  if (!Number.isFinite(date.getTime())) return false;
  if (route.cadence.everyMinutes) {
    return date.getUTCMinutes() % route.cadence.everyMinutes === 0;
  }
  return (
    date.getUTCDay() === route.cadence.day &&
    date.getUTCHours() === route.cadence.hour &&
    date.getUTCMinutes() === route.cadence.minute
  );
}

function isEnabled(route, env) {
  return (env[route.setting] ?? (route.defaultEnabled ? "true" : "false")) === "true";
}

async function constantTimeEqual(left, right) {
  const [leftHash, rightHash] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const a = new Uint8Array(leftHash);
  const b = new Uint8Array(rightHash);
  let mismatch = 0;
  for (let index = 0; index < a.length; index += 1) mismatch |= a[index] ^ b[index];
  return mismatch === 0;
}

function targetUrl(env, route) {
  const base = new URL(env.TARGET_BASE_URL ?? "https://www.sherivs.com");
  if (base.protocol !== "https:" || !base.hostname || base.username || base.password) {
    throw new Error("invalid_target_base_url");
  }
  return new URL(route.path, base);
}

async function callRoute(route, env, fetchImpl = fetch) {
  const started = Date.now();
  let status = 0;
  let bytes = 0;
  try {
    if (!env.CRON_SECRET) throw new Error("cron_secret_not_configured");
    const response = await fetchImpl(targetUrl(env, route), {
      method: "GET",
      headers: { Authorization: "Bearer " + env.CRON_SECRET },
      signal: AbortSignal.timeout(route.timeoutMs),
    });
    status = response.status;
    bytes = (await response.arrayBuffer()).byteLength;
  } finally {
    console.log(
      `cron route=${route.name} http=${status} ms=${Date.now() - started} bytes=${bytes}`,
    );
  }
  return { route: route.name, status, ms: Date.now() - started };
}

const worker = {
  async scheduled(controller, env, ctx) {
    const tasks = ROUTES.map(async (route) => {
      if (!isDue(route, controller.scheduledTime)) {
        console.log(`cron skipped route=${route.name} reason=not_due`);
        return;
      }
      if (!isEnabled(route, env)) {
        console.log(`cron skipped route=${route.name} reason=disabled`);
        return;
      }
      try {
        await callRoute(route, env);
      } catch {
        // A failed endpoint must not prevent the remaining scheduled routes from running.
      }
    });
    ctx.waitUntil(Promise.allSettled(tasks));
  },

  async fetch(request, env) {
    const secret = env.CRON_SECRET;
    const authorization = request.headers.get("authorization") ?? "";
    if (!secret || !(await constantTimeEqual(authorization, "Bearer " + secret))) {
      return new Response(null, { status: 401 });
    }

    const name = new URL(request.url).searchParams.get("route");
    const route = ROUTES.find((candidate) => candidate.name === name);
    if (!route) return Response.json({ error: "unknown_route" }, { status: 404 });
    if (!isEnabled(route, env)) return Response.json({ error: "route_disabled" }, { status: 409 });

    try {
      const result = await callRoute(route, env);
      return Response.json(result);
    } catch {
      return Response.json({ route: route.name, status: 0, ms: 0 }, { status: 502 });
    }
  },
};

export { ROUTES, isDue, isEnabled };
export default worker;

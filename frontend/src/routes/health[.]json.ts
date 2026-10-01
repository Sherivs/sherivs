/**
 * LAUNCH_BLOCKER — unauthenticated machine health endpoint.
 *
 * JSON only, no auth (load balancers / uptime probes cannot authenticate),
 * but deliberately leak-free: the payload is the fixed whitelist produced by
 * `buildHealthReport` — status, ts, uptime, memory, version, check results.
 * No env vars, no connection strings, no stack traces, no query handling.
 *
 * `failing` reports 503 so orchestrators can drain the instance; `degraded`
 * stays 200 because the instance is still serving.
 */
import { createFileRoute } from "@tanstack/react-router";
import type {} from "@tanstack/react-start";
import { buildHealthReport } from "@/lib/observability/health";

/** Version comes from the root package.json; absence degrades to null. */
async function readPackageVersion(): Promise<string | null> {
  try {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const raw = readFileSync(join(process.cwd(), "package.json"), "utf8");
    const pkg = JSON.parse(raw) as { version?: unknown };
    return typeof pkg.version === "string" && pkg.version.length > 0 ? pkg.version : null;
  } catch {
    return null;
  }
}

export const Route = createFileRoute("/health.json")({
  server: {
    handlers: {
      GET: async () => {
        const report = await buildHealthReport({ version: await readPackageVersion() });
        return new Response(JSON.stringify(report), {
          status: report.status === "failing" ? 503 : 200,
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
          },
        });
      },
    },
  },
});
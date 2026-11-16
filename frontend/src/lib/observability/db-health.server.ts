/**
 * Database dependency check for the health endpoint (mission M0).
 *
 * One tiny read through the server client, with a time limit, cached for a short while so an
 * unauthenticated caller cannot turn /health.json into a stream of database queries. The result
 * is a fixed vocabulary: it never carries a connection string, a row, or the database's own words.
 */
import { SystemClock, TimeAuthority } from "@/lib/kernel/time-authority";
import type { DependencyCheckResult, NamedDependencyCheck } from "./health";

export const DB_HEALTH_CHECK_NAME = "database";
export const DB_HEALTH_CACHE_MS = 30_000;
export const DB_HEALTH_TIMEOUT_MS = 2_500;

/** Resolves true when the database answered, false when it answered with an error. */
export type DatabaseProbe = () => Promise<boolean>;

export interface DatabaseHealthOptions {
  readonly probe: DatabaseProbe;
  readonly nowMs: () => number;
  readonly cacheMs?: number;
  readonly timeoutMs?: number;
}

export function createDatabaseHealthCheck(options: DatabaseHealthOptions): NamedDependencyCheck {
  const cacheMs = options.cacheMs ?? DB_HEALTH_CACHE_MS;
  const timeoutMs = options.timeoutMs ?? DB_HEALTH_TIMEOUT_MS;
  let cached: { atMs: number; result: DependencyCheckResult } | null = null;
  let inFlight: Promise<DependencyCheckResult> | null = null;

  const run = async (): Promise<DependencyCheckResult> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const outcome = await Promise.race([
        options.probe().then((ok) => (ok ? "ok" : "error")),
        new Promise<"timeout">((resolve) => {
          timer = setTimeout(() => resolve("timeout"), timeoutMs);
        }),
      ]);
      if (outcome === "ok") return { name: DB_HEALTH_CHECK_NAME, status: "ok" };
      return {
        name: DB_HEALTH_CHECK_NAME,
        status: "failing",
        detail: outcome === "timeout" ? "no answer in time" : "query failed",
      };
    } catch {
      return { name: DB_HEALTH_CHECK_NAME, status: "failing", detail: "not reachable" };
    } finally {
      if (timer) clearTimeout(timer);
    }
  };

  return {
    name: DB_HEALTH_CHECK_NAME,
    check: async () => {
      const now = options.nowMs();
      if (cached && now - cached.atMs < cacheMs) return cached.result;
      inFlight ??= run().then((result) => {
        cached = { atMs: options.nowMs(), result };
        inFlight = null;
        return result;
      });
      return inFlight;
    },
  };
}

const clock = new TimeAuthority(new SystemClock());
let productionCheck: NamedDependencyCheck | null = null;

/** The check the route uses: a head-only count on a one-row platform table. */
export function databaseHealthCheck(): NamedDependencyCheck {
  productionCheck ??= createDatabaseHealthCheck({
    nowMs: () => clock.now().atMs,
    probe: async () => {
      const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
      const { error } = await supabaseAdmin
        .from("platform_service_identities" as never)
        .select("code", { head: true, count: "exact" })
        .limit(1);
      return !error;
    },
  });
  return productionCheck;
}

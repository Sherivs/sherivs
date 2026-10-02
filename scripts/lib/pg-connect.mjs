/**
 * CoreGrid — shared Postgres connection resolution for client scripts.
 *
 * Companion to scripts/lib/pg-ssl.mjs (which owns the TLS policy; this module
 * owns the transport). Supabase direct endpoints (db.<ref>.supabase.co) are
 * IPv6-only; IPv4-only execution environments must use the shared session
 * pooler (Supabase docs: "Session pooler … aws-<n>-<region>.pooler.supabase.com",
 * user `postgres.<ref>`). This helper:
 *
 *   1. tries the DATABASE_URL host as given, then
 *   2. on a NETWORK-level failure only (IPv6 unreachable), retries through the
 *      session pooler with the SAME credentials and the SAME strict TLS policy.
 *
 * TLS is never weakened: every connection derives its `ssl` option from
 * `pgSslConfig`, so verification is strict against COREGRID_DB_CA_CERT (the
 * Supabase project CA, published by Supabase at
 * supabase/cli `apps/cli-go/internal/gen/types/templates/prod-ca-2021.crt` —
 * fingerprint-verified against the live chain) or Node's default store.
 * Disabling verification (COREGRID_DB_INSECURE_TLS=1) remains the explicitly
 * logged last resort and is never chosen here automatically.
 *
 * The transport switch is logged (Constitution §29). Credential values are
 * never logged.
 */
import net from "node:net";
import { pgSslConfig } from "./pg-ssl.mjs";

const POOLER_REGION_ENV = "COREGRID_DB_POOLER_REGION";
const DEFAULT_POOLER_REGION = "eu-west-1";
/** Supavisor clusters are indexed per rollout wave; the tenant exists on exactly one. */
const POOLER_CLUSTER_INDICES = ["aws-1", "aws-0", "aws-2", "aws-3"];

/** Resolve the A/AAAA records for a host; returns [] when unresolvable. */
async function resolveAddresses(host) {
  const { promises: dns } = await import("node:dns");
  const results = await Promise.allSettled([dns.lookup(host, { all: true, verbatim: true })]);
  return results[0].status === "fulfilled" ? results[0].value : [];
}

/** Probe whether ANY address for the host is reachable at the TCP layer. */
export async function hostReachable(host, port) {
  const addresses = await resolveAddresses(host);
  for (const { address, family } of addresses) {
    const reachable = await new Promise((resolve) => {
      const socket = net.connect({ host: address, port, family, timeout: 4000 });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("timeout", () => {
        socket.destroy();
        resolve(false);
      });
      socket.once("error", () => resolve(false));
    });
    if (reachable) return true;
  }
  return addresses.length > 0 ? false : false;
}

/**
 * Build the session-pooler form of a Supabase direct DATABASE_URL.
 * Returns candidate URLs for each Supavisor cluster index — the tenant
 * exists on exactly one; candidates are tried in order.
 */
export function poolerUrlsFor(connectionString, region = process.env[POOLER_REGION_ENV] ?? DEFAULT_POOLER_REGION) {
  let url;
  try {
    url = new URL(connectionString);
  } catch {
    return [];
  }
  const direct = /^db\.([a-z0-9]+)\.supabase\.co$/.exec(url.hostname);
  if (!direct) return [];
  const ref = direct[1];
  return POOLER_CLUSTER_INDICES.map((index) => {
    const candidate = new URL(connectionString);
    candidate.hostname = `${index}-${region}.pooler.supabase.com`;
    if (candidate.username === "postgres") candidate.username = `postgres.${ref}`;
    return candidate.toString();
  });
}

/**
 * Connect a pg client with strict TLS, falling back to the session pooler when
 * the direct host is unreachable at the network layer (IPv6-only endpoint).
 * The caller owns closing the client.
 */
export async function connectCoregridPostgres(connectionString, pgModule, log = console.error) {
  const ssl = pgSslConfig(connectionString);
  if (!ssl) throw new Error("DATABASE_URL explicitly disables TLS — refusing (pg-ssl.mjs policy)");

  const url = new URL(connectionString);
  const directHost = url.hostname;
  const port = Number(url.port || 5432);

  if (await hostReachable(directHost, port)) {
    const client = new pgModule.default.Client({ connectionString, ssl });
    await client.connect();
    log(`pg transport: direct host=${directHost} tls=strict`);
    return client;
  }

  let client = null;
  let lastError = null;
  for (const candidate of poolerUrlsFor(connectionString)) {
    const candidateHost = new URL(candidate).hostname;
    const viaSsl = pgSslConfig(candidate);
    if (!viaSsl) throw new Error("pooler URL explicitly disables TLS — refusing (pg-ssl.mjs policy)");
    try {
      client = new pgModule.default.Client({ connectionString: candidate, ssl: viaSsl });
      await client.connect();
      log(`pg transport: direct host=${directHost} unreachable (IPv6-only endpoint) — session pooler host=${candidateHost} tls=strict`);
      return client;
    } catch (err) {
      lastError = err;
      try { await client?.end(); } catch { /* already closed */ }
      client = null;
    }
  }
  throw new Error(`all pooler candidates failed: ${lastError instanceof Error ? lastError.message : String(lastError)}`);
}

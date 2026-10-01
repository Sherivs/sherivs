/**
 * CoreGrid — shared TLS policy for PostgreSQL client scripts (MISSION-V1-016).
 *
 * Default posture (secure): TLS is always negotiated, and the server
 * certificate must verify against Node's default CA store. Endpoint
 * certificates signed by a private CA (e.g. a managed Postgres deployment's
 * own authority) must be trusted out of band via `NODE_EXTRA_CA_CERTS` —
 * never by disabling verification.
 *
 * Escape hatch: setting COREGRID_DB_INSECURE_TLS=1 opts out of certificate
 * verification (rejectUnauthorized: false) for environments whose endpoint
 * cannot present a verifiable chain. This weakens transport security and must
 * never be enabled against production. The variable is read at connection
 * time and its activation is logged so insecure runs remain observable
 * (Constitution §29).
 *
 * Known failure mode (observed 2026-10-01 against the CoreGrid dev project):
 * Supabase Postgres endpoints present a certificate chain rooted in a
 * Supabase private CA, so Node's default CA store rejects it with
 * SELF_SIGNED_CERT_IN_CHAIN. The secure remediation is to download the
 * project's CA (Dashboard → Database → Settings → SSL Configuration) and
 * start Node with NODE_EXTRA_CA_CERTS=/abs/path/prod-ca-2021.crt; the escape
 * hatch above is the explicitly-logged insecure fallback of last resort.
 * Note also that Supabase direct connections (db.<ref>.supabase.co) are
 * IPv6-only; IPv4-only hosts must use the shared pooler (session mode).
 *
 * An explicit `sslmode=disable` (or ssl=false/ssl=0) in the connection string
 * is honoured: the caller then gets no TLS at all, by explicit choice of the
 * operator, and this helper stays out of the way.
 *
 * CA provisioning: set COREGRID_DB_CA_CERT to the managed CA's PEM text (or a
 * path to the .crt file). The certificate is passed as the client's `ca`, so
 * verification is strict against the managed authority without relying on
 * NODE_EXTRA_CA_CERTS process-wide wiring.
 *
 * Owners: SENTINEL (scripts/ work package). All Postgres client scripts in
 * scripts/ must derive their `ssl` option from this helper.
 */

import { readFileSync } from "node:fs";

const INSECURE_ENV = "COREGRID_DB_INSECURE_TLS";
const INSECURE_TLS_WARNING = "WARNING: PostgreSQL TLS certificate verification is disabled";
const CA_ENV = "COREGRID_DB_CA_CERT";

/**
 * Resolve the managed-Postgres CA for strict verification.
 *
 * Accepts either the PEM text itself (recommended when the CA is provisioned
 * as a Cloud Agent runtime secret) or a filesystem path to the certificate.
 * Returns undefined when unset — Node's default CA store applies.
 */
function resolveCa(env = process.env) {
  const value = (env[CA_ENV] ?? "").trim();
  if (!value) return undefined;
  if (value.startsWith("-----BEGIN")) return value;
  return readFileSync(value, "utf8");
}

/**
 * Resolve the node-postgres `ssl` option for a connection string.
 *
 * @param {string} connectionString DATABASE_URL-style connection string.
 * @returns {{ rejectUnauthorized: boolean } | undefined} The `ssl` value to
 *   pass to `new pg.Client(...)`, or `undefined` when TLS is explicitly
 *   disabled in the connection string itself.
 */
export function pgSslConfig(connectionString = process.env.DATABASE_URL ?? "") {
  if (
    /(?:[?&])sslmode=disable(?:[&'"]|$)/.test(connectionString) ||
    /(?:[?&])ssl=(?:false|0)(?:[&'"]|$)/.test(connectionString)
  ) {
    return undefined;
  }
  if (process.env[INSECURE_ENV] === "1") {
    console.error(`${INSECURE_TLS_WARNING} (${INSECURE_ENV}=1 — never use in production).`);
    return { rejectUnauthorized: false };
  }
  const ca = resolveCa();
  return ca ? { rejectUnauthorized: true, ca } : { rejectUnauthorized: true };
}

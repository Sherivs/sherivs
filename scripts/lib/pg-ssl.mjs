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
 * Owners: SENTINEL (scripts/ work package). All Postgres client scripts in
 * scripts/ must derive their `ssl` option from this helper.
 */

const INSECURE_ENV = "COREGRID_DB_INSECURE_TLS";
const INSECURE_TLS_WARNING = "WARNING: PostgreSQL TLS certificate verification is disabled";

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
  return { rejectUnauthorized: true };
}

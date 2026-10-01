/**
 * Type declarations for scripts/lib/pg-ssl.mjs so TypeScript consumers
 * (unit tests, typed scripts) see the real contract instead of implicit any.
 */
export function pgSslConfig(
  connectionString?: string,
): { rejectUnauthorized: boolean; ca?: string } | undefined;

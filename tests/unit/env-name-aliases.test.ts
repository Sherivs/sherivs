/**
 * Rename phase 2: SHERIVS_* environment names are read first; the former
 * COREGRID_* names are still honoured as a fallback.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { pgSslConfig } from "../../scripts/lib/pg-ssl.mjs";
import { parseMobileEnv } from "../../mobile/src/api/contracts/env";

const NEW_PEM = "-----BEGIN CERTIFICATE-----\nNEW\n-----END CERTIFICATE-----";
const OLD_PEM = "-----BEGIN CERTIFICATE-----\nOLD\n-----END CERTIFICATE-----";
const NAMES = ["SHERIVS_DB_CA_CERT", "COREGRID_DB_CA_CERT", "SHERIVS_DB_INSECURE_TLS", "COREGRID_DB_INSECURE_TLS"];

beforeEach(() => NAMES.forEach((n) => delete process.env[n]));
afterEach(() => NAMES.forEach((n) => delete process.env[n]));

describe("database TLS env names", () => {
  it("reads SHERIVS_DB_CA_CERT", () => {
    process.env.SHERIVS_DB_CA_CERT = NEW_PEM;
    expect(pgSslConfig("postgresql://u:p@h:5432/db")?.ca).toBe(NEW_PEM);
  });
  it("falls back to the former COREGRID_DB_CA_CERT", () => {
    process.env.COREGRID_DB_CA_CERT = OLD_PEM;
    expect(pgSslConfig("postgresql://u:p@h:5432/db")?.ca).toBe(OLD_PEM);
  });
  it("prefers the new name when both are set", () => {
    process.env.SHERIVS_DB_CA_CERT = NEW_PEM;
    process.env.COREGRID_DB_CA_CERT = OLD_PEM;
    expect(pgSslConfig("postgresql://u:p@h:5432/db")?.ca).toBe(NEW_PEM);
  });
  it("honours either name for the insecure escape hatch", () => {
    process.env.SHERIVS_DB_INSECURE_TLS = "1";
    expect(pgSslConfig("postgresql://u:p@h:5432/db")).toEqual({ rejectUnauthorized: false });
    delete process.env.SHERIVS_DB_INSECURE_TLS;
    process.env.COREGRID_DB_INSECURE_TLS = "1";
    expect(pgSslConfig("postgresql://u:p@h:5432/db")).toEqual({ rejectUnauthorized: false });
  });
});

describe("mobile web base URL env name", () => {
  const base = {
    EXPO_PUBLIC_APP_ENV: "development",
    EXPO_PUBLIC_SUPABASE_URL: "https://probe.supabase.co",
    EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_abc123",
  };
  it("reads EXPO_PUBLIC_SHERIVS_WEB_BASE_URL first", () => {
    const env = parseMobileEnv({
      ...base,
      EXPO_PUBLIC_SHERIVS_WEB_BASE_URL: "https://new.example",
      EXPO_PUBLIC_COREGRID_WEB_BASE_URL: "https://old.example",
    });
    expect(env.sherivsWebBaseUrl).toBe("https://new.example");
  });
  it("falls back to EXPO_PUBLIC_COREGRID_WEB_BASE_URL", () => {
    const env = parseMobileEnv({ ...base, EXPO_PUBLIC_COREGRID_WEB_BASE_URL: "https://old.example" });
    expect(env.sherivsWebBaseUrl).toBe("https://old.example");
  });
});

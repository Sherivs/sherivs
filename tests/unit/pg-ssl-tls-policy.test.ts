import { describe, it, expect, afterEach, beforeEach } from "vitest";
import { pgSslConfig } from "../../scripts/lib/pg-ssl.mjs";

const CA_PEM = "-----BEGIN CERTIFICATE-----\nMIITest\n-----END CERTIFICATE-----\n";

beforeEach(() => {
  // Baseline hygiene: some environments legitimately provision COREGRID_DB_CA_CERT
  // for live verification; each test sets the env it asserts on.
  delete process.env.COREGRID_DB_CA_CERT;
  delete process.env.COREGRID_DB_INSECURE_TLS;
});

afterEach(() => {
  delete process.env.COREGRID_DB_CA_CERT;
  delete process.env.COREGRID_DB_INSECURE_TLS;
});

describe("pgSslConfig TLS posture", () => {
  it("verifies certificates by default", () => {
    const config = pgSslConfig("postgresql://u:p@h:5432/db");
    expect(config).toEqual({ rejectUnauthorized: true });
  });

  it("honours explicit sslmode=disable in the connection string", () => {
    expect(
      pgSslConfig("postgresql://u:p@h:5432/db?sslmode=disable"),
    ).toBeUndefined();
  });

  it("fails open only through the logged insecure escape hatch", () => {
    process.env.COREGRID_DB_INSECURE_TLS = "1";
    expect(pgSslConfig("postgresql://u:p@h:5432/db")).toEqual({
      rejectUnauthorized: false,
    });
  });

  it("pins the managed CA when provided as PEM text", () => {
    process.env.COREGRID_DB_CA_CERT = CA_PEM;
    const config = pgSslConfig("postgresql://u:p@h:5432/db");
    expect(config?.rejectUnauthorized).toBe(true);
    expect(config?.ca).toBe(CA_PEM.trim());
  });

  it("pins the managed CA when provided as a certificate file path", () => {
    process.env.COREGRID_DB_CA_CERT = new URL(
      "./fixtures/pg-ca-fixture.crt",
      import.meta.url,
    ).pathname;
    const config = pgSslConfig("postgresql://u:p@h:5432/db");
    expect(config?.rejectUnauthorized).toBe(true);
    expect(config?.ca).toContain("-----BEGIN CERTIFICATE-----");
  });

  it("stays strict when the CA variable is empty", () => {
    process.env.COREGRID_DB_CA_CERT = "";
    expect(pgSslConfig("postgresql://u:p@h:5432/db")).toEqual({
      rejectUnauthorized: true,
    });
  });
});

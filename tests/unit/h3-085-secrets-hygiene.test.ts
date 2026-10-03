/**
 * CoreGrid — H3 wave, team H3-085 (Secrets-Hygiene Engineer), mission H-085.
 * Offline tests for scripts/verify-secrets-hygiene.mjs: detection coverage,
 * allowlist semantics, redaction law, and CLI exit-code contracts.
 *
 * Every fixture below is a clearly synthetic, self-describing fake (the
 * scanner's own allowlist exempts tests/** fixture zones for exactly this
 * reason). No database, no network, no real credential material — and no
 * full secret value is ever asserted into output that leaves the test.
 */
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

interface SecretsHygieneFinding {
  readonly file: string;
  readonly line: number;
  readonly patternClass: string;
  readonly redacted: string;
}

interface SecretsHygieneModule {
  readonly PATTERN_CLASSES: readonly { readonly name: string }[];
  classifyValue(value: string): string | null;
  redact(value: string): string;
  isAllowlistedPath(relPath: string): boolean;
  scanContent(content: string, relPath: string): SecretsHygieneFinding[];
  scanTree(rootDir: string): SecretsHygieneFinding[];
}

// @ts-expect-error — plain-JS verification script imported into the TS unit suite (read-only module import; same pattern as tests/unit/h3-088-posture-validation.test.ts). A `declare module` ambient declaration cannot name a relative specifier (TS1042), so the repo convention is an error-suppressed namespace import plus a typed local interface.
import * as secretsHygieneMjs from "../../scripts/verify-secrets-hygiene.mjs";

const {
  PATTERN_CLASSES,
  classifyValue,
  isAllowlistedPath,
  redact,
  scanContent,
  scanTree,
} = secretsHygieneMjs as unknown as SecretsHygieneModule;

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const SCRIPT = join(ROOT, "scripts", "verify-secrets-hygiene.mjs");

// -- synthetic fixtures (self-describing fakes; never real credentials) ------
const FAKE_PROVIDER_KEY = "sk-SYNTHETICFAKE000000000000000000000000";
const FAKE_AWS_KEY = "AKIAIOSFODNN7SYNTHETICFAKE";
const FAKE_JWT =
  "eyJmYWtlIjoiaGVhZGVyIn0.eyJmYWtlIjoicGF5bG9hZCJ9.ZmFrZV9zaWduYXR1cmVfdmFsdWVfZmFrZQ";
const FAKE_ASSIGNMENT = `const SYNTHETIC_FAKE_TOKEN = "A7fK9mQ2xR5tW8yZ3bN6cP1dJ4hL0sV9eG";`;
const FAKE_JSON_SECRET = `{"client_secret": "Xk9Pq2Rw7Yt3Nb5Vc8Zf1Mj4Hd0Gs6La"}`;
const FAKE_PRIVATE_KEY = "-----BEGIN SYNTHETIC FAKE PRIVATE KEY-----";
const FAKE_CONN_STRING =
  "postgres://svc_user:Qw7xKp9zR2mTv4Ns@db.synthetic.internal:5432/coregrid";
const CLEAN_LINE = `const greeting = "hello coregrid";`;
const PLACEHOLDER_ASSIGNMENT = `const SYNTHETIC_FAKE_TOKEN = "changeme-this-is-a-placeholder-value-000000000";`;

interface RunResult {
  status: number;
  stdout: string;
  stderr: string;
}

function runScript(args: string[]): RunResult {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], { encoding: "utf8" });
  return { status: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

let tmpRoot: string;
let tmpFindings: string;
let tmpClean: string;
const tmpDirs: string[] = [];

beforeAll(() => {
  tmpRoot = mkdtempSync(join(tmpdir(), "h3-085-"));
  tmpDirs.push(tmpRoot);
  tmpFindings = join(tmpRoot, "with-findings");
  tmpClean = join(tmpRoot, "clean");
  mkdirSync(join(tmpFindings, "node_modules", "leaky"), { recursive: true });
  mkdirSync(join(tmpClean, "frontend", "src", "lib", "kernel"), { recursive: true });
  writeFileSync(
    join(tmpFindings, "config.ts"),
    `export const KEY = "${FAKE_PROVIDER_KEY}";\n`,
  );
  // excluded directory: must never contribute findings
  writeFileSync(join(tmpFindings, "node_modules", "leaky", "x.js"), FAKE_AWS_KEY);
  writeFileSync(join(tmpFindings, "package-lock.json"), FAKE_JWT);
  writeFileSync(join(tmpClean, "frontend", "src", "lib", "kernel", "ok.ts"), `${CLEAN_LINE}\n`);
});

afterAll(() => {
  for (const dir of tmpDirs) rmSync(dir, { recursive: true, force: true });
});

describe("H-085 pattern detection (synthetic fixtures)", () => {
  it("detects every provider-key prefix shape", () => {
    expect(classifyValue(FAKE_PROVIDER_KEY)).toBe("PROVIDER_KEY_PREFIX");
    expect(classifyValue(FAKE_AWS_KEY)).toBe("PROVIDER_KEY_PREFIX");
    expect(classifyValue("nvapi-SYNTHETICFAKE0000000000000000")).toBe("PROVIDER_KEY_PREFIX");
  });

  it("does not flag identifiers that merely contain a provider prefix substring", () => {
    // "risk-..." contains the substring "sk-..." — a word boundary is required.
    expect(classifyValue('const id = "risk-approval-escalation-campaign-2026-10";')).toBeNull();
    expect(classifyValue('{"id": "risk-signatures-carry-evidence-confidence"}')).toBeNull();
  });

  it("detects JWT three-segment shapes", () => {
    expect(classifyValue(`Bearer ${FAKE_JWT}`)).toBe("JWT_TOKEN");
  });

  it("detects high-entropy literals in secret-named assignment context", () => {
    expect(classifyValue(FAKE_ASSIGNMENT)).toBe("HIGH_ENTROPY_ASSIGNMENT");
    expect(classifyValue(FAKE_JSON_SECRET)).toBe("HIGH_ENTROPY_ASSIGNMENT");
  });

  it("detects private-key BEGIN blocks", () => {
    expect(classifyValue(FAKE_PRIVATE_KEY)).toBe("PRIVATE_KEY_BLOCK");
  });

  it("detects connection strings with embedded passwords", () => {
    expect(classifyValue(FAKE_CONN_STRING)).toBe("CONNECTION_STRING_PASSWORD");
  });

  it("exempts connection strings whose embedded password is a placeholder", () => {
    expect(classifyValue("postgres://svc_user:pass@db.synthetic.internal:5432/coregrid")).toBeNull();
    expect(classifyValue("postgres://svc_user:<pw>@db.synthetic.internal:5432/coregrid")).toBeNull();
    expect(classifyValue("redis://default:${REDIS_PASSWORD}@cache.synthetic.internal:6379")).toBeNull();
  });

  it("does not flag ordinary code or documentation lines", () => {
    expect(classifyValue(CLEAN_LINE)).toBeNull();
    expect(classifyValue("export const TENANT_SCOPE = \"tenant\";")).toBeNull();
    expect(classifyValue("see docs/runbooks/recovery-drill.md for the drill plan")).toBeNull();
  });

  it("exempts well-known placeholder values in assignment context", () => {
    expect(classifyValue(PLACEHOLDER_ASSIGNMENT)).toBeNull();
  });

  it("requires mixed letters+digits for high-entropy assignment values", () => {
    expect(classifyValue(`const SYNTHETIC_FAKE_TOKEN = "00000000000000000000000000000000000000";`)).toBeNull();
    expect(classifyValue(`const SYNTHETIC_FAKE_TOKEN = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";`)).toBeNull();
  });

  it("declares exactly the five documented pattern classes", () => {
    expect(PATTERN_CLASSES.map((pattern) => pattern.name).sort()).toEqual([
      "CONNECTION_STRING_PASSWORD",
      "HIGH_ENTROPY_ASSIGNMENT",
      "JWT_TOKEN",
      "PRIVATE_KEY_BLOCK",
      "PROVIDER_KEY_PREFIX",
    ]);
  });
});

describe("H-085 allowlist semantics", () => {
  it("allowlists test-fixture zones (tests/**)", () => {
    expect(isAllowlistedPath("tests/unit/h3-085-secrets-hygiene.test.ts")).toBe(true);
    expect(isAllowlistedPath("tests/failure/h3-030-context-bleed.test.ts")).toBe(true);
    expect(isAllowlistedPath("tests/e2e/fixtures.ts")).toBe(true);
  });

  it("allowlists the scanner's own pattern file", () => {
    expect(isAllowlistedPath("scripts/verify-secrets-hygiene.mjs")).toBe(true);
  });

  it("never allowlists production surfaces", () => {
    expect(isAllowlistedPath("frontend/src/lib/security/credential-broker.ts")).toBe(false);
    expect(isAllowlistedPath("database/supabase/migrations/20261003000001_core.sql")).toBe(false);
    expect(isAllowlistedPath("scripts/apply-canonical-hardening.mjs")).toBe(false);
    expect(isAllowlistedPath("docs/runbooks/recovery-drill.md")).toBe(false);
    expect(isAllowlistedPath(".env.example")).toBe(false);
  });

  it("suppresses findings inside allowlisted paths even with secret-shaped content", () => {
    const findings = scanContent(`${FAKE_PROVIDER_KEY}\n`, "tests/unit/fixture.ts");
    expect(findings).toEqual([]);
  });

  it("supports the inline coregrid-secrets-hygiene-allow marker", () => {
    const flagged = scanContent(`${FAKE_ASSIGNMENT}\n`, "src/config.ts");
    expect(flagged).toHaveLength(1);
    const suppressed = scanContent(
      `${FAKE_ASSIGNMENT} // coregrid-secrets-hygiene-allow\n`,
      "src/config.ts",
    );
    expect(suppressed).toEqual([]);
  });
});

describe("H-085 redaction law", () => {
  it("emits file:line + pattern class + short redacted prefix only", () => {
    const findings = scanContent(`${FAKE_PROVIDER_KEY}\n${FAKE_JWT}\n`, "src/config.ts");
    expect(findings).toHaveLength(2);
    expect(findings[0]).toMatchObject({
      file: "src/config.ts",
      line: 1,
      patternClass: "PROVIDER_KEY_PREFIX",
    });
    expect(findings[1]).toMatchObject({ line: 2, patternClass: "JWT_TOKEN" });
    for (const finding of findings) {
      expect(finding.redacted.length).toBeLessThanOrEqual(32);
      expect(finding.redacted.endsWith(`]`)).toBe(true);
      expect(finding.redacted).toContain("[REDACTED");
    }
  });

  it("never emits more than a 4-character value prefix", () => {
    const value = FAKE_PROVIDER_KEY;
    const out = redact(value);
    expect(out.startsWith(value.slice(0, 4))).toBe(true);
    expect(out.includes(value.slice(4))).toBe(false);
    expect(out).toContain(`len=${value.length}`);
  });

  it("redacted output is scan-safe by construction (re-scan yields no findings)", () => {
    const first = scanContent(`${FAKE_ASSIGNMENT}\n`, "src/config.ts");
    expect(first).toHaveLength(1);
    const reportLine = `src/config.ts:1 HIGH_ENTROPY_ASSIGNMENT ${first[0].redacted}`;
    expect(scanContent(`${reportLine}\n`, "progress/h3-wave/H3-085.report.md")).toEqual([]);
  });
});

describe("H-085 tree scanning", () => {
  it("scans trees, skipping excluded dirs and lockfiles", () => {
    const findings = scanTree(tmpFindings);
    expect(findings).toHaveLength(1);
    expect(findings[0].patternClass).toBe("PROVIDER_KEY_PREFIX");
    expect(findings[0].file.endsWith("config.ts")).toBe(true);
    expect(findings.some((finding) => finding.file.includes("node_modules"))).toBe(false);
    expect(findings.some((finding) => finding.file.includes("package-lock"))).toBe(false);
  });

  it("reports a clean tree as empty", () => {
    expect(scanTree(tmpClean)).toEqual([]);
  });
});

describe("H-085 CLI exit-code contracts", () => {
  it("exits 0 and prints PASS on a clean scan root", () => {
    const run = runScript(["--scan-root", tmpClean]);
    expect(run.status).toBe(0);
    expect(run.stdout).toContain("PASS");
  });

  it("exits 1 on findings and never prints the full matched value", () => {
    const run = runScript(["--scan-root", tmpFindings]);
    expect(run.status).toBe(1);
    expect(run.stdout).toContain("PROVIDER_KEY_PREFIX");
    expect(run.stdout).toContain("[REDACTED");
    expect(run.stdout).not.toContain(FAKE_PROVIDER_KEY);
  });

  it("supports --json with the same redaction law", () => {
    const run = runScript(["--scan-root", tmpFindings, "--json"]);
    expect(run.status).toBe(1);
    const payload = JSON.parse(run.stdout) as { findings: Array<{ redacted: string }> };
    expect(payload.findings).toHaveLength(1);
    expect(JSON.stringify(payload)).not.toContain(FAKE_PROVIDER_KEY);
  });

  it("rejects unknown arguments with BLOCKED_USAGE (exit 2)", () => {
    const run = runScript(["--rehearse"]);
    expect(run.status).toBe(2);
    expect(run.stderr).toContain("BLOCKED_USAGE");
  });

  it("fails closed on a missing --scan-root value and a nonexistent root (exit 2)", () => {
    expect(runScript(["--scan-root"]).status).toBe(2);
    expect(runScript(["--scan-root", join(tmpRoot, "does-not-exist")]).status).toBe(2);
  });
});
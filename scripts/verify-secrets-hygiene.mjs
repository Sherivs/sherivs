#!/usr/bin/env node
/**
 * CoreGrid — H3 wave, team H3-085 (Secrets-Hygiene Engineer), mission H-085.
 *
 * Static scan for committed secret-shaped strings (AGENTS.md §29/§30: never
 * log or commit secrets). Detection classes:
 *
 *   PROVIDER_KEY_PREFIX        known provider key shapes (OpenAI/Stripe/AWS/
 *                              GitHub/Slack/GitLab/Google)
 *   JWT_TOKEN                  three-segment base64url JWT (header.payload.sig)
 *   HIGH_ENTROPY_ASSIGNMENT    long high-entropy literal assigned to a
 *                              secret/token/key/password-like name
 *   PRIVATE_KEY_BLOCK          PEM/OpenSSH/PGP private-key BEGIN marker
 *   CONNECTION_STRING_PASSWORD database/service URL with embedded password
 *
 * Allowlist (always applied):
 *   - test-fixture zones (tests/**): fixtures there are self-describing
 *     synthetic fakes by wave convention (H3-WAVE-CAMPAIGN.md LAW 6);
 *   - the scanner's own pattern file (this script);
 *   - lines carrying the inline marker `coregrid-secrets-hygiene-allow`;
 *   - well-known placeholder values (changeme/placeholder/example/…,
 *     ${...} env interpolation, <...> template slots, all-repetition padding).
 *
 * Hygiene law for THIS tool itself: it never emits a full matched value —
 * output is file:line + pattern class + a SHORT redacted prefix only, and
 * the redaction is scan-safe by construction (a redacted finding line re-
 * scanned produces no findings).
 *
 * Exit codes: 0 PASS (no findings), 1 FAIL (findings), 2 BLOCKED (usage or
 * scan error) — same fail-closed family as the wave's drill exemplars.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const SCRIPT_REL = "scripts/verify-secrets-hygiene.mjs";
const INLINE_ALLOW_MARKER = "coregrid-secrets-hygiene-allow";

// ---------------------------------------------------------------------------
// Pattern classes
// ---------------------------------------------------------------------------

/**
 * Synthetic/self-describing placeholder values that must never be reported:
 * docs examples, env-interpolation slots, template slots, and padding runs.
 */
const PLACEHOLDER_TOKEN_RE =
  /(?:changeme|change[-_]?me|placeholder|example|sample|dummy|fixture|synthetic|redacted|xxxxx|your[-_]?|<[^>]*>|\$\{[^}]*\}|%[A-Z_]+%)/i;

/** Value must mix letters and digits to count as high-entropy material. */
function isHighEntropyLiteral(value) {
  if (value.length < 32) return false;
  if (PLACEHOLDER_TOKEN_RE.test(value)) return false;
  if (/^(.)\1+$/.test(value)) return false; // all-same-char padding
  if (!/[A-Za-z]/.test(value) || !/[0-9]/.test(value)) return false;
  return true;
}

export const PATTERN_CLASSES = [
  {
    name: "PROVIDER_KEY_PREFIX",
    description: "Known provider API-key shapes (OpenAI, Stripe, AWS, GitHub, Slack, GitLab, Google).",
    regex: new RegExp(
      [
        "sk-(?:proj-)?[A-Za-z0-9_-]{20,}", // OpenAI-style
        "(?:sk|rk|pk)_(?:test|live)_[A-Za-z0-9]{16,}", // Stripe-style
        "AKIA[0-9A-Z]{16}", // AWS access key id
        "gh[pousr]_[A-Za-z0-9]{20,}", // GitHub tokens
        "github_pat_[A-Za-z0-9_]{22,}", // GitHub fine-grained PAT
        "xox[baprs]-[A-Za-z0-9-]{10,}", // Slack tokens
        "glpat-[A-Za-z0-9_-]{20,}", // GitLab PAT
        "AIza[0-9A-Za-z_-]{35}", // Google API key
        "nvapi-[A-Za-z0-9_-]{20,}", // NVIDIA (NIM) API key
      ]
        .map((shape) => `\\b(?:${shape})`)
        .join("|"),
      "g",
    ),
  },
  {
    name: "JWT_TOKEN",
    description: "Three-segment base64url JWT shape (header.payload.signature).",
    regex: /\beyJ[A-Za-z0-9_-]{5,}\.eyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{8,}/g,
  },
  {
    name: "HIGH_ENTROPY_ASSIGNMENT",
    description: "Long high-entropy literal assigned to a secret/token/key/password-like name.",
    // code-style assignment: const/let/var SECRET: string = "..."
    regexps: [
      /(?:\b(?:const|let|var)\s+[A-Za-z0-9_$]*(?:SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL|API_?KEY|PRIVATE_?KEY|ACCESS_?KEY)[A-Za-z0-9_$]*\b(?:\s*:\s*[^=\n]+?)?=\s*)(["'`])([^"'`\n]{32,})\1/g,
      // JSON/YAML/obj style: "client_secret": "..."
      /["']?(?:client[_-]?secret|api[_-]?key|access[_-]?key|secret[_-]?key|private[_-]?key|password|passwd|secret|token)["']?\s*[:=]\s*(["'])([^"'\n]{32,})\1/gi,
    ],
    valueFilter: isHighEntropyLiteral,
  },
  {
    name: "PRIVATE_KEY_BLOCK",
    description: "PEM/OpenSSH/PGP private-key BEGIN marker.",
    regex: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY(?: BLOCK)?-----/g,
  },
  {
    name: "CONNECTION_STRING_PASSWORD",
    description: "Database/service connection URL with an embedded password.",
    regex: /((?:postgres(?:ql)?|mysql|maria|mongodb(?:\+srv)?|redis|rediss|amqps?|mssql|jdbc:[a-z0-9]+):\/\/[^\s"'@/:]*:([^\s"'@/]{2,})@)/g,
    captureGroup: 1,
    valueFilter: (wholeMatch) => {
      const at = wholeMatch.lastIndexOf("@");
      const colon = wholeMatch.lastIndexOf(":", at - 1);
      const password = wholeMatch.slice(colon + 1, at);
      return (
        !PLACEHOLDER_TOKEN_RE.test(password) &&
        !/^(?:password|pass|pwd|secret|\*+|x+|\.+)$/.test(password)
      );
    },
  },
];

/** Match class against one raw value; returns pattern name or null. */
export function classifyValue(value) {
  return detectValue(value)?.patternClass ?? null;
}

/**
 * @typedef {Object} Detection
 * @property {string} patternClass
 * @property {string} raw
 */

/** First secret-shaped detection in `value`, with its raw matched material.
 * @param {string} value
 * @returns {Detection | null}
 */
function detectValue(value) {
  for (const pattern of PATTERN_CLASSES) {
    const regexes = pattern.regexps ?? [pattern.regex];
    for (const regex of regexes) {
      regex.lastIndex = 0;
      let match;
      while ((match = regex.exec(value)) !== null) {
        // Secret-bearing group: explicit capture index, else the last
        // meaningful group, else the whole match.
        const raw = pattern.captureGroup
          ? match[pattern.captureGroup]
          : (match[2] ?? match[1] ?? match[0]);
        if (pattern.valueFilter ? pattern.valueFilter(raw) : true) {
          return { patternClass: pattern.name, raw };
        }
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Redaction (never emit a full value)
// ---------------------------------------------------------------------------

/** SHORT redacted prefix: first 4 characters + length, never the rest. */
export function redact(value) {
  const head = value.slice(0, 4);
  return `${head}…[REDACTED len=${value.length}]`;
}

// ---------------------------------------------------------------------------
// Allowlist
// ---------------------------------------------------------------------------

const FIXTURE_ZONE_PREFIXES = ["tests/"];

/**
 * Path-level allowlist: test-fixture zones and the scanner's own pattern
 * file. `relPath` uses POSIX separators relative to the scan root.
 */
export function isAllowlistedPath(relPath) {
  const posix = relPath.split(sep).join("/");
  if (posix === SCRIPT_REL) return true;
  return FIXTURE_ZONE_PREFIXES.some((prefix) => posix.startsWith(prefix));
}

/** Line-level inline suppression marker. */
function isInlineAllowed(line) {
  return line.includes(INLINE_ALLOW_MARKER);
}

// ---------------------------------------------------------------------------
// Scanning
// ---------------------------------------------------------------------------

const TEXT_EXTENSIONS = new Set([
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".json", ".md", ".mdx",
  ".sql", ".yml", ".yaml", ".toml", ".sh", ".bash", ".py", ".rb", ".go",
  ".env", ".txt", ".html", ".css", ".cfg", ".conf", ".ini", ".properties",
]);
const TEXT_FILENAMES = new Set(["Dockerfile", ".env.example", ".gitignore", "Makefile"]);
const EXCLUDED_DIR_NAMES = new Set([
  "node_modules", ".git", "dist", "build", "coverage", ".next", ".turbo",
  "out", "vendor", ".cache", "__pycache__", ".playwright", "test-results",
]);
const EXCLUDED_FILENAMES = new Set(["package-lock.json", "pnpm-lock.yaml", "yarn.lock"]);
const MAX_SCAN_BYTES = 2 * 1024 * 1024;

/**
 * @typedef {Object} Finding
 * @property {string} file
 * @property {number} line
 * @property {string} patternClass
 * @property {string} redacted
 */

function shouldSkipFile(name) {
  return EXCLUDED_FILENAMES.has(name);
}

function isTextCandidate(name) {
  if (TEXT_FILENAMES.has(name)) return true;
  const dot = name.lastIndexOf(".");
  if (dot <= 0) return false;
  return TEXT_EXTENSIONS.has(name.slice(dot).toLowerCase());
}

/** Scan one file's content. `relPath` decides the path allowlist. */
export function scanContent(content, relPath) {
  const findings = [];
  if (isAllowlistedPath(relPath)) return findings;
  const lines = content.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (isInlineAllowed(line)) continue;
    const detection = detectValue(line);
    if (detection === null) continue;
    findings.push({
      file: relPath,
      line: i + 1,
      patternClass: detection.patternClass,
      redacted: redact(detection.raw),
    });
  }
  return findings;
}

function walk(dir, rootDir, out) {
  const entries = readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const abs = join(dir, entry.name);
    const rel = relative(rootDir, abs);
    if (entry.isDirectory()) {
      if (EXCLUDED_DIR_NAMES.has(entry.name)) continue;
      walk(abs, rootDir, out);
      continue;
    }
    if (entry.isFile() && isTextCandidate(entry.name) && !shouldSkipFile(entry.name)) {
      out.push({ abs, rel });
    }
  }
}

export function collectScanFiles(rootDir) {
  const files = [];
  walk(rootDir, rootDir, files);
  return files;
}

/** Scan a directory tree; returns findings with POSIX-relative paths. */
export function scanTree(rootDir) {
  const findings = [];
  for (const { abs, rel } of collectScanFiles(rootDir)) {
    let stat;
    try {
      stat = statSync(abs);
    } catch {
      continue;
    }
    if (!stat.isFile() || stat.size > MAX_SCAN_BYTES) continue;
    let content;
    try {
      content = readFileSync(abs, "utf8");
    } catch {
      continue; // unreadable (binary-ish) — skip silently
    }
    findings.push(...scanContent(content, rel));
  }
  return findings;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function usage() {
  return (
    "usage: node scripts/verify-secrets-hygiene.mjs [--scan-root <dir>] [--json]\n" +
    "exit 0 = clean, 1 = findings, 2 = blocked (usage/scan error)\n" +
    "output never contains a full matched value (file:line + class + short redacted prefix)"
  );
}

function main(argv) {
  let scanRoot = ROOT;
  let json = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--json") {
      json = true;
    } else if (arg === "--scan-root") {
      const next = argv[i + 1];
      if (!next) {
        process.stderr.write(`${usage()}\n`);
        return 2;
      }
      scanRoot = next;
      i += 1;
    } else {
      process.stderr.write(`BLOCKED_USAGE: unknown argument ${arg}\n${usage()}\n`);
      return 2;
    }
  }
  if (!existsSync(scanRoot) || !statSync(scanRoot).isDirectory()) {
    process.stderr.write(`BLOCKED_SCAN_ROOT: not a directory: ${scanRoot}\n`);
    return 2;
  }

  let findings;
  try {
    findings = scanTree(scanRoot);
  } catch (error) {
    process.stderr.write(`BLOCKED_SCAN: ${(error && error.message) || "scan failed"}\n`);
    return 2;
  }

  if (json) {
    process.stdout.write(`${JSON.stringify({ findings }, null, 2)}\n`);
  } else {
    if (findings.length === 0) {
      process.stdout.write("PASS: no secret-shaped strings found (allowlists applied).\n");
    } else {
      process.stdout.write(`FAIL: ${findings.length} secret-shaped finding(s):\n`);
      for (const finding of findings) {
        process.stdout.write(
          `${finding.file}:${finding.line} ${finding.patternClass} ${finding.redacted}\n`,
        );
      }
    }
  }
  return findings.length === 0 ? 0 : 1;
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  process.exitCode = main(process.argv.slice(2));
}
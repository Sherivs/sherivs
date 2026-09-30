#!/usr/bin/env node
/**
 * CoreGrid — Foundation secrets scanner (Phase 01, §34/§81).
 *
 * Scans git-tracked files for high-risk secret material and fails the build if
 * any is found. Intentionally conservative: it reports evidence for human
 * review rather than attempting to "clean" matches.
 *
 * Excluded: tracked docs/markdown (documentation may legitimately describe
 * variable names), `.env.example` templates, lockfiles, test fixtures, and
 * binary files. Secret *values* committed under any other tracked path fail.
 *
 * Usage: node scripts/verification/secret-scan.mjs
 * Exit codes: 0 = clean; 1 = matches found.
 */
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const tracked = execFileSync("git", ["ls-files"], { encoding: "utf8" })
  .split("\n")
  .map((s) => s.trim())
  .filter(Boolean)
  .filter((f) => !/\.(md|example|example\.env|map|png|jpe?g|gif|webp|woff2?|ico)$/i.test(f))
  .filter((f) => !f.includes("package-lock.json"))
  .filter((f) => !/^tests\//.test(f));

const PATTERNS = [
  { name: "private-key-block", re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/ },
  { name: "stripe-live-key", re: /sk_live_[0-9A-Za-z]{16,}/ },
  { name: "supabase-secret-key", re: /sb_secret_[0-9A-Za-z_-]{20,}/ },
  { name: "supabase-project-url", re: /https:\/\/[a-z0-9]{16,}\.supabase\.co/ },
  { name: "supabase-publishable-key", re: /sb_publishable_[0-9A-Za-z_-]{20,}/ },
  { name: "aws-access-key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "google-api-key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "github-pat", re: /\bghp_[0-9A-Za-z]{30,}\b/ },
  { name: "github-fine-grained-pat", re: /\bgithub_pat_[0-9A-Za-z_]{30,}\b/ },
  { name: "slack-token", re: /\bxox[baprs]-[0-9A-Za-z-]{20,}\b/ },
  {
    name: "secret-assignment",
    re: /(SERVICE_ROLE_KEY|SECRET_KEY|VAPID_PRIVATE_KEY|PAYSTACK_SECRET_KEY|TWILIO_API_KEY|NVIDIA_API_KEY|AI_API_KEY|AWS_SECRET_ACCESS_KEY)\s*[:=]\s*["']?([^"'\s]{12,})/,
  },
];

const findings = [];
for (const file of tracked) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue; // deleted or unreadable between listing and read
  }
  if (text.includes("\u0000")) continue; // binary
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    for (const p of PATTERNS) {
      const m = line.match(p.re);
      if (m) {
        // Ignore obvious placeholders and environment-var references.
        const value = (m[2] ?? m[0] ?? "").toLowerCase();
        if (
          /^(your_|xxx|example|placeholder|<.*>|changeme|dummy|process\.env|import\.meta\.env|env\.)/.test(
            value,
          )
        )
          continue;
        findings.push({ file, line: i + 1, pattern: p.name, match: m[0].slice(0, 40) });
      }
    }
  }
}

if (findings.length > 0) {
  console.error(
    `SECRET SCAN FAILED — ${findings.length} potential secret(s) found in tracked files:`,
  );
  for (const f of findings.slice(0, 25)) {
    console.error(`  ${f.file}:${f.line}  [${f.pattern}]  ${f.match}`);
  }
  process.exit(1);
}
console.log("SECRET SCAN PASSED — no high-risk secret patterns in tracked files.");

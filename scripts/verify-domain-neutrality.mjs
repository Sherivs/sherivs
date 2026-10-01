#!/usr/bin/env node
/**
 * MISSION-R-05 (J-037 / V1CAP-067) — continuous domain-neutrality guard.
 *
 * Extends the P33 kernel-purity machinery (tests/unit/kernel-purity.test.ts,
 * which already owns frontend/src/lib/kernel/reality.ts, domain-manifest.ts,
 * outbox.ts, runtime-registry.ts and the universal-kernel substrate SQL) to
 * the REST of the universal surface:
 *
 *   (a) frontend/src/lib/*.ts          — universal lib ROOT files only
 *                                        (kernel/ and runtime/ subdirs are
 *                                        owned by the kernel-purity test and
 *                                        the runtime boundary, respectively)
 *   (b) frontend/src/lib/kernel/phase-contracts/  — the kernel-purity test
 *                                        does NOT scan this directory
 *   (c) database/supabase/migrations/  — every migration file
 *
 * Token vocabulary is derived from STREAM I (STREAM_I_CONTAMINATION_AUDIT.json):
 * education/scholar domain words, Scholar-specific role names, the
 * pre-CoreGrid product name, the legacy Scholar authorization helpers, and a
 * STRUCTURAL check for schoolId-typed universal helpers
 * (STREAM H domainContaminationInCode entry 2: audit.ts AuditParams.schoolId).
 *
 * Baseline semantics (fail-on-new-violation, warn-on-baseline):
 *   - every CURRENT violation is recorded in
 *     architecture/coregrid-mvp-architecture/NEUTRALITY_GUARD_BASELINE.json;
 *   - the guard WARNS on baseline entries and prints them on EVERY run —
 *     a baseline entry is never silently passed;
 *   - the guard FAILS (exit 1) on any observed (file, kind, token) violation
 *     that is NOT in the baseline;
 *   - SHRINK-ONLY RATCHET: baseline entries may be REMOVED as relocations
 *     land (ADR-003/004 coordination); entries may NEVER be added. A file
 *     that introduces domain vocabulary must relocate the code into the
 *     owning runtime namespace, not extend the baseline.
 *
 * Exit codes: 0 PASS (clean or baseline-only), 1 FAIL (new violation,
 * unreadable baseline, or scan error).
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const BASELINE_PATH = join(
  ROOT,
  "architecture/coregrid-mvp-architecture/NEUTRALITY_GUARD_BASELINE.json",
);

// ---------------------------------------------------------------------------
// Scan surfaces
// ---------------------------------------------------------------------------
const LIB_ROOT = join(ROOT, "frontend/src/lib");
const PHASE_CONTRACTS = join(LIB_ROOT, "kernel/phase-contracts");
const MIGRATIONS = join(ROOT, "database/supabase/migrations");

// ---------------------------------------------------------------------------
// Token vocabulary (STREAM I + tests/unit/kernel-purity.test.ts DOMAIN_TERMS)
// ---------------------------------------------------------------------------
// STRICT tokens: flagged on any word-boundary, case-insensitive occurrence.
const STRICT_TOKENS = [
  "scholar",
  "student",
  "teacher",
  "school",
  "classroom",
  "curriculum",
  "exam",
  "examination",
  "grade",
  "grading",
  "attendance",
  "fee",
  "fees",
  "tuition",
  "timetable",
  "admission",
  "lesson",
  "homework",
  "library",
  "hostel",
  "bursar",
  "principal",
  "guardian",
  "enrollment",
  "enrolment",
  "academic",
  "discipline",
  "payroll",
  "textbook",
  "vibeora",
  "get_my_school_id",
  "is_school_admin",
];

// LITERAL tokens: domain role names that also carry neutral technical
// meanings ("parent" of a node, a JDBC "driver", a "bus" — STREAM I classifies
// the ROLE usage as domain). Flagged only when they appear as a quoted string
// literal (a role enum value) or in a file/directory NAME.
const LITERAL_TOKENS = ["parent", "staff", "driver", "bus"];

// STRUCTURAL check: schoolId-typed universal helpers — any schoolId/school_id
// occurrence on any scanned surface is reported under its own kind so the
// STREAM H audit.ts finding (AuditParams.schoolId) stays individually
// addressable and the class stays separately visible in the baseline.
const STRUCTURAL_TOKENS = ["schoolId", "school_id"];

// Filename check: domain vocabulary in a scanned file's own name (catches
// teachers.functions.ts, school-settings.functions.ts, driver-portal.*,
// *_harden_schools_*.sql, ... without content matching).
const FILENAME_TOKENS = [
  ...STRICT_TOKENS.filter((t) => !["schoolId", "school_id", "vibeora"].includes(t)),
  ...LITERAL_TOKENS,
  "facilities",
];

function tokenRegex(token) {
  return new RegExp(`\\b${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
}

function literalRegex(token) {
  return new RegExp(`['"\`]${token}['"\`]`, "i");
}

// ---------------------------------------------------------------------------
// Scan implementation (multiline-aware: the whole file is scanned line by
// line, report is file:line:token)
// ---------------------------------------------------------------------------
function* walkFiles(dir) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (entry === "node_modules") continue;
      yield* walkFiles(full);
    } else {
      yield full;
    }
  }
}

function scanContent(content, fileName) {
  const hits = [];
  const lines = content.split(/\r?\n/);
  lines.forEach((line, idx) => {
    const lineNo = idx + 1;
    for (const token of STRICT_TOKENS) {
      if (tokenRegex(token).test(line)) {
        hits.push({ file: fileName, kind: "vocabulary", token, line: lineNo, snippet: line.trim().slice(0, 160) });
      }
    }
    for (const token of LITERAL_TOKENS) {
      if (literalRegex(token).test(line)) {
        hits.push({ file: fileName, kind: "vocabulary-literal", token, line: lineNo, snippet: line.trim().slice(0, 160) });
      }
    }
    for (const token of STRUCTURAL_TOKENS) {
      if (tokenRegex(token).test(line)) {
        hits.push({ file: fileName, kind: "structural", token, line: lineNo, snippet: line.trim().slice(0, 160) });
      }
    }
  });
  return hits;
}

function scanFilename(fileName) {
  const base = fileName.split("/").pop();
  const hits = [];
  for (const token of FILENAME_TOKENS) {
    if (tokenRegex(token).test(base)) {
      hits.push({ file: fileName, kind: "filename", token, line: 0, snippet: base });
    }
  }
  return hits;
}

function collectScan() {
  const hits = [];
  for (const full of walkFiles(LIB_ROOT)) {
    const rel = relative(ROOT, full).split(sep).join("/");
    // Root level only — kernel/ is owned by the kernel-purity test, runtime/
    // and other subdirectories are domain namespaces by construction.
    if (!/^frontend\/src\/lib\/[^/]+\.ts$/.test(rel)) continue;
    hits.push(...scanFilename(rel), ...scanContent(readFileSync(full, "utf8"), rel));
  }
  for (const full of walkFiles(PHASE_CONTRACTS)) {
    const rel = relative(ROOT, full).split(sep).join("/");
    if (!rel.endsWith(".ts")) continue;
    hits.push(...scanFilename(rel), ...scanContent(readFileSync(full, "utf8"), rel));
  }
  for (const full of walkFiles(MIGRATIONS)) {
    const rel = relative(ROOT, full).split(sep).join("/");
    if (!rel.endsWith(".sql")) continue;
    hits.push(...scanFilename(rel), ...scanContent(readFileSync(full, "utf8"), rel));
  }
  return hits;
}

// ---------------------------------------------------------------------------
// Baseline
// ---------------------------------------------------------------------------
const key = (h) => `${h.kind}|${h.file}|${h.token}`;

function loadBaseline() {
  if (!existsSync(BASELINE_PATH)) {
    console.error(`FATAL baseline missing: ${relative(ROOT, BASELINE_PATH).split(sep).join("/")}`);
    console.error("The neutrality guard refuses to run without an explicit quarantine baseline.");
    process.exit(1);
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(BASELINE_PATH, "utf8"));
  } catch (err) {
    console.error(`FATAL baseline unreadable: ${err.message}`);
    process.exit(1);
  }
  if (!Array.isArray(parsed.baselineEntries)) {
    console.error("FATAL baseline malformed: missing baselineEntries[]");
    process.exit(1);
  }
  return parsed;
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------
console.log("verify-domain-neutrality (MISSION-R-05 / J-037 / V1CAP-067)");
console.log("surfaces: frontend/src/lib/*.ts (root) + frontend/src/lib/kernel/phase-contracts/ + database/supabase/migrations/");
console.log(`baseline: ${relative(ROOT, BASELINE_PATH).split(sep).join("/")}`);

const baseline = loadBaseline();
const baselineKeys = new Set(baseline.baselineEntries.map(key));
const observed = collectScan();

const NEW = observed.filter((h) => !baselineKeys.has(key(h)));
const quarantined = observed.filter((h) => baselineKeys.has(key(h)));
const observedKeys = new Set(observed.map(key));
const stale = baseline.baselineEntries.filter((e) => !observedKeys.has(`${e.kind}|${e.file}|${e.token}`));

console.log("--- scan result ---");
console.log(`observed violation hits: ${observed.length} across ${observedKeys.size} (file,kind,token) groups`);
console.log(`quarantined (in baseline): ${quarantined.length} hits / ${baseline.baselineEntries.length} baseline groups`);
console.log(`NEW violations: ${NEW.length}`);

if (quarantined.length > 0) {
  console.log("--- baseline quarantine (WARN — printed every run, never silently passed) ---");
  const byGroup = new Map();
  for (const h of quarantined) {
    const k = key(h);
    if (!byGroup.has(k)) byGroup.set(k, []);
    byGroup.get(k).push(h);
  }
  for (const h of quarantined) {
    const streamIRef = baseline.baselineEntries.find((e) => key(e) === key(h))?.streamIRef ?? "-";
    console.log(`WARN  ${h.file}:${h.line}:${h.token} [${h.kind}] (baseline, STREAM I: ${streamIRef})`);
  }
}

if (stale.length > 0) {
  console.log("--- ratchet opportunities (baseline entries no longer observed) ---");
  for (const e of stale) {
    console.log(`RATCHET  remove baseline entry ${e.kind}|${e.file}|${e.token} — no longer observed (shrink-only ratchet)`);
  }
  console.log(
    "NOTE stale baseline entries do not fail the run; remove them in the same change that cleared them (shrink-only, ADR-003/004).",
  );
}

if (NEW.length > 0) {
  console.log("--- NEW VIOLATIONS (FAIL — not in baseline, baseline is shrink-only) ---");
  for (const h of NEW) {
    console.log(`FAIL  ${h.file}:${h.line}:${h.token} [${h.kind}] :: ${h.snippet}`);
  }
  console.error(
    `STATUS=FAIL — ${NEW.length} new domain-neutrality violation hit(s). ` +
      "Domain code belongs in the owning runtime namespace, not the universal surface. " +
      "The baseline cannot be extended (shrink-only ratchet); relocate the code.",
  );
  process.exit(1);
}

console.log("STATUS=PASS — no new domain-neutrality violations beyond the honest quarantine baseline.");
process.exit(0);

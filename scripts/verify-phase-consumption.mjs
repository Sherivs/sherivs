#!/usr/bin/env node
/**
 * CoreGrid — Scholar phase-consumption audit (Phases 01–51).
 *
 * For every phase: does runtime-001 (Scholar) consume it? Is it already built?
 * Outputs: CONSUMED/BUILT, CONSUMED/GAP (next to build, domain-neutral in the
 * kernel — Scholar is only a consumer), or NOT-CONSUMED (skip).
 *
 * Evidence = authored domain-neutral modules (frontend/src/lib/*) + unit
 * suites (tests/unit/*) matched by the phase keyword table below. This is a
 * living governance artifact; extend the keyword table when a phase grows.
 */
import { readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const LIB = join(ROOT, "frontend", "src", "lib");
const TESTS = join(ROOT, "tests", "unit");

const libFiles = existsSync(LIB) ? readdirSync(LIB) : [];
const testFiles = existsSync(TESTS) ? readdirSync(TESTS) : [];

/** Scholar R-001 consumption set (kernel graph + runtime phases + foundations). */
const SCHOLAR_CONSUMED = new Set([
  "01",
  "02",
  "03",
  "04",
  "05",
  "06",
  "08",
  "09",
  "10",
  "11",
  "12",
  "13",
  "14",
  "15",
  "16",
  "17",
  "18",
  "19",
  "20",
  "22",
  "23",
  "24",
  "25",
  "26",
  "30",
  "33",
]);

/** Phase -> module/test keyword evidence (domain-neutral artifacts). */
const EVIDENCE = {
  "01": ["foundation", "phase-catalog"],
  "02": ["identity", "roles"],
  "03": ["tenant"],
  "04": ["scholar", "education", "runtime/scholar"],
  "05": ["runtime-core", "runtime-events", "outbox"],
  "06": ["workspace"],
  "07": ["agent-"],
  "08": ["security", "authorization"],
  "09": ["trust", "security-risk"],
  10: ["communication", "messages", "push"],
  11: ["academic-", "education-assessment"],
  12: ["scheduling", "timetable"],
  13: ["financial", "paystack", "payments", "fees"],
  14: ["data-", "data-catalog"],
  15: ["hardware", "bus-tracking", "facility"],
  16: ["twin", "digital"],
  17: ["automation", "workflow"],
  18: ["analytics"],
  19: ["command"],
  20: ["government"],
  21: ["cloud"],
  22: ["platform-", "device", "offline"],
  23: ["web-"],
  24: ["experience"],
  25: ["onboarding", "workforce", "invitations"],
  26: ["ai-", "ai-gateway", "ai-governance"],
  27: ["marketplace"],
  28: ["dev-"],
  29: ["integration"],
  30: ["global", "localization"],
  31: ["enterprise"],
  32: ["evolution"],
  33: ["kernel", "cg_"],
  34: [],
  35: [],
  36: [],
  37: [],
  38: [],
  39: [],
  40: [],
  41: [],
  42: [],
  43: [],
  44: [],
  45: [],
  46: [],
  47: [],
  48: [],
  49: [],
  50: [],
  51: [],
};

function matches(files, pattern) {
  return files.some((file) => file.toLowerCase().includes(pattern.toLowerCase()));
}

let builtCount = 0;
let gapCount = 0;
const gaps = [];
const rows = [];

for (let i = 1; i <= 51; i += 1) {
  const id = String(i).padStart(2, "0");
  const consumed = SCHOLAR_CONSUMED.has(id);
  const keywords = EVIDENCE[id] ?? [];
  const built = keywords.some((keyword) => {
    if (keyword.endsWith("/")) {
      return matches(libFiles, keyword);
    }
    return matches(libFiles, keyword) || matches(testFiles, keyword);
  });

  if (consumed) {
    if (built) {
      builtCount += 1;
      rows.push(`CONSUMED/BUILT     phase ${id}`);
    } else {
      gapCount += 1;
      gaps.push(id);
      rows.push(`CONSUMED/GAP       phase ${id}  <- next build (kernel, domain-neutral)`);
    }
  } else {
    rows.push(`NOT-CONSUMED       phase ${id}`);
  }
}

console.log(rows.join("\n"));
console.log("---");
console.log(`consumed-and-built: ${builtCount} | consumed-gaps: ${gapCount}`);
if (gaps.length > 0) console.log(`next to build: phases ${gaps.join(", ")}`);
process.exit(gapCount > 0 ? 1 : 0);

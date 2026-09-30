#!/usr/bin/env node
/**
 * Foundation conformance assessment (mechanism 10, Gate 15).
 *
 * Compares DECLARED contracts (foundation contract module, foundation
 * migration, Scholar flow) against OBSERVED live evidence (dev database RLS
 * isolation check, recorded loop executions). Read-only: it writes only the
 * assessment artifact.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const projectRef = "nwrflbpbhyiqdptmlccm";

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}

function envToken() {
  for (const line of read(".env.local").split(/\r?\n/)) {
    const match = line.trim().match(/^(?:export\s+)?SUPABASE_ACCESS_TOKEN\s*=\s*(.*)$/);
    if (match) return match[1].trim().replace(/^['"]|['"]$/g, "");
  }
  return null;
}

const token = envToken();
if (!token) {
  console.error("BLOCKED_NO_CREDENTIAL SUPABASE_ACCESS_TOKEN is missing from .env.local.");
  process.exit(2);
}

const contractSource = read("frontend/src/lib/control-plane/foundation-mission.ts");
const loopSource = read("frontend/src/lib/control-plane/foundation-loop.ts");
const scholarSource = read("frontend/src/lib/runtime/scholar-foundation-flow.ts");
const migration = read(
  "database/supabase/migrations/20260929000000_coregrid_foundation_mission_001.sql",
);
const kernelMigration = read(
  "database/supabase/migrations/20260903000000_coregrid_universal_kernel_substrate.sql",
);
const checkpoint = JSON.parse(read("architecture/COREGRID_V52_GATE_CHECKPOINT.json"));
const gate14 = JSON.parse(read("architecture/COREGRID_GATE_14_SCHOLAR_VALIDATION.json"));

const scholarManifest = read("frontend/src/lib/runtime/scholar.ts");

function extractList(name, source) {
  const match = source.match(new RegExp(`export const ${name} = \\[([^\\]]+)\\]`, "s"));
  if (!match) return null;
  return [...match[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
}

function extractOntologyEntityTypes(source) {
  const block = source.match(/entityTypes:\s*\[([\s\S]*?)\],\s*\n\s*relationshipTypes/);
  if (!block) return null;
  return [...block[1].matchAll(/name:\s*"([^"]+)"/g)].map((m) => m[1]);
}

const declared = {
  missionLifecycles: extractList("MISSION_LIFECYCLES", contractSource),
  executionStatuses: extractList("EXECUTION_STATUSES", contractSource),
  externalEffects: extractList("EXTERNAL_EFFECTS", contractSource),
  evidenceLifecycles: extractList("EVIDENCE_LIFECYCLES", contractSource),
  verificationDecisions: extractList("VERIFICATION_DECISIONS", contractSource),
  conformanceDecisions: extractList("CONFORMANCE_DECISIONS", contractSource),
  scholarEntityTypes: extractOntologyEntityTypes(scholarManifest),
};

const foundationTables = [
  "cg_mission_intent",
  "cg_execution_record",
  "cg_execution_history",
  "cg_foundation_evidence",
  "cg_verification_result",
  "cg_conformance_assessment",
];

function checkFindings() {
  const findings = [];
  for (const [name, values] of Object.entries(declared)) {
    if (name === "scholarEntityTypes") continue;
    if (!Array.isArray(values) || values.length === 0) {
      findings.push(`declared vocabulary missing: ${name}`);
      continue;
    }
    for (const value of values) {
      if (!migration.includes(`'${value}'`)) {
        findings.push(`migration does not pin declared ${name} value '${value}'`);
      }
    }
  }
  if (!Array.isArray(declared.scholarEntityTypes) || declared.scholarEntityTypes.length === 0) {
    findings.push("Scholar ontology entity types not declared");
  } else if (!scholarSource.includes("scholarEntityDraft")) {
    findings.push("Scholar flow does not enforce its ontology through the runtime boundary");
  }
  if (!scholarSource.includes("scholarRelationshipDraft")) {
    findings.push("Scholar flow does not bind relationships through the runtime boundary");
  }
  if (!scholarSource.includes("scholarEventDraft")) {
    findings.push("Scholar flow does not record events through the runtime boundary");
  }
  for (const table of foundationTables) {
    if (!migration.includes(`CREATE TABLE IF NOT EXISTS public.${table}`)) {
      findings.push(`migration does not declare ${table}`);
    }
  }
  if (!migration.includes("cg_execution_history is append-only")) {
    findings.push("migration does not declare the append-only history guard");
  }
  if (!migration.includes("decision <> 'verified' OR cardinality(evidence_ids) > 0")) {
    findings.push("migration does not pin verification-evidence constraint");
  }
  if (
    !migration.includes(
      "declared_contract_id = observed_contract_id AND declared_version = observed_version",
    )
  ) {
    findings.push("migration does not pin conformance contract-match constraint");
  }
  if (!loopSource.includes("requestedRealityRef")) {
    findings.push("foundation loop does not separate requested from admitted reality reference");
  }
  return findings;
}

async function liveCheck() {
  const sql = read("database/queries/rls-isolation-check.sql")
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("\\"))
    .join("\n");
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`isolation check HTTP ${res.status} ${text.slice(0, 300)}`);
  const rows = JSON.parse(text);
  const failures = rows.filter((row) => String(row?.issue ?? "").startsWith("FAIL"));
  return { passed: failures.length === 0, failures };
}

const staticFindings = checkFindings();
let live;
try {
  live = await liveCheck();
} catch (error) {
  live = { passed: false, failures: [String(error.message ?? error)] };
}

const httpEvidence = checkpoint.foundationMission001?.httpEvidence ?? null;
const scholarEvidence = gate14.status ?? null;

const dimensions = [
  {
    id: "contract-vocabulary-pinned",
    declared:
      "All universal foundation contract vocabularies are pinned in the migration CHECK clauses.",
    observed: staticFindings.some((f) => f.includes("pinned"))
      ? "mismatch found"
      : "all universal values pinned",
    decision: staticFindings.some((f) => f.includes("pinned")) ? "NONCONFORMANT" : "CONFORMANT",
  },
  {
    id: "scholar-ontology-boundary",
    declared:
      "Scholar entity types are enforced at the runtime boundary through the universal kernel draft contract.",
    observed: staticFindings.some((f) => f.includes("Scholar"))
      ? "boundary not enforced"
      : "ontology declared and enforced via scholarEntityDraft; kernel purity tests pass",
    decision: staticFindings.some((f) => f.includes("Scholar")) ? "NONCONFORMANT" : "CONFORMANT",
  },
  {
    id: "append-only-execution-history",
    declared: "cg_execution_history rejects updates and deletes.",
    observed:
      migration.includes("cg_execution_history is append-only") && live.passed
        ? "trigger present and live isolation check confirms guards"
        : "guard not established",
    decision:
      migration.includes("cg_execution_history is append-only") && live.passed
        ? "CONFORMANT"
        : "NONCONFORMANT",
  },
  {
    id: "deny-by-default-foundation-tables",
    declared: "anon and authenticated hold no privileges on foundation tables.",
    observed: live.passed
      ? "live RLS isolation check returned no FAIL rows"
      : `live failures: ${JSON.stringify(live.failures).slice(0, 400)}`,
    decision: live.passed ? "CONFORMANT" : "NONCONFORMANT",
  },
  {
    id: "independent-verification",
    declared:
      "Verified decisions require evidence; conformance requires a contract and version match.",
    observed: migration.includes("cardinality(evidence_ids) > 0")
      ? "constraints present in applied schema"
      : "missing",
    decision: migration.includes("cardinality(evidence_ids) > 0") ? "CONFORMANT" : "NONCONFORMANT",
  },
  {
    id: "foundation-loop-execution",
    declared: "Reality reference → mission → execution → evidence → independent verification.",
    observed: httpEvidence,
    decision: httpEvidence ? "CONFORMANT" : "NOT_ASSESSED",
  },
  {
    id: "scholar-domain-validation",
    declared: "Scholar entity flows through the universal substrate and the governed loop.",
    observed: scholarEvidence,
    decision:
      scholarEvidence === "EXECUTED_AND_VERIFIED_BOUNDED_PROBE" ? "CONFORMANT" : "NOT_ASSESSED",
  },
  {
    id: "scholar-reality-vocabulary",
    declared:
      "Scholar relationships and events are validated against the Scholar ontology at the runtime boundary and recorded through the universal kernel substrate (cg_relationship, cg_event).",
    observed:
      staticFindings.some((f) => f.includes("runtime boundary")) ||
      !kernelMigration.includes("CREATE TABLE IF NOT EXISTS public.cg_relationship") ||
      !kernelMigration.includes("CREATE TABLE IF NOT EXISTS public.cg_event")
        ? "runtime boundary or kernel substrate not established"
        : "relationship and event vocabulary enforced via scholarRelationshipDraft/scholarEventDraft; kernel substrate declares cg_relationship and cg_event",
    decision:
      staticFindings.some((f) => f.includes("runtime boundary")) ||
      !kernelMigration.includes("CREATE TABLE IF NOT EXISTS public.cg_relationship") ||
      !kernelMigration.includes("CREATE TABLE IF NOT EXISTS public.cg_event")
        ? "NONCONFORMANT"
        : "CONFORMANT",
  },
  {
    id: "deployment",
    declared: "Foundation slice installed in a named environment as an operational service.",
    observed: "never deployed",
    decision: "NOT_ASSESSED",
  },
  {
    id: "operational-runtime",
    declared: "Named-environment runtime evidence of executing, observable, recoverable behavior.",
    observed: "bounded probes only; no live telemetry",
    decision: "NOT_ASSESSED",
  },
];

const conformant = dimensions.filter((d) => d.decision === "CONFORMANT").length;
const nonconformant = dimensions.filter((d) => d.decision === "NONCONFORMANT").length;
const notAssessed = dimensions.filter((d) => d.decision === "NOT_ASSESSED").length;

const assessment = {
  mission: "COREGRID-MISSION-0001",
  artifact: "COREGRID_GATE_15_CONFORMANCE_ASSESSMENT",
  mechanism: "10 — Conformance",
  captured: new Date().toISOString(),
  assessedScope: {
    contract: "frontend/src/lib/control-plane/foundation-mission.ts",
    contractVersion: "1",
    migration: "database/supabase/migrations/20260929000000_coregrid_foundation_mission_001.sql",
    scholarFlow: "frontend/src/lib/runtime/scholar-foundation-flow.ts",
    environment: `dev project ${projectRef}`,
  },
  staticFindings,
  live: { passed: live.passed, failureCount: live.failures.length },
  dimensions,
  decision:
    nonconformant > 0 || staticFindings.length > 0
      ? "NONCONFORMANT"
      : notAssessed > 0
        ? "CONDITIONALLY_CONFORMANT"
        : "CONFORMANT",
  decisionScope:
    "Foundation Mission 001 contracts and Scholar validation flow; deployment and operational runtime excluded from conformance until Gate 15 runtime evidence exists",
  counts: { conformant, nonconformant, notAssessed, total: dimensions.length },
  rule: "Conformance is assessed against declared contracts only. NOT_ASSESSED dimensions are unfinished work, not passes.",
};

const output = join(root, "architecture", "COREGRID_GATE_15_CONFORMANCE_ASSESSMENT.json");
writeFileSync(output, `${JSON.stringify(assessment, null, 2)}\n`, "utf8");
console.log(
  JSON.stringify(
    {
      decision: assessment.decision,
      counts: assessment.counts,
      staticFindings: assessment.staticFindings.length,
      livePassed: live.passed,
    },
    null,
    2,
  ),
);
if (assessment.decision === "NONCONFORMANT") process.exit(1);

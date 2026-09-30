import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(fileURLToPath(new URL(".", import.meta.url)), "..");
const architectureRoot = join(root, "architecture");
const outputPath = join(root, "architecture", "COREGRID_REPOSITORY_INVENTORY.json");
const blueprintOutputPath = join(root, "architecture", "COREGRID_BLUEPRINT_CATALOG.json");

function walk(directory, output = []) {
  if (!existsSync(directory)) return output;
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if ([".git", "node_modules", "test-results"].includes(entry.name)) continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walk(path, output);
    else output.push(relative(root, path).split(sep).join("/"));
  }
  return output;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

const files = walk(root).sort();
const registryPath = join(architectureRoot, "registry.json");
const registry = existsSync(registryPath) ? readJson(registryPath) : null;
const phaseById = new Map((registry?.phases ?? []).map((phase) => [phase.id, phase]));

const topLevel = new Map();
for (const path of files) {
  const segment = path.split("/")[0];
  topLevel.set(segment, (topLevel.get(segment) ?? 0) + 1);
}

const phasePattern = /^phase-(\d{2})-(.+)\.md$/;
const blueprints = files
  .filter((path) => path.startsWith("architecture/") && path.endsWith(".md"))
  .map((path) => {
    const filename = path.split("/").at(-1);
    const phaseMatch = filename.match(phasePattern);
    const phase = phaseMatch ? phaseById.get(phaseMatch[1]) : undefined;
    let kind = "architecture";
    if (filename.includes("acceptance")) kind = "verification";
    else if (filename.includes("proof")) kind = "verification";
    else if (filename.includes("reconciliation")) kind = "reconciliation";
    else if (filename.includes("audit") || path.includes("/archaeology/")) kind = "audit";
    else if (filename.includes("map") || filename.includes("graph")) kind = "architecture-map";
    else if (filename.includes("blueprint")) kind = "blueprint";
    else if (phase) kind = "phase-blueprint";

    return {
      artifactId: path.replaceAll("/", ":"),
      sourceLocation: path,
      kind,
      canonicalPhase: phase?.id ?? null,
      claimedOwner: phase?.name ?? null,
      status: phase?.status ?? "UNSCOPED",
      implementationReferences: phase?.modules ?? [],
      consumers: phase?.consumers ?? [],
      scopeLock: phase ? "PHASE_REGISTRY_CONTRACT_REQUIRED" : "REVIEW_REQUIRED",
    };
  });

const inventory = {
  mission: "COREGRID-MISSION-0001",
  artifact: "COREGRID_REPOSITORY_INVENTORY",
  status: "OBSERVED",
  capturedAt: new Date().toISOString(),
  exclusions: [".git", "node_modules", "test-results"],
  repository: {
    fileCount: files.length,
    topLevelCounts: Object.fromEntries([...topLevel.entries()].sort()),
    lockfiles: files.filter((path) =>
      /(^|\/)(package-lock\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb)$/.test(path),
    ),
    environmentTemplates: files.filter((path) => path.endsWith(".env.example")),
    workflows: files.filter((path) => path.startsWith(".github/workflows/")),
    migrations: files.filter((path) => path.startsWith("database/") && path.endsWith(".sql")),
    sourceTypeScript: files.filter(
      (path) => /\.(ts|tsx)$/.test(path) && path.startsWith("frontend/"),
    ),
    tests: files.filter((path) => path.startsWith("tests/")),
    phaseDocuments: files.filter((path) => phasePattern.test(path.split("/").at(-1) ?? "")),
    phaseContracts: files.filter((path) => path.includes("kernel/phase-contracts/")),
  },
  classifications: {
    canonical: [
      "CONSTITUTION.md",
      "REGISTRY.md",
      "DEPENDENCY.md",
      "BOUNDARIES.md",
      "DECISIONS.md",
      "PROGRESS.md",
    ],
    conceptualMotherSurfaces: [
      "COREGRID.md",
      "GOVERNANCE.md",
      "ARCHITECTURE.md",
      "REALITY.md",
      "ENGINEERING.md",
      "WORKFORCE.md",
      "MISSIONS.md",
      "BLUEPRINTS.md",
      "PROGRESS.md",
      "ECOSYSTEM.md",
      "IMPLEMENTATION.md",
      "RUNTIME.md",
      "ASSURANCE.md",
    ],
    specialized: ["AGENTS.md", "README.md", "docs/", ".github/"],
    implementation: ["frontend/", "database/", "scripts/", "tests/"],
    infrastructure: ["infrastructure/"],
    compatibilityOrPlaceholder: ["api/", "backend/", "mobile/", "agents/"],
    engineeringTooling: [".claude/", ".claude-flow/", ".swarm/", ".codex/"],
    quarantineReview: ["test-results/", "scratch outputs"],
  },
  registry: {
    phaseCount: registry?.phaseCount ?? null,
    capabilityCount: registry?.capabilities?.length ?? null,
    runtimeCount: registry?.runtimes?.length ?? null,
    phase52Registered: phaseById.has("52"),
  },
  evidenceBoundary: {
    phase52Implementation: "UNVERIFIED",
    deployment: "UNVERIFIED",
    operational: "UNVERIFIED",
    acceptanceDefinitionsPresent: files.filter(
      (path) => path.startsWith("architecture/phase-acceptance/") && path.endsWith(".json"),
    ).length,
  },
  nextGate: "Reconcile authority aliases and ownership before implementation expansion.",
};

const blueprintCatalog = {
  mission: "COREGRID-MISSION-0001",
  artifact: "COREGRID_BLUEPRINT_CATALOG",
  status: "OBSERVED_WITH_UNRESOLVED_OWNERSHIP",
  capturedAt: inventory.capturedAt,
  classificationVocabulary: [
    "strategic",
    "architecture",
    "domain",
    "capability",
    "system",
    "runtime",
    "data",
    "reality-causal",
    "security",
    "interface",
    "infrastructure",
    "integration",
    "migration",
    "evolution",
    "research",
    "experimental",
    "operational",
    "policy",
    "composite",
  ],
  blueprints,
  unresolvedOwnership: ["D1", "D2", "D3", "D4", "D5", "D7"],
  phase52: {
    registered: false,
    implementationAuthorized: false,
    source: "architecture/phase-52-cross domain and engineering sections",
  },
  nextGate: "Semantic review and ownership reconciliation before scope locking.",
};

writeFileSync(outputPath, `${JSON.stringify(inventory, null, 2)}\n`, "utf8");
writeFileSync(blueprintOutputPath, `${JSON.stringify(blueprintCatalog, null, 2)}\n`, "utf8");

console.log(
  JSON.stringify(
    {
      repositoryFiles: inventory.repository.fileCount,
      phaseDocuments: inventory.repository.phaseDocuments.length,
      phaseContracts: inventory.repository.phaseContracts.length,
      blueprints: blueprintCatalog.blueprints.length,
      phase52Registered: blueprintCatalog.phase52.registered,
      outputs: [
        "architecture/COREGRID_REPOSITORY_INVENTORY.json",
        "architecture/COREGRID_BLUEPRINT_CATALOG.json",
      ],
    },
    null,
    2,
  ),
);

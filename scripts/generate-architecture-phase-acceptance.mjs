import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const architectureDir = join(root, "architecture");
const acceptanceDir = join(architectureDir, "phase-acceptance");
const registry = JSON.parse(readFileSync(join(architectureDir, "registry.json"), "utf8"));

function findPhaseDocument(id) {
  const name = readdirSync(architectureDir).find(
    (entry) => entry.startsWith(`phase-${id}-`) && entry.endsWith(".md"),
  );
  return name ? `architecture/${name}` : null;
}

function findPhaseContract(id) {
  const contractDir = join(root, "frontend", "src", "lib", "kernel", "phase-contracts");
  const name = readdirSync(contractDir).find(
    (entry) => entry.startsWith(`phase-${id}-`) && entry.endsWith(".ts"),
  );
  return name ? `frontend/src/lib/kernel/phase-contracts/${name}` : null;
}

const generated = [];
for (const phase of registry.phases) {
  if (Number(phase.id) < 31) continue;
  const existing = readdirSync(acceptanceDir).some(
    (entry) => entry.startsWith(`phase-${phase.id}-`) && entry.endsWith(".json"),
  );
  if (existing) continue;

  const source = findPhaseDocument(phase.id);
  const contract = findPhaseContract(phase.id);
  if (!source || !contract) {
    throw new Error(`Cannot build acceptance definition for phase ${phase.id}`);
  }

  const slug = source
    .slice(`architecture/phase-${phase.id}-`.length, -".md".length)
    .replaceAll(" ", "-");
  const output = join(acceptanceDir, `phase-${phase.id}-${slug}.json`);
  const definition = {
    $comment:
      "Architecture-phase acceptance definition. It records design and contract evidence without claiming implementation, runtime, deployment, or operational completion.",
    phase: phase.id,
    phaseName: phase.name,
    source,
    contract,
    ownership: {
      canonicalOwners: {
        [`phase-${phase.id}-capability`]: phase.id,
      },
      note: "Registry ownership is observed. Cross-phase duplication and runtime ownership remain subject to Mission 0001 reconciliation.",
    },
    areas: [
      {
        id: "architecture-and-contract-defined",
        area: "Architecture and phase contract are defined",
        requirement:
          "The phase has a canonical blueprint and machine-readable phase contract; this proves definition only.",
        required: true,
        evidence: [
          { kind: "document", path: source, contains: phase.name },
          { kind: "contract", path: contract, contains: "phaseId" },
        ],
      },
      {
        id: "implementation-runtime-and-operations",
        area: "Implementation, runtime, deployment and operations remain unverified",
        requirement:
          "Executable modules, runtime consumers, deployment evidence and operational proof must be established by a later bounded mission; this definition does not infer them from design text.",
        required: false,
        evidence: [{ kind: "document", path: source, contains: "Implementation" }],
      },
    ],
  };
  writeFileSync(output, `${JSON.stringify(definition, null, 2)}\n`, "utf8");
  generated.push(output.replace(`${root}\\`, "").replaceAll("\\", "/"));
}

console.log(
  JSON.stringify(
    {
      generated: generated.length,
      files: generated,
      note: "Design evidence is not implementation or operational evidence.",
    },
    null,
    2,
  ),
);

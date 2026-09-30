#!/usr/bin/env node
/**
 * Lands Campaign-52 WP-02 mapped principles onto receiving surfaces.
 * Append-only. Skips a file that already carries the marker.
 * Does not change registry phase capacity or authorize implementation.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const marker = "<!-- campaign-52-wp02-receiving-record -->";
const source = "architecture/COREGRID_CAMPAIGN_52_WP_02_RECEIVING_RECONCILIATION.json";

const sections = {
  "COREGRID.md": ["CG-P52-GAP-016", "CG-P52-GAP-020"],
  "ARCHITECTURE.md": [
    "CG-P52-GAP-012",
    "CG-P52-GAP-016",
    "CG-P52-GAP-020",
    "CG-P52-GAP-025",
    "CG-P52-GAP-026",
    "CG-P52-GAP-027",
  ],
  "REALITY.md": ["CG-P52-GAP-009", "CG-P52-GAP-022"],
  "ENGINEERING.md": ["CG-P52-GAP-007", "CG-P52-GAP-014", "CG-P52-GAP-023"],
  "MISSIONS.md": [
    "CG-P52-GAP-007",
    "CG-P52-GAP-014",
    "CG-P52-GAP-022",
    "CG-P52-GAP-023",
    "CG-P52-GAP-024",
  ],
  "BLUEPRINTS.md": ["CG-P52-GAP-015"],
  "ECOSYSTEM.md": [
    "CG-P52-GAP-015",
    "CG-P52-GAP-016",
    "CG-P52-GAP-017",
    "CG-P52-GAP-018",
    "CG-P52-GAP-020",
  ],
  "IMPLEMENTATION.md": ["CG-P52-GAP-012"],
  "RUNTIME.md": ["CG-P52-GAP-012", "CG-P52-GAP-015"],
  "ASSURANCE.md": ["CG-P52-GAP-022"],
  "REGISTRY.md": ["CG-P52-GAP-025", "CG-P52-GAP-026", "CG-P52-GAP-027"],
  "CONTROL-PLANE-05-CONTEXT-ASSEMBLY.md": ["CG-P52-GAP-010"],
  "architecture/phase-05-core-application-runtime.md": ["CG-P52-GAP-012"],
  "architecture/phase-14-data-platform.md": ["CG-P52-GAP-011"],
  "architecture/phase-22-mobile-platform.md": ["CG-P52-GAP-013"],
  "architecture/phase-23-web-platform.md": ["CG-P52-GAP-013"],
  "architecture/phase-24-coregrid-experience-design-intelligence.md": ["CG-P52-GAP-021"],
  "architecture/phase-27-marketplace.md": ["CG-P52-GAP-018"],
  "architecture/phase-28-developer-platform.md": ["CG-P52-GAP-018"],
  "architecture/phase-50-human-civilization-interface-layer.md": ["CG-P52-GAP-021"],
};

const notes = {
  "CG-P52-GAP-007":
    "The universal application shell comes before additional domain runtimes. Named home surfaces are product intent. The global shell extract remains blocked.",
  "CG-P52-GAP-009":
    "One identity may participate in many realities. CoreGrid switches active context and does not replace identity.",
  "CG-P52-GAP-010":
    "An organization switch verifies membership, role, authority, domain, and organization reality before experience loads. A client organization id is not access.",
  "CG-P52-GAP-011":
    "Personal reality and organizational reality stay separated. Cross-context access requires identity, membership, permission, purpose, policy, and consent where applicable.",
  "CG-P52-GAP-012":
    "Clients share contracts. The proposed directory tree is source design and does not authorize a repository migration.",
  "CG-P52-GAP-013":
    "Web and mobile share domain contracts, identity, authorization, ontology, and experience definitions. Native capabilities stay local.",
  "CG-P52-GAP-014":
    "Engines follow a locked sequence and are not the first build. Extract stages do not override Mission 0001 gates.",
  "CG-P52-GAP-015":
    "A domain runtime is a package of ontology, workflow, policy, experience, and extension points. Scholar remains the existing domain runtime.",
  "CG-P52-GAP-016":
    "Unknown domains are discovered and validated before they become packages. Discovery is not canonical domain truth.",
  "CG-P52-GAP-017":
    "The SDK economy is a governed flywheel. It does not authorize billing, publication, or the blocked developer-platform gaps.",
  "CG-P52-GAP-018":
    "Users, organizations, and developers meet on one platform. This does not authorize live installation or resolve the blocked developer marketplace.",
  "CG-P52-GAP-020":
    "Durability is compound substrate, not feature count. This does not register new capabilities or claim they are operational.",
  "CG-P52-GAP-021":
    "Experience is a composition of invariants, reality, role, authority, state, and objectives. The formula is not an executable compiler.",
  "CG-P52-GAP-022":
    "The reality loop is cross-cutting law. Each edge still needs its own contract and evidence.",
  "CG-P52-GAP-023":
    "Implementation proceeds in locked blocks. The extract sequence is subordinate to Mission 0001.",
  "CG-P52-GAP-024":
    "The first visible product is the universal experience, not a domain vertical. Foundation Mission 001 remains unauthorized.",
  "CG-P52-GAP-025":
    "Heading-only 55-phase binding. Registered phase capacity remains 51. Phase 52 is not registered.",
  "CG-P52-GAP-026": "Duplicate heading-only binding. It adds no phase authority.",
  "CG-P52-GAP-027": "Duplicate heading-only binding. It adds no phase authority.",
};

const reconciliation = JSON.parse(readFileSync(join(root, source), "utf8"));
const known = new Set(reconciliation.records.map((record) => record.gapId));
const landed = [];

for (const [relativePath, gapIds] of Object.entries(sections)) {
  for (const gapId of gapIds) {
    if (!known.has(gapId) || !notes[gapId]) {
      throw new Error(`${relativePath}: unknown mapped gap ${gapId}`);
    }
  }
  const path = join(root, relativePath);
  const current = readFileSync(path, "utf8");
  if (current.includes(marker)) {
    landed.push({ path: relativePath, action: "ALREADY_PRESENT" });
    continue;
  }
  const lines = gapIds.map((gapId) => `- \`${gapId}\`: ${notes[gapId]}`);
  const block = [
    "",
    marker,
    "",
    "## Campaign-52 WP-02 receiving record",
    "",
    "Status: `SCOPE_RECORDED_IMPLEMENTATION_DENIED`",
    `Source: \`${source}\``,
    "",
    "These mapped Phase 52 extracts are received here as provenance. They do not authorize runtime implementation, a new phase, or a registry expansion.",
    "",
    ...lines,
    "",
  ].join("\n");
  writeFileSync(path, `${current.replace(/\s*$/, "\n")}${block}`, "utf8");
  landed.push({ path: relativePath, action: "APPENDED", gaps: gapIds });
}

const result = {
  mission: "COREGRID-MISSION-0001",
  campaign: "CAMPAIGN-52",
  workPackage: "CAMPAIGN-52-WP-02",
  status: "RECEIVING_SURFACES_UPDATED",
  implementationAuthorization: "DENIED",
  registryPhaseCapacity: 51,
  landed,
};
writeFileSync(
  join(root, "architecture", "COREGRID_CAMPAIGN_52_WP_02_SURFACE_LANDING.json"),
  `${JSON.stringify(result, null, 2)}\n`,
  "utf8",
);
console.log(
  JSON.stringify(
    {
      status: result.status,
      appended: landed.filter((item) => item.action === "APPENDED").length,
      alreadyPresent: landed.filter((item) => item.action === "ALREADY_PRESENT").length,
    },
    null,
    2,
  ),
);

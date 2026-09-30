import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const gapPath = join(root, "architecture", "COREGRID_PHASE_52_UNRESOLVED_GAP_REGISTER.json");
const packetPath = join(
  root,
  "architecture",
  "COREGRID_CAMPAIGN_52_WP_01_OWNERSHIP_DECISION_PACKET.md",
);
const outputPath = join(root, "architecture", "COREGRID_CAMPAIGN_52_WP_01_VERIFICATION.json");

const gaps = JSON.parse(readFileSync(gapPath, "utf8"));
const packet = readFileSync(packetPath, "utf8");
const packetIds = [...packet.matchAll(/^### (CG-P52-GAP-\d{3}) —/gm)].map((match) => match[1]);
const gapIds = gaps.gaps.map((gap) => gap.id);
const missingFromPacket = gapIds.filter((id) => !packetIds.includes(id));
const unexpectedInPacket = packetIds.filter((id) => !gapIds.includes(id));
const unresolvedDispositionCount = (packet.match(/- Disposition: `UNRESOLVED`/g) ?? []).length;
const authorizedMarkers = [
  "AUTHORIZED_IMPLEMENTATION",
  "REGISTERED_PHASE",
  "APPROVED_OWNER",
].filter((marker) => packet.includes(marker));

const result = {
  mission: "COREGRID-MISSION-0001",
  artifact: "COREGRID_CAMPAIGN_52_WP_01_VERIFICATION",
  status:
    missingFromPacket.length === 0 &&
    unexpectedInPacket.length === 0 &&
    unresolvedDispositionCount === gapIds.length &&
    authorizedMarkers.length === 0
      ? "PASS_BLOCKED_PENDING_AUTHORITY"
      : "FAIL",
  inputs: {
    gapRegister: "architecture/COREGRID_PHASE_52_UNRESOLVED_GAP_REGISTER.json",
    decisionPacket: "architecture/COREGRID_CAMPAIGN_52_WP_01_OWNERSHIP_DECISION_PACKET.md",
  },
  counts: {
    registeredGaps: gapIds.length,
    packetWorkItems: packetIds.length,
    unresolvedDispositions: unresolvedDispositionCount,
  },
  missingFromPacket,
  unexpectedInPacket,
  unauthorizedMarkers: authorizedMarkers,
  rule: "Packet completeness does not authorize architecture or implementation.",
};

writeFileSync(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
console.log(JSON.stringify(result, null, 2));
if (result.status === "FAIL") process.exit(1);

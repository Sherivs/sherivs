/**
 * The whole Sherivs workforce in one place: pack, charter and workspace per agent.
 * Definitions only; importing this reads no database and holds no secret.
 */
import { JARVIS_EXECUTIVE_PACK } from "../jarvis-executive/executive-pack";
import { COMPLETION_WORKFORCE_PACKS } from "../twin-engine/packs/completion-workforce-packs";
import { EXPANSION_WORKFORCE_PACKS } from "../twin-engine/packs/expansion-workforce-packs";
import { PLATFORM_WORKFORCE_PACKS } from "../twin-engine/packs/platform-workforce-packs";
import type { RolePack } from "../twin-engine/role-pack";
import type { AgentCharter } from "./charter";
import { COMPLETION_CHARTERS } from "./charters/completion-charters";
import { EXISTING_CHARTERS } from "./charters/existing-charters";
import { EXPANSION_CHARTERS } from "./charters/expansion-charters";
import type { AgentWorkspace } from "./workspace";
import { WORKFORCE_WORKSPACES } from "./workspaces/workforce-workspaces";

export interface WorkforceMember {
  readonly pack: RolePack;
  readonly charter: AgentCharter;
  readonly workspace: AgentWorkspace;
}

export const WORKFORCE_PACKS: readonly RolePack[] = [
  JARVIS_EXECUTIVE_PACK,
  ...PLATFORM_WORKFORCE_PACKS,
  ...EXPANSION_WORKFORCE_PACKS,
  ...COMPLETION_WORKFORCE_PACKS,
];

export const WORKFORCE_CHARTERS: readonly AgentCharter[] = [
  ...EXISTING_CHARTERS,
  ...EXPANSION_CHARTERS,
  ...COMPLETION_CHARTERS,
];

/** One member per charter, in charter order. An agent missing a pack or workspace is skipped. */
export function workforceRoster(): readonly WorkforceMember[] {
  return WORKFORCE_CHARTERS.flatMap((charter) => {
    const pack = WORKFORCE_PACKS.find((p) => p.code === charter.packCode);
    const workspace = WORKFORCE_WORKSPACES.find((w) => w.packCode === charter.packCode);
    return pack && workspace ? [{ pack, charter, workspace }] : [];
  });
}

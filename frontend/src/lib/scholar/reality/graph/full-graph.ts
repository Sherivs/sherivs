/**
 * M5a (E-009) — the full graph, all families statically imported. For server
 * use (validation, plan generation, review). Public steps use registry.ts.
 */
import { assembleGraph } from "./assemble";
import { ENTRY_MODULE } from "./entry";
import { MODULE as agriculture } from "./families/agriculture-college";
import { MODULE as coe } from "./families/college-of-education";
import { MODULE as health } from "./families/health-college";
import { MODULE as islamiyya } from "./families/islamiyya";
import { MODULE as multiCampus } from "./families/multi-campus";
import { MODULE as oversight } from "./families/oversight";
import { MODULE as polytechnic } from "./families/polytechnic";
import { MODULE as privateBasic } from "./families/private-basic";
import { MODULE as publicBasic } from "./families/public-basic";
import { MODULE as tvet } from "./families/tvet";
import { MODULE as unityTechnical } from "./families/unity-technical";
import { MODULE as university } from "./families/university";
import type { GraphModule } from "./types";

export const ALL_FAMILY_MODULES: readonly GraphModule[] = [
  privateBasic,
  publicBasic,
  unityTechnical,
  islamiyya,
  university,
  polytechnic,
  coe,
  health,
  agriculture,
  tvet,
  multiCampus,
  oversight,
];

export const FULL_REALITY_GRAPH = assembleGraph([ENTRY_MODULE, ...ALL_FAMILY_MODULES]);

/**
 * M5a (E-009) — assemble graph modules into one question graph (ADR-107).
 */
import { REALITY_GRAPH_ID, REALITY_GRAPH_VERSION, ROOT_QUESTION_ID } from "./entry";
import type { GraphModule, QuestionGraph } from "./types";

export function assembleGraph(modules: readonly GraphModule[]): QuestionGraph {
  return {
    graphId: REALITY_GRAPH_ID,
    version: REALITY_GRAPH_VERSION,
    rootId: ROOT_QUESTION_ID,
    questions: modules.flatMap((m) => m.questions),
    edges: modules.flatMap((m) => m.edges),
    modules: modules.map((m) => m.moduleId),
  };
}

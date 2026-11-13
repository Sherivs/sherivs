import type { CardData } from "@/lib/sherivs-ws/live";
import type { WorkspaceManifest } from "@/components/workspaces/_contract-shim";
import { ACADEMIC_TEACHING_WORKSPACE } from "./academic-teaching";
import { ADMINISTRATIVE_OPERATIONS_WORKSPACE } from "./administrative-operations";
import {
  buildCategoryWorkspace,
  type CategoryWorkspaceSpec,
  type CategoryWorkspaceView,
} from "./category-workspace";

/** Registered category workspaces, in display order. Later stages append here. */
export const CATEGORY_WORKSPACE_SPECS: readonly CategoryWorkspaceSpec[] = [
  ACADEMIC_TEACHING_WORKSPACE,
  ADMINISTRATIVE_OPERATIONS_WORKSPACE,
];

export function categoryWorkspaces(
  manifest: WorkspaceManifest | null,
  cards: Readonly<Record<string, CardData>>,
  loading = false,
  failed = false,
): CategoryWorkspaceView[] {
  return CATEGORY_WORKSPACE_SPECS.map((spec) =>
    buildCategoryWorkspace(spec, manifest, cards, loading, failed),
  ).filter((view): view is CategoryWorkspaceView => view !== null);
}

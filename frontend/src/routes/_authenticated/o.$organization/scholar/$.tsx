import { createFileRoute } from "@tanstack/react-router";
import { Suspense, type ComponentType } from "react";
import { RoleGuard } from "@/components/role-guard";
import type { AppRole } from "@/lib/roles";
import {
  normalizeAppPath,
  scholarRoleSegmentFromLeaf,
  SCHOLAR_ROLE_GUARD,
} from "@/lib/experience/organization-routes";
import { SCHOLAR_BOUND_SURFACES } from "./-surfaces";

export const Route = createFileRoute("/_authenticated/o/$organization/scholar/$")({
  component: BoundScholarSurface,
});

function BoundScholarSurface() {
  const { _splat } = Route.useParams();
  const leaf = normalizeAppPath(`/${_splat ?? ""}`);
  const key = leaf.replace(/^\//, "");
  const segment = scholarRoleSegmentFromLeaf(leaf);
  const allow = (segment ? SCHOLAR_ROLE_GUARD[segment] : undefined) as AppRole[] | undefined;
  const Surface = SCHOLAR_BOUND_SURFACES[key] as ComponentType | undefined;

  if (!Surface || !allow) {
    return (
      <div className="min-h-[40vh] grid place-items-center px-4 text-sm text-muted-foreground">
        This runtime surface is not bound: {leaf}
      </div>
    );
  }

  return (
    <RoleGuard allow={allow}>
      <Suspense
        fallback={
          <div className="min-h-[40vh] grid place-items-center text-muted-foreground">Loading…</div>
        }
      >
        <Surface />
      </Suspense>
    </RoleGuard>
  );
}

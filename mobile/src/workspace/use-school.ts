import { useMemo } from "react";
import { useSession } from "@/providers/session-provider";
import { buildWorkspaceManifest, type WorkspaceManifest } from "./manifest";
import { linkedStudents, type LinkedStudent } from "@/api/school.client";
import { cacheKey, useCachedQuery, type CachedQuery } from "@/lib/offline-cache";

export interface SchoolContext {
  readonly userId: string | null;
  readonly role: string | null;
  readonly fullName: string | null;
  readonly manifest: WorkspaceManifest;
  readonly students: CachedQuery<LinkedStudent[]>;
  readonly key: (name: string) => string | null;
}

export function useSchool(): SchoolContext {
  const { session, actor, client } = useSession();
  const userId = session?.user?.id ?? null;
  const role = actor?.kind === "user" ? actor.profile.role : actor?.kind === "super_admin" ? "super_admin" : null;
  const fullName = actor?.kind === "user" ? actor.profile.full_name : null;
  const manifest = useMemo(() => buildWorkspaceManifest(role), [role]);
  const key = (name: string) => (userId ? cacheKey(userId, name) : null);
  const students = useCachedQuery(key("students"), () => linkedStudents(client, userId ?? ""), [userId]);
  return { userId, role, fullName, manifest, students, key };
}

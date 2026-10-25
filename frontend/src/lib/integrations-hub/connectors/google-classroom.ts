/**
 * Google Classroom connector — STUB. Read-only roster/course import via the Classroom API
 * (courses.list, courses.students.list, courses.teachers.list). OAuth2 consent by a Workspace
 * admin of the school; the refresh token is stored in the Sherivs Vault, never in a table.
 * Not wired yet: OAuth client registration + Google verification for restricted scopes.
 */
import type { CanonicalRecord, ConnectorManifest, ConnectorRuntime, PullResult } from "../sdk";

export const googleClassroomManifest: ConnectorManifest = {
  key: "google-classroom",
  name: "Google Classroom",
  version: "0.1.0",
  category: "lms",
  auth_type: "oauth2",
  entities: ["class", "student", "staff", "assignment"],
  directions: ["inbound"],
  status: "stub",
};
export const GOOGLE_CLASSROOM_SCOPES = [
  "https://www.googleapis.com/auth/classroom.courses.readonly",
  "https://www.googleapis.com/auth/classroom.rosters.readonly",
] as const;

interface Course {
  id: string;
  name: string;
  section?: string;
  courseState?: string;
}
interface Student {
  userId: string;
  profile?: { name?: { givenName?: string; familyName?: string }; emailAddress?: string };
}

export const mapCourse = (c: Course): CanonicalRecord => ({
  external_id: `gc:${c.id}`,
  data: { name: c.name, arm: c.section ?? null },
});
export const mapStudent = (s: Student): CanonicalRecord => ({
  external_id: `gc:${s.userId}`,
  data: {
    first_name: s.profile?.name?.givenName,
    last_name: s.profile?.name?.familyName,
    email: s.profile?.emailAddress,
  },
});

export const googleClassroom: ConnectorRuntime = {
  manifest: googleClassroomManifest,
  async pull({ entity, cursor, secret: accessToken, fetch }): Promise<PullResult> {
    if (!accessToken) throw new Error("google-classroom: not connected");
    if (entity !== "class")
      throw new Error(`google-classroom: ${entity} pull not implemented yet (stub)`);
    const u = new URL("https://classroom.googleapis.com/v1/courses");
    u.searchParams.set("pageSize", "100");
    u.searchParams.set("courseStates", "ACTIVE");
    if (cursor) u.searchParams.set("pageToken", cursor);
    const r = await fetch(u.toString(), { headers: { Authorization: `Bearer ${accessToken}` } });
    if (!r.ok) throw new Error(`google-classroom: HTTP ${r.status}`);
    const j = (await r.json()) as { courses?: Course[]; nextPageToken?: string };
    return {
      records: (j.courses ?? []).map(mapCourse),
      cursor: j.nextPageToken ?? null,
      done: !j.nextPageToken,
    };
  },
};

/**
 * Moodle connector (inbound) via Moodle Web Services REST:
 *   GET {base}/webservice/rest/server.php?wstoken=<token>&wsfunction=<fn>&moodlewsrestformat=json
 * Functions: core_course_get_courses (class), core_enrol_get_enrolled_users (student, staff, enrollment),
 * gradereport_user_get_grade_items (result: course total as exam_score out of 100).
 * Source: docs.moodle.org/dev/Web_service_API_functions. The site admin creates a token for an external
 * service limited to those functions. Vault secret (JSON): {"token"}; config: {"base_url"}.
 * Cursor = index of the next course to read (one course per page keeps every call small).
 */
import {
  baseUrl,
  parseSecret,
  type CanonicalRecord,
  type ConnectorManifest,
  type ConnectorRuntime,
  type PullContext,
  type PullResult,
} from "../sdk";

export const moodleManifest: ConnectorManifest = {
  key: "moodle",
  name: "Moodle",
  version: "1.0.0",
  category: "lms",
  auth_type: "api_key",
  entities: ["class", "student", "staff", "enrollment", "result"],
  directions: ["inbound"],
  status: "beta",
};

interface Course {
  id: number;
  fullname: string;
  shortname: string;
  format?: string;
}
interface MUser {
  id: number;
  username?: string;
  idnumber?: string;
  firstname?: string;
  lastname?: string;
  email?: string;
  roles?: { shortname: string }[];
}
interface GradeItems {
  usergrades?: {
    userid: number;
    gradeitems: { itemtype: string; graderaw: number | null; grademax: number }[];
  }[];
}

async function call<T>(
  ctx: PullContext,
  fn: string,
  params: Record<string, string> = {},
): Promise<T> {
  const { token } = parseSecret<{ token: string }>(ctx.secret, ["token"]);
  const q = new URLSearchParams({
    wstoken: token,
    wsfunction: fn,
    moodlewsrestformat: "json",
    ...params,
  });
  const r = await ctx.fetch(`${baseUrl(ctx.config)}/webservice/rest/server.php`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: q.toString(),
  });
  if (!r.ok) throw new Error(`moodle: ${fn} HTTP ${r.status}`);
  const j = (await r.json()) as T & { exception?: string; errorcode?: string };
  if (j && typeof j === "object" && "exception" in j && j.exception)
    throw new Error(`moodle: ${fn} ${j.errorcode ?? "error"}`);
  return j;
}
const isStudent = (u: MUser) => (u.roles ?? []).some((r) => r.shortname === "student");
const isTeacher = (u: MUser) =>
  (u.roles ?? []).some((r) => /teacher|editingteacher|manager/.test(r.shortname));
const uid = (u: MUser) => `moodle:${u.id}`;

export function mapMoodleUser(u: MUser, as: "student" | "staff"): CanonicalRecord {
  return {
    external_id: uid(u),
    data:
      as === "student"
        ? {
            admission_number: u.idnumber || undefined,
            first_name: u.firstname,
            last_name: u.lastname,
          }
        : {
            staff_number: u.idnumber || undefined,
            first_name: u.firstname,
            last_name: u.lastname,
            email: u.email,
          },
  };
}

export const moodle: ConnectorRuntime = {
  manifest: moodleManifest,
  async pull(ctx): Promise<PullResult> {
    const courses = (await call<Course[]>(ctx, "core_course_get_courses")).filter(
      (c) => c.format !== "site",
    );
    if (ctx.entity === "class")
      return {
        records: courses.map((c) => ({
          external_id: `moodle:course:${c.id}`,
          data: { name: c.fullname, arm: c.shortname },
        })),
        cursor: null,
        done: true,
      };
    const i = Number(ctx.cursor ?? 0) || 0;
    if (i >= courses.length) return { records: [], cursor: "0", done: true };
    const course = courses[i];
    const next = { cursor: String(i + 1), done: i + 1 >= courses.length };
    if (ctx.entity === "result") {
      const g = await call<GradeItems>(ctx, "gradereport_user_get_grade_items", {
        courseid: String(course.id),
      });
      const recs = (g.usergrades ?? []).flatMap((ug) =>
        ug.gradeitems
          .filter((it) => it.itemtype === "course" && it.graderaw !== null)
          .map((it) => ({
            external_id: `moodle:grade:${course.id}:${ug.userid}`,
            data: {
              student_external_id: `moodle:${ug.userid}`,
              subject: course.fullname,
              exam_score: Math.round(((it.graderaw ?? 0) / (it.grademax || 100)) * 10000) / 100,
              term: String(ctx.config.term ?? "Imported"),
              academic_year: String(ctx.config.academic_year ?? "Imported"),
            },
          })),
      );
      return { records: recs, ...next };
    }
    const users = await call<MUser[]>(ctx, "core_enrol_get_enrolled_users", {
      courseid: String(course.id),
    });
    if (ctx.entity === "student")
      return { records: users.filter(isStudent).map((u) => mapMoodleUser(u, "student")), ...next };
    if (ctx.entity === "staff")
      return { records: users.filter(isTeacher).map((u) => mapMoodleUser(u, "staff")), ...next };
    if (ctx.entity === "enrollment")
      return {
        records: users.filter(isStudent).map((u) => ({
          external_id: `moodle:enrol:${course.id}:${u.id}`,
          data: { student_external_id: uid(u), class_external_id: `moodle:course:${course.id}` },
        })),
        ...next,
      };
    throw new Error(`moodle: ${ctx.entity} not supported`);
  },
};

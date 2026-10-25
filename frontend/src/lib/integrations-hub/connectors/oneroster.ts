/**
 * OneRoster 1.1 connector (inbound), the IMS standard many SIS expose (Classter, and most international SIS).
 *   token: POST {token_url} grant_type=client_credentials (HTTP Basic client_id:client_secret)
 *   data:  GET {base_url}/ims/oneroster/v1p1/{classes|users|enrollments}?limit=&offset=&filter=dateLastModified>'<iso>'
 * Sources: OneRoster 1.1 spec (1edtech), support.singlewire.com OneRoster integration guide (endpoints, OAuth2 client credentials,
 * dateLastModified delta). Vault secret (JSON): {"client_id","client_secret"}; config: {"base_url","token_url"}.
 * Cursor = "<offset>|<run high-water dateLastModified>|<previous high-water>".
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

export const onerosterManifest: ConnectorManifest = {
  key: "oneroster",
  name: "OneRoster 1.1 (Classter and other SIS)",
  version: "1.0.0",
  category: "sis",
  auth_type: "oauth2",
  entities: ["class", "student", "staff", "guardian", "enrollment"],
  directions: ["inbound"],
  status: "beta",
};
const PAGE = 500;
interface ORUser {
  sourcedId: string;
  status?: string;
  dateLastModified?: string;
  role: string;
  identifier?: string;
  givenName?: string;
  familyName?: string;
  email?: string;
  phone?: string;
  agents?: { sourcedId: string }[];
}
interface ORClass {
  sourcedId: string;
  dateLastModified?: string;
  title: string;
  classCode?: string;
  grades?: string[];
}
interface OREnr {
  sourcedId: string;
  dateLastModified?: string;
  role: string;
  user: { sourcedId: string };
  class: { sourcedId: string };
}

export function mapOneRoster(entity: string, x: ORUser | ORClass | OREnr): CanonicalRecord | null {
  const id = `or:${x.sourcedId}`;
  if (entity === "class") {
    const c = x as ORClass;
    return { external_id: id, data: { name: c.title, arm: c.classCode, level: c.grades?.[0] } };
  }
  if (entity === "enrollment") {
    const e = x as OREnr;
    if (e.role !== "student") return null;
    return {
      external_id: id,
      data: {
        student_external_id: `or:${e.user.sourcedId}`,
        class_external_id: `or:${e.class.sourcedId}`,
      },
    };
  }
  const u = x as ORUser;
  if (entity === "student" && u.role === "student")
    return {
      external_id: id,
      data: {
        admission_number: u.identifier || undefined,
        first_name: u.givenName,
        last_name: u.familyName,
      },
    };
  if (entity === "staff" && (u.role === "teacher" || u.role === "administrator"))
    return {
      external_id: id,
      data: {
        staff_number: u.identifier || undefined,
        first_name: u.givenName,
        last_name: u.familyName,
        email: u.email,
        phone: u.phone,
        role: u.role === "administrator" ? "admin" : "teacher",
      },
    };
  if (
    entity === "guardian" &&
    (u.role === "parent" || u.role === "guardian" || u.role === "relative")
  ) {
    const child = (u.agents ?? [])[0]?.sourcedId;
    return {
      external_id: id,
      data: {
        first_name: u.givenName,
        last_name: u.familyName,
        email: u.email,
        phone: u.phone,
        student_external_id: child ? `or:${child}` : undefined,
      },
    };
  }
  return null;
}

async function token(ctx: PullContext): Promise<string> {
  const s = parseSecret<{ client_id: string; client_secret: string }>(ctx.secret, [
    "client_id",
    "client_secret",
  ]);
  const url = String(ctx.config.token_url ?? "");
  if (!/^https:\/\//.test(url)) throw new Error("oneroster: set token_url (https)");
  const r = await ctx.fetch(url, {
    method: "POST",
    headers: {
      Authorization: "Basic " + Buffer.from(`${s.client_id}:${s.client_secret}`).toString("base64"),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  if (!r.ok) throw new Error(`oneroster: token HTTP ${r.status}`);
  const j = (await r.json()) as { access_token?: string };
  if (!j.access_token) throw new Error("oneroster: no access token");
  return j.access_token;
}

export const oneroster: ConnectorRuntime = {
  manifest: onerosterManifest,
  async pull(ctx): Promise<PullResult> {
    const [offS, hwS, prevS] = (ctx.cursor ?? "0||").split("|");
    const offset = Number(offS) || 0;
    const since = prevS || "";
    let hw = hwS || since;
    const path =
      ctx.entity === "class" ? "classes" : ctx.entity === "enrollment" ? "enrollments" : "users";
    const key =
      ctx.entity === "class" ? "classes" : ctx.entity === "enrollment" ? "enrollments" : "users";
    const q = new URLSearchParams({
      limit: String(PAGE),
      offset: String(offset),
      sort: "dateLastModified",
    });
    if (since) q.set("filter", `dateLastModified>'${since}'`);
    const r = await ctx.fetch(`${baseUrl(ctx.config)}/ims/oneroster/v1p1/${path}?${q}`, {
      headers: { Authorization: `Bearer ${await token(ctx)}`, Accept: "application/json" },
    });
    if (!r.ok) throw new Error(`oneroster: ${path} HTTP ${r.status}`);
    const rows = (((await r.json()) as Record<string, unknown>)[key] ?? []) as (ORUser &
      ORClass &
      OREnr)[];
    for (const x of rows)
      if (x.dateLastModified && x.dateLastModified > hw) hw = x.dateLastModified;
    const records = rows
      .filter((x) => x.status !== "tobedeleted")
      .map((x) => mapOneRoster(ctx.entity, x))
      .filter((x): x is CanonicalRecord => !!x);
    const done = rows.length < PAGE;
    return { records, cursor: done ? `0|${hw}|${hw}` : `${offset + PAGE}|${hw}|${since}`, done };
  },
};

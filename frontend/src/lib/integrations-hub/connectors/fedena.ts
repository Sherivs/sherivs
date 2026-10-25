/**
 * Fedena connector (inbound). Fedena exposes a REST API on each school's own instance:
 *   token:  POST {base}/oauth/token  (client_id, client_secret, grant_type=password, username, password, redirect_uri)
 *   calls:  GET  {base}/api/<resource>?search[<ransack predicate>]=<v>   Authorization: Token token="<access_token>"
 *   responses are XML. Sources: support.fedena.com article 190972, apis.fedena.com (student_search, employee_search, batch_search).
 * ASSUMPTIONS (verify against a sandbox instance before GA): element names below (admission_no, first_name,
 * last_name, gender, date_of_birth, batch_name, employee_number, email, mobile_phone) and that ransack `id_gt`
 * works for incremental paging. The XML reader is a minimal leaf-element extractor with no DTD/entity expansion.
 * Vault secret (JSON): {"client_id","client_secret","username","password","redirect_uri"}; config: {"base_url"}.
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

export const fedenaManifest: ConnectorManifest = {
  key: "fedena",
  name: "Fedena",
  version: "0.9.0",
  category: "sis",
  auth_type: "oauth2",
  entities: ["student", "staff", "class"],
  directions: ["inbound"],
  status: "beta",
};

const ENT: Record<string, string> = {
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&apos;": "'",
  "&amp;": "&",
};
const decode = (s: string) =>
  s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&(lt|gt|quot|apos|amp);/g, (m) => ENT[m])
    .trim();

/** Extract `<tag>` elements and their leaf children. Refuses DOCTYPE (no entity expansion, no XXE). */
export function xmlRecords(xml: string, tag: string): Record<string, string>[] {
  if (/<!DOCTYPE/i.test(xml)) throw new Error("fedena: DOCTYPE not allowed");
  const out: Record<string, string>[] = [];
  const re = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g");
  for (const m of xml.matchAll(re)) {
    const rec: Record<string, string> = {};
    for (const f of m[1].matchAll(
      /<([a-zA-Z_][\w.-]*)(?:\s[^>]*)?>([^<]*(?:<!\[CDATA\[[\s\S]*?\]\]>)?[^<]*)<\/\1>/g,
    ))
      rec[f[1]] = decode(f[2]);
    out.push(rec);
  }
  return out;
}

const RES: Record<string, { path: string; tag: string }> = {
  student: { path: "students", tag: "student" },
  staff: { path: "employees", tag: "employee" },
  class: { path: "batches", tag: "batch" },
};
export function mapFedena(entity: string, r: Record<string, string>): CanonicalRecord | null {
  if (entity === "student") {
    const ext = r.admission_no || r.id;
    if (!ext) return null;
    return {
      external_id: `fedena:${ext}`,
      data: {
        admission_number: r.admission_no,
        first_name: r.first_name,
        last_name: r.last_name,
        gender: r.gender?.toLowerCase().startsWith("f") ? "female" : r.gender ? "male" : undefined,
        date_of_birth: r.date_of_birth,
        class_name: r.batch_name,
      },
    };
  }
  if (entity === "staff") {
    const ext = r.employee_number || r.id;
    if (!ext) return null;
    return {
      external_id: `fedena:${ext}`,
      data: {
        staff_number: r.employee_number,
        first_name: r.first_name,
        last_name: r.last_name,
        email: r.email,
        phone: r.mobile_phone,
        department: r.employee_department_name,
      },
    };
  }
  const ext = r.id || r.name;
  if (!ext) return null;
  return {
    external_id: `fedena:${ext}`,
    data: { name: r.name ?? r.batch_name, level: r.course_name, academic_year: r.academic_year },
  };
}

async function token(ctx: PullContext, base: string): Promise<string> {
  const s = parseSecret<{
    client_id: string;
    client_secret: string;
    username: string;
    password: string;
    redirect_uri: string;
  }>(ctx.secret, ["client_id", "client_secret", "username", "password"]);
  const body = new URLSearchParams({
    client_id: s.client_id,
    client_secret: s.client_secret,
    grant_type: "password",
    username: s.username,
    password: s.password,
    redirect_uri: s.redirect_uri ?? "",
  });
  const r = await ctx.fetch(`${base}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!r.ok) throw new Error(`fedena: token HTTP ${r.status}`);
  const j = (await r.json()) as { access_token?: string };
  if (!j.access_token) throw new Error("fedena: no access token");
  return j.access_token;
}

export const fedena: ConnectorRuntime = {
  manifest: fedenaManifest,
  async pull(ctx): Promise<PullResult> {
    const res = RES[ctx.entity];
    if (!res) throw new Error(`fedena: ${ctx.entity} not supported`);
    const base = baseUrl(ctx.config);
    const t = await token(ctx, base);
    const after = Number(ctx.cursor ?? 0) || 0;
    const r = await ctx.fetch(`${base}/api/${res.path}?search[id_gt]=${after}`, {
      headers: { Authorization: `Token token="${t}"`, Accept: "application/xml" },
    });
    if (!r.ok) throw new Error(`fedena: ${res.path} HTTP ${r.status}`);
    const rows = xmlRecords(await r.text(), res.tag);
    const maxId = rows.reduce((m, x) => Math.max(m, Number(x.id) || 0), after);
    return {
      records: rows.map((x) => mapFedena(ctx.entity, x)).filter((x): x is CanonicalRecord => !!x),
      cursor: String(maxId),
      done: rows.length === 0 || maxId === after,
    };
  },
};

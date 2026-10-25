/**
 * SHERIVS-090 Integration Hub — connector SDK.
 *
 * A connector is a manifest (what it is, how it authenticates, which canonical entities
 * it can move) plus a runtime that turns the school's source records into canonical
 * records `{ external_id, data }`. Connectors never write tables: every record goes
 * through `integration_ingest`, which derives the school from the integration row,
 * dedupes on external_id / natural key, and is idempotent per idempotency key.
 * Secrets live only in the Sherivs Vault (org_credentials, SHERIVS-012), addressed by
 * integrations.credential_provider / credential_name.
 */
export const CANONICAL_ENTITIES = [
  "student",
  "staff",
  "guardian",
  "class",
  "enrollment",
  "result",
  "fee_invoice",
  "payment",
  "assignment",
] as const;
export type CanonicalEntity = (typeof CANONICAL_ENTITIES)[number];
export type AuthType = "none" | "api_key" | "oauth2" | "hmac_webhook" | "db_replica" | "sftp";
export type Direction = "inbound" | "outbound";

/** Canonical fields per entity (subset; the full model is in the Integration Hub design page). */
export const CANONICAL_FIELDS: Record<CanonicalEntity, readonly string[]> = {
  student: [
    "external_id",
    "admission_number",
    "first_name",
    "last_name",
    "other_names",
    "gender",
    "date_of_birth",
    "class_name",
    "state_of_origin",
    "lga",
    "guardian_phone",
    "guardian_email",
  ],
  staff: [
    "external_id",
    "staff_number",
    "first_name",
    "last_name",
    "email",
    "phone",
    "role",
    "department",
  ],
  guardian: [
    "external_id",
    "first_name",
    "last_name",
    "phone",
    "email",
    "relationship",
    "student_external_id",
  ],
  class: ["external_id", "name", "level", "arm", "form_teacher_external_id", "academic_year"],
  result: [
    "external_id",
    "student_external_id",
    "subject",
    "term",
    "academic_year",
    "ca_score",
    "exam_score",
  ],
  fee_invoice: [
    "external_id",
    "student_external_id",
    "fee_type",
    "amount_naira",
    "term",
    "academic_year",
  ],
  payment: [
    "external_id",
    "invoice_external_id",
    "amount_naira",
    "paid_at",
    "reference",
    "channel",
  ],
  enrollment: [
    "external_id",
    "student_external_id",
    "admission_number",
    "class_external_id",
    "class_name",
    "course_code",
    "session",
    "semester",
  ],
  assignment: ["external_id", "class_external_id", "title", "due_at"],
};

export interface ConnectorManifest {
  key: string;
  name: string;
  version: string;
  category: "file" | "api" | "lms" | "sis" | "finance" | "identity";
  auth_type: AuthType;
  entities: CanonicalEntity[];
  directions: Direction[];
  status: "stub" | "beta" | "ga" | "retired";
}

export interface CanonicalRecord {
  external_id: string;
  data: Record<string, unknown>;
}
export type Transform =
  "none" | "trim" | "upper" | "lower" | "date_dmy" | "date_iso" | "phone_ng" | "naira_kobo";
export interface FieldMapping {
  source: string;
  target: string;
  transform?: Transform;
}

export interface PullResult {
  records: CanonicalRecord[];
  cursor?: string | null;
  done?: boolean;
}
export interface PullContext {
  entity: CanonicalEntity;
  /** Opaque incremental cursor from the previous page/run (sync_jobs.cursor). */
  cursor: string | null;
  /** Decrypted connector secret from the vault (JSON string for multi-field credentials); memory only. */
  secret: string | null;
  /** Non-secret integration config (base_url, token_url, ...). */
  config: Record<string, unknown>;
  /** SSRF-guarded fetch (http.server.ts); injected so connectors stay unit-testable. */
  fetch: (url: string, init?: RequestInit) => Promise<Response>;
}
export interface ConnectorRuntime {
  manifest: ConnectorManifest;
  /** Pull one page of canonical records. Return done=true when the entity is fully read for this run. */
  pull?(ctx: PullContext): Promise<PullResult>;
}

/** Parse a multi-field credential stored in the vault as JSON. */
export function parseSecret<T extends Record<string, string>>(
  secret: string | null,
  keys: (keyof T)[],
): T {
  if (!secret) throw new Error("connector is not connected (no credential in the vault)");
  let o: unknown;
  try {
    o = JSON.parse(secret);
  } catch {
    throw new Error("connector credential is malformed");
  }
  for (const k of keys)
    if (typeof (o as Record<string, unknown>)[k as string] !== "string")
      throw new Error(`connector credential is missing ${String(k)}`);
  return o as T;
}
export function baseUrl(config: Record<string, unknown>): string {
  const b = config.base_url;
  if (typeof b !== "string" || !/^https:\/\/[^\s/]+/.test(b))
    throw new Error("set the connector base URL (https) first");
  return b.replace(/\/+$/, "");
}

export function applyTransform(v: unknown, t: Transform = "none"): unknown {
  if (v === null || v === undefined) return v;
  const s = String(v);
  switch (t) {
    case "trim":
      return s.trim();
    case "upper":
      return s.trim().toUpperCase();
    case "lower":
      return s.trim().toLowerCase();
    case "date_iso": {
      const d = new Date(s.trim());
      return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
    }
    case "date_dmy": {
      // Nigerian DD/MM/YYYY
      if (/^\d{4}-\d{2}-\d{2}$/.test(s.trim())) return s.trim(); // already ISO (Excel date cells)
      const m = s.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
      return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : null;
    }
    case "phone_ng": {
      let d = s.replace(/\D/g, "");
      if (/^[789][01]\d{8}$/.test(d)) d = "0" + d; // Excel numeric cells drop the leading 0
      if (/^0[789]\d{9}$/.test(d)) return "+234" + d.slice(1);
      if (/^234[789]\d{9}$/.test(d)) return "+" + d;
      return null;
    }
    case "naira_kobo": {
      const n = Number(s.replace(/[₦,\s]/g, ""));
      return Number.isFinite(n) ? Math.round(n * 100) : null;
    }
    default:
      return s;
  }
}

/** Map a raw source row to a canonical record. Rows without an external id are dropped by the caller. */
export function mapRow(
  row: Record<string, unknown>,
  mappings: FieldMapping[],
): CanonicalRecord | null {
  const data: Record<string, unknown> = {};
  for (const m of mappings) {
    const v = applyTransform(row[m.source], m.transform);
    if (v !== undefined && v !== null && v !== "") data[m.target] = v;
  }
  const ext = data.external_id ?? data.admission_number ?? data.staff_number;
  if (ext === undefined || ext === null || String(ext).trim() === "") return null;
  delete data.external_id;
  return { external_id: String(ext).trim().slice(0, 200), data };
}

/** Deterministic idempotency key for a batch (same file/payload => same key => replay, not a second run). */
export async function batchKey(prefix: string, records: CanonicalRecord[]): Promise<string> {
  const buf = new TextEncoder().encode(JSON.stringify(records));
  const h = await crypto.subtle.digest("SHA-256", buf);
  return `${prefix}-${Array.from(new Uint8Array(h))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")
    .slice(0, 40)}`;
}

/** Suggest mappings by fuzzy header name (admin confirms in the UI). */
export function suggestMappings(headers: string[], entity: CanonicalEntity): FieldMapping[] {
  const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
  const alias: Record<string, string[]> = {
    admission_number: [
      "admissionno",
      "admno",
      "regno",
      "registrationnumber",
      "matricno",
      "matricnumber",
      "studentid",
    ],
    first_name: ["firstname", "fname", "givenname"],
    last_name: ["lastname", "surname", "lname", "familyname"],
    other_names: ["othernames", "middlename"],
    gender: ["gender", "sex"],
    date_of_birth: ["dob", "dateofbirth", "birthdate"],
    class_name: ["class", "classname", "arm", "level"],
    guardian_phone: ["parentphone", "guardianphone", "phone"],
    staff_number: ["staffno", "staffid", "employeeid"],
    email: ["email", "emailaddress"],
  };
  const out: FieldMapping[] = [];
  for (const target of CANONICAL_FIELDS[entity]) {
    const keys = [norm(target), ...(alias[target] ?? [])];
    const h = headers.find((x) => keys.includes(norm(x)));
    if (h)
      out.push({
        source: h,
        target,
        transform:
          target === "date_of_birth" ? "date_dmy" : target.endsWith("phone") ? "phone_ng" : "trim",
      });
  }
  return out;
}

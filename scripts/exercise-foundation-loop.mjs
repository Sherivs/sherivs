#!/usr/bin/env node
/**
 * Exercise recordFoundationLoop with a disposable school-admin session.
 * Secrets stay in process memory and are never printed.
 */
import { spawn } from "node:child_process";
import { randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { fromCrossJSON, toJSON } from "seroval";

const root = fileURLToPath(new URL("..", import.meta.url));
const projectRef = "nwrflbpbhyiqdptmlccm";
const supabaseUrl = `https://${projectRef}.supabase.co`;
const email = "foundation-loop-probe@example.invalid";
const password = randomBytes(18).toString("base64url");
const slug = "foundation-loop-probe";

function sanitize(text) {
  return String(text)
    .replace(/sbp_[A-Za-z0-9_\-]+/g, "[redacted]")
    .replace(/eyJ[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+\.[A-Za-z0-9_\-]+/g, "[redacted-jwt]")
    .replace(password, "[redacted]");
}

let accessToken = process.env.SUPABASE_ACCESS_TOKEN ?? "";
if (!accessToken) {
  try {
    const envFile = readFileSync(join(root, ".env.local"), "utf8");
    for (const line of envFile.split(/\r?\n/)) {
      const match = line.trim().match(/^(?:export\s+)?SUPABASE_ACCESS_TOKEN\s*=\s*(.*)$/);
      if (match) accessToken = match[1].trim().replace(/^['"]|['"]$/g, "");
    }
  } catch {
    // .env.local absent — the environment variable was the only source.
  }
}
if (!accessToken) {
  console.error("BLOCKED_NO_CREDENTIAL");
  process.exit(2);
}

async function management(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/database/query`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`SQL HTTP ${res.status} ${sanitize(text).slice(0, 400)}`);
  return text === "" ? [] : JSON.parse(text);
}

const keysRes = await fetch(`https://api.supabase.com/v1/projects/${projectRef}/api-keys`, {
  headers: { Authorization: `Bearer ${accessToken}` },
});
const keysText = await keysRes.text();
if (!keysRes.ok) throw new Error(`keys HTTP ${keysRes.status} ${sanitize(keysText).slice(0, 200)}`);
const keys = JSON.parse(keysText);
const named = keys.map((key) => key.name ?? key.type ?? "unnamed");
console.log(`api_key_names=${named.join(",")}`);
const anon = keys.find((key) => /anon|publishable/i.test(`${key.name} ${key.type ?? ""}`));
const service = keys.find((key) => /service|secret/i.test(`${key.name} ${key.type ?? ""}`));
const anonKey = anon?.api_key ?? anon?.key;
const serviceKey = service?.api_key ?? service?.key;
if (!anonKey || !serviceKey) throw new Error("publishable or service key missing");

async function authAdmin(path, init = {}) {
  const res = await fetch(`${supabaseUrl}/auth/v1${path}`, {
    ...init,
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
      ...(init.headers ?? {}),
    },
  });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

const existing = await authAdmin(`/admin/users?email=${encodeURIComponent(email)}`);
if (existing.ok) {
  const body = JSON.parse(existing.text);
  const users = body.users ?? body;
  const prior = Array.isArray(users) ? users.find((user) => user.email === email) : null;
  if (prior?.id) await authAdmin(`/admin/users/${prior.id}`, { method: "DELETE" });
}
await management(`
  DELETE FROM public.cg_verification_result
    WHERE execution_id IN (
      SELECT id FROM public.cg_execution_record
      WHERE tenant_id IN (SELECT id::text FROM public.schools WHERE slug = '${slug}')
    );
  DELETE FROM public.cg_foundation_evidence
    WHERE tenant_id IN (SELECT id::text FROM public.schools WHERE slug = '${slug}');
  DROP TRIGGER IF EXISTS cg_execution_history_append_only ON public.cg_execution_history;
  DELETE FROM public.cg_execution_history
    WHERE execution_id IN (
      SELECT id FROM public.cg_execution_record
      WHERE tenant_id IN (SELECT id::text FROM public.schools WHERE slug = '${slug}')
    );
  CREATE TRIGGER cg_execution_history_append_only
    BEFORE UPDATE OR DELETE ON public.cg_execution_history
    FOR EACH ROW EXECUTE FUNCTION public.cg_foundation_reject_history_mutation();
  DELETE FROM public.cg_execution_record
    WHERE tenant_id IN (SELECT id::text FROM public.schools WHERE slug = '${slug}');
  DELETE FROM public.cg_mission_intent
    WHERE tenant_id IN (SELECT id::text FROM public.schools WHERE slug = '${slug}');
  DELETE FROM public.cg_event
    WHERE tenant_id IN (SELECT id::text FROM public.schools WHERE slug = '${slug}');
  DELETE FROM public.cg_relationship
    WHERE tenant_id IN (SELECT id::text FROM public.schools WHERE slug = '${slug}');
  DELETE FROM public.cg_entity
    WHERE tenant_id IN (SELECT id::text FROM public.schools WHERE slug = '${slug}');
  DELETE FROM public.schools WHERE slug = '${slug}';
`);

const created = await authAdmin("/admin/users", {
  method: "POST",
  body: JSON.stringify({ email, password, email_confirm: true }),
});
if (!created.ok)
  throw new Error(`create user HTTP ${created.status} ${sanitize(created.text).slice(0, 300)}`);
const user = JSON.parse(created.text);
const userId = user.id ?? user.user?.id;
if (!userId) throw new Error("created user has no id");

const schoolRows = await management(`
  INSERT INTO public.schools (name, slug)
  VALUES ('Foundation Loop Probe', '${slug}')
  RETURNING id;
`);
const schoolId = schoolRows[0]?.id;
if (!schoolId) throw new Error("probe school was not created");
await management(`
  INSERT INTO public.users (id, school_id, full_name, email, role)
  VALUES ('${userId}', '${schoolId}', 'Foundation Loop Probe', '${email}', 'admin');
`);
const entityRows = await management(`
  INSERT INTO public.cg_entity (entity_type, tenant_id, state)
  VALUES ('foundation-probe', '${schoolId}', 'observed')
  RETURNING id;
`);
const entityId = entityRows[0]?.id;
if (!entityId) throw new Error("probe entity was not created");
console.log("probe_session=created same_tenant_entity=created");

const signedIn = await fetch(`${supabaseUrl}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: {
    apikey: anonKey,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ email, password }),
});
const sessionText = await signedIn.text();
if (!signedIn.ok) {
  throw new Error(`sign-in HTTP ${signedIn.status} ${sanitize(sessionText).slice(0, 300)}`);
}
const session = JSON.parse(sessionText);
const sessionToken = session.access_token;
if (!sessionToken) throw new Error("authenticated session did not return an access token");

const serverFunctionId = "e1de8e1bc360032225b0c71aae9a128614ea1bd75bc10c594eb26119b72a680f";
const requestData = {
  realityRef: entityId,
  missionId: "COREGRID-FOUNDATION-MISSION-001",
  version: "http-live-1",
  purpose: "bounded-reality-loop",
  authorityRef: "CONTROL-PLANE-06",
  contextRef: "foundation-http-context",
  ownerRef: "MISSIONS.md",
  action: "record-observation",
  idempotencyKey: "foundation-http-idem-001",
};

async function callServerFunction() {
  const response = await fetch(
    `${process.env.FOUNDATION_LOOP_BASE_URL ?? "http://localhost:4173"}/_serverFn/${serverFunctionId}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${sessionToken}`,
        "Content-Type": "application/json",
        "x-tsr-serverFn": "true",
      },
      body: JSON.stringify(toJSON({ data: requestData })),
    },
  );
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`server-function HTTP ${response.status} ${sanitize(text).slice(0, 500)}`);
  }
  try {
    const decoded = fromCrossJSON(JSON.parse(text), { plugins: [] });
    if (decoded?.error) throw new Error(String(decoded.error.message ?? decoded.error));
    return decoded?.result ?? decoded;
  } catch (error) {
    throw new Error(
      `server-function decode failed: ${sanitize(text).slice(0, 1200)}; ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

const first = await callServerFunction();
const second = await callServerFunction();
console.log(
  JSON.stringify({
    first: {
      replayed: first.replayed,
      executionStatus: first.executionStatus,
      verification: first.verification?.decision ?? null,
    },
    second: {
      replayed: second.replayed,
      executionId: second.executionId,
      verification: second.verification?.decision ?? null,
    },
  }),
);

const child = spawn(
  process.execPath,
  [
    join(root, "node_modules/vitest/vitest.mjs"),
    "run",
    "tests/integration/foundation-loop.live.test.ts",
  ],
  {
    cwd: root,
    env: {
      ...process.env,
      SUPABASE_URL: supabaseUrl,
      SUPABASE_PUBLISHABLE_KEY: anonKey,
      SUPABASE_SERVICE_ROLE_KEY: serviceKey,
      FOUNDATION_LOOP_EMAIL: email,
      FOUNDATION_LOOP_PASSWORD: password,
      FOUNDATION_LOOP_ENTITY_ID: entityId,
      FOUNDATION_LOOP_SCHOOL_ID: schoolId,
      FOUNDATION_LOOP_USER_ID: userId,
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
let vitestOutput = "";
child.stdout.on("data", (chunk) => {
  vitestOutput += chunk.toString();
});
child.stderr.on("data", (chunk) => {
  vitestOutput += chunk.toString();
});
const vitestExit = await new Promise((resolve) => child.on("close", resolve));
console.log(sanitize(vitestOutput));

await management(`
  DELETE FROM public.audit_logs WHERE user_id = '${userId}';
  DELETE FROM public.cg_verification_result
    WHERE execution_id IN (SELECT id FROM public.cg_execution_record WHERE tenant_id = '${schoolId}');
  DELETE FROM public.cg_foundation_evidence WHERE tenant_id = '${schoolId}';
  DROP TRIGGER cg_execution_history_append_only ON public.cg_execution_history;
  DELETE FROM public.cg_execution_history
    WHERE execution_id IN (SELECT id FROM public.cg_execution_record WHERE tenant_id = '${schoolId}');
  CREATE TRIGGER cg_execution_history_append_only
    BEFORE UPDATE OR DELETE ON public.cg_execution_history
    FOR EACH ROW EXECUTE FUNCTION public.cg_foundation_reject_history_mutation();
  DELETE FROM public.cg_execution_record WHERE tenant_id = '${schoolId}';
  DELETE FROM public.cg_mission_intent WHERE tenant_id = '${schoolId}';
  DELETE FROM public.cg_event WHERE tenant_id = '${schoolId}';
  DELETE FROM public.cg_relationship WHERE tenant_id = '${schoolId}';
  DELETE FROM public.cg_entity WHERE tenant_id = '${schoolId}';
  DELETE FROM public.users WHERE id = '${userId}';
  DELETE FROM public.schools WHERE id = '${schoolId}';
`);
await authAdmin(`/admin/users/${userId}`, { method: "DELETE" });
console.log("probe_cleaned=true");
if (vitestExit !== 0) process.exit(vitestExit ?? 1);

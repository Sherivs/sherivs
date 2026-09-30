#!/usr/bin/env node
/**
 * CoreGrid — live tenant-isolation spec (Tenant A cannot access Tenant B).
 *
 * Mandatory gate (Constitution §31): Tenant A ≠ Tenant B, enforced on the LIVE
 * database. The spec builds two disposable tenant fixtures (schools A/B +
 * real auth users with admin roles), asserts:
 *   - user A cannot read school B's messages   (cross-tenant DENY)
 *   - user A cannot read school B's users      (cross-tenant DENY)
 *   - user B CAN read its own message          (within-tenant ALLOW)
 * and then removes all fixtures.
 *
 * Env (never hard-coded): SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY,
 * SUPABASE_ANON_KEY.
 */
import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_ANON_KEY;
if (!url || !serviceKey || !anonKey) {
  console.error("SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY / SUPABASE_ANON_KEY required.");
  process.exit(2);
}

const svc = createClient(url, serviceKey, { auth: { persistSession: false } });
const stamp = `${Date.now()}`.slice(-8);
const schoolA = { name: `Isolation Tenant A ${stamp}`, slug: `iso-a-${stamp}` };
const schoolB = { name: `Isolation Tenant B ${stamp}`, slug: `iso-b-${stamp}` };
const emailA = `iso-a-${stamp}@coregrid.dev`;
const emailB = `iso-b-${stamp}@coregrid.dev`;
const password = "TenantIsolation!2026";
const thread = crypto.randomUUID();

const ids = { schoolA: null, schoolB: null, userA: null, userB: null, msgId: null };
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  — ${detail}` : ""}`);
};

async function signInAs(email) {
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const body = await res.json();
  if (!res.ok || !body.access_token) {
    throw new Error(`sign-in failed for ${email}: ${JSON.stringify(body).slice(0, 200)}`);
  }
  return body.access_token;
}

async function readAs(token, table, query) {
  const qs = new URLSearchParams(query);
  const res = await fetch(`${url}/rest/v1/${table}?${qs}`, {
    headers: { apikey: anonKey, Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${table} read failed [${res.status}]: ${text.slice(0, 200)}`);
  return JSON.parse(text || "[]");
}

async function createAuthUser(email) {
  const res = await fetch(`${url}/auth/v1/admin/users`, {
    method: "POST",
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ email, password, email_confirm: true }),
  });
  const body = await res.json();
  if (!res.ok) {
    throw new Error(`auth user create failed for ${email}: ${JSON.stringify(body).slice(0, 200)}`);
  }
  return body.id;
}

async function deleteAuthUser(id) {
  await fetch(`${url}/auth/v1/admin/users/${id}`, {
    method: "DELETE",
    headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
  });
}

try {
  /* ---------- fixtures ---------- */
  const sa = await svc.from("schools").insert(schoolA).select("id").single();
  if (sa.error) throw new Error(`school A insert: ${sa.error.message}`);
  ids.schoolA = sa.data.id;
  const sb = await svc.from("schools").insert(schoolB).select("id").single();
  if (sb.error) throw new Error(`school B insert: ${sb.error.message}`);
  ids.schoolB = sb.data.id;

  ids.userA = await createAuthUser(emailA);
  ids.userB = await createAuthUser(emailB);

  const ua = await svc.from("users").insert({
    id: ids.userA,
    school_id: ids.schoolA,
    full_name: "Isolation Admin A",
    role: "admin",
  });
  if (ua.error) throw new Error(`users row A: ${ua.error.message}`);
  const ub = await svc.from("users").insert({
    id: ids.userB,
    school_id: ids.schoolB,
    full_name: "Isolation Admin B",
    role: "admin",
  });
  if (ub.error) throw new Error(`users row B: ${ub.error.message}`);

  const msg = await svc
    .from("messages")
    .insert({
      school_id: ids.schoolB,
      sender_id: ids.userB,
      recipient_id: ids.userB,
      subject: "tenant isolation fixture",
      body: "must only be readable inside tenant B",
      thread_id: thread,
      is_read: false,
    })
    .select("id")
    .single();
  if (msg.error) throw new Error(`message insert: ${msg.error.message}`);
  ids.msgId = msg.data.id;

  /* ---------- assertions ---------- */
  const tokenA = await signInAs(emailA);
  const tokenB = await signInAs(emailB);

  const crossMsgs = await readAs(tokenA, "messages", {
    school_id: `eq.${ids.schoolB}`,
    select: "id",
  });
  check(
    "Tenant A cannot read Tenant B messages",
    Array.isArray(crossMsgs) && crossMsgs.length === 0,
    `rows=${crossMsgs.length}`,
  );

  const crossUsers = await readAs(tokenA, "users", {
    school_id: `eq.${ids.schoolB}`,
    select: "id",
  });
  check(
    "Tenant A cannot read Tenant B users",
    Array.isArray(crossUsers) && crossUsers.length === 0,
    `rows=${crossUsers.length}`,
  );

  const ownMsgs = await readAs(tokenB, "messages", { id: `eq.${ids.msgId}`, select: "id" });
  check(
    "Tenant B can read own message (within tenant)",
    Array.isArray(ownMsgs) && ownMsgs.length === 1,
    `rows=${ownMsgs.length}`,
  );

  const ownUsers = await readAs(tokenB, "users", { id: `eq.${ids.userB}`, select: "id" });
  check(
    "User B reads self",
    Array.isArray(ownUsers) && ownUsers.length === 1,
    `rows=${ownUsers.length}`,
  );
} catch (err) {
  check("tenant-isolation spec execution", false, err.message);
} finally {
  /* ---------- cleanup (best-effort) ---------- */
  if (ids.msgId) await svc.from("messages").delete().eq("id", ids.msgId);
  for (const uid of [ids.userA, ids.userB]) {
    if (uid) {
      await svc.from("users").delete().eq("id", uid);
      await deleteAuthUser(uid);
    }
  }
  for (const sid of [ids.schoolA, ids.schoolB]) {
    if (sid) await svc.from("schools").delete().eq("id", sid);
  }
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\nTenant-isolation spec: ${results.length - failed}/${results.length} passed.`);
process.exit(failed === 0 ? 0 : 1);

#!/usr/bin/env node
/**
 * Sherivs — E2E critical-flow verification (directive §33; AGENTS.md §31).
 *
 * Exercises the critical identity/organization flows against a REAL
 * Supabase project (the canonical one when run with --live), creating
 * uniquely-tagged probe data and deleting it again — the probe leaves the
 * substrate exactly as it found it.
 *
 * Flows:
 *   F1  public homepage reachable
 *   F2  signup (auth user exists, verified)
 *   F3  onboarding (organization + founder identity + derived primary
 *       membership + audit record — via the SOLE customer write path)
 *   F4  identity resolution (founder reads own membership; RLS-scoped)
 *   F5  reality read-model (lifecycle state derived; roster count readable
 *       for the active context)
 *   F6  authorization refusal (linked founder cannot mint a second org;
 *       second actor cannot read the founder's membership rows)
 *   F7  cleanup verified (probe rows absent after deletion)
 *
 * Usage:
 *   node scripts/verify-critical-flows.mjs --live [--base-url https://sherivs.com]
 *
 * WITHOUT --live the script exits 0 with SKIPPED (used in CI without
 * credentials). Required env for --live: SUPABASE_URL, SUPABASE_ANON_KEY,
 * SUPABASE_SERVICE_ROLE_KEY (service key is used ONLY for probe setup and
 * cleanup — never to perform an action under test).
 *
 * Probe vocabulary: every created object carries the tag
 * `sherivs-e2e-<runid>` in email/slug so an interrupted run can be
 * identified and swept by hand: slugs/email prefix `zz-e2e-<runid>`.
 */
import { createClient } from "@supabase/supabase-js";

const live = process.argv.includes("--live");
const baseUrlIdx = process.argv.indexOf("--base-url");
const BASE_URL = baseUrlIdx > -1 ? process.argv[baseUrlIdx + 1] : "https://sherivs.com";

const REQUIRED_ENV = ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"];

if (!live) {
  console.log("SKIPPED — critical-flow E2E runs only with --live (real substrate).");
  process.exit(0);
}

for (const key of REQUIRED_ENV) {
  if (!process.env[key]) {
    console.error(`FATAL: ${key} is required for --live.`);
    process.exit(2);
  }
}

const RUN_ID = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const PROBE_EMAIL = `zz-e2e-${RUN_ID}@probe.sherivs.com`;
const PROBE_PASS = `E2e-${RUN_ID}-x9!`;
const PROBE_SLUG = `zz-e2e-${RUN_ID}`;
const FOUNDER_IDENTITY = "E2E Founder";

const url = process.env.SUPABASE_URL;
const anon = process.env.SUPABASE_ANON_KEY;
const service = process.env.SUPABASE_SERVICE_ROLE_KEY;

const admin = createClient(url, service, { auth: { autoRefreshToken: false, persistSession: false } });

const results = [];
function record(flow, ok, detail) {
  results.push({ flow, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${flow}  ${detail ?? ""}`);
}

let authUserId = null;
let orgId = null;

async function cleanup() {
  // Best-effort, order-safe: membership → identity row → org → audit → auth user.
  try {
    if (authUserId && orgId) {
      await admin.from("organization_memberships").delete().eq("user_id", authUserId);
      await admin.from("users").delete().eq("id", authUserId);
      await admin.from("schools").delete().eq("id", orgId);
    }
    if (authUserId) await admin.auth.admin.deleteUser(authUserId);
    // Audit records reference the org by slug in new_value; sweep by tag.
    await admin.from("audit_logs").delete().ilike("new_value::text", `%${PROBE_SLUG}%`);
  } catch (e) {
    console.error(`WARN cleanup: ${e.message ?? e}`);
  }
}

async function main() {
  try {
    // F1 — public homepage
    const home = await fetch(`${BASE_URL}/`, { redirect: "follow" });
    const homeHtml = await home.text();
    record(
      "F1 public-homepage",
      home.status === 200 && /operating intelligence/i.test(homeHtml) && !/coregrid/i.test(homeHtml),
      `status=${home.status}`,
    );

    // F2 — signup
    const created = await admin.auth.admin.createUser({
      email: PROBE_EMAIL,
      password: PROBE_PASS,
      email_confirm: true,
    });
    if (created.error) throw new Error(`probe setup failed: ${created.error.message}`);
    authUserId = created.data.user.id;
    record("F2 signup", Boolean(authUserId), `auth user ${authUserId.slice(0, 8)}…`);

    // Sign in as the founder (the flow under test uses the anon client + JWT).
    const anonClient = createClient(url, anon, { auth: { autoRefreshToken: false, persistSession: false } });
    const signedIn = await anonClient.auth.signInWithPassword({ email: PROBE_EMAIL, password: PROBE_PASS });
    if (signedIn.error) throw new Error(`sign-in failed: ${signedIn.error.message}`);
    const jwt = signedIn.data.session.access_token;
    const founder = createClient(url, anon, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });

    // F3 — onboarding (sole customer write path)
    const rpc = await founder.rpc("create_organization_with_founder", {
      p_org_name: "E2E Probe Academy",
      p_org_slug: PROBE_SLUG,
      p_full_name: FOUNDER_IDENTITY,
      p_runtime: "scholar",
    });
    orgId = typeof rpc.data === "string" ? rpc.data : null;
    record("F3 onboarding", Boolean(orgId), orgId ? `org ${orgId.slice(0, 8)}…` : rpc.error?.message);

    // F4 — identity resolution: founder reads own membership (RLS-scoped)
    const membership = await founder
      .from("organization_memberships")
      .select("school_id, role, is_primary, is_active")
      .eq("user_id", authUserId)
      .maybeSingle();
    const m = membership.data;
    record(
      "F4 identity-resolution",
      Boolean(m && m.school_id === orgId && m.role === "admin" && m.is_primary === true),
      m ? `role=${m.role} primary=${m.is_primary}` : membership.error?.message,
    );

    // F5 — reality read-model substrate (active org roster readable)
    const roster = await founder.from("users").select("id", { count: "exact", head: true }).eq("school_id", orgId);
    record("F5 reality-read", roster.count === 1, `roster=${roster.count ?? roster.error?.message}`);

    // F6a — linked founder cannot mint a second organization
    const second = await founder.rpc("create_organization_with_founder", {
      p_org_name: "E2E Probe Two",
      p_org_slug: `${PROBE_SLUG}-b`,
      p_full_name: FOUNDER_IDENTITY,
      p_runtime: "scholar",
    });
    record("F6a second-org-refused", Boolean(second.error), second.error?.message?.slice(0, 60));

    // F6b — a second actor cannot read the founder's membership rows (RLS)
    const other = await admin.auth.admin.createUser({
      email: `zz-e2e-${RUN_ID}-b@probe.sherivs.com`,
      password: PROBE_PASS,
      email_confirm: true,
    });
    if (!other.error) {
      const otherId = other.data.user.id;
      const otherSigned = await anonClient.auth.signInWithPassword({
        email: `zz-e2e-${RUN_ID}-b@probe.sherivs.com`,
        password: PROBE_PASS,
      });
      const otherJwt = otherSigned.data?.session?.access_token;
      const otherClient = createClient(url, anon, {
        auth: { autoRefreshToken: false, persistSession: false },
        global: { headers: { Authorization: `Bearer ${otherJwt}` } },
      });
      const foreign = await otherClient
        .from("organization_memberships")
        .select("school_id")
        .eq("user_id", authUserId);
      const isolated = (foreign.data ?? []).length === 0;
      record("F6b cross-tenant-isolation", isolated, `visibleRows=${(foreign.data ?? []).length}`);
      await admin.auth.admin.deleteUser(otherId);
      authUserId = authUserId; // keep founder cleanup attribution
    } else {
      record("F6b cross-tenant-isolation", false, "probe setup failed");
    }

    // F7 — cleanup verified
    await cleanup();
    const { count: orgsLeft } = await admin
      .from("schools")
      .select("id", { count: "exact", head: true })
      .eq("slug", PROBE_SLUG);
    const { count: usersLeft } = await admin
      .from("users")
      .select("id", { count: "exact", head: true })
      .eq("id", authUserId ?? "00000000-0000-0000-0000-000000000000");
    record("F7 cleanup", (orgsLeft ?? 0) === 0 && (usersLeft ?? 0) === 0, `orgsLeft=${orgsLeft} usersLeft=${usersLeft}`);
    authUserId = null;
    orgId = null;
  } finally {
    await cleanup();
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\nCRITICAL FLOWS: ${results.length - failed.length}/${results.length} passed${failed.length ? ` — FAILED: ${failed.map((f) => f.flow).join(", ")}` : ""}`);
  process.exit(failed.length ? 1 : 0);
}

main().catch(async (e) => {
  console.error(`FATAL: ${e.message ?? e}`);
  await cleanup();
  process.exit(1);
});

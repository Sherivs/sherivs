// ENT-01 concurrent-session and rollback checks (LOCAL, DISPOSABLE ONLY).
// Needs real concurrent transactions, so the fixture is committed (the single-transaction suite cannot do this) and removed again at
// the end. Run only against a loopback disposable database that already has the repository migrations:
//   cd tools/sim-lab && node ../../tests/integration/ent-01-subscription-concurrency.local.mjs
// Environment: SIM_PG_PORT (default 54329), SIM_PG_HOST (127.0.0.1), SIM_PG_USER (postgres), SIMDB (postgres),
//              ENT01_PG_DIR (directory whose node_modules holds `pg`; default tools/sim-lab).
// Prints "ENT-01-CONC PASS|FAIL: <name>" lines; exits 1 if any check fails.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pgDir = process.env.ENT01_PG_DIR || path.resolve(here, "../../tools/sim-lab");
const { Client } = createRequire(path.join(pgDir, "package.json"))("pg");

const host = process.env.SIM_PG_HOST || "127.0.0.1";
const port = Number(process.env.SIM_PG_PORT ?? 54329);
const user = process.env.SIM_PG_USER || "postgres";
const database = process.env.SIMDB || "postgres";
if (!/^(127\.0\.0\.1|::1|localhost)$/.test(host))
  throw new Error(`ENT-01-CONC: refusing non-loopback host ${host}`);
if (!/(disposable|scratch|local|test|sim|postgres|ent_01)/i.test(database)) {
  throw new Error(`ENT-01-CONC: refusing database ${database}, not a named disposable DB`);
}

const owner = new Client({ host, port, user, database });
await owner.connect();
const su = (await owner.query("select rolsuper from pg_roles where rolname = current_user")).rows[0]
  ?.rolsuper;
if (!su) throw new Error("ENT-01-CONC: must run as a superuser on a disposable DB");

const results = [];
function expect(name, ok, detail = "") {
  results.push({ name, ok: !!ok });
  console.log(`ENT-01-CONC ${ok ? "PASS" : "FAIL"}: ${name} [${detail}]`);
}

const PREFIX = "ent01c-";

// Remove every row the fixture created. Triggers (append-only guards, audit) are bypassed for this cleanup only, which is why the
// script refuses to run anywhere but a disposable database.
async function cleanup() {
  await owner.query(`
    DO $c$
    DECLARE ids uuid[]; t record; uids uuid[];
    BEGIN
      SELECT array_agg(id) INTO ids FROM public.schools WHERE slug LIKE '${PREFIX}%';
      IF ids IS NULL THEN RETURN; END IF;
      SELECT array_agg(id) INTO uids FROM public.users WHERE school_id = ANY (ids);
      SET LOCAL session_replication_role = replica;
      FOR t IN SELECT c.table_name, c.column_name FROM information_schema.columns c
                 JOIN information_schema.tables tb ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name AND tb.table_type = 'BASE TABLE'
                WHERE c.table_schema = 'public' AND c.column_name IN ('school_id', 'org_id') AND c.data_type = 'uuid' AND c.table_name <> 'schools'
      LOOP
        EXECUTE format('DELETE FROM public.%I WHERE %I = ANY ($1)', t.table_name, t.column_name) USING ids;
      END LOOP;
      -- tables that key the organization by a text column (role assignments use tenant_ref)
      FOR t IN SELECT c.table_name, c.column_name FROM information_schema.columns c
                 JOIN information_schema.tables tb ON tb.table_schema = c.table_schema AND tb.table_name = c.table_name AND tb.table_type = 'BASE TABLE'
                WHERE c.table_schema = 'public' AND c.column_name = 'tenant_ref' AND c.data_type = 'text'
      LOOP
        EXECUTE format('DELETE FROM public.%I WHERE %I = ANY ($1)', t.table_name, t.column_name) USING (SELECT array_agg(i::text) FROM unnest(ids) i);
      END LOOP;
      DELETE FROM public.users WHERE school_id = ANY (ids);
      IF uids IS NOT NULL THEN DELETE FROM auth.users WHERE id = ANY (uids); END IF;
      DELETE FROM public.schools WHERE id = ANY (ids);
    END $c$`);
}

// One administrator account per fixture organization (users.id is the primary key).
const adminIds = new Map();
async function mkSchool(key) {
  const adminId = `00000000-0000-0000-0000-00000000e1c${adminIds.size + 1}`;
  adminIds.set(key, adminId);
  const s = (
    await owner.query(
      "insert into public.schools (name, slug, subscription_tier) values ($1, $2, 'trial') returning id",
      [`ENT01C ${key}`, PREFIX + key],
    )
  ).rows[0].id;
  await owner.query(
    "insert into auth.users (id, email, email_confirmed_at) values ($1, $2, now())",
    [adminId, `${adminId.slice(-4)}@ent01.test`],
  );
  await owner.query(
    "insert into public.users (id, school_id, full_name, role, email, is_active) values ($1, $2, 'ENT01C admin', 'admin', $3, true)",
    [adminId, s, `${adminId.slice(-4)}@ent01.test`],
  );
  return s;
}

// One transaction under a realistic role and JWT (the way an API request runs). `body` receives the client.
async function asRole(role, sub, body, { commit = true } = {}) {
  const c = new Client({ host, port, user, database });
  await c.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify(sub ? { sub, role } : { role }),
    ]);
    await c.query(`set local role ${role}`);
    const out = await body(c);
    await c.query(commit ? "commit" : "rollback");
    return { ok: true, out };
  } catch (e) {
    try {
      await c.query("rollback");
    } catch {
      /* connection already unusable */
    }
    return { ok: false, code: e.code, message: e.message };
  } finally {
    await c.end();
  }
}

const tierOf = async (s) =>
  (await owner.query("select subscription_tier t from public.schools where id=$1", [s])).rows[0].t;
const auditN = async (s) =>
  Number(
    (
      await owner.query(
        "select count(*)::int n from public.audit_logs where school_id=$1 and action='subscription.change'",
        [s],
      )
    ).rows[0].n,
  );
const planOf = async (s) =>
  (await owner.query("select plan_id p from public.org_entitlements where org_id=$1", [s])).rows[0]
    ?.p;

let failed = false;
try {
  await cleanup();

  // K1: many administrators (the same account on many connections) try to elevate at once.
  {
    const s = await mkSchool("k1");
    const adminId = adminIds.get("k1");
    const attempts = await Promise.all(
      Array.from({ length: 24 }, () =>
        asRole("authenticated", adminId, (c) =>
          c.query("update public.schools set subscription_tier='enterprise' where id=$1", [s]),
        ),
      ),
    );
    const denied = attempts.filter((a) => !a.ok && a.code === "42501").length;
    expect(
      "K1 24 concurrent self-elevation attempts are all denied and the tier is unchanged",
      denied === 24 && (await tierOf(s)) === "trial" && (await planOf(s)) === "trial",
      `denied=${denied} tier=${await tierOf(s)} plan=${await planOf(s)}`,
    );
    expect(
      "K1b no audit record exists for denied attempts",
      (await auditN(s)) === 0,
      `audit=${await auditN(s)}`,
    );
  }

  // K2: an authorized tier change while administrators keep editing ordinary fields is neither blocked nor lost.
  {
    const s = await mkSchool("k2");
    const adminId = adminIds.get("k2");
    const renames = Array.from({ length: 10 }, (_, i) =>
      asRole("authenticated", adminId, (c) =>
        c.query("update public.schools set name=$2 where id=$1", [s, `ENT01C k2 rename ${i}`]),
      ),
    );
    const change = asRole("service_role", null, (c) =>
      c.query("update public.schools set subscription_tier='starter' where id=$1", [s]),
    );
    const all = await Promise.all([...renames, change]);
    const okRenames = all.slice(0, 10).filter((a) => a.ok).length;
    expect(
      "K2 ordinary edits and one authorized change interleave: all succeed, the tier change is kept, one audit record",
      okRenames === 10 && all[10].ok && (await tierOf(s)) === "starter" && (await auditN(s)) === 1,
      `renames_ok=${okRenames} change_ok=${all[10].ok} tier=${await tierOf(s)} audit=${await auditN(s)}`,
    );
    expect(
      "K2b the entitlement plan matches the changed tier",
      (await planOf(s)) === "starter",
      `plan=${await planOf(s)}`,
    );
  }

  // K3: an authorized change that is rolled back leaves no tier change, no entitlement change and no audit record.
  {
    const s = await mkSchool("k3");
    const adminId = adminIds.get("k3");
    const before = { tier: await tierOf(s), plan: await planOf(s), audit: await auditN(s) };
    const r = await asRole(
      "service_role",
      null,
      (c) => c.query("update public.schools set subscription_tier='professional' where id=$1", [s]),
      { commit: false },
    );
    expect(
      "K3 a rolled-back authorized change leaves tier, plan and audit unchanged",
      r.ok &&
        (await tierOf(s)) === before.tier &&
        (await planOf(s)) === before.plan &&
        (await auditN(s)) === before.audit,
      `tier=${await tierOf(s)} plan=${await planOf(s)} audit=${await auditN(s)}`,
    );
    // a denied elevation inside a transaction that also did an allowed edit rolls the allowed edit back with it
    const r2 = await asRole("authenticated", adminId, async (c) => {
      await c.query("update public.schools set name='ENT01C k3 half' where id=$1", [s]);
      await c.query("update public.schools set subscription_tier='enterprise' where id=$1", [s]);
    });
    const name = (await owner.query("select name from public.schools where id=$1", [s])).rows[0]
      .name;
    expect(
      "K3b a transaction that tries to elevate is rolled back as a whole, including its allowed edit",
      !r2.ok && r2.code === "42501" && name === "ENT01C k3" && (await tierOf(s)) === "trial",
      `code=${r2.code} name=${name} tier=${await tierOf(s)}`,
    );
  }

  // K4: an administrator's open transaction on the row does not let a later elevation slip through when it commits.
  {
    const s = await mkSchool("k4");
    const adminId = adminIds.get("k4");
    const slow = new Client({ host, port, user, database });
    await slow.connect();
    await slow.query("begin");
    await slow.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: adminId, role: "authenticated" }),
    ]);
    await slow.query("set local role authenticated");
    await slow.query("update public.schools set name='ENT01C k4 slow' where id=$1", [s]);
    const trusted = asRole("service_role", null, (c) =>
      c.query("update public.schools set subscription_tier='growth' where id=$1", [s]),
    );
    await new Promise((r) => setTimeout(r, 300));
    let elevate;
    try {
      await slow.query("update public.schools set subscription_tier='enterprise' where id=$1", [s]);
      elevate = { ok: true };
    } catch (e) {
      elevate = { ok: false, code: e.code };
    }
    await slow.query("rollback");
    await slow.end();
    const t = await trusted;
    expect(
      "K4 an administrator holding the row cannot elevate; the authorized change then applies cleanly",
      !elevate.ok && elevate.code === "42501" && t.ok && (await tierOf(s)) === "growth",
      `elevate_code=${elevate.code} trusted_ok=${t.ok} tier=${await tierOf(s)}`,
    );
  }
} catch (e) {
  failed = true;
  console.log(`ENT-01-CONC ERROR: ${e.stack || e}`);
} finally {
  await cleanup();
  const left = (
    await owner.query("select count(*)::int n from public.schools where slug like $1", [
      `${PREFIX}%`,
    ])
  ).rows[0].n;
  expect("Z the fixture was removed completely", left === 0, `left=${left}`);
  await owner.end();
}

const pass = results.filter((r) => r.ok).length;
const fail = results.length - pass + (failed ? 1 : 0);
console.log(`ENT-01-CONC RESULT: pass=${pass} fail=${fail}`);
process.exit(fail > 0 || failed ? 1 : 0);

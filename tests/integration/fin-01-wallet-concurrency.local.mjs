// FIN-01 concurrent-session checks (LOCAL, DISPOSABLE ONLY).
// Needs real concurrent transactions, so the fixture is committed (the single-transaction suite cannot do this) and removed again at
// the end. Run only against a loopback disposable database that already has the repository migrations:
//   cd tools/sim-lab && node ../../tests/integration/fin-01-wallet-concurrency.local.mjs
// Environment: SIM_PG_PORT (default 54329), SIM_PG_HOST (127.0.0.1), SIM_PG_USER (postgres), SIMDB (postgres),
//              FIN01_PG_DIR (directory whose node_modules holds `pg`; default tools/sim-lab).
// Prints "FIN-01-CONC PASS|FAIL: <name>" lines; exits 1 if any check fails.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pgDir = process.env.FIN01_PG_DIR || path.resolve(here, "../../tools/sim-lab");
const { Pool, Client } = createRequire(path.join(pgDir, "package.json"))("pg");

const host = process.env.SIM_PG_HOST || "127.0.0.1";
const port = Number(process.env.SIM_PG_PORT ?? 54329);
const user = process.env.SIM_PG_USER || "postgres";
const database = process.env.SIMDB || "postgres";
if (!/^(127\.0\.0\.1|::1|localhost)$/.test(host))
  throw new Error(`FIN-01-CONC: refusing non-loopback host ${host}`);
if (!/(disposable|scratch|local|test|sim|postgres|fin_01)/i.test(database)) {
  throw new Error(`FIN-01-CONC: refusing database ${database}, not a named disposable DB`);
}

const admin = new Client({ host, port, user, database });
await admin.connect();
const su = (await admin.query("select rolsuper from pg_roles where rolname = current_user")).rows[0]
  ?.rolsuper;
if (!su) throw new Error("FIN-01-CONC: must run as a superuser on a disposable DB");

const results = [];
function expect(name, ok, detail = "") {
  results.push({ name, ok: !!ok });
  console.log(`FIN-01-CONC ${ok ? "PASS" : "FAIL"}: ${name} [${detail}]`);
}

const PREFIX = "fin01c-";

// Remove every row the fixture created. Triggers (append-only guards, audit) are bypassed for this cleanup only, which is why the
// script refuses to run anywhere but a disposable database.
async function cleanup() {
  await admin.query(`
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
      DELETE FROM public.users WHERE school_id = ANY (ids);
      IF uids IS NOT NULL THEN DELETE FROM auth.users WHERE id = ANY (uids); END IF;
      DELETE FROM public.schools WHERE id = ANY (ids);
    END $c$`);
}

async function mkSchool(key, wallet) {
  const s = (
    await admin.query(
      "insert into public.schools (name, slug, subscription_tier) values ($1, $2, 'growth') returning id",
      [`FIN01C ${key}`, PREFIX + key],
    )
  ).rows[0].id;
  if (wallet > 0)
    await admin.query("select public._wallet_post($1, 'topup', $2, $3)", [
      s,
      wallet,
      `FIN01C-SEED-${key}`,
    ]);
  return s;
}

const pool = new Pool({ host, port, user, database, max: 40 });

// One metering call as the platform (service role) in its own transaction, like one RPC request.
async function meter(client, args) {
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE service_role");
    await client.query(
      "select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true)",
    );
    const r = await client.query("select public.meter_usage($1,$2,$3,$4,$5,$6,$7,$8) as r", [
      args.school,
      args.item ?? "sms",
      args.qty ?? 1,
      args.ref,
      args.student ?? null,
      args.priority ?? "normal",
      args.year ?? null,
      args.term ?? null,
    ]);
    await client.query("COMMIT");
    return { ok: true, r: r.rows[0].r };
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* connection already reset */
    }
    return { ok: false, code: e.code, msg: String(e.message) };
  }
}

// Fire n calls at once: every connection is checked out first, then all calls are released together.
async function burst(n, make) {
  const clients = await Promise.all(Array.from({ length: n }, () => pool.connect()));
  try {
    return await Promise.all(clients.map((c, i) => meter(c, make(i))));
  } finally {
    clients.forEach((c) => c.release());
  }
}
const count = (rs, f) => rs.filter(f).length;
const insufficient = (r) => !r.ok && /insufficient_wallet/.test(r.msg);

async function snapshot(school) {
  const w =
    (await admin.query("select balance from public.school_wallets where school_id=$1", [school]))
      .rows[0]?.balance ?? "0";
  const l = (
    await admin.query(
      "select coalesce(sum(amount),0) s, count(*) filter (where kind='usage') u from public.wallet_ledger where school_id=$1",
      [school],
    )
  ).rows[0];
  const e = (
    await admin.query("select count(*) n from public.usage_events where school_id=$1", [school])
  ).rows[0].n;
  return { balance: Number(w), ledgerSum: Number(l.s), usageLines: Number(l.u), events: Number(e) };
}

try {
  await cleanup();

  // C1: sixteen concurrent distinct sends against a wallet that affords ten: exactly ten succeed, none overdraws.
  {
    const s = await mkSchool("c1", 100);
    const rs = await burst(16, (i) => ({ school: s, ref: `C1-${i}` }));
    const snap = await snapshot(s);
    expect(
      "C1 16 concurrent NGN10 sends on a NGN100 wallet: exactly 10 succeed, 6 refused, balance 0, never negative",
      count(rs, (r) => r.ok) === 10 &&
        count(rs, insufficient) === 6 &&
        snap.balance === 0 &&
        snap.balance === snap.ledgerSum &&
        snap.usageLines === 10 &&
        snap.events === 10,
      `ok=${count(rs, (r) => r.ok)} refused=${count(rs, insufficient)} balance=${snap.balance} ledger=${snap.ledgerSum} events=${snap.events}`,
    );
  }

  // C2: the same reference sent twelve times at once is charged once, and no caller gets an error (idempotent, not a unique violation).
  {
    const s = await mkSchool("c2", 1000);
    const rs = await burst(12, () => ({ school: s, ref: "C2-SAME" }));
    const snap = await snapshot(s);
    expect(
      "C2 12 concurrent calls with one reference charge exactly once and every caller gets a clean answer",
      snap.usageLines === 1 &&
        snap.balance === 990 &&
        snap.events === 1 &&
        count(rs, (r) => r.ok) === 12,
      `ok=${count(rs, (r) => r.ok)} errors=${
        rs
          .filter((r) => !r.ok)
          .map((r) => r.code)
          .join(",") || "none"
      } balance=${snap.balance} usageLines=${snap.usageLines}`,
    );
  }

  // C3: concurrent safety sends cannot push the wallet past the bounded overdraft (default NGN1000, five pages = NGN50 each).
  {
    const s = await mkSchool("c3", 0);
    const rs = await burst(30, (i) => ({ school: s, ref: `C3-${i}`, qty: 5, priority: "safety" }));
    const snap = await snapshot(s);
    expect(
      "C3 30 concurrent NGN50 safety sends on an empty wallet: the balance stops at the NGN1000 limit",
      snap.balance >= -1000 &&
        snap.balance === snap.ledgerSum &&
        count(rs, (r) => r.ok) === 20 &&
        count(rs, insufficient) === 10,
      `ok=${count(rs, (r) => r.ok)} refused=${count(rs, insufficient)} balance=${snap.balance}`,
    );
  }

  // C4: the per-student daily cap (growth plan: 1 SMS per student per day) holds under concurrency.
  {
    const s = await mkSchool("c4", 1000);
    const stu = (
      await admin.query("insert into public.students (school_id) values ($1) returning id", [s])
    ).rows[0].id;
    const rs = await burst(12, (i) => ({ school: s, ref: `C4-${i}`, student: stu }));
    const snap = await snapshot(s);
    expect(
      "C4 12 concurrent sends for one student on a 1-per-day plan: exactly one is metered",
      count(rs, (r) => r.ok) === 1 && snap.events === 1 && snap.balance === 990,
      `ok=${count(rs, (r) => r.ok)} events=${snap.events} balance=${snap.balance}`,
    );
  }

  // C5: the term pool is consumed exactly to its allowance (no overshoot, no partial debit) when the wallet is empty.
  {
    const s = await mkSchool("c5", 0);
    await admin.query(
      "insert into public.term_usage_pools (school_id, academic_year, term, item, allowance) values ($1,'F1','T1','sms',10)",
      [s],
    );
    const rs = await burst(20, (i) => ({ school: s, ref: `C5-${i}`, year: "F1", term: "T1" }));
    const used = Number(
      (await admin.query("select used from public.term_usage_pools where school_id=$1", [s]))
        .rows[0].used,
    );
    const snap = await snapshot(s);
    expect(
      "C5 20 concurrent sends against a 10-message pool and an empty wallet: exactly 10 succeed, the pool ends at 10, nothing is charged",
      count(rs, (r) => r.ok) === 10 &&
        count(rs, insufficient) === 10 &&
        used === 10 &&
        snap.balance === 0 &&
        snap.events === 10,
      `ok=${count(rs, (r) => r.ok)} refused=${count(rs, insufficient)} poolUsed=${used} balance=${snap.balance} events=${snap.events}`,
    );
  }

  // C6: a top-up credited while debits are running is never lost (the wallet row lock serializes them).
  {
    const s = await mkSchool("c6", 50);
    const clients = await Promise.all(Array.from({ length: 11 }, () => pool.connect()));
    try {
      const jobs = clients.map((c, i) =>
        i === 0
          ? (async () => {
              try {
                await c.query("BEGIN");
                await c.query("SET LOCAL ROLE service_role");
                await c.query(
                  "select set_config('request.jwt.claims', '{\"role\":\"service_role\"}', true)",
                );
                await c.query("select public.wallet_credit_topup($1, 500, 'FIN01C-TOPUP-6')", [s]);
                await c.query("COMMIT");
                return { ok: true };
              } catch (e) {
                try {
                  await c.query("ROLLBACK");
                } catch {}
                return { ok: false, msg: String(e.message) };
              }
            })()
          : meter(c, { school: s, ref: `C6-${i}` }),
      );
      const rs = await Promise.all(jobs);
      const snap = await snapshot(s);
      expect(
        "C6 a top-up racing ten NGN10 debits: the final balance is seed + topup - charged, to the naira",
        snap.balance === 50 + 500 - 10 * snap.usageLines &&
          snap.balance === snap.ledgerSum &&
          rs[0].ok,
        `balance=${snap.balance} usageLines=${snap.usageLines} ledger=${snap.ledgerSum}`,
      );
    } finally {
      clients.forEach((c) => c.release());
    }
  }
} finally {
  await pool.end();
  let cleanupOk = true;
  try {
    await cleanup();
  } catch (e) {
    cleanupOk = false;
    console.error(`FIN-01-CONC cleanup failed: ${e.message}`);
  }
  const left = (
    await admin.query(`select count(*)::int n from public.schools where slug like '${PREFIX}%'`)
  ).rows[0].n;
  expect("C7 the fixture was removed completely", cleanupOk && left === 0, `schools left=${left}`);
  await admin.end();
}

const pass = results.filter((r) => r.ok).length;
const fail = results.length - pass;
console.log(`FIN-01-CONC RESULT: pass=${pass} fail=${fail}`);
process.exit(fail ? 1 : 0);

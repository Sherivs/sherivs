// COMMS-03 concurrent-worker and rollback checks (LOCAL, DISPOSABLE ONLY).
// Needs real concurrent transactions, so the fixture is committed (the single-transaction suite cannot do this) and removed again at
// the end. Run only against a loopback disposable database that already has the repository migrations (including FIN-01 and ENT-01
// and the COMMS-03 migration):
//   cd tools/sim-lab && node ../../tests/integration/comms-03-sms-concurrency.local.mjs
// Environment: SIM_PG_PORT (default 54329), SIM_PG_HOST (127.0.0.1), SIM_PG_USER (postgres), SIMDB (postgres),
//              COMMS03_PG_DIR (directory whose node_modules holds `pg`; default tools/sim-lab).
// Prints "COMMS-03-CONC PASS|FAIL: <name>" lines; exits 1 if any check fails.
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pgDir = process.env.COMMS03_PG_DIR || path.resolve(here, "../../tools/sim-lab");
const { Client } = createRequire(path.join(pgDir, "package.json"))("pg");

const host = process.env.SIM_PG_HOST || "127.0.0.1";
const port = Number(process.env.SIM_PG_PORT ?? 54329);
const user = process.env.SIM_PG_USER || "postgres";
const database = process.env.SIMDB || "postgres";
if (!/^(127\.0\.0\.1|::1|localhost)$/.test(host))
  throw new Error(`COMMS-03-CONC: refusing non-loopback host ${host}`);
if (!/(disposable|scratch|local|test|sim|postgres|comms_03)/i.test(database)) {
  throw new Error(`COMMS-03-CONC: refusing database ${database}, not a named disposable DB`);
}

const owner = new Client({ host, port, user, database });
await owner.connect();
const su = (await owner.query("select rolsuper from pg_roles where rolname = current_user")).rows[0]
  ?.rolsuper;
if (!su) throw new Error("COMMS-03-CONC: must run as a superuser on a disposable DB");
if (
  !(await owner.query("select to_regprocedure('public.comms_sms_claim(uuid,uuid,text,text)') p"))
    .rows[0].p
) {
  throw new Error("COMMS-03-CONC: the COMMS-03 migration is not applied on this database");
}

const results = [];
function expect(name, ok, detail = "") {
  results.push({ name, ok: !!ok });
  console.log(`COMMS-03-CONC ${ok ? "PASS" : "FAIL"}: ${name} [${detail}]`);
}

const PREFIX = "c03c-";

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
      DELETE FROM public.users WHERE school_id = ANY (ids);
      IF uids IS NOT NULL THEN DELETE FROM auth.users WHERE id = ANY (uids); END IF;
      DELETE FROM public.schools WHERE id = ANY (ids);
    END $c$`);
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
const svc = (sql, params = []) => asRole("service_role", null, (c) => c.query(sql, params));
const svcRows = async (sql, params = []) => (await svc(sql, params)).out?.rows?.[0];

let seq = 0;
const claimToken = () => `claim:${crypto.randomUUID()}`;

// Organization with funded wallet, live SMS on, a parent recipient and two admins; returns queued message ids.
async function fixture(key, messages) {
  seq += 1;
  const tag = String(seq).padStart(2, "0");
  const s = (
    await owner.query(
      "insert into public.schools (name, slug, subscription_tier) values ($1, $2, 'growth') returning id",
      [`C03C ${key}`, PREFIX + key],
    )
  ).rows[0].id;
  const ids = ["a1", "a2", "p"].map((r, i) => `00000000-0000-0000-0000-0000000c3${tag}${i}`);
  const phones = ["a1", "a2", "p"].map((r, i) => `234805${tag}0${i}00`);
  for (let i = 0; i < 3; i += 1) {
    await owner.query(
      "insert into auth.users (id, email, phone, email_confirmed_at, phone_confirmed_at) values ($1, $2, $3, now(), now())",
      [ids[i], `c03c-${tag}-${i}@c03.test`, phones[i]],
    );
    await owner.query(
      "insert into public.users (id, school_id, full_name, role, email, phone, is_active) values ($1, $2, $3, $4, $5, $6, true)",
      [ids[i], s, `C03C ${key} ${i}`, i < 2 ? "admin" : "parent", `c03c-${tag}-${i}@c03.test`, phones[i]],
    );
  }
  await svc("select public.wallet_credit_topup($1, 1000, $2)", [s, `C03C-TOPUP-${key}`]);
  await svc("select public.flag_set('sms_live', $1, true)", [s]);
  const msgs = [];
  for (let n = 0; n < messages; n += 1) {
    const pid = crypto.randomUUID();
    await owner.query(
      `insert into public.comms_send_proposals (id, org_id, school_id, channel, template_code, language, category, audience_spec,
         recipient_user_ids, template_vars, draft_body, status, proposed_by, approved_by, approved_at, released_at)
       values ($1, $2, $2, 'sms', 'fee_reminder', 'en', 'utility', '{"kind":"user"}', $3, '{}', 'x', 'released', $4, $5, now(), now())`,
      [pid, s, [ids[2]], ids[0], ids[1]],
    );
    const r = await svcRows(
      `select (public.comms_send($1, 'sms', $2, 'fee_reminder', '{"student":"K","amount":"1","link":"https://x.test"}'::jsonb, null, 'normal', $3, 'en'))->>'id' id`,
      [s, phones[2], `${pid}:${ids[2]}`],
    );
    msgs.push(r.id);
  }
  return { s, msgs, parent: ids[2], phone: phones[2], admins: [ids[0], ids[1]] };
}

const balance = async (s) =>
  Number((await owner.query("select balance from public.school_wallets where school_id=$1", [s])).rows[0].balance);
const msgRow = async (id) =>
  (await owner.query("select status, provider_ref, error from public.outbound_messages where id=$1", [id])).rows[0];
const count = async (sql, p) => Number((await owner.query(sql, p)).rows[0].n);
const reversals = (s) =>
  count("select count(*)::int n from public.usage_event_reversals where school_id=$1", [s]);
const refundLedger = (s) =>
  count("select count(*)::int n from public.wallet_ledger where school_id=$1 and kind='refund'", [s]);

let failed = false;
try {
  await cleanup();

  // K1: many workers race to claim one message: exactly one wins; the rest get false and change nothing.
  {
    const f = await fixture("k1", 1);
    const attempts = await Promise.all(
      Array.from({ length: 24 }, () =>
        svcRows("select public.comms_sms_claim($1, $2, $3, 'bulksmsnigeria') ok", [f.msgs[0], f.s, claimToken()]),
      ),
    );
    const winners = attempts.filter((a) => a?.ok === true).length;
    const row = await msgRow(f.msgs[0]);
    expect(
      "K1 24 concurrent workers claim one message: exactly one wins",
      winners === 1 && row.status === "queued" && /^claim:/.test(row.provider_ref),
      `winners=${winners} ref=${row.provider_ref}`,
    );
  }

  // K2: the same refund requested by many operators at once credits the wallet once, with one reversal and one ledger row.
  {
    const f = await fixture("k2", 1);
    const before = await balance(f.s);
    const attempts = await Promise.all(
      Array.from({ length: 12 }, () =>
        svc("select public.comms_refund_unsubmitted($1, $2, 'cancelled_unsent') r", [f.msgs[0], f.s]),
      ),
    );
    const refunded = attempts.filter((a) => a.ok && a.out.rows[0].r.refunded === true).length;
    expect(
      "K2 12 concurrent refund requests credit the wallet exactly once (NGN10), one reversal row, one ledger row",
      refunded === 1 && (await balance(f.s)) === before + 10 && (await reversals(f.s)) === 1 && (await refundLedger(f.s)) === 1,
      `refunded=${refunded} delta=${(await balance(f.s)) - before} reversals=${await reversals(f.s)} ledger=${await refundLedger(f.s)}`,
    );
  }

  // K3: concurrent settles by the claim holder (failed+refund) and by a stranger: only the holder's takes effect, refund once.
  {
    const f = await fixture("k3", 1);
    const claim = claimToken();
    await svc("select public.comms_sms_claim($1, $2, $3, 'bulksmsnigeria')", [f.msgs[0], f.s, claim]);
    const before = await balance(f.s);
    const attempts = await Promise.all([
      ...Array.from({ length: 6 }, () =>
        svcRows(
          "select public.comms_sms_settle($1, $2, $3, 'failed', null, null, 'rej', 'provider_rejected') ok",
          [f.msgs[0], f.s, claim],
        ),
      ),
      ...Array.from({ length: 6 }, () =>
        svcRows(
          "select public.comms_sms_settle($1, $2, $3, 'sent', 'bulksmsnigeria', 'prov-x', null) ok",
          [f.msgs[0], f.s, claimToken()],
        ),
      ),
    ]);
    const winners = attempts.filter((a) => a?.ok === true).length;
    const row = await msgRow(f.msgs[0]);
    expect(
      "K3 racing settles (holder vs strangers): one wins, the message is failed, refunded once",
      winners === 1 && row.status === "failed" && row.provider_ref === null && (await balance(f.s)) === before + 10 && (await reversals(f.s)) === 1,
      `winners=${winners} status=${row.status} delta=${(await balance(f.s)) - before}`,
    );
  }

  // K4: a held message reconciled by many operators at once: one resolution wins, refunded once.
  {
    const f = await fixture("k4", 1);
    const claim = claimToken();
    await svc("select public.comms_sms_claim($1, $2, $3, 'bulksmsnigeria')", [f.msgs[0], f.s, claim]);
    await svc("select public.comms_sms_hold($1, $2, $3, 'provider_error', 'http 502')", [f.msgs[0], f.s, claim]);
    const before = await balance(f.s);
    const attempts = await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        i % 2 === 0
          ? svc("select public.comms_sms_reconcile($1, $2, 'not_accepted', null, 'checked') r", [f.msgs[0], f.s])
          : svc("select public.comms_sms_reconcile($1, $2, 'accepted', $3, 'checked') r", [f.msgs[0], f.s, `prov-${i}`]),
      ),
    );
    const winners = attempts.filter((a) => a.ok).length;
    const row = await msgRow(f.msgs[0]);
    const delta = (await balance(f.s)) - before;
    const consistent =
      (row.status === "failed" && delta === 10 && (await reversals(f.s)) === 1) ||
      (row.status === "sent" && delta === 0 && (await reversals(f.s)) === 0);
    expect(
      "K4 10 racing reconciliations of one held message: exactly one resolution wins and the money matches it",
      winners === 1 && consistent,
      `winners=${winners} status=${row.status} delta=${delta}`,
    );
  }

  // K5: delivery reports race (delivered vs failed, replayed): the first one wins, once, and nothing refunds.
  {
    const f = await fixture("k5", 1);
    const claim = claimToken();
    await svc("select public.comms_sms_claim($1, $2, $3, 'bulksmsnigeria')", [f.msgs[0], f.s, claim]);
    await svc("select public.comms_sms_settle($1, $2, $3, 'sent', 'bulksmsnigeria', 'prov-5', null)", [f.msgs[0], f.s, claim]);
    const before = await balance(f.s);
    const attempts = await Promise.all(
      Array.from({ length: 16 }, (_, i) =>
        svcRows("select public.comms_sms_report_delivery($1, $2, $3, 'DLR') ok", [f.msgs[0], f.s, i % 2 ? "delivered" : "failed"]),
      ),
    );
    const winners = attempts.filter((a) => a?.ok === true).length;
    const row = await msgRow(f.msgs[0]);
    expect(
      "K5 16 racing delivery reports: exactly one applies, the final state is terminal, nothing is refunded",
      winners === 1 && ["delivered", "failed"].includes(row.status) && (await balance(f.s)) === before && (await reversals(f.s)) === 0,
      `winners=${winners} status=${row.status}`,
    );
  }

  // K6: rollback atomicity: a settle+refund inside a transaction that later fails leaves the message claimed and the wallet untouched.
  {
    const f = await fixture("k6", 1);
    const claim = claimToken();
    await svc("select public.comms_sms_claim($1, $2, $3, 'bulksmsnigeria')", [f.msgs[0], f.s, claim]);
    const before = await balance(f.s);
    const r = await asRole("service_role", null, async (c) => {
      await c.query(
        "select public.comms_sms_settle($1, $2, $3, 'failed', null, null, 'rej', 'provider_rejected')",
        [f.msgs[0], f.s, claim],
      );
      await c.query("select 1/0");
    });
    const row = await msgRow(f.msgs[0]);
    expect(
      "K6 a failed transaction rolls back the close and the refund together",
      !r.ok && row.provider_ref === claim && row.status === "queued" && (await balance(f.s)) === before && (await reversals(f.s)) === 0 && (await refundLedger(f.s)) === 0,
      `ref=${row.provider_ref} delta=${(await balance(f.s)) - before}`,
    );
    const again = await svcRows(
      "select public.comms_sms_settle($1, $2, $3, 'failed', null, null, 'rej', 'provider_rejected') ok",
      [f.msgs[0], f.s, claim],
    );
    expect(
      "K6b after the rollback the same settle still works and refunds exactly once",
      again?.ok === true && (await balance(f.s)) === before + 10 && (await reversals(f.s)) === 1,
      `delta=${(await balance(f.s)) - before}`,
    );
  }

  // K7: a plan downgrade racing many claims: every claim after the downgrade commits is refused; none after it succeeds.
  {
    const f = await fixture("k7", 6);
    const claims = Array.from({ length: 6 }, (_, i) =>
      svcRows("select public.comms_sms_claim($1, $2, $3, 'bulksmsnigeria') ok", [f.msgs[i], f.s, claimToken()]),
    );
    await owner.query("update public.schools set subscription_tier='trial' where id=$1", [f.s]);
    const early = (await Promise.all(claims)).filter((a) => a?.ok === true).length;
    const late = await Promise.all(
      f.msgs.map(() => svcRows("select public.comms_sms_claim($1, $2, $3, 'bulksmsnigeria') ok", [f.msgs[0], f.s, claimToken()])),
    );
    const claimedAfter = late.filter((a) => a?.ok === true).length;
    const unclaimedStillQueued = await count(
      "select count(*)::int n from public.outbound_messages where org_id=$1 and status='queued' and provider_ref is null",
      [f.s],
    );
    expect(
      "K7 once the plan is downgraded no further claim succeeds (the unclaimed messages stay queued, unsent)",
      claimedAfter === 0 && unclaimedStillQueued === 6 - early,
      `claimed_before_or_during=${early} claimed_after_downgrade=${claimedAfter} still_unclaimed=${unclaimedStillQueued}`,
    );
  }

  // K8: the existing idempotent-replay behaviour of comms_send is not weakened: the same reference sent 8 times at once
  // yields one message and one charge.
  {
    const f = await fixture("k8", 0);
    const pid = crypto.randomUUID();
    await owner.query(
      `insert into public.comms_send_proposals (id, org_id, school_id, channel, template_code, language, category, audience_spec,
         recipient_user_ids, template_vars, draft_body, status, proposed_by, approved_by, approved_at, released_at)
       values ($1, $2, $2, 'sms', 'fee_reminder', 'en', 'utility', '{"kind":"user"}', $3, '{}', 'x', 'released', $4, $5, now(), now())`,
      [pid, f.s, [f.parent], f.admins[0], f.admins[1]],
    );
    const before = await balance(f.s);
    const ref = `${pid}:${f.parent}`;
    const attempts = await Promise.all(
      Array.from({ length: 8 }, () =>
        svc(
          `select (public.comms_send($1, 'sms', $2, 'fee_reminder', '{"student":"K","amount":"1","link":"https://x.test"}'::jsonb, null, 'normal', $3, 'en'))->>'id' id`,
          [f.s, f.phone, ref],
        ),
      ),
    );
    const rows = await count("select count(*)::int n from public.outbound_messages where org_id=$1 and reference=$2", [f.s, ref]);
    const delta = (await balance(f.s)) - before;
    expect(
      "K8 8 concurrent sends of one reference produce one message and one NGN10 charge",
      rows === 1 && delta === -10,
      `messages=${rows} delta=${delta} ok=${attempts.filter((a) => a.ok).length}`,
    );
  }
} catch (e) {
  failed = true;
  console.log(`COMMS-03-CONC ERROR: ${e.stack || e}`);
} finally {
  await cleanup();
  const left = (
    await owner.query("select count(*)::int n from public.schools where slug like $1", [`${PREFIX}%`])
  ).rows[0].n;
  expect("Z the fixture was removed completely", left === 0, `left=${left}`);
  await owner.end();
}

const pass = results.filter((r) => r.ok).length;
const fail = results.length - pass + (failed ? 1 : 0);
console.log(`COMMS-03-CONC RESULT: pass=${pass} fail=${fail}`);
process.exit(fail === 0 ? 0 : 1);

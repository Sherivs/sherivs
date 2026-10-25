// SHERIVS-PAY-SPLIT sim: Paystack split checkout + once-per-term share + cash wallet debit (local sim DB only, TEST key semantics).
import pg from "pg"; import fs from "node:fs";
const c = new pg.Client({ host: "127.0.0.1", port: Number(process.env.SIM_PG_PORT ?? 54329), user: "postgres" }); await c.connect();
const results = []; const rec = (area, name, pass, detail) => { results.push({ area, name, pass, detail }); console.log(`${pass ? "PASS" : "FAIL"} [${area}] ${name} :: ${detail}`); };
const as = async (role, sql, p = []) => { await c.query(`SET LOCAL ROLE ${role}`); await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ role })]);
  try { await c.query("SAVEPOINT s"); const r = await c.query(sql, p); await c.query("RELEASE SAVEPOINT s"); return { ok: true, rows: r.rows, row: r.rows[0] }; }
  catch (e) { await c.query("ROLLBACK TO SAVEPOINT s"); return { ok: false, err: e.message }; } finally { await c.query("RESET ROLE"); } };
const svc = (sql, p) => as("service_role", sql, p);
const asUser = async (uid, sql, p = []) => { await c.query("SET LOCAL ROLE authenticated"); await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated" })]);
  try { await c.query("SAVEPOINT s"); const r = await c.query(sql, p); await c.query("RELEASE SAVEPOINT s"); return { ok: true, rows: r.rows, row: r.rows[0] }; }
  catch (e) { await c.query("ROLLBACK TO SAVEPOINT s"); return { ok: false, err: e.message }; } finally { await c.query("RESET ROLE"); } };
await c.query("BEGIN");
try {
  const schools = (await c.query("select id from schools order by created_at limit 4")).rows.map((r) => r.id);
  const [S, S2, S3, S4] = schools;
  const studs = async (s, n) => (await c.query("select id from students where school_id=$1 order by id limit $2", [s, n])).rows.map((r) => r.id);
  const [st1, st2, st3, st4, st5] = await studs(S, 5);
  const Y = "2031/2032", T = "first";
  const bursar = (await c.query("select id from users where school_id=$1 and role in ('admin','principal') order by id limit 1", [S])).rows[0].id;
  const cash = (sql, p) => asUser(bursar, sql, p);
  await c.query("update schools set subscription_tier='growth' where id=$1", [S]);
  await c.query(`insert into org_payment_subaccounts (org_id, subaccount_code, settlement_bank_code, account_last4, account_ciphertext, account_wrapped_dek, key_version, platform_charge_kobo, active)
                 values ($1,'ACCT_simschool1','058','1234','ct','dek','v1',0,true)`, [S]);
  const mkFee = async (st, amt, type = "tuition", school = S) => (await c.query(
    "insert into fees (school_id, student_id, fee_type, amount, term, academic_year, status, paystack_reference) values ($1,$2,$3,$4,$5,$6,'unpaid',$7) returning id",
    [school, st, type, amt, T, Y, null])).rows[0].id;
  const setRef = (fee, ref) => c.query("update fees set paystack_reference=$2 where id=$1", [fee, ref]);
  const plan = async (fee, ref, hold = "45 minutes") => { await setRef(fee, ref); return (await svc("select public.fee_checkout_split($1,$2,$3::interval) p", [fee, ref, hold])).row?.p; };
  const settle = async (ref, sub, share) => (await svc("select public.fee_split_settle($1,$2,$3) r", [ref, sub, share])).row?.r;
  const wallet = async (s) => Number((await c.query("select coalesce((select balance from school_wallets where school_id=$1),0) b", [s])).rows[0].b);
  const share = async (s, st) => (await c.query("select status, payment_reference, amount from student_platform_fee_ledger where school_id=$1 and student_id=$2 and academic_year=$3 and term=$4 and fee_type='platform_share'", [s, st, Y, T])).rows[0];

  // 1. amount = fee_amount_due (A05b relief function), share = growth ₦3,000, bearer main account
  const f1 = await mkFee(st1, 60000);
  const p1 = await plan(f1, "uos_sim_1");
  const due1 = Number((await svc("select public.fee_amount_due($1) d", [f1])).row.d);
  rec("split", "Amount charged is fee_amount_due; Growth share ₦3,000 to Sherivs; bearer = main account; school subaccount",
    p1?.split === true && p1.amount_kobo === Math.round(due1 * 100) && p1.share_kobo === 300000 && p1.bearer === "account" && p1.subaccount_code === "ACCT_simschool1",
    JSON.stringify({ due1, ...p1 }));
  rec("split", "School receives its fee minus the platform fee, with no Paystack deduction (Sherivs bears it)", p1.amount_kobo - p1.share_kobo === 5700000, `school gets ${(p1.amount_kobo - p1.share_kobo) / 100}`);

  // 2. second checkout same student/term while first is pending: no share
  const f1b = await mkFee(st1, 18000, "uniform");
  const p1b = await plan(f1b, "uos_sim_1b");
  rec("once", "A second checkout in the same term carries no share while the first holds it", p1b.share_kobo === 0, JSON.stringify(p1b));
  // 3. settle first: collected; then any further checkout -> 0
  await c.query("update fees set status='paid' where id=$1", [f1]);
  const s1 = await settle("uos_sim_1", "ACCT_simschool1", 300000);
  const p1c = await plan(f1b, "uos_sim_1c");
  const l1 = await share(S, st1);
  rec("once", "After settlement the share is collected once; later payments that term carry no share", s1?.share_collected === true && l1.status === "collected" && p1c.share_kobo === 0, JSON.stringify({ s1, l1, p1c: p1c.share_kobo }));
  // 4. replay
  const s1r = await settle("uos_sim_1", "ACCT_simschool1", 300000);
  rec("once", "Replayed settlement is a no-op", s1r?.duplicate === true, JSON.stringify(s1r));

  // 5. expired hold can be retaken
  const f2 = await mkFee(st2, 50000); await plan(f2, "uos_sim_2");
  const f2b = await mkFee(st2, 20000, "levy:bus"); const p2b = await plan(f2b, "uos_sim_2b", "0 seconds");
  rec("once", "An abandoned checkout's hold expires and the next checkout takes the share", p2b.share_kobo === 300000, JSON.stringify(p2b));
  // 6. late completion of the expired one: share already taken -> school wallet credited back
  await c.query("update fees set status='paid' where id=$1", [f2b]); await settle("uos_sim_2b", "ACCT_simschool1", 300000);
  const w0 = await wallet(S); await c.query("update fees set status='paid' where id=$1", [f2]);
  const s2 = await settle("uos_sim_2", "ACCT_simschool1", 300000); const w1 = await wallet(S);
  rec("once", "If two checkouts both carried the share (late completion), the school is credited back the extra", s2?.reason === "share_already_collected" && w1 - w0 === 3000, JSON.stringify({ s2, credit: w1 - w0 }));

  // 7. cash: wallet debited once per student/term
  const wc0 = await wallet(S);
  const c1 = (await cash("select public.record_cash_payment($1,$2,$3,$4,10000,'cash',null,'R-1') r", [S, st3, Y, T])).row.r;
  const c2 = (await cash("select public.record_cash_payment($1,$2,$3,$4,5000,'cash',null,'R-2') r", [S, st3, Y, T])).row.r;
  const wc1 = await wallet(S);
  rec("cash", "Cash payments debit the school wallet ₦3,000 once per student per term", c1.share_debited === true && c2.share_debited === false && wc0 - wc1 === 3000, JSON.stringify({ c1, c2, debit: wc0 - wc1 }));
  // 8. cash first then online -> no share online
  const f3 = await mkFee(st3, 40000); const p3 = await plan(f3, "uos_sim_3");
  rec("cash", "After a cash payment took the term share, online checkout carries none", p3.share_kobo === 0, JSON.stringify(p3));
  // 9. online pending then cash then online settles -> wallet refund
  const f4 = await mkFee(st4, 40000); const p4 = await plan(f4, "uos_sim_4");
  const wa = await wallet(S); await cash("select public.record_cash_payment($1,$2,$3,$4,1000,'cash',null,'R-3')", [S, st4, Y, T]);
  await c.query("update fees set status='paid' where id=$1", [f4]); const s4 = await settle("uos_sim_4", "ACCT_simschool1", p4.share_kobo);
  const wb = await wallet(S); const l4 = await share(S, st4);
  rec("cash", "Cash during a pending online checkout: the wallet debit is refunded when the split share settles (never twice)", s4.wallet_refunded === true && wb === wa && l4.payment_reference === "paystack:uos_sim_4", JSON.stringify({ s4, net: wb - wa, l4 }));

  // 10. small payment cannot carry the share
  const f5 = await mkFee(st5, 2500); const p5 = await plan(f5, "uos_sim_5");
  rec("split", "A payment smaller than the share is not split (school must receive money); share stays owed", p5.share_kobo === 0 && p5.split === true, JSON.stringify(p5));

  // 11. tiers + negotiated enterprise + no subaccount
  const tierShare = async (tier) => { await c.query("update schools set subscription_tier=$2 where id=$1", [S2, tier]); return Number((await svc("select public.platform_share_per_student($1) v", [S2])).row.v); };
  const tiers = { starter: await tierShare("starter"), growth: await tierShare("growth"), professional: await tierShare("professional"), trial: await tierShare("trial") };
  await c.query("update schools set subscription_tier='enterprise' where id=$1", [S2]);
  await svc("select public.set_school_platform_price($1, 4500, 'negotiated')", [S2]);
  const ent = Number((await svc("select public.platform_share_per_student($1) v", [S2])).row.v);
  rec("tiers", "Starter ₦2k, Growth ₦3k, Professional ₦5k, Trial 0; Enterprise uses the negotiated price", tiers.starter === 2000 && tiers.growth === 3000 && tiers.professional === 5000 && tiers.trial === 0 && ent === 4500, JSON.stringify({ ...tiers, ent }));
  const s2st = (await studs(S2, 1))[0]; const f6 = await mkFee(s2st, 30000, "tuition", S2); const p6 = await plan(f6, "uos_sim_6");
  rec("split", "School without an active subaccount gets a plain (non-split) checkout", p6.split === false && p6.share_kobo === 0, JSON.stringify(p6));
  await c.query(`insert into org_payment_subaccounts (org_id, subaccount_code, settlement_bank_code, account_last4, account_ciphertext, account_wrapped_dek, key_version, platform_charge_kobo, active)
                 values ($1,'ACCT_simschool2','058','9876','ct','dek','v1',0,true)`, [S2]);
  const f7 = await mkFee(s2st, 30000, "uniform", S2); const p7 = await plan(f7, "uos_sim_7");
  rec("tiers", "Enterprise negotiated ₦4,500 flows into the split", p7.share_kobo === 450000, JSON.stringify(p7));

  // 12. security
  const subMis = await settle("uos_sim_7", "ACCT_simschool1", 450000);
  const anon = await as("anon", "select public.fee_checkout_split($1,'uos_sim_x')", [f7]);
  const authd = await as("authenticated", "select public.fee_checkout_split($1,'uos_sim_x')", [f7]);
  const authSettle = await as("authenticated", "select public.fee_split_settle('uos_sim_7','ACCT_simschool2',1)");
  const authPrice = await as("authenticated", "select public.set_school_platform_price($1, 1, 'x')", [S2]);
  rec("security", "Wrong subaccount refused; anon/authenticated cannot plan, settle, or set prices", subMis?.reason === "subaccount_mismatch" && !anon.ok && !authd.ok && !authSettle.ok && !authPrice.ok,
    `mismatch ${subMis?.reason}; anon ${anon.err?.slice(0, 40)}; auth ${authd.err?.slice(0, 40)}; settle ${authSettle.err?.slice(0, 40)}; price ${authPrice.err?.slice(0, 40)}`);
  // 13. concurrency: 20 parallel-style checkouts for one student -> exactly one carries the share
  const st6 = (await studs(S, 6))[5]; let carried = 0;
  for (let i = 0; i < 20; i++) { const f = await mkFee(st6, 10000 + i, `t${i}`); const p = await plan(f, `uos_sim_c${i}`); if (p.share_kobo > 0) carried++; }
  rec("once", "20 checkouts for one student in a term: exactly one carries the share", carried === 1, `carried ${carried}`);
  // 14. leakage report sees online-collected shares
  const leak = (await svc("select public.platform_fee_leakage($1,$2,$3) r", [S, Y, T])).row.r;
  rec("leakage", "Leakage check counts split-collected and wallet-collected shares", Number(leak.shares_collected) >= 4, JSON.stringify(leak));
} finally { await c.query("ROLLBACK"); }
fs.writeFileSync("results/paystack-split-sim.json", JSON.stringify(results, null, 1));
console.log(`\n${results.filter((r) => r.pass).length}/${results.length} passed`); await c.end();

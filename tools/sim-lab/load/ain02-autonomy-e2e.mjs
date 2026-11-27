// AIN-02 one autonomy scale and the promotion gate E2E against the local sim-lab Postgres (never a hosted database).
//
// What the SQL harness cannot show: the gate under real concurrency and the privilege boundary over separate
// connections, each its own transaction as the service role.
//   A  20 simultaneous promotions on one piece of evidence: exactly one succeeds, 19 are refused, one ledger row;
//   B  10 simultaneous promotions on 10 different pieces of evidence for the same rung: exactly one rung is gained
//      (the advisory lock and the from-level check serialize them), one more ledger row;
//   C  10 simultaneous promotions signed by an organization administrator (not the founder): none succeeds;
//   D  the service role cannot write the earned level directly (insert, update, delete, truncate): all refused;
//   E  a regression recorded as evidence lowers the agent in every organization it holds a level in, once, and a
//      replay of that evidence lowers nothing more;
//   F  new steps follow the level: draft after the promotion, suggest after the automatic demotion;
//   G  a promotion that commits while a regression is being recorded does not make the regression call abort: the
//      regression is recorded and lowers the level that was committed, one rung from where it stands.
//   H  the first rung: a promotion from suggest that has not committed, and a regression recorded meanwhile: the
//      regression waits for the promotion and then lowers it (an agent-wide lock orders them);
//   I  an executed record in flight at act_and_report and a demotion: the demotion waits for the record's
//      transaction, and a record started after the demotion is refused.
//
// Nothing here calls a model, sends a message or reaches a network other than loopback. `sent_live` counts rows in the
// outbound tables for these organizations (this scenario creates none) and `dup` is computed from SQL.
import crypto from "node:crypto";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const simDir = path.resolve(here, "..");
const { Client } = createRequire(path.join(simDir, "package.json"))("pg");
const host = process.env.SIM_PG_HOST || "127.0.0.1";
const port = Number(process.env.SIM_PG_PORT ?? 54329);
const runTag = crypto.randomBytes(4).toString("hex");
const CONCURRENT = 20;
const RIVALS = 10;

const id = (prefix, n) => `${prefix}-0000-4000-8000-${runTag}${String(n).padStart(4, "0")}`;
const sha = (label) =>
  crypto.createHash("sha256").update(`ain02-e2e:${runTag}:${label}`).digest("hex");

function assertLocalEnvironment() {
  if (!/^(127\.0\.0\.1|::1|localhost)$/.test(host)) {
    throw new Error("AIN02 refuses a non-loopback Postgres host");
  }
}

async function connect() {
  const c = new Client({ host, port, user: "postgres", database: "postgres" });
  await c.connect();
  return c;
}

// A3: every promotion spends one fresh step-up bound to (org, agent, level, evidence). The e2e plays the verified
// passkey by inserting that row; a refused promotion does not spend it, so racers can each hold one.
async function grantStepUp(actor, org, agentRef, to, evidence) {
  const c = await connect();
  try {
    await c.query(
      `INSERT INTO public.wf_sensitive_step_up (user_id, action_kind, subject_digest, expires_at)
       VALUES ($1, 'agent_promotion',
               public.wf_step_up_digest('agent_promotion', ARRAY[$2::text, $3::text, $4::text, $5::text]),
               now() + interval '4 minutes')`,
      [actor, org, agentRef, to, evidence],
    );
  } finally {
    await c.end();
  }
}

const orgA = id("f2610000", 1);
const orgB = id("f2610000", 2);
const adminA = id("f2620000", 1);
const founder = id("f2620000", 2);
const author = id("f2620000", 3);
const publisher = id("f2620000", 4);
const agent = `ain02-e2e-${runTag}`;
const runIds = { a: id("f2630000", 1) };

async function setup(c) {
  await c.query("BEGIN");
  for (const u of [adminA, founder, author, publisher]) {
    await c.query("INSERT INTO auth.users (id) VALUES ($1)", [u]);
  }
  for (const [org, name] of [
    [orgA, "a"],
    [orgB, "b"],
  ]) {
    await c.query("INSERT INTO public.schools (id, name, slug) VALUES ($1, $2, $3)", [
      org,
      `AIN02 e2e org ${name}`,
      `ain02-e2e-${runTag}-${name}`,
    ]);
    await c.query(
      `INSERT INTO public.wf_org_settings (org_id, workflows_enabled, autonomy_ceiling)
       VALUES ($1, true, 'act_and_report')`,
      [org],
    );
  }
  await c.query(
    `INSERT INTO public.users (id, school_id, full_name, email, role, is_active)
     VALUES ($1, $2, 'AIN02 e2e admin', $3, 'admin', true)`,
    [adminA, orgA, `a-${runTag}@ain02.invalid`],
  );
  await c.query(
    `INSERT INTO public.super_admins (id, full_name, email, is_active)
     VALUES ($1, 'AIN02 e2e founder', $2, true)`,
    [founder, `f-${runTag}@ain02.invalid`],
  );
  await c.query(
    `INSERT INTO public.agent_pause_rules (agent_code, tier, kill_scope) VALUES ($1, 'department', 'agent')`,
    [agent],
  );
  await c.query(
    `INSERT INTO public.wf_agent (agent_ref, family, codename, agent_tier, accountable, supervisor, pack_version,
       max_tier, context_ceiling, daily_actions, daily_model_calls, daily_cost_cap_minor)
     VALUES ($1, 'platform', 'Fixture', 'department', 'fixture', 'jarvis-executive', '1.0.0', 'T3', 'internal', 1000, 0, 0)`,
    [agent],
  );
  for (const org of [orgA, orgB]) {
    await c.query(
      `INSERT INTO public.wf_agent_platform_grant (org_id, agent_ref) VALUES ($1, $2)`,
      [org, agent],
    );
  }
  const def = crypto.randomUUID();
  const ver = crypto.randomUUID();
  await c.query(
    "INSERT INTO public.wf_definition (id, org_id, key, name) VALUES ($1, $2, $3, $4)",
    [def, orgA, `ain02-e2e-${runTag}`, "AIN02 e2e"],
  );
  await c.query(
    `INSERT INTO public.wf_version (id, org_id, definition_id, version, graph, created_by)
     VALUES ($1, $2, $3, 1, '{"steps":[]}', $4)`,
    [ver, orgA, def, author],
  );
  await c.query(
    `UPDATE public.wf_version SET state = 'published', published_by = $2 WHERE id = $1`,
    [ver, publisher],
  );
  await c.query(
    `UPDATE public.wf_definition SET current_version_id = $2, status = 'active' WHERE id = $1`,
    [def, ver],
  );
  const template = crypto.randomUUID();
  await c.query(
    `INSERT INTO public.wf_template (id, template_key, version, name, description, graph, agent_ref, autonomy_max)
     VALUES ($1, $2, 1, 'AIN02 e2e template', 'fixture', '{"steps":[]}', NULL, 'act_and_report')`,
    [template, `ain02-e2e-${runTag}`],
  );
  await c.query(
    `INSERT INTO public.wf_run (id, org_id, definition_id, version_id, idempotency_key, status, max_depth,
       max_steps, step_count, started_by, deadline_at, started_at, agent_ref, template_id)
     VALUES ($1, $2, $3, $4, $5, 'running', 3, 500, 0, $6, now() + interval '1 hour', now(), $7, $8)`,
    [runIds.a, orgA, def, ver, `ain02-e2e-run-${runTag}`, adminA, agent, template],
  );
  await c.query("COMMIT");
}

/** Run one statement as the service role in its own connection and transaction. */
async function asServiceRole(sql, params = []) {
  const c = await connect();
  try {
    await c.query("BEGIN");
    await c.query("SET LOCAL ROLE service_role");
    const res = await c.query(sql, params);
    await c.query("COMMIT");
    return { outcome: "ok", rows: res.rows };
  } catch (error) {
    await c.query("ROLLBACK").catch(() => {});
    return { outcome: "refused", code: error.code, message: String(error.message) };
  } finally {
    await c.end();
  }
}

const recordEvidence = async (label, graded, passed, critical = 0) => {
  const r = await asServiceRole(
    `SELECT public.wf_autonomy_record_evidence($1, $2, $3, $4, $5, 0, now(), $6) AS v`,
    [agent, `suite-${label}`, graded, passed, critical, sha(label)],
  );
  if (r.outcome !== "ok") throw new Error(`record evidence ${label}: ${r.message}`);
  return r.rows[0].v;
};

const promote = async (actor, org, to, evidence) => {
  await grantStepUp(actor, org, agent, to, evidence);
  return promoteNoGrant(actor, org, to, evidence);
};
const promoteNoGrant = (actor, org, to, evidence) =>
  asServiceRole(
    `SELECT public.wf_autonomy_promote($1, $2, $3, $4, $5, 'AIN02 e2e promotion on evidence') AS v`,
    [actor, org, agent, to, evidence],
  );

const count = async (c, sql, params) => Number((await c.query(sql, params)).rows[0].n);
const levelOf = async (c, org) =>
  (
    await c.query(
      `SELECT earned_level FROM public.wf_agent_autonomy WHERE org_id = $1 AND agent_ref = $2`,
      [org, agent],
    )
  ).rows[0]?.earned_level ?? "suggest";

async function newStepLevel(c, key) {
  await c.query(
    `INSERT INTO public.wf_step_run (org_id, run_id, step_key, kind, idempotency_key, action_class)
     VALUES ($1, $2, $3, 'action', $4, 'internal')`,
    [orgA, runIds.a, key, `ain02-e2e-${runTag}-${key}`],
  );
  return (
    await c.query(
      `SELECT autonomy_level FROM public.wf_step_run WHERE org_id = $1 AND idempotency_key = $2`,
      [orgA, `ain02-e2e-${runTag}-${key}`],
    )
  ).rows[0].autonomy_level;
}

async function main() {
  assertLocalEnvironment();
  const admin = await connect();
  await setup(admin);

  // A. one piece of evidence, many promotions at once
  const evA = (await recordEvidence("a", 30, 30)).evidence_id;
  const first = await Promise.all(
    Array.from({ length: CONCURRENT }, () => promote(founder, orgA, "draft", evA)),
  );
  const promoted = first.filter((r) => r.outcome === "ok").length;
  const refused = first.filter((r) => r.outcome === "refused").length;
  const ledgerA = await count(
    admin,
    `SELECT count(*) n FROM public.wf_autonomy_change WHERE org_id = $1 AND agent_ref = $2 AND kind = 'promote'`,
    [orgA, agent],
  );
  const levelAfterA = await levelOf(admin, orgA);

  // B. rivals: different evidence, same rung (draft -> act_with_approval)
  const rivalIds = [];
  for (let i = 0; i < RIVALS; i += 1)
    rivalIds.push((await recordEvidence(`rival${i}`, 60, 60)).evidence_id);
  const rivals = await Promise.all(
    rivalIds.map((e) => promote(founder, orgA, "act_with_approval", e)),
  );
  const rivalsPromoted = rivals.filter((r) => r.outcome === "ok").length;
  const levelAfterB = await levelOf(admin, orgA);
  const ledgerB = await count(
    admin,
    `SELECT count(*) n FROM public.wf_autonomy_change WHERE org_id = $1 AND agent_ref = $2 AND kind = 'promote'`,
    [orgA, agent],
  );

  // C. a tenant administrator is not the founder
  const evC = (await recordEvidence("c", 300, 300)).evidence_id;
  const nonFounder = await Promise.all(
    Array.from({ length: RIVALS }, () => promote(adminA, orgA, "act_and_report", evC)),
  );
  const nonFounderPromoted = nonFounder.filter((r) => r.outcome === "ok").length;
  const nonFounderRightReason = nonFounder.filter((r) =>
    r.message?.includes("only_the_founder_promotes"),
  ).length;

  // D. direct writes as the service role
  const direct = await Promise.all([
    asServiceRole(
      `INSERT INTO public.wf_agent_autonomy (org_id, agent_ref, earned_level) VALUES ($1, $2, 'act_and_report')
       ON CONFLICT (org_id, agent_ref) DO UPDATE SET earned_level = 'act_and_report'`,
      [orgB, agent],
    ),
    asServiceRole(
      `UPDATE public.wf_agent_autonomy SET earned_level = 'act_and_report' WHERE agent_ref = $1`,
      [agent],
    ),
    asServiceRole(`DELETE FROM public.wf_agent_autonomy WHERE agent_ref = $1`, [agent]),
    asServiceRole(`TRUNCATE public.wf_agent_autonomy`),
  ]);
  const directRefused = direct.filter((r) => r.outcome === "refused" && r.code === "42501").length;
  const levelAfterD = await levelOf(admin, orgA);

  // F (first half). a new step follows the level the agent holds now
  const stepAtApproval = await newStepLevel(admin, "after-promote");

  // E. a regression lowers the agent everywhere it holds a level, once. First give orgB a level through the gate.
  const evB = (await recordEvidence("b", 25, 25)).evidence_id;
  const toB = await promote(founder, orgB, "draft", evB);
  const orgBBefore = await levelOf(admin, orgB);
  const regression = await recordEvidence("regress", 100, 80);
  const orgAAfter = await levelOf(admin, orgA);
  const orgBAfter = await levelOf(admin, orgB);
  const replay = await recordEvidence("regress", 100, 80);
  const autoRows = await count(
    admin,
    `SELECT count(*) n FROM public.wf_autonomy_change WHERE agent_ref = $1 AND kind = 'auto_demote'`,
    [agent],
  );
  // F (second half). keep demoting to the floor with a critical failure, then a new step is at suggest
  await recordEvidence("critical", 200, 199, 1);
  await recordEvidence("critical2", 200, 199, 1);
  const stepAtFloor = await newStepLevel(admin, "after-demote");
  const levelFloor = await levelOf(admin, orgA);

  // G. a promotion that commits while a regression is being recorded must not make the regression call abort
  const evG1 = (await recordEvidence("g1", 25, 25)).evidence_id;
  const g1 = await promote(founder, orgB, "draft", evG1);
  const evG2 = (await recordEvidence("g2", 60, 60)).evidence_id;
  await grantStepUp(founder, orgB, agent, "act_with_approval", evG2);
  const holder = await connect();
  await holder.query("BEGIN");
  await holder.query("SET LOCAL ROLE service_role");
  // Holds the per-agent lock and an uncommitted rise to act_with_approval in orgB.
  await holder.query(
    `SELECT public.wf_autonomy_promote($1, $2, $3, 'act_with_approval', $4, 'AIN02 e2e race promotion')`,
    [founder, orgB, agent, evG2],
  );
  const racing = asServiceRole(
    `SELECT public.wf_autonomy_record_evidence($1, 'suite-g3', 100, 50, 0, 0, now(), $2) AS v`,
    [agent, sha("g3")],
  );
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await holder.query("COMMIT");
  await holder.end();
  const raced = await racing;
  const raceV = raced.rows?.[0]?.v;
  const levelAfterG = await levelOf(admin, orgB);

  // H. the first rung: a promotion from suggest that has not committed yet, and a regression recorded meanwhile.
  //    The regression must wait for the promotion and then lower it (review round 2, finding 1).
  const agentH = `ain02-e2e-h-${runTag}`;
  await admin.query(
    `INSERT INTO public.agent_pause_rules (agent_code, tier, kill_scope) VALUES ($1, 'department', 'agent')`,
    [agentH],
  );
  await admin.query(
    `INSERT INTO public.wf_agent (agent_ref, family, codename, agent_tier, accountable, supervisor, pack_version,
       max_tier, context_ceiling, daily_actions, daily_model_calls, daily_cost_cap_minor)
     VALUES ($1, 'platform', 'Fixture', 'department', 'fixture', 'jarvis-executive', '1.0.0', 'T3', 'internal', 1000, 0, 0)`,
    [agentH],
  );
  await admin.query(
    `INSERT INTO public.wf_agent_platform_grant (org_id, agent_ref) VALUES ($1, $2)`,
    [orgA, agentH],
  );
  const recordH = async (label, graded, passed) => {
    const r = await asServiceRole(
      `SELECT public.wf_autonomy_record_evidence($1, $2, $3, $4, 0, 0, now(), $5) AS v`,
      [agentH, `suite-${label}`, graded, passed, sha(label)],
    );
    if (r.outcome !== "ok") throw new Error(`record evidence ${label}: ${r.message}`);
    return r.rows[0].v;
  };
  const promoteH = async (org, to, evidence) => {
    await grantStepUp(founder, org, agentH, to, evidence);
    return promoteHNoGrant(org, to, evidence);
  };
  const promoteHNoGrant = (org, to, evidence) =>
    asServiceRole(
      `SELECT public.wf_autonomy_promote($1, $2, $3, $4, $5, 'AIN02 e2e promotion on evidence') AS v`,
      [founder, org, agentH, to, evidence],
    );
  const levelOfH = async (org) =>
    (
      await admin.query(
        `SELECT earned_level FROM public.wf_agent_autonomy WHERE org_id = $1 AND agent_ref = $2`,
        [org, agentH],
      )
    ).rows[0]?.earned_level ?? "suggest";
  const evH1 = (await recordH("h1", 25, 25)).evidence_id;
  await grantStepUp(founder, orgA, agentH, "draft", evH1);
  const holderH = await connect();
  await holderH.query("BEGIN");
  await holderH.query("SET LOCAL ROLE service_role");
  await holderH.query(
    `SELECT public.wf_autonomy_promote($1, $2, $3, 'draft', $4, 'AIN02 e2e first rung race')`,
    [founder, orgA, agentH, evH1],
  );
  const racingH = asServiceRole(
    `SELECT public.wf_autonomy_record_evidence($1, 'suite-h2', 100, 10, 0, 0, now(), $2) AS v`,
    [agentH, sha("h2")],
  );
  await new Promise((resolve) => setTimeout(resolve, 1500));
  await holderH.query("COMMIT");
  await holderH.end();
  const racedH = await racingH;
  const rungV = racedH.rows?.[0]?.v;
  const levelAfterH = await levelOfH(orgA);

  // I. an executed record in flight and a demotion: the demotion waits for the record (finding 2).
  const climb = async (label, to, graded) => {
    const ev = (await recordH(label, graded, graded)).evidence_id;
    const r = await promoteH(orgA, to, ev);
    if (r.outcome !== "ok") throw new Error(`climb ${label}: ${r.message}`);
  };
  await climb("i1", "draft", 25);
  await climb("i2", "act_with_approval", 60);
  await climb("i3", "act_and_report", 400);
  const runH = crypto.randomUUID();
  await admin.query(
    `INSERT INTO public.wf_run (id, org_id, definition_id, version_id, idempotency_key, status, max_depth, max_steps,
       step_count, started_by, deadline_at, started_at, agent_ref, template_id)
     SELECT $1, org_id, definition_id, version_id, $2, status, max_depth, max_steps, 0, started_by, deadline_at,
            started_at, $3, template_id FROM public.wf_run WHERE id = $4`,
    [runH, `ain02-e2e-run-h-${runTag}`, agentH, runIds.a],
  );
  await admin.query(
    `INSERT INTO public.wf_step_run (org_id, run_id, step_key, kind, idempotency_key, action_class)
     VALUES ($1, $2, 'h', 'action', $3, 'internal')`,
    [orgA, runH, `ain02-e2e-${runTag}-h`],
  );
  const stepH = (
    await admin.query(
      `SELECT id, autonomy_level FROM public.wf_step_run WHERE org_id = $1 AND idempotency_key = $2`,
      [orgA, `ain02-e2e-${runTag}-h`],
    )
  ).rows[0];
  const outboxInsert = `INSERT INTO public.wf_action_sandbox_outbox (org_id, run_id, step_run_id, kind, category,
       template_ref, broker_decision_id, idempotency_key) VALUES ($1, $2, $3, 'in_app', 'communication', 'notice.a', gen_random_uuid(), $4)`;
  // Only the AIN-02 trigger is under test; the other outbox triggers and the broker foreign key are off for this
  // transaction and switched back on below.
  const holderI = await connect();
  await holderI.query("BEGIN");
  await holderI.query("ALTER TABLE public.wf_action_sandbox_outbox DISABLE TRIGGER ALL");
  await holderI.query(
    "ALTER TABLE public.wf_action_sandbox_outbox ENABLE TRIGGER wf_action_sandbox_outbox_90_autonomy",
  );
  await holderI.query(outboxInsert, [orgA, runH, stepH.id, `ain02-e2e-ob-${runTag}-1`]);
  let demoteDoneAt = 0;
  const demoting = asServiceRole(
    `SELECT public.wf_autonomy_demote($1, $2, $3, 'act_with_approval', 'AIN02 e2e demotion during a record') AS v`,
    [founder, orgA, agentH],
  ).then((r) => {
    demoteDoneAt = Date.now();
    return r;
  });
  await new Promise((resolve) => setTimeout(resolve, 1500));
  const demotionWaited = demoteDoneAt === 0;
  await holderI.query("COMMIT");
  const holderCommittedAt = Date.now();
  await holderI.end();
  const demoted = await demoting;
  const afterRefused = await (async () => {
    const c = await connect();
    try {
      await c.query("BEGIN");
      await c.query("ALTER TABLE public.wf_action_sandbox_outbox DISABLE TRIGGER ALL");
      await c.query(
        "ALTER TABLE public.wf_action_sandbox_outbox ENABLE TRIGGER wf_action_sandbox_outbox_90_autonomy",
      );
      await c.query(outboxInsert, [orgA, runH, stepH.id, `ain02-e2e-ob-${runTag}-2`]);
      await c.query("COMMIT");
      return "allowed";
    } catch (error) {
      await c.query("ROLLBACK").catch(() => {});
      return error.code;
    } finally {
      await c.end();
    }
  })();
  const recordRows = await count(
    admin,
    `SELECT count(*) n FROM public.wf_action_sandbox_outbox WHERE org_id = $1 AND idempotency_key LIKE $2`,
    [orgA, `ain02-e2e-ob-${runTag}-%`],
  );
  const levelAfterI = await levelOfH(orgA);
  // Clean up: the record rows are test data; switch every outbox trigger back on.
  await admin.query("BEGIN");
  await admin.query("ALTER TABLE public.wf_action_sandbox_outbox DISABLE TRIGGER ALL");
  await admin.query(
    `DELETE FROM public.wf_action_sandbox_outbox WHERE org_id = $1 AND idempotency_key LIKE $2`,
    [orgA, `ain02-e2e-ob-${runTag}-%`],
  );
  await admin.query("ALTER TABLE public.wf_action_sandbox_outbox ENABLE TRIGGER ALL");
  await admin.query("COMMIT");
  const outboxTriggersOn = await count(
    admin,
    `SELECT count(*) n FROM pg_trigger WHERE tgrelid = 'public.wf_action_sandbox_outbox'::regclass AND NOT tgisinternal AND tgenabled <> 'O'`,
    [],
  );

  const sentLive = await count(
    admin,
    `SELECT (SELECT count(*) FROM public.wf_action_sandbox_outbox WHERE org_id = ANY($1))
          + (SELECT count(*) FROM public.wf_action_draft WHERE org_id = ANY($1)) n`,
    [[orgA, orgB]],
  );
  const dup = await count(
    admin,
    `SELECT count(*) n FROM (SELECT evidence_id FROM public.wf_autonomy_change
       WHERE kind = 'promote' AND agent_ref = $1 GROUP BY 1 HAVING count(*) > 1) d`,
    [agent],
  );
  await admin.end();

  const failures = [];
  if (promoted !== 1) failures.push(`promoted=${promoted} expected 1`);
  if (refused !== CONCURRENT - 1) failures.push(`refused=${refused}`);
  if (ledgerA !== 1 || levelAfterA !== "draft")
    failures.push(`A ledger=${ledgerA} level=${levelAfterA}`);
  if (rivalsPromoted !== 1 || levelAfterB !== "act_with_approval" || ledgerB !== 2) {
    failures.push(`B promoted=${rivalsPromoted} level=${levelAfterB} ledger=${ledgerB}`);
  }
  if (nonFounderPromoted !== 0 || nonFounderRightReason !== RIVALS) failures.push("C nonfounder");
  if (directRefused !== 4 || levelAfterD !== "act_with_approval")
    failures.push(`D direct=${directRefused} level=${levelAfterD}`);
  if (stepAtApproval !== "act_with_approval") failures.push(`F step=${stepAtApproval}`);
  if (toB.outcome !== "ok" || orgBBefore !== "draft") failures.push("E setup");
  if (
    !regression.regression ||
    regression.demoted !== 2 ||
    orgAAfter !== "draft" ||
    orgBAfter !== "suggest"
  ) {
    failures.push(`E regression demoted=${regression.demoted} a=${orgAAfter} b=${orgBAfter}`);
  }
  if (replay.recorded || replay.demoted !== 0 || autoRows !== 2)
    failures.push(`E replay rows=${autoRows}`);
  if (stepAtFloor !== "suggest" || levelFloor !== "suggest")
    failures.push(`F floor step=${stepAtFloor} level=${levelFloor}`);
  if (g1.outcome !== "ok") failures.push("G setup");
  if (
    raced.outcome !== "ok" ||
    !raceV?.recorded ||
    !raceV?.regression ||
    raceV.demoted !== 1 ||
    levelAfterG !== "draft"
  ) {
    failures.push(
      `G race outcome=${raced.outcome} ${raced.message ?? ""} demoted=${raceV?.demoted} level=${levelAfterG}`,
    );
  }
  if (!rungV?.recorded || !rungV?.regression || rungV.demoted !== 1 || levelAfterH !== "suggest") {
    failures.push(
      `H rung race outcome=${racedH.outcome} ${racedH.message ?? ""} demoted=${rungV?.demoted} level=${levelAfterH}`,
    );
  }
  if (
    stepH.autonomy_level !== "act_and_report" ||
    !demotionWaited ||
    demoted.outcome !== "ok" ||
    demoteDoneAt < holderCommittedAt ||
    recordRows !== 1 ||
    afterRefused !== "42501" ||
    levelAfterI !== "act_with_approval" ||
    outboxTriggersOn !== 0
  ) {
    failures.push(
      `I outbox race step=${stepH.autonomy_level} waited=${demotionWaited} demote=${demoted.outcome} rows=${recordRows} after=${afterRefused} level=${levelAfterI} triggers_off=${outboxTriggersOn}`,
    );
  }
  if (sentLive !== 0 || dup !== 0) failures.push("sent_or_dup");
  const line =
    `AIN02-E2E RESULT: concurrent=${CONCURRENT} promoted=${promoted} refused=${refused} ledger_rows=${ledgerA} ` +
    `rivals=${RIVALS} rivals_promoted=${rivalsPromoted} nonfounder_promoted=${nonFounderPromoted} ` +
    `direct_write_refused=${directRefused} auto_demoted=${regression.demoted} replay_demoted=${replay.demoted} race_demoted=${raceV?.demoted} race_level=${levelAfterG} ` +
    `rung_race_demoted=${rungV?.demoted} rung_race_level=${levelAfterH} record_waited=${demotionWaited} record_after_demotion=${afterRefused} ` +
    `step_after_promote=${stepAtApproval} step_after_demote=${stepAtFloor} sent_live=${sentLive} dup=${dup}`;
  console.log(line);
  if (failures.length) {
    console.error(`AIN02-E2E FAIL: ${failures.join(", ")}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`AIN02-E2E FAIL: ${error.message}`);
  process.exit(1);
});

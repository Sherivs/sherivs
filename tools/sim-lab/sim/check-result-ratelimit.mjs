// Proves check_result commits its rate-limit row on a wrong admission number.
// A raised error used to roll that row back, so admission numbers could be
// guessed without the 10/hour cap and a correct PIN was distinguishable.
// Local sim only. Never points at production.
import pg from "pg";
import { randomBytes } from "node:crypto";

const port = Number(process.env.SIM_PG_PORT ?? 54329);
const c = new pg.Client({ host: "127.0.0.1", port, user: "postgres", database: "postgres" });
await c.connect();

const suffix = randomBytes(4).toString("hex");
const slug = `m006-${suffix}`;
const serial = `SRVM006${suffix.toUpperCase()}`;
const pin = "123456789012";
const admission = `ADM-${suffix}`;
let schoolId = null;

async function asAnon(serialValue, pinValue, admissionValue) {
  await c.query("begin");
  try {
    await c.query("set local role anon");
    const row = await c.query("select public.check_result($1, $2, $3) as result", [
      serialValue,
      pinValue,
      admissionValue,
    ]);
    await c.query("commit");
    return row.rows[0].result;
  } catch (error) {
    await c.query("rollback");
    throw error;
  }
}

try {
  const school = await c.query(
    "insert into public.schools (name, slug) values ($1, $2) returning id",
    ["M006 checker", slug],
  );
  schoolId = school.rows[0].id;
  const student = await c.query(
    "insert into public.students (school_id, admission_number) values ($1, $2) returning id",
    [schoolId, admission],
  );
  await c.query(
    `insert into public.grades (school_id, student_id, subject, term, academic_year, ca_score, exam_score, is_published)
     values ($1, $2, 'Mathematics', 'First', '2026', 20, 50, true)`,
    [schoolId, student.rows[0].id],
  );
  const batch = await c.query(
    `insert into public.result_pin_batches (school_id, academic_year, term, quantity, max_uses)
     values ($1, '2026', 'First', 1, 5) returning id`,
    [schoolId],
  );
  await c.query(
    `insert into public.result_pins (serial, batch_id, school_id, pin_hash, max_uses, academic_year, term)
     values ($1, $2, $3, extensions.crypt($4, extensions.gen_salt('bf', 6)), 5, '2026', 'First')`,
    [serial, batch.rows[0].id, schoolId, pin],
  );

  const wrongPin = await asAnon(serial, "000000000000", admission);
  const wrongAdmission = await asAnon(serial, pin, "NO-SUCH-STUDENT");
  if (wrongPin?.error !== "invalid serial or PIN" || wrongAdmission?.error !== "invalid serial or PIN") {
    throw new Error(
      `PIN oracle still open: wrong pin=${JSON.stringify(wrongPin)} wrong admission=${JSON.stringify(wrongAdmission)}`,
    );
  }

  const hits = [];
  for (let i = 0; i < 12; i += 1) hits.push(await asAnon(serial, pin, "NO-SUCH-STUDENT"));
  const limited = hits.filter((row) => row?.error === "rate_limited");
  if (limited.length < 2) {
    throw new Error(`rate limit did not stick: ${JSON.stringify(hits.map((row) => row?.error))}`);
  }
  const counted = await c.query(
    "select count(*)::int n from public.rate_limit_events where bucket = 'result_checker.serial' and subject = $1",
    [serial],
  );
  if (counted.rows[0].n < 10) {
    throw new Error(`expected the limiter rows to commit, saw ${counted.rows[0].n}`);
  }

  const fresh = `SRVM006B${suffix.toUpperCase()}`;
  const batch2 = await c.query(
    `insert into public.result_pin_batches (school_id, academic_year, term, quantity, max_uses)
     values ($1, '2026', 'First', 1, 5) returning id`,
    [schoolId],
  );
  await c.query(
    `insert into public.result_pins (serial, batch_id, school_id, pin_hash, max_uses, academic_year, term)
     values ($1, $2, $3, extensions.crypt($4, extensions.gen_salt('bf', 6)), 5, '2026', 'First')`,
    [fresh, batch2.rows[0].id, schoolId, pin],
  );
  const ok = await asAnon(fresh, pin, admission);
  if (ok?.ok !== true || !Array.isArray(ok.subjects) || ok.subjects.length !== 1) {
    throw new Error(`valid card did not return the published grade: ${JSON.stringify(ok)}`);
  }

  console.log(
    JSON.stringify({
      ok: true,
      school_id: schoolId,
      limiter_rows: counted.rows[0].n,
      rate_limited_responses: limited.length,
      published_subject: ok.subjects[0].subject,
    }),
  );
} finally {
  // Schools are not deleted: audit_logs is append-only and a school delete
  // tries to null those rows. The sim database is disposable.
  await c.query("delete from public.rate_limit_events where subject like $1", [
    `SRVM006%${suffix.toUpperCase()}`,
  ]).catch(() => {});
  await c.end();
}

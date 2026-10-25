// Track E: seed attendance (20 school days per student) and one open CBT test per class (20 questions)
// so k6 can exercise the attendance + CBT flows. Local sim DB only.
import pg from "pg";
const c = new pg.Client({ host: "127.0.0.1", port: Number(process.env.SIM_PG_PORT ?? 54329), user: "postgres" }); await c.connect();
await c.query(`set session_replication_role = replica`); // skip audit triggers for bulk seed
await c.query(`insert into attendance (school_id, student_id, class_id, date, status)
  select s.school_id, s.id, s.class_id, d::date, case when random() < 0.92 then 'present' when random() < 0.5 then 'late' else 'absent' end
  from students s cross join generate_series(current_date - 27, current_date, interval '1 day') d
  where extract(isodow from d) < 6 on conflict do nothing`);
await c.query(`insert into cbt_questions (school_id, subject, stem, options, answer_key, marks)
  select sc.id, 'Mathematics', 'Q' || g || ': what is ' || g || ' + ' || g || '?', jsonb_build_array(g, g*2, g*3, g*4), 1, 1
  from schools sc cross join generate_series(1, 20) g`);
await c.query(`insert into cbt_tests (school_id, title, class_id, duration_minutes, opens_at, closes_at, question_ids)
  select cl.school_id, 'Sim mock exam', cl.id, 60, now() - interval '1 hour', now() + interval '2 days',
         (select array_agg(q.id) from cbt_questions q where q.school_id = cl.school_id)
  from classes cl`);
await c.query(`set session_replication_role = origin`); await c.query(`analyze attendance; analyze cbt_tests; analyze cbt_questions`);
const r = await c.query(`select (select count(*) from attendance) att, (select count(*) from cbt_tests) tests`);
console.log(r.rows[0]); await c.end();

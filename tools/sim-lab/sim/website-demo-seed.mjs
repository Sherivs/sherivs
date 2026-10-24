// SHERIVS-100: seed the fictional demo organizations (tests/fixtures/website/demo-facts.ts) into the LOCAL sim DB as
// real rows, then publish each generated site through the guarded RPCs as that org's own admin. Local only.
// Usage: DEMO_BUNDLE=/path/demo-bundle.mjs PGPORT=54372 node tools/sim-lab/sim/website-demo-seed.mjs
// (bundle = esbuild of { DEMO_FACTS, generateSite }, see docs/website-engine/SPEC.md §11)
import pg from "pg";
import { randomUUID as uuid } from "node:crypto";
const { DEMO_FACTS, generateSite } = await import(process.env.DEMO_BUNDLE);
const c = new pg.Client({
  host: "127.0.0.1",
  port: +(process.env.PGPORT || 54329),
  user: "postgres",
});
await c.connect();
const q = (s, p) => c.query(s, p);
const DOMAINS = {
  lagosNurseryPrimary: "www.littlepearls.sch.ng",
  federalUniversity: "fuarewa.edu.ng",
};
const out = {};
for (const [key, f] of Object.entries(DEMO_FACTS)) {
  if (key === "stateBoard") continue;
  const d = f.data,
    s = d.school;
  // Idempotent: audit logs are append-only, so an existing demo org is reported, never deleted.
  const had = (
    await q(
      "SELECT s.id, w.published_version v FROM schools s LEFT JOIN websites w ON w.school_id = s.id WHERE s.slug = $1",
      [s.slug],
    )
  ).rows[0];
  if (had) {
    out[key] = { slug: s.slug, domain: DOMAINS[key] ?? null, version: had.v, existing: true };
    continue;
  }
  await q("BEGIN");
  const sid = uuid(),
    admin = uuid();
  await q(
    `INSERT INTO schools (id,name,slug,motto,about,school_vision,school_mission,founded_year,primary_color,secondary_color,phone,email,address,
      office_hours,institution_category,instagram_url,admission_requirements,admission_deadline,subscription_tier,subscription_status,is_active,max_students)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,'growth','active',true,50000)`,
    [
      sid,
      s.name,
      s.slug,
      s.motto,
      s.about,
      s.vision ?? null,
      s.mission ?? null,
      s.founded_year,
      s.primary_color,
      s.secondary_color,
      s.phone ?? null,
      s.email ?? null,
      s.address ?? null,
      s.office_hours ?? null,
      s.institution_category,
      s.socials?.instagram ?? null,
      d.admissions?.requirements ?? null,
      d.admissions?.deadline ?? null,
    ],
  );
  await q("INSERT INTO auth.users (id,email) VALUES ($1,$2)", [
    admin,
    `admin-${s.slug}@demo.invalid`,
  ]);
  await q(
    "INSERT INTO users (id,school_id,full_name,email,role) VALUES ($1,$2,'Demo admin',$3,'admin')",
    [admin, sid, `admin-${s.slug}@demo.invalid`],
  );
  const campus = {};
  for (const k of d.campuses ?? [])
    campus[k.name] = (
      await q("INSERT INTO campuses (school_id,name,address) VALUES ($1,$2,$3) RETURNING id", [
        sid,
        k.name,
        k.address,
      ])
    ).rows[0].id;
  for (const x of d.sections ?? [])
    await q(
      "INSERT INTO school_sections (school_id,campus_id,name,kind,gender,residency) VALUES ($1,$2,$3,$4,$5,$6)",
      [sid, campus[x.campus] ?? null, x.name, x.kind, x.gender, x.residency],
    );
  for (const [i, p] of (d.programmes ?? []).entries())
    await q(
      "INSERT INTO academic_programs (school_id,name,description,age_range,duration,order_index,is_published) VALUES ($1,$2,$3,$4,$5,$6,true)",
      [sid, p.name, p.description ?? null, p.age_range ?? null, p.duration ?? null, i],
    );
  for (const [i, x] of (d.facilities ?? []).entries())
    await q(
      "INSERT INTO school_facilities (school_id,name,description,order_index,is_published) VALUES ($1,$2,$3,$4,true)",
      [sid, x.name, x.description ?? null, i],
    );
  for (const n of d.news ?? [])
    await q(
      "INSERT INTO news (school_id,title,content,excerpt,is_published,published_at,target_audience) VALUES ($1,$2,$3,$3,true,$4,'all')",
      [sid, n.title, n.excerpt, n.published_at],
    );
  for (const e of d.events ?? [])
    await q(
      "INSERT INTO events (school_id,title,location,event_date,event_time,is_published,target_audience) VALUES ($1,$2,$3,$4,$5,true,'all')",
      [sid, e.title, e.location ?? null, e.date, e.time ?? null],
    );
  for (const [i, t] of (d.testimonials ?? []).entries())
    await q(
      "INSERT INTO testimonials (school_id,name,role,content,order_index,is_published) VALUES ($1,$2,$3,$4,$5,true)",
      [sid, t.name, t.role, t.content, i],
    );
  for (const [i, x] of (d.faqs ?? []).entries())
    await q(
      "INSERT INTO faqs (school_id,question,answer,order_index,is_published) VALUES ($1,$2,$3,$4,true)",
      [sid, x.question, x.answer, i],
    );
  if (d.transport)
    await q(
      `INSERT INTO school_transport (school_id,transport_enabled,coverage_areas,morning_pickup_start,afternoon_departure_time,live_tracking_enabled,monthly_transport_fee)
      VALUES ($1,true,$2,$3,$4,$5,$6)`,
      [
        sid,
        d.transport.coverage_areas,
        d.transport.morning_pickup_start,
        d.transport.afternoon_departure_time,
        !!d.transport.live_tracking_enabled,
        d.transport.monthly_fee ?? null,
      ],
    );
  for (const h of d.hostels ?? [])
    await q(
      "INSERT INTO hostel_rooms (school_id,room_name,capacity,gender) SELECT $1, 'Room ' || g, $2, $3 FROM generate_series(1,$4::int) g",
      [sid, Math.round(h.capacity / h.rooms), h.gender, h.rooms],
    );
  if (d.alumni)
    await q(
      "INSERT INTO alumni_profiles (school_id,full_name,verified,grad_year) SELECT $1, 'Alumnus ' || g, true, $2::int + (g % ($3::int - $2::int + 1)) FROM generate_series(1,$4::int) g",
      [sid, d.alumni.first_year, d.alumni.last_year, d.alumni.verified],
    );
  for (const x of d.donations ?? [])
    await q(
      "INSERT INTO donation_campaigns (school_id,title,goal,status) VALUES ($1,$2,$3,'open')",
      [sid, x.title, x.goal],
    );
  if (d.results_checker)
    await q(
      "INSERT INTO result_pin_batches (school_id,academic_year,term,quantity) VALUES ($1,'2025/2026','first',100)",
      [sid],
    );
  if (d.stats?.students)
    await q(
      "INSERT INTO students (school_id,admission_number,is_active) SELECT $1, 'D' || g, true FROM generate_series(1,$2::int) g",
      [sid, d.stats.students],
    );
  if (d.stats?.teachers) {
    await q(
      "INSERT INTO auth.users (id,email) SELECT gen_random_uuid(), 't' || g || '-' || $1 || '@demo.invalid' FROM generate_series(1,$2::int) g",
      [s.slug, d.stats.teachers],
    );
    await q(
      "INSERT INTO users (id,school_id,full_name,email,role) SELECT id, $1, 'Teacher', email, 'teacher' FROM auth.users WHERE email LIKE 't%-' || $2 || '@demo.invalid'",
      [sid, s.slug],
    );
  }
  await q(
    "INSERT INTO onboarding_sessions (school_id,answers,status,applied_at) VALUES ($1,$2,'applied',now())",
    [sid, JSON.stringify(f.onboarding ?? {})],
  );
  if (DOMAINS[key])
    await q(
      "INSERT INTO school_domains (school_id,hostname,purpose,is_primary,status,verified_at) VALUES ($1,$2,'public_site',true,'verified',now())",
      [sid, DOMAINS[key]],
    );
  // Publish exactly like the builder/onboarding hook: as the org's own admin, through the guarded RPCs.
  await q("SET LOCAL ROLE authenticated");
  await q("select set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({ sub: admin, role: "authenticated" }),
  ]);
  const facts = (await q("select public.website_facts($1) r", [sid])).rows[0].r;
  const doc = generateSite(facts);
  await q("select public.website_save_draft($1,$2::jsonb,0)", [sid, JSON.stringify(doc)]);
  const v = (
    await q("select public.website_publish($1,'Generated from onboarding (demo seed)') v", [sid])
  ).rows[0].v;
  await q("COMMIT");
  out[key] = {
    slug: s.slug,
    domain: DOMAINS[key] ?? null,
    version: v,
    pages: doc.pages.map((p) => p.slug),
    locales: doc.locales,
  };
}
console.log(JSON.stringify(out, null, 2));
await c.end();

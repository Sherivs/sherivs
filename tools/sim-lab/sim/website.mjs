// SHERIVS-100 website engine sim: RLS + RPC scenarios incl. tenant isolation. Local only.
// Usage: PGPORT=54329 node sim/website.mjs
import pg from "pg"; import fs from "node:fs"; import { randomUUID as uuid } from "node:crypto";
const c = new pg.Client({ host: "127.0.0.1", port: +(process.env.PGPORT || 54329), user: "postgres" });
await c.connect();
const results = [];
async function check(name, fn) { await c.query("BEGIN"); try { await fn(); results.push({ name, ok: true }); } catch (e) { results.push({ name, ok: false, err: String(e.message).slice(0, 300) }); } finally { await c.query("ROLLBACK"); } }
const as = async (uid) => { await c.query("RESET ROLE"); await c.query("SET LOCAL ROLE authenticated"); await c.query("select set_config('request.jwt.claims',$1,true)", [JSON.stringify({ sub: uid, role: "authenticated" })]); };
const anon = async () => { await c.query("RESET ROLE"); await c.query("SET LOCAL ROLE anon"); await c.query("select set_config('request.jwt.claims','{\"role\":\"anon\"}',true)"); };
const owner = async () => { await c.query("RESET ROLE"); await c.query("select set_config('request.jwt.claims','{}',true)"); };
const assert = (v, m) => { if (!v) throw new Error(m); };
async function err(sql, p = []) { await c.query("SAVEPOINT s"); try { await c.query(sql, p); } catch (e) { await c.query("ROLLBACK TO SAVEPOINT s"); return e.code || "ERR"; } await c.query("ROLLBACK TO SAVEPOINT s"); return null; }
const doc = (title = "Welcome", extra = []) => ({ schema: 1, locales: ["en", "ha"], theme: { primary: "#0b6b3a", secondary: "#a35a00", font: "system", radius: "soft" },
  pages: [{ id: "p-home", slug: "home", title: { en: "Home" }, nav: true, sections: [{ id: "s1", background: "default", layout: "stack",
    blocks: [{ id: "b1", type: "hero", variant: "centered", props: { heading: { en: title } } }, { id: "b2", type: "news", props: {} }, ...extra] }] }] });
async function world() {
  await owner(); const w = {};
  for (const k of ["A", "B"]) {
    const sid = uuid(), admin = uuid(), teacher = uuid();
    await c.query("INSERT INTO schools (id,name,slug,subscription_tier,subscription_status,is_active,max_students) VALUES ($1,$2,$3,'growth','active',true,1000)", [sid, `Sim ${k}`, `simweb-${k.toLowerCase()}-${sid.slice(0, 6)}`]);
    for (const [u, role] of [[admin, "admin"], [teacher, "teacher"]]) {
      await c.query("INSERT INTO auth.users (id,email) VALUES ($1,$2)", [u, `${role}-${u.slice(0, 6)}@sim.invalid`]);
      await c.query("INSERT INTO users (id,school_id,full_name,email,role) VALUES ($1,$2,$3,$4,$5)", [u, sid, role, `${role}-${u.slice(0, 6)}@sim.invalid`, role]);
    }
    await c.query("INSERT INTO news (school_id,title,content,is_published,published_at,target_audience) VALUES ($1,$2,'x',true,now(),'all'),($1,$3,'x',false,now(),'all'),($1,$4,'x',true,now(),'staff')",
      [sid, `${k} public news`, `${k} DRAFT news`, `${k} STAFF-ONLY news`]);
    await c.query("INSERT INTO school_staff (school_id,full_name,is_published) VALUES ($1,$2,true)", [sid, `${k} Teacher Person`]);
    await c.query("INSERT INTO hostel_rooms (school_id,room_name,capacity,gender) VALUES ($1,'Room SECRET-12',12,'male')", [sid]);
    await c.query("INSERT INTO alumni_profiles (school_id,full_name,verified,grad_year) VALUES ($1,'Alumnus SECRETNAME',true,2010)", [sid]);
    w[k] = { sid, admin, teacher, slug: (await c.query("select slug from schools where id=$1", [sid])).rows[0].slug };
  }
  return w;
}
const pub = async (host, slug) => { await anon(); return (await c.query("select public.website_public($1,$2) r", [host, slug])).rows[0].r; };
const save = async (w, d, rev) => (await c.query("select public.website_save_draft($1,$2::jsonb,$3) r", [w.sid, JSON.stringify(d), rev])).rows[0].r;

await check("unpublished school: public read returns live data, no document (renderer generates)", async () => {
  const w = await world(); const r = await pub(null, w.A.slug);
  assert(r && r.document === null && r.version === null && r.data.school.name === "Sim A", JSON.stringify(r).slice(0, 200));
  const titles = r.data.news.map((n) => n.title);
  assert(titles.includes("A public news") && !titles.some((t) => /DRAFT|STAFF-ONLY|^B /.test(t)), titles.join("|"));
  assert(!("staff" in r.data), "staff bundled without opt-in");
});
await check("admin saves and publishes; drafts never leak to the public", async () => {
  const w = await world(); await as(w.A.admin);
  assert(await save(w.A, doc("V1"), 0) === 1, "rev1");
  let r = await pub(null, w.A.slug); assert(r.document === null, "draft visible before publish");
  await as(w.A.admin); const v = (await c.query("select public.website_publish($1,'first') v", [w.A.sid])).rows[0].v; assert(v === 1, "v1");
  await save(w.A, doc("DRAFT-V2"), 1);
  r = await pub(null, w.A.slug); assert(r.version === 1 && r.document.pages[0].sections[0].blocks[0].props.heading.en === "V1", "public shows draft");
});
await check("tenant isolation: other school's admin, teachers and anon cannot read or write a site", async () => {
  const w = await world(); await as(w.A.admin); await save(w.A, doc(), 0); await c.query("select public.website_publish($1,null)", [w.A.sid]);
  await as(w.B.admin);
  for (const sql of ["select public.website_get($1)", "select public.website_facts($1)", "select public.website_publish($1,null)", "select public.website_rollback($1,1)", "select public.website_preview_data($1,null)"])
    assert(await err(sql, [w.A.sid]) === "42501", `B admin: ${sql}`);
  assert(await err("select public.website_save_draft($1,$2::jsonb,1)", [w.A.sid, JSON.stringify(doc("hijack"))]) === "42501", "B save");
  assert((await c.query("select count(*)::int n from websites where school_id=$1", [w.A.sid])).rows[0].n === 0, "B reads A websites via RLS");
  await as(w.A.teacher); assert(await err("select public.website_save_draft($1,$2::jsonb,1)", [w.A.sid, JSON.stringify(doc())]) === "42501", "teacher save");
  await anon();
  assert(await err("select * from websites") === "42501", "anon select websites");
  assert(await err("select * from website_versions") === "42501", "anon select versions");
  assert(await err("select public.website_publish($1,null)", [w.A.sid]) === "42501", "anon publish");
  assert(await err("select public._website_data($1,null,true)", [w.A.sid]) === "42501", "anon _website_data");
});
await check("validator rejects script URLs, unknown blocks, bad variants, missing home, duplicates, oversize", async () => {
  const w = await world(); await as(w.A.admin);
  const bads = [
    doc("x", [{ id: "b3", type: "cta", props: { cta_href: "javascript:alert(1)" } }]),
    doc("x", [{ id: "b3", type: "cta", props: { cta_href: " DATA:text/html,<script>" } }]),
    doc("x", [{ id: "b3", type: "raw_html", props: {} }]),
    doc("x", [{ id: "b3", type: "hero", variant: "fancy", props: {} }]),
    doc("x", [{ id: "b1", type: "news", props: {} }]),
    { ...doc(), pages: [{ ...doc().pages[0], slug: "start" }] },
    { ...doc(), locales: ["fr"] },
    { ...doc(), theme: { primary: "red", secondary: "#000000" } },
    doc("x", [{ id: "b3", type: "rich_text", props: { body: { en: "x".repeat(700000) } } }]),
  ];
  for (const b of bads) assert(await err("select public.website_save_draft($1,$2::jsonb,0)", [w.A.sid, JSON.stringify(b)]) === "22023", `accepted ${JSON.stringify(b).slice(0, 120)}`);
});
await check("optimistic concurrency: a stale editor cannot overwrite a newer draft", async () => {
  const w = await world(); await as(w.A.admin); await save(w.A, doc("a"), 0); await save(w.A, doc("b"), 1);
  assert(await err("select public.website_save_draft($1,$2::jsonb,1)", [w.A.sid, JSON.stringify(doc("stale"))]) === "40001", "stale write accepted");
});
await check("rollback republishes an old version as a new version; history is immutable", async () => {
  const w = await world(); await as(w.A.admin);
  await save(w.A, doc("one"), 0); await c.query("select public.website_publish($1,null)", [w.A.sid]);
  await save(w.A, doc("two"), 1); await c.query("select public.website_publish($1,null)", [w.A.sid]);
  const v = (await c.query("select public.website_rollback($1,1) v", [w.A.sid])).rows[0].v; assert(v === 3, `v=${v}`);
  const r = await pub(null, w.A.slug); assert(r.version === 3 && r.document.pages[0].sections[0].blocks[0].props.heading.en === "one", "rollback content");
  await as(w.A.admin); const g = (await c.query("select public.website_get($1) g", [w.A.sid])).rows[0].g;
  assert(g.draft_rev === 3 && g.versions.length === 3 && g.versions[0].source === "rollback", JSON.stringify(g.versions));
  await owner(); assert(await err("update website_versions set note='x' where school_id=$1", [w.A.sid]) === "42501", "version mutable");
  assert(await err("delete from website_audit where school_id=$1", [w.A.sid]) === "42501", "audit deletable");
});
await check("custom domains: only verified hostnames resolve; host never falls back to a slug", async () => {
  const w = await world(); await owner();
  await c.query("insert into school_domains (school_id,hostname,purpose,status,is_primary) values ($1,'www.sima.sch.ng','public_site','verified',true),($1,'pending.sima.sch.ng','public_site','pending',false),($2,'old.simb.sch.ng','public_site','removed',false)", [w.A.sid, w.B.sid]);
  const r = await pub("WWW.SimA.sch.ng.", null); assert(r?.school_id === w.A.sid && r.canonical_host === "www.sima.sch.ng", "verified host");
  assert((await pub("pending.sima.sch.ng", null)) === null, "pending domain resolved");
  assert((await pub("old.simb.sch.ng", null)) === null, "removed domain resolved");
  assert((await pub("www.sima.sch.ng", w.B.slug)).school_id === w.A.sid, "slug overrode host");
  assert((await pub("unknown.example.com", w.B.slug)) === null, "unknown host fell back to slug");
  await owner(); await c.query("update schools set is_active=false where id=$1", [w.A.sid]);
  assert((await pub(null, w.A.slug)) === null && (await pub("www.sima.sch.ng", null)) === null, "inactive school served");
});
await check("opt-in personal data: staff only with a visible staff block; hostels and alumni only as totals", async () => {
  const w = await world(); await as(w.A.admin);
  await save(w.A, doc("x", [{ id: "b3", type: "staff_directory", hidden: true, props: {} }, { id: "b4", type: "boarding", props: {} }, { id: "b5", type: "alumni", props: {} }]), 0);
  await c.query("select public.website_publish($1,null)", [w.A.sid]);
  let r = await pub(null, w.A.slug); assert(!("staff" in r.data), "hidden staff block exposed staff");
  const s = JSON.stringify(r.data); assert(!s.includes("SECRET"), "room or alumni names exposed");
  assert(r.data.hostels[0].capacity === 12 && r.data.alumni.verified === 1, s.slice(0, 200));
  await as(w.A.admin); await save(w.A, doc("x", [{ id: "b3", type: "staff_directory", props: {} }]), 1); await c.query("select public.website_publish($1,null)", [w.A.sid]);
  r = await pub(null, w.A.slug); assert(r.data.staff?.length === 1 && r.data.staff[0].full_name === "A Teacher Person", "opt-in staff missing");
  assert(!JSON.stringify(r.data).includes("B Teacher"), "other school's staff");
});
await check("publish needs a draft and the catalog; website.manage permission is registered", async () => {
  const w = await world(); await as(w.A.admin);
  assert(await err("select public.website_publish($1,null)", [w.A.sid]) === "22023", "publish without draft");
  await owner(); const n = (await c.query("select count(*)::int n from role_template_permissions where permission_code='website.manage'")).rows[0].n;
  assert(n === 3, `grants ${n}`);
  await anon(); assert((await c.query("select count(*)::int n from website_block_types")).rows[0].n >= 25, "catalog not public");
});

const ok = results.filter((r) => r.ok).length;
console.log(`website engine: ${ok}/${results.length} passed`);
for (const r of results) console.log(r.ok ? "PASS" : "FAIL", r.name, r.err ?? "");
fs.mkdirSync(new URL("../results/", import.meta.url), { recursive: true });
fs.writeFileSync(new URL("../results/website-100.json", import.meta.url), JSON.stringify({ at: new Date().toISOString(), ok, total: results.length, results }, null, 1));
await c.end(); process.exit(ok === results.length ? 0 : 1);

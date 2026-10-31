// SHERIVS-101 website v2 sim: posts authoring roles, scheduling, public reads and tenant isolation. Local only.
// Usage: PGPORT=54372 PGDATABASE=postgres node tools/sim-lab/sim/website-v2.mjs
import pg from "pg";
import fs from "node:fs";
import { randomUUID as uuid } from "node:crypto";
const c = new pg.Client({
  host: "127.0.0.1",
  port: +(process.env.PGPORT || 54329),
  user: "postgres",
  database: process.env.PGDATABASE || "postgres",
});
await c.connect();
const results = [];
async function check(name, fn) {
  await c.query("BEGIN");
  try {
    await fn();
    results.push({ name, ok: true });
  } catch (e) {
    results.push({ name, ok: false, err: String(e.message).slice(0, 300) });
  } finally {
    await c.query("ROLLBACK");
  }
}
const as = async (uid) => {
  await c.query("RESET ROLE");
  await c.query("SET LOCAL ROLE authenticated");
  await c.query("select set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({ sub: uid, role: "authenticated" }),
  ]);
};
const anon = async () => {
  await c.query("RESET ROLE");
  await c.query("SET LOCAL ROLE anon");
  await c.query("select set_config('request.jwt.claims','{\"role\":\"anon\"}',true)");
};
const owner = async () => {
  await c.query("RESET ROLE");
  await c.query("select set_config('request.jwt.claims','{}',true)");
};
const assert = (v, m) => {
  if (!v) throw new Error(m);
};
async function err(sql, p = []) {
  await c.query("SAVEPOINT s");
  try {
    await c.query(sql, p);
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT s");
    return e.code || "ERR";
  }
  await c.query("ROLLBACK TO SAVEPOINT s");
  return null;
}
const one = async (sql, p = []) => (await c.query(sql, p)).rows[0];
const doc = (blog = true) => ({
  schema: 1,
  locales: ["en", "ha"],
  theme: {
    primary: "#ffd400",
    secondary: "#0b6b3a",
    font: "system",
    radius: "soft",
    pairing: "classic",
    dark: "auto",
    credit: false,
  },
  seo: { favicon: "/media/icon.png", og_image: "https://cdn.example.org/og.jpg" },
  pages: [
    {
      id: "p-home",
      slug: "home",
      title: { en: "Home" },
      nav: true,
      sections: [
        {
          id: "s1",
          background: "default",
          layout: "stack",
          blocks: [
            { id: "b1", type: "hero", variant: "crest", props: {} },
            ...(blog ? [{ id: "b2", type: "blog", variant: "featured", props: {} }] : []),
            {
              id: "b3",
              type: "policies",
              variant: "accordion",
              props: { items: [{ title: { en: "Privacy" }, kind: "privacy" }] },
            },
          ],
        },
      ],
    },
  ],
});
async function world() {
  await owner();
  const w = {};
  for (const k of ["A", "B"]) {
    const sid = uuid(),
      admin = uuid(),
      author = uuid(),
      teacher = uuid();
    await c.query(
      "INSERT INTO schools (id,name,slug,subscription_tier,subscription_status,is_active,max_students,primary_color,secondary_color) VALUES ($1,$2,$3,'growth','active',true,1000,'#c8102e','#ffd400')",
      [sid, `Sim ${k}`, `simv2-${k.toLowerCase()}-${sid.slice(0, 6)}`],
    );
    for (const [u, role] of [
      [admin, "admin"],
      [author, "staff"],
      [teacher, "teacher"],
    ]) {
      await c.query("INSERT INTO auth.users (id,email) VALUES ($1,$2)", [
        u,
        `${role}-${u.slice(0, 6)}@sim.invalid`,
      ]);
      await c.query(
        "INSERT INTO users (id,school_id,full_name,email,role) VALUES ($1,$2,$3,$4,$5)",
        [u, sid, role, `${role}-${u.slice(0, 6)}@sim.invalid`, role === "staff" ? "teacher" : role],
      );
    }
    await c.query(
      "INSERT INTO user_role_assignments (org_id,user_id,role_code,scope_type,status) VALUES ($1,$2,'ng.admissions_officer_school','org','active')",
      [sid, author],
    );
    w[k] = {
      sid,
      admin,
      author,
      teacher,
      slug: (await one("select slug from schools where id=$1", [sid])).slug,
    };
    await as(admin);
    await c.query("select website_save_draft($1,$2,0)", [sid, JSON.stringify(doc())]);
    await c.query("select website_publish($1,'v2 sim')", [sid]);
    await owner();
  }
  return w;
}
const post = (o = {}) =>
  JSON.stringify({
    slug: "sports-day",
    title: { en: "Sports day", ha: "Ranar wasanni" },
    excerpt: { en: "Blue house won" },
    body: { en: "We had **fun**." },
    category: "Sports",
    author_name: "Mrs A",
    cover_url: "/media/s.jpg",
    status: "draft",
    ...o,
  });

await check(
  "v2 theme + seo validate; bad pairing, bad favicon and javascript: rejected",
  async () => {
    const w = await world();
    await as(w.A.admin);
    const bad = doc();
    bad.theme.pairing = "comic";
    assert(
      (await err("select website_save_draft($1,$2,1)", [w.A.sid, JSON.stringify(bad)])) === "22023",
      "pairing accepted",
    );
    const bad2 = doc();
    bad2.seo.favicon = "http://x.test/a.png";
    assert(
      (await err("select website_save_draft($1,$2,1)", [w.A.sid, JSON.stringify(bad2)])) ===
        "22023",
      "http favicon accepted",
    );
    const bad3 = doc();
    bad3.seo.og_image = "javascript:alert(1)";
    assert(
      (await err("select website_save_draft($1,$2,1)", [w.A.sid, JSON.stringify(bad3)])) ===
        "22023",
      "js og accepted",
    );
  },
);
await check("author writes drafts but cannot publish; editor publishes", async () => {
  const w = await world();
  await as(w.A.author);
  const id = (await one("select website_post_save($1,$2) id", [w.A.sid, post()])).id;
  assert(id, "author draft failed");
  assert(
    (await err("select website_post_save($1,$2)", [w.A.sid, post({ id, status: "published" })])) ===
      "42501",
    "author published",
  );
  await as(w.A.admin);
  await c.query("select website_post_save($1,$2)", [w.A.sid, post({ id, status: "published" })]);
  await as(w.A.author);
  assert(
    (await err("select website_post_save($1,$2)", [
      w.A.sid,
      post({ id, title: { en: "Hacked" } }),
    ])) === "42501",
    "author edited a published post",
  );
  assert(
    (await err("select website_post_delete($1,$2)", [w.A.sid, id])) === "42501",
    "author deleted a published post",
  );
});
await check("teacher (no website permission) and anon cannot read or write posts", async () => {
  const w = await world();
  await as(w.A.teacher);
  assert(
    (await err("select website_post_save($1,$2)", [w.A.sid, post()])) === "42501",
    "teacher wrote",
  );
  assert((await err("select website_posts_list($1)", [w.A.sid])) === "42501", "teacher listed");
  assert(
    Number((await one("select count(*) n from website_posts")).n) === 0,
    "teacher sees rows via RLS",
  );
  await anon();
  assert((await err("select website_post_save($1,$2)", [w.A.sid, post()])) !== null, "anon wrote");
  assert((await err("select * from website_posts")) !== null, "anon table read");
});
await check(
  "public site shows only published, due posts; drafts and scheduled stay hidden",
  async () => {
    const w = await world();
    await as(w.A.admin);
    await c.query("select website_post_save($1,$2)", [
      w.A.sid,
      post({ slug: "live", status: "published", publish_at: "2026-01-01T00:00:00Z" }),
    ]);
    await c.query("select website_post_save($1,$2)", [
      w.A.sid,
      post({ slug: "later", status: "published", publish_at: "2099-01-01T00:00:00Z" }),
    ]);
    await c.query("select website_post_save($1,$2)", [w.A.sid, post({ slug: "draft" })]);
    await anon();
    const site = (await one("select website_public(null,$1) j", [w.A.slug])).j;
    const slugs = (site.data.posts ?? []).map((p) => p.slug);
    assert(JSON.stringify(slugs) === '["live"]', `posts ${JSON.stringify(slugs)}`);
    assert(!JSON.stringify(site.data.posts).includes("fun"), "body leaked into list");
    assert(
      (
        await one("select website_public_post(null,$1,'live') j", [w.A.slug])
      ).j.post.body.en.includes("fun"),
      "post body missing",
    );
    assert(
      (await one("select website_public_post(null,$1,'later') j", [w.A.slug])).j.post === null,
      "scheduled post visible",
    );
    assert(
      (await one("select website_public_post(null,$1,'draft') j", [w.A.slug])).j.post === null,
      "draft visible",
    );
  },
);
await check("tenant isolation: B's host cannot read A's post; A cannot write into B", async () => {
  const w = await world();
  await as(w.A.admin);
  await c.query("select website_post_save($1,$2)", [
    w.A.sid,
    post({ slug: "a-secret-ish", status: "published" }),
  ]);
  assert(
    (await err("select website_post_save($1,$2)", [w.B.sid, post({ status: "published" })])) ===
      "42501",
    "A admin wrote into B",
  );
  const aid = (await one("select id from website_posts where school_id=$1", [w.A.sid])).id;
  await as(w.B.admin);
  assert(
    (await err("select website_post_save($1,$2)", [
      w.B.sid,
      post({ id: aid, status: "published" }),
    ])) === "P0002",
    "B edited A's post by id",
  );
  await c.query("select website_post_delete($1,$2)", [w.B.sid, aid]);
  await anon();
  assert(
    (await one("select website_public_post(null,$1,'a-secret-ish') j", [w.B.slug])).j.post === null,
    "A's post on B's site",
  );
  assert(
    (await one("select website_public_post(null,$1,'a-secret-ish') j", [w.A.slug])).j.post !== null,
    "B deleted A's post",
  );
});
await check("blog-less site carries no posts in its public bundle", async () => {
  const w = await world();
  await as(w.A.admin);
  await c.query("select website_post_save($1,$2)", [w.A.sid, post({ status: "published" })]);
  const r = await one("select draft_rev from websites where school_id=$1", [w.A.sid]);
  await c.query("select website_save_draft($1,$2,$3)", [
    w.A.sid,
    JSON.stringify(doc(false)),
    r.draft_rev,
  ]);
  await c.query("select website_publish($1,null)", [w.A.sid]);
  await anon();
  assert(
    !("posts" in (await one("select website_public(null,$1) j", [w.A.slug])).j.data),
    "posts present without blog block",
  );
});
await check(
  "brand colours: managers set schools.primary/secondary; others cannot; hex enforced",
  async () => {
    const w = await world();
    await as(w.A.admin);
    await c.query("select website_set_brand($1,'#123ABC','#ffd400')", [w.A.sid]);
    assert(
      (await err("select website_set_brand($1,'red','#ffd400')", [w.A.sid])) === "22023",
      "non-hex accepted",
    );
    assert(
      (await err("select website_set_brand($1,'#000000','#ffffff')", [w.B.sid])) === "42501",
      "cross-tenant brand write",
    );
    await as(w.A.author);
    assert(
      (await err("select website_set_brand($1,'#000000','#ffffff')", [w.A.sid])) === "42501",
      "author changed brand",
    );
    await owner();
    assert(
      (await one("select primary_color p from schools where id=$1", [w.A.sid])).p === "#123abc",
      "not saved",
    );
  },
);
await check("post validation: slug, lengths, script URLs, duplicate links", async () => {
  const w = await world();
  await as(w.A.admin);
  assert(
    (await err("select website_post_save($1,$2)", [w.A.sid, post({ slug: "Bad Slug" })])) ===
      "22023",
    "bad slug",
  );
  assert(
    (await err("select website_post_save($1,$2)", [
      w.A.sid,
      post({ cover_url: "javascript:alert(1)" }),
    ])) === "22023",
    "js cover",
  );
  assert(
    (await err("select website_post_save($1,$2)", [w.A.sid, post({ title: { en: "" } })])) ===
      "22023",
    "empty title",
  );
  assert(
    (await err("select website_post_save($1,$2)", [
      w.A.sid,
      post({ title: { fr: "Bonjour" } }),
    ])) === "22023",
    "unknown locale",
  );
  await c.query("select website_post_save($1,$2)", [w.A.sid, post()]);
  assert(
    (await err("select website_post_save($1,$2)", [w.A.sid, post()])) === "23505",
    "duplicate slug",
  );
  assert(
    Number(
      (
        await one(
          "select count(*) n from website_audit where school_id=$1 and action='post.save'",
          [w.A.sid],
        )
      ).n,
    ) >= 1,
    "no audit",
  );
});
await c.end();
const pass = results.filter((r) => r.ok).length;
console.log(`website v2 sim: ${pass}/${results.length} PASS`);
for (const r of results.filter((r) => !r.ok)) console.log("FAIL", r.name, "::", r.err);
fs.mkdirSync("results", { recursive: true });
fs.writeFileSync(
  "results/sim-101-website-v2.json",
  JSON.stringify({ at: new Date().toISOString(), pass, total: results.length, results }, null, 1),
);

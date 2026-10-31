// SHERIVS-101: give the three demo organizations (seeded by website-demo-seed.mjs) v2 content and per-school
// design choices, as each school's own admin would in /admin/website: logo, font pairing, hero style, rules,
// policies, term dates, PTA, downloads, vacancies and blog posts (published + one scheduled). Local sim only.
// Usage: DEMO_BUNDLE=/path/demo-bundle.mjs PGPORT=54372 PGDATABASE=v2 node tools/sim-lab/sim/website-v2-demo.mjs
import pg from "pg";
const { DEMO_FACTS, generateSite } = await import(process.env.DEMO_BUNDLE);
const c = new pg.Client({
  host: "127.0.0.1",
  port: +(process.env.PGPORT || 54329),
  user: "postgres",
  database: process.env.PGDATABASE || "postgres",
});
await c.connect();
const q = (s, p) => c.query(s, p);
const EXTRA = {
  lagosNurseryPrimary: {
    choices: { pairing: "friendly", radius: "round", hero: "centered" },
    onboarding: {
      academic: {
        terms: [
          {
            name: "First term",
            starts: "2026-09-14",
            ends: "2026-12-11",
            note: "Mid-term break 26–30 October",
          },
          { name: "Second term", starts: "2027-01-11", ends: "2027-04-01" },
          { name: "Third term", starts: "2027-04-26", ends: "2027-07-23" },
        ],
      },
      pta: {
        about:
          "Every parent is a member of our PTA. We meet once a term to plan events, support teachers and welcome new families.",
        meetings: "First Saturday of each term, 10:00am, school hall.",
        contact: "mailto:pta@littlepearls.demo",
        executives: [
          { name: "Mrs Funke Adebayo", role: "Chairperson" },
          { name: "Mr Chidi Okafor", role: "Secretary" },
          { name: "Mrs Aisha Bello", role: "Treasurer" },
        ],
      },
      downloads: [
        { label: "Admission form 2026/27", href: "/files/admission-form.pdf", group: "Admissions" },
        { label: "Primary 1–3 booklist", href: "/files/booklist-p1-3.pdf", group: "Booklists" },
      ],
      policies: {
        uniform:
          "Pink gingham dress or shirt with navy shorts/skirt, white socks and black shoes. Fridays: house T-shirt.",
        fees_refund:
          "Fees are paid per term before resumption. Deposits are refundable up to two weeks before resumption, less a ₦10,000 processing charge.",
      },
    },
    posts: [
      {
        slug: "inter-house-sports-2026",
        title: "Blue House wins Inter-House Sports 2026",
        excerpt: "A morning of races, relays and cheering families at our Lekki campus.",
        category: "Sports",
        author: "Mrs Adeyemi",
        at: "2026-10-18T10:00:00Z",
      },
      {
        slug: "reading-week",
        title: "Reading Week: 1,200 books read in five days",
        excerpt:
          "Pupils read with parents, older pupils read to nursery classes, and every class visited the library.",
        category: "Academics",
        author: "Head Teacher",
        at: "2026-10-09T09:00:00Z",
      },
      {
        slug: "end-of-term-concert",
        title: "End-of-term concert",
        excerpt: "Scheduled post: appears on its date.",
        category: "Events",
        author: "Head Teacher",
        at: "2099-12-05T09:00:00Z",
      },
    ],
  },
  bornoSecondary: {
    choices: { pairing: "classic", radius: "soft", hero: "crest" },
    onboarding: {
      academic: {
        terms: [
          { name: "First term", starts: "2026-09-21", ends: "2026-12-18" },
          { name: "Second term", starts: "2027-01-11", ends: "2027-04-09" },
        ],
      },
      vacancies: [
        {
          title: "Mathematics teacher (SS1–SS3)",
          type: "Full-time",
          closes: "2026-12-31",
          summary: "B.Sc/B.Ed Mathematics, TRCN registration.",
          apply: "mailto:principal@gssgwange.demo",
        },
      ],
    },
    posts: [
      {
        slug: "waec-results-2026",
        title: "WASSCE 2026: 87% credit pass in five subjects",
        excerpt: "Our best results in ten years, including English and Mathematics.",
        category: "Results",
        author: "Principal",
        at: "2026-09-02T08:00:00Z",
      },
      {
        slug: "science-fair",
        title: "Students build a solar water pump at the state science fair",
        excerpt: "SS2 Physics students took second place in Maiduguri.",
        category: "Achievements",
        author: "Mal. Bukar",
        at: "2026-10-12T08:00:00Z",
      },
    ],
  },
  federalUniversity: {
    choices: { pairing: "scholarly", radius: "square", hero: "crest", stats: "cards" },
    onboarding: {
      vacancies: [
        {
          title: "Lecturer II, Computer Science",
          type: "Academic",
          closes: "2026-11-30",
          summary: "PhD or M.Sc with publications. Apply with CV and three referees.",
          apply: "mailto:registrar@fuarewa.demo",
        },
      ],
      downloads: [
        {
          label: "Undergraduate prospectus 2026/27",
          href: "/files/prospectus.pdf",
          group: "Admissions",
        },
        { label: "Student handbook", href: "/files/handbook.pdf", group: "Students" },
      ],
      policies: {
        ict: "University network and e-learning accounts are for academic use. Sharing passwords, piracy and attacks on systems lead to suspension of access and disciplinary action.",
      },
    },
    posts: [
      {
        slug: "matriculation-2026",
        title: "4,812 new students matriculate",
        excerpt: "The Vice-Chancellor welcomed the 2026/27 class at the main auditorium.",
        category: "Campus",
        author: "Registry",
        at: "2026-10-16T09:00:00Z",
      },
      {
        slug: "research-grant",
        title: "TETFund grant for drought-resistant millet research",
        excerpt: "The Faculty of Agriculture wins ₦85m for a three-year study.",
        category: "Research",
        author: "Directorate of Research",
        at: "2026-10-03T09:00:00Z",
      },
      {
        slug: "convocation",
        title: "Convocation 2026 programme",
        excerpt: "Order of events and venues for graduands and guests.",
        category: "Events",
        author: "Registry",
        at: "2026-09-20T09:00:00Z",
      },
    ],
  },
};
const out = {};
for (const [key, x] of Object.entries(EXTRA)) {
  const f = DEMO_FACTS[key];
  const {
    rows: [s],
  } = await q("SELECT id FROM schools WHERE slug=$1", [f.data.school.slug]);
  const {
    rows: [admin],
  } = await q("SELECT id FROM users WHERE school_id=$1 AND role='admin' LIMIT 1", [s.id]);
  await q("UPDATE schools SET logo_url='/site-icon.svg' WHERE id=$1 AND logo_url IS NULL", [s.id]);
  await q("BEGIN");
  await q("SET LOCAL ROLE authenticated");
  await q("SELECT set_config('request.jwt.claims',$1,true)", [
    JSON.stringify({ sub: admin.id, role: "authenticated" }),
  ]);
  const facts = {
    data: { ...f.data, school: { ...f.data.school, logo_url: "/site-icon.svg" } },
    onboarding: { ...(f.onboarding ?? {}), ...x.onboarding },
  };
  const doc = generateSite(facts);
  doc.theme.pairing = x.choices.pairing;
  doc.theme.radius = x.choices.radius;
  for (const p of doc.pages)
    for (const sec of p.sections)
      for (const b of sec.blocks) {
        if (b.type === "hero") b.variant = x.choices.hero;
        if (b.type === "stats" && x.choices.stats) b.variant = x.choices.stats;
      }
  for (const p of x.posts)
    if (
      !(await q("SELECT 1 FROM website_posts WHERE school_id=$1 AND slug=$2", [s.id, p.slug]))
        .rowCount
    )
      await q("SELECT website_post_save($1,$2)", [
        s.id,
        JSON.stringify({
          slug: p.slug,
          title: { en: p.title },
          excerpt: { en: p.excerpt },
          body: { en: `${p.excerpt}\n\nMore details are available from the school office.` },
          category: p.category,
          author_name: p.author,
          status: "published",
          publish_at: p.at,
        }),
      ]);
  const {
    rows: [w],
  } = await q("SELECT website_get($1) j", [s.id]);
  await q("SELECT website_save_draft($1,$2,$3)", [s.id, JSON.stringify(doc), w.j.draft_rev]);
  const {
    rows: [v],
  } = await q("SELECT website_publish($1,'v2 demo content') v", [s.id]);
  await q("COMMIT");
  out[key] = {
    slug: f.data.school.slug,
    version: v.v,
    pages: doc.pages.map((p) => p.slug),
    pairing: doc.theme.pairing,
  };
}
console.log(JSON.stringify(out, null, 1));
await c.end();

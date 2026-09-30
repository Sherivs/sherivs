/**
 * Public school site — section components.
 *
 * Each section is an isolated component that:
 *   - receives the active `school` row,
 *   - fetches its own data via TanStack Query,
 *   - renders a labelled skeleton when content is absent,
 *   - never references another section.
 *
 * Atoms, navbar, footer and section header live in ./_shared.tsx.
 * The composer (./site.tsx) is responsible for wiring sections to
 * the per-school enable flags.
 */
import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { Eye, Target, Phone, Mail, MapPin, Clock, Quote, Star, ArrowRight } from "lucide-react";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";
import { supabase } from "@/integrations/supabase/client";
import type { SchoolRow } from "@/contexts/app-context";
import {
  SectionBadge,
  GlassCard,
  DashedBox,
  Initial,
  Reveal,
  BackgroundOrbs,
  Particles,
  SectionHeader,
} from "./_shared";

/* ------------------------------------------------------------------ */
/* Section 1 — Hero                                                    */
/* ------------------------------------------------------------------ */

export function HeroSection({ school }: { school: SchoolRow }) {
  const sid = school.id;
  const stats = useQuery({
    queryKey: ["pub-hero-stats", sid],
    queryFn: async () => {
      const [s, t, p] = await Promise.all([
        supabase.from("students").select("id", { head: true, count: "exact" }).eq("school_id", sid),
        supabase
          .from("users")
          .select("id", { head: true, count: "exact" })
          .eq("school_id", sid)
          .eq("role", "teacher")
          .eq("is_active", true),
        supabase
          .from("academic_programs")
          .select("id", { head: true, count: "exact" })
          .eq("school_id", sid)
          .eq("is_published", true),
      ]);
      return { students: s.count ?? 0, teachers: t.count ?? 0, programs: p.count ?? 0 };
    },
  });

  const headline = school.hero_headline as string | null;
  const subline = (school.hero_subheadline as string | null) ?? (school.motto as string | null);
  const ctaText = (school.hero_cta_text as string | null) ?? "Apply Now";
  const foundedYear = school.founded_year as number | null;
  const years = foundedYear ? new Date().getFullYear() - foundedYear : 0;

  // 0 is a valid count — show "0", only fall back to "—" while loading.
  const showCount = (n: number | undefined) => (n === undefined ? "—" : n);
  const items = [
    { label: "Students Enrolled", value: showCount(stats.data?.students) },
    { label: "Active Teachers", value: showCount(stats.data?.teachers) },
    { label: "Programs", value: showCount(stats.data?.programs) },
    { label: "Years of Excellence", value: years > 0 ? years : "—" },
  ];

  return (
    <section id="home" className="relative flex min-h-dvh items-center overflow-hidden pt-32 pb-16">
      <BackgroundOrbs />
      <Particles />
      <div className="relative z-10 mx-auto grid max-w-7xl gap-12 px-6 md:px-8 lg:grid-cols-[3fr_2fr]">
        <Reveal>
          <div>
            <SectionBadge label="HERO_SECTION" />
            <h1 className="mt-6 font-display text-4xl font-bold leading-none tracking-tight text-white md:text-7xl">
              {headline ?? (
                <DashedBox label="MAIN HEADLINE" hint="Set in Settings → Hero" className="h-24" />
              )}
            </h1>
            <div className="mt-6 max-w-xl text-base leading-relaxed text-white/70 md:text-lg">
              {subline ?? <DashedBox label="TAGLINE / MOTTO" />}
            </div>
            <div className="mt-10 flex flex-wrap gap-4">
              <Link
                to="/admissions"
                className="rounded-full px-6 py-3 text-sm font-semibold text-white shadow-xl transition-transform hover:scale-105"
                style={{ background: "var(--tenant-primary, #3b82f6)" }}
              >
                {ctaText}
              </Link>
              <a
                href="#about"
                className="rounded-full border border-white/15 px-6 py-3 text-sm font-semibold text-white/90 transition-colors hover:bg-white/5"
              >
                Explore School
              </a>
            </div>
          </div>
        </Reveal>

        <Reveal delay={120}>
          <div className="hidden grid-cols-2 gap-6 lg:grid">
            {items.map((it, i) => (
              <GlassCard key={i} className="p-6">
                <div className="font-display text-4xl font-bold text-white">{it.value}</div>
                <div className="mt-2 text-xs font-semibold uppercase tracking-[0.2em] text-white/50">
                  {it.label}
                </div>
              </GlassCard>
            ))}
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Section 2 — About                                                   */
/* ------------------------------------------------------------------ */

export function AboutSection({ school }: { school: SchoolRow }) {
  const about = school.about as string | null;
  const vision = school.school_vision as string | null;
  const mission = school.school_mission as string | null;
  const founded = school.founded_year as number | null;
  return (
    <section id="about" className="relative py-24 md:py-32">
      <div className="mx-auto max-w-7xl px-6 md:px-8">
        <Reveal>
          <div className="flex flex-col items-center text-center">
            <SectionBadge label="ABOUT_US_SECTION" />
            <h2 className="mt-4 font-display text-4xl font-bold tracking-tight text-white">
              About {school.name}
            </h2>
          </div>
        </Reveal>

        <div className="mt-14 grid gap-8 lg:grid-cols-2">
          <Reveal>
            <div className="space-y-6">
              {about ? (
                <p className="text-base leading-relaxed text-white/70">{about}</p>
              ) : (
                <DashedBox
                  label="SCHOOL DESCRIPTION"
                  hint="Admin adds this in Settings → School Profile"
                  className="h-40"
                />
              )}
              {founded ? (
                <div className="flex items-center gap-4 text-sm text-white/60">
                  <span className="font-semibold uppercase tracking-[0.2em] text-white/40">
                    Est.
                  </span>
                  <span className="font-display text-2xl text-white">{founded}</span>
                  <span className="h-px flex-1 bg-white/10" />
                </div>
              ) : (
                <DashedBox label="FOUNDED YEAR" />
              )}
            </div>
          </Reveal>

          <Reveal delay={80}>
            <div className="space-y-6">
              <GlassCard className="p-7">
                <div className="flex items-start gap-4">
                  <div className="grid h-10 w-10 place-items-center rounded-xl bg-white/5 text-white/80">
                    <Eye className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.25em] text-white/40">
                      Our Vision
                    </div>
                    <div className="mt-3 text-sm leading-relaxed text-white/80">
                      {vision ?? (
                        <span className="text-white/30">Add a vision statement in Settings.</span>
                      )}
                    </div>
                  </div>
                </div>
              </GlassCard>
              <GlassCard className="p-7">
                <div className="flex items-start gap-4">
                  <div className="grid h-10 w-10 place-items-center rounded-xl bg-white/5 text-white/80">
                    <Target className="h-5 w-5" />
                  </div>
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.25em] text-white/40">
                      Our Mission
                    </div>
                    <div className="mt-3 text-sm leading-relaxed text-white/80">
                      {mission ?? (
                        <span className="text-white/30">Add a mission statement in Settings.</span>
                      )}
                    </div>
                  </div>
                </div>
              </GlassCard>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Section 3 — Why Us                                                  */
/* ------------------------------------------------------------------ */

export function WhyUsSection({ school }: { school: SchoolRow }) {
  const sid = school.id;
  const q = useQuery({
    queryKey: ["pub-why-us", sid],
    queryFn: async () => {
      const { data } = await supabase
        .from("why_us_items")
        .select("id, title, description, icon, order_index")
        .eq("school_id", sid)
        .eq("is_published", true)
        .order("order_index");
      return data ?? [];
    },
  });
  const items = q.data ?? [];
  return (
    <section id="why-us" className="relative py-24 md:py-32">
      <div className="mx-auto max-w-7xl px-6 md:px-8">
        <SectionHeader
          badge="WHY_CHOOSE_US"
          title="Why Choose Us"
          subtitle="What sets us apart from every other institution"
        />
        <div className="mt-14 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {items.length === 0
            ? Array.from({ length: 6 }).map((_, i) => (
                <Reveal key={i} delay={i * 60}>
                  <DashedBox label="WHY-US ITEM" className="h-40" />
                </Reveal>
              ))
            : items.map((it, i) => (
                <Reveal key={it.id} delay={i * 60}>
                  <GlassCard className="p-7">
                    <div className="text-4xl">{(it.icon as string) || "✨"}</div>
                    <h3 className="mt-4 font-display text-lg font-semibold text-white">
                      {it.title}
                    </h3>
                    <p className="mt-2 text-sm leading-relaxed text-white/60">{it.description}</p>
                  </GlassCard>
                </Reveal>
              ))}
        </div>
        {items.length === 0 && (
          <p className="mt-6 text-center text-xs text-white/30">
            Add advantages in Admin → CMS → Why Us
          </p>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Section 4 — Academic Programs                                       */
/* ------------------------------------------------------------------ */

export function ProgramsSection({ school }: { school: SchoolRow }) {
  const sid = school.id;
  const q = useQuery({
    queryKey: ["pub-programs", sid],
    queryFn: async () => {
      const { data } = await supabase
        .from("academic_programs")
        .select("id, name, description, age_range, duration, order_index")
        .eq("school_id", sid)
        .eq("is_published", true)
        .order("order_index");
      return data ?? [];
    },
  });
  const items = q.data ?? [];
  return (
    <section id="academics" className="relative py-24 md:py-32">
      <div className="mx-auto max-w-7xl px-6 md:px-8">
        <SectionHeader
          badge="ACADEMICS"
          title="Academic Programs"
          subtitle="Excellence across every level of education"
        />
        <div className="mt-14 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {items.length === 0
            ? Array.from({ length: 3 }).map((_, i) => (
                <Reveal key={i} delay={i * 60}>
                  <DashedBox
                    label="PROGRAM"
                    hint="Add in Admin → CMS → Academic Programs"
                    className="h-48"
                  />
                </Reveal>
              ))
            : items.map((p, i) => (
                <Reveal key={p.id} delay={i * 60}>
                  <GlassCard className="relative p-7">
                    <div
                      aria-hidden
                      className="absolute inset-x-0 top-0 h-px"
                      style={{ background: "var(--tenant-primary, #3b82f6)" }}
                    />
                    <h3 className="font-display text-xl font-semibold text-white">{p.name}</h3>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {p.age_range && (
                        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-widest text-white/60">
                          {p.age_range}
                        </span>
                      )}
                      {p.duration && (
                        <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-[11px] uppercase tracking-widest text-white/60">
                          {p.duration}
                        </span>
                      )}
                    </div>
                    <p className="mt-4 text-sm leading-relaxed text-white/60">{p.description}</p>
                  </GlassCard>
                </Reveal>
              ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Section 5 — Facilities                                              */
/* ------------------------------------------------------------------ */

export function FacilitiesSection({ school }: { school: SchoolRow }) {
  const sid = school.id;
  const q = useQuery({
    queryKey: ["pub-facilities", sid],
    queryFn: async () => {
      const { data } = await supabase
        .from("school_facilities")
        .select("id, name, description, icon, order_index")
        .eq("school_id", sid)
        .eq("is_published", true)
        .order("order_index");
      return data ?? [];
    },
  });
  const items = q.data ?? [];
  return (
    <section id="facilities" className="relative py-24 md:py-32">
      <div className="mx-auto max-w-7xl px-6 md:px-8">
        <SectionHeader
          badge="FACILITIES"
          title="World-Class Facilities"
          subtitle="Built for excellence in learning and development"
        />
        <div className="mt-14 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {items.length === 0
            ? Array.from({ length: 6 }).map((_, i) => (
                <Reveal key={i} delay={i * 60}>
                  <DashedBox label="FACILITY" className="h-40" />
                </Reveal>
              ))
            : items.map((f, i) => (
                <Reveal key={f.id} delay={i * 60}>
                  <GlassCard className="p-7">
                    <div className="text-4xl transition-transform duration-500 group-hover:scale-110">
                      {(f.icon as string) || "🏫"}
                    </div>
                    <h3 className="mt-4 font-display text-lg font-semibold text-white">{f.name}</h3>
                    <p className="mt-2 text-sm leading-relaxed text-white/60">{f.description}</p>
                  </GlassCard>
                </Reveal>
              ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Section 6 — Staff                                                   */
/* ------------------------------------------------------------------ */

export function StaffSection({ school }: { school: SchoolRow }) {
  const sid = school.id;
  const q = useQuery({
    queryKey: ["pub-staff", sid],
    queryFn: async () => {
      // Prefer the CMS-curated staff cards; fall back to internal users
      const { data: curated } = await supabase
        .from("school_staff" as never)
        .select(
          "id, full_name, role, avatar_url, bio, subject_specialty, years_experience, qualification, order_index",
        )
        .eq("school_id", sid)
        .eq("is_published", true)
        .order("order_index");
      if (curated && curated.length > 0) return curated as never[];
      const { data } = await supabase
        .from("users")
        .select(
          "id, full_name, role, avatar_url, subject_specialty, years_experience, qualification",
        )
        .eq("school_id", sid)
        .in("role", ["teacher", "admin", "principal"])
        .eq("is_active", true)
        .order("full_name");
      return (data ?? []) as never[];
    },
  });
  const items = (q.data ?? []) as Array<{
    id: string;
    full_name: string;
    role: string | null;
    avatar_url: string | null;
    bio?: string | null;
    subject_specialty: string | null;
    years_experience: number | null;
    qualification: string | null;
  }>;
  // Always show at least 6 cards on the public site — pad with placeholders
  // so a school with only 1–2 staff still fills out the section like the design.
  const placeholdersNeeded = Math.max(0, 6 - items.length);
  return (
    <section id="staff" className="relative py-24 md:py-32">
      <div className="mx-auto max-w-7xl px-6 md:px-8">
        <SectionHeader
          badge="OUR_STAFF"
          title="Meet Our Team"
          subtitle="Dedicated professionals shaping future leaders"
        />
        <div className="mt-14 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {items.length === 0 ? (
            Array.from({ length: 6 }).map((_, i) => (
              <Reveal key={i} delay={i * 60}>
                <DashedBox
                  label="STAFF MEMBER"
                  hint="Add in Admin → CMS → Staff"
                  className="h-72"
                />
              </Reveal>
            ))
          ) : (
            <>
              {items.map((u, i) => {
                const role = String(u.role ?? "");
                const roleColor =
                  role === "principal"
                    ? "bg-amber-500/15 text-amber-300 border-amber-500/30"
                    : role === "admin"
                      ? "bg-violet-500/15 text-violet-300 border-violet-500/30"
                      : "bg-sky-500/15 text-sky-300 border-sky-500/30";
                return (
                  <Reveal key={u.id} delay={i * 60}>
                    <GlassCard className="p-6 text-center">
                      {u.avatar_url ? (
                        <img
                          src={u.avatar_url as string}
                          alt={String(u.full_name)}
                          className="mx-auto h-20 w-20 rounded-full object-cover"
                        />
                      ) : (
                        <Initial name={String(u.full_name)} size={80} className="mx-auto" />
                      )}
                      <h3 className="mt-4 font-display text-base font-semibold text-white">
                        {u.full_name as string}
                      </h3>
                      <span
                        className={
                          "mt-2 inline-block rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest " +
                          roleColor
                        }
                      >
                        {role}
                      </span>
                      {u.bio && (
                        <p className="mt-3 border-t border-white/5 pt-3 text-xs leading-relaxed text-white/70">
                          {u.bio}
                        </p>
                      )}
                      {u.subject_specialty && (
                        <p className="mt-2 text-xs text-white/60">
                          {u.subject_specialty as string}
                        </p>
                      )}
                      {u.years_experience ? (
                        <p className="mt-1 text-[11px] text-white/40">
                          {u.years_experience as number} years experience
                        </p>
                      ) : null}
                      {u.qualification && (
                        <span className="mt-2 inline-block rounded-full bg-white/5 px-2 py-0.5 text-[10px] text-white/60">
                          {u.qualification as string}
                        </span>
                      )}
                    </GlassCard>
                  </Reveal>
                );
              })}
              {Array.from({ length: placeholdersNeeded }).map((_, i) => (
                <Reveal key={`ph-${i}`} delay={(items.length + i) * 60}>
                  <DashedBox
                    label="STAFF MEMBER"
                    hint="Add in Admin → CMS → Staff"
                    className="h-72"
                  />
                </Reveal>
              ))}
            </>
          )}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Section 7 — News + Events tabs                                      */
/* ------------------------------------------------------------------ */

export function NewsEventsSection({ school }: { school: SchoolRow }) {
  const sid = school.id;
  const [tab, setTab] = useState<"all" | "news" | "events">("all");
  const news = useQuery({
    queryKey: ["pub-news", sid],
    queryFn: async () => {
      const { data } = await supabase
        .from("news")
        .select("id, title, excerpt, cover_image_url, category, published_at")
        .eq("school_id", sid)
        .eq("is_published", true)
        .order("published_at", { ascending: false })
        .limit(6);
      return data ?? [];
    },
  });
  const events = useQuery({
    queryKey: ["pub-events", sid],
    queryFn: async () => {
      const today = new Date().toISOString().slice(0, 10);
      const { data } = await supabase
        .from("events")
        .select("id, title, description, event_date, location, cover_image_url")
        .eq("school_id", sid)
        .eq("is_published", true)
        .gte("event_date", today)
        .order("event_date")
        .limit(6);
      return data ?? [];
    },
  });

  const combined: Array<{
    kind: "news" | "event";
    id: string;
    title: string;
    blurb: string | null;
    date: string | null;
    image: string | null;
    href: string;
    location?: string | null;
  }> = [
    ...(news.data ?? []).map((n) => ({
      kind: "news" as const,
      id: n.id as string,
      title: n.title as string,
      blurb: (n.excerpt as string | null) ?? null,
      date: (n.published_at as string | null) ?? null,
      image: (n.cover_image_url as string | null) ?? null,
      href: `/news/${n.id}`,
    })),
    ...(events.data ?? []).map((e) => ({
      kind: "event" as const,
      id: e.id as string,
      title: e.title as string,
      blurb: (e.description as string | null) ?? null,
      date: (e.event_date as string | null) ?? null,
      image: (e.cover_image_url as string | null) ?? null,
      href: `/events/${e.id}`,
      location: (e.location as string | null) ?? null,
    })),
  ];
  const filtered = tab === "all" ? combined : combined.filter((c) => c.kind === tab.slice(0, -1));

  return (
    <section id="news" className="relative py-24 md:py-32">
      <div className="mx-auto max-w-7xl px-6 md:px-8">
        <SectionHeader
          badge="NEWS_AND_EVENTS"
          title="Latest from Our School"
          subtitle="Stay connected with everything happening on campus"
        />
        <div className="mt-10 flex justify-center gap-2">
          {(["all", "news", "events"] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={
                "rounded-full px-4 py-1.5 text-xs font-semibold uppercase tracking-widest transition-colors " +
                (tab === t
                  ? "bg-white text-black"
                  : "border border-white/10 text-white/60 hover:bg-white/5")
              }
            >
              {t}
            </button>
          ))}
        </div>
        <div className="mt-10 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {filtered.length === 0
            ? Array.from({ length: 3 }).map((_, i) => (
                <Reveal key={i} delay={i * 60}>
                  <DashedBox label="NEWS ARTICLE" hint="Post in Admin → News" className="h-56" />
                </Reveal>
              ))
            : filtered.map((c, i) => (
                <Reveal key={c.id} delay={i * 60}>
                  <Link to={c.href} className="block">
                    <GlassCard className="overflow-hidden">
                      {c.image ? (
                        <img
                          src={c.image}
                          alt={c.title}
                          width={640}
                          height={192}
                          loading="lazy"
                          decoding="async"
                          className="h-48 w-full object-cover"
                        />
                      ) : (
                        <div className="h-48 w-full bg-gradient-to-br from-white/5 to-white/[0.02]" />
                      )}
                      <div className="p-6">
                        <span className="inline-block rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-widest text-white/60">
                          {c.kind}
                        </span>
                        <h3 className="mt-3 font-display text-lg font-semibold text-white">
                          {c.title}
                        </h3>
                        {c.blurb && (
                          <p className="mt-2 line-clamp-3 text-sm text-white/60">{c.blurb}</p>
                        )}
                        {c.date && (
                          <p className="mt-3 text-xs text-white/40">
                            {new Date(c.date).toLocaleDateString(undefined, {
                              month: "short",
                              day: "numeric",
                              year: "numeric",
                            })}
                            {c.location ? ` · ${c.location}` : ""}
                          </p>
                        )}
                      </div>
                    </GlassCard>
                  </Link>
                </Reveal>
              ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Section 8 — Testimonials                                            */
/* ------------------------------------------------------------------ */

export function TestimonialsSection({ school }: { school: SchoolRow }) {
  const sid = school.id;
  const q = useQuery({
    queryKey: ["pub-testimonials", sid],
    queryFn: async () => {
      const { data } = await supabase
        .from("testimonials")
        .select("id, name, role, content, rating, avatar_url, order_index")
        .eq("school_id", sid)
        .eq("is_published", true)
        .order("order_index");
      return data ?? [];
    },
  });
  const items = q.data ?? [];
  return (
    <section id="alumni" className="relative py-24 md:py-32">
      <div className="mx-auto max-w-7xl px-6 md:px-8">
        <SectionHeader
          badge="ALUMNI_AND_TESTIMONIALS"
          title="Parent and Alumni Voices"
          subtitle="Stories from our community that speak for themselves"
        />
        <div className="mt-14 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {items.length === 0
            ? Array.from({ length: 3 }).map((_, i) => (
                <Reveal key={i} delay={i * 60}>
                  <DashedBox label="TESTIMONIAL" className="h-56" />
                </Reveal>
              ))
            : items.map((t, i) => (
                <Reveal key={t.id} delay={i * 60}>
                  <GlassCard className="relative p-7">
                    <Quote
                      className="absolute right-6 top-6 h-10 w-10"
                      style={{ color: "var(--tenant-primary, #3b82f6)", opacity: 0.15 }}
                    />
                    <p className="text-sm italic leading-relaxed text-white/80">"{t.content}"</p>
                    <div className="mt-5 flex">
                      {Array.from({ length: 5 }).map((_, idx) => (
                        <Star
                          key={idx}
                          className={
                            "h-4 w-4 " +
                            (idx < ((t.rating as number) || 5)
                              ? "fill-amber-400 text-amber-400"
                              : "text-white/15")
                          }
                        />
                      ))}
                    </div>
                    <div className="mt-5 flex items-center gap-3 border-t border-white/[0.06] pt-4">
                      {t.avatar_url ? (
                        <img
                          src={t.avatar_url as string}
                          alt=""
                          className="h-10 w-10 rounded-full object-cover"
                        />
                      ) : (
                        <Initial name={String(t.name)} size={40} />
                      )}
                      <div>
                        <div className="text-sm font-semibold text-white">{t.name}</div>
                        {t.role && <div className="text-xs text-white/50">{t.role}</div>}
                      </div>
                    </div>
                  </GlassCard>
                </Reveal>
              ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Section 9 — Blog                                                    */
/* ------------------------------------------------------------------ */

export function BlogSection({ school }: { school: SchoolRow }) {
  const sid = school.id;
  const q = useQuery({
    queryKey: ["pub-blog", sid],
    queryFn: async () => {
      const { data } = await supabase
        .from("blog_posts")
        .select("id, slug, title, excerpt, cover_image_url, category, published_at")
        .eq("school_id", sid)
        .eq("is_published", true)
        .order("published_at", { ascending: false })
        .limit(3);
      return data ?? [];
    },
  });
  const items = q.data ?? [];
  return (
    <section id="blog" className="relative py-24 md:py-32">
      <div className="mx-auto max-w-7xl px-6 md:px-8">
        <SectionHeader
          badge="BLOG_AND_INSIGHTS"
          title="Insights from Our School"
          subtitle="Thought leadership in education"
        />
        <div className="mt-14 grid gap-6 md:grid-cols-3">
          {items.length === 0
            ? Array.from({ length: 3 }).map((_, i) => (
                <Reveal key={i} delay={i * 60}>
                  <DashedBox label="BLOG POST" className="h-72" />
                </Reveal>
              ))
            : items.map((p, i) => (
                <Reveal key={p.id} delay={i * 60}>
                  <Link to={`/blog/${p.slug as string}` as never} className="block">
                    <GlassCard className="overflow-hidden">
                      {p.cover_image_url ? (
                        <img
                          src={p.cover_image_url as string}
                          alt={p.title as string}
                          className="h-44 w-full object-cover"
                        />
                      ) : (
                        <div className="h-44 w-full bg-gradient-to-br from-white/5 to-white/[0.02]" />
                      )}
                      <div className="p-6">
                        {p.category && (
                          <span className="inline-block rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] uppercase tracking-widest text-white/60">
                            {p.category as string}
                          </span>
                        )}
                        <h3 className="mt-3 font-display text-lg font-semibold text-white">
                          {p.title as string}
                        </h3>
                        {p.excerpt && (
                          <p className="mt-2 line-clamp-2 text-sm text-white/60">
                            {p.excerpt as string}
                          </p>
                        )}
                        <div className="mt-4 flex items-center justify-end text-xs text-white/40">
                          {/* author lookup omitted */}
                          {p.published_at && (
                            <span>
                              {new Date(p.published_at as string).toLocaleDateString(undefined, {
                                month: "short",
                                day: "numeric",
                              })}
                            </span>
                          )}
                        </div>
                      </div>
                    </GlassCard>
                  </Link>
                </Reveal>
              ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Section 10 — Admissions CTA                                         */
/* ------------------------------------------------------------------ */

export function AdmissionsCtaSection({ school }: { school: SchoolRow }) {
  const reqs = school.admission_requirements as string | null;
  const timeline =
    (school.admission_timeline as Array<{ title: string; description?: string }> | null) ?? null;
  return (
    <section id="admissions-cta" className="relative py-24 md:py-32">
      <div className="mx-auto max-w-7xl px-6 md:px-8">
        <SectionHeader
          badge="ADMISSIONS"
          title="Join Our Community"
          subtitle="Applications are reviewed on a rolling basis"
        />
        <div className="mt-14 grid gap-8 lg:grid-cols-2">
          <Reveal>
            <div className="space-y-6">
              <h3 className="font-display text-lg font-semibold text-white">
                Admission Requirements
              </h3>
              {reqs ? (
                <p className="whitespace-pre-line text-sm leading-relaxed text-white/70">{reqs}</p>
              ) : (
                <DashedBox label="ADMISSION REQUIREMENTS" className="h-32" />
              )}
              <h3 className="mt-8 font-display text-lg font-semibold text-white">
                Application Timeline
              </h3>
              {timeline && timeline.length > 0 ? (
                <ol className="space-y-3">
                  {timeline.map((step, i) => (
                    <li key={i} className="flex gap-4">
                      <span
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-full text-sm font-bold text-white"
                        style={{ background: "var(--tenant-primary, #3b82f6)" }}
                      >
                        {i + 1}
                      </span>
                      <div>
                        <div className="text-sm font-semibold text-white">{step.title}</div>
                        {step.description && (
                          <div className="text-xs text-white/50">{step.description}</div>
                        )}
                      </div>
                    </li>
                  ))}
                </ol>
              ) : (
                <div className="space-y-3">
                  {[1, 2, 3].map((n) => (
                    <DashedBox key={n} label={`STEP ${n}`} />
                  ))}
                </div>
              )}
            </div>
          </Reveal>
          <Reveal delay={100}>
            <GlassCard className="p-10 text-center">
              <h3 className="font-display text-3xl font-bold text-white">Ready to Apply?</h3>
              <p className="mt-3 text-sm text-white/60">Start your application below.</p>
              <Link
                to="/admissions"
                className="mt-8 inline-flex w-full items-center justify-center gap-2 rounded-full px-8 py-4 text-base font-semibold text-white shadow-xl transition-transform hover:scale-105"
                style={{ background: "var(--tenant-primary, #3b82f6)" }}
              >
                Apply Now <ArrowRight className="h-4 w-4" />
              </Link>
              <a
                href="#contact"
                className="mt-4 inline-block text-sm text-white/60 underline-offset-4 hover:underline"
              >
                Or request more information
              </a>
            </GlassCard>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Section 11 — FAQs                                                   */
/* ------------------------------------------------------------------ */

export function FaqsSection({ school }: { school: SchoolRow }) {
  const sid = school.id;
  const q = useQuery({
    queryKey: ["pub-faqs", sid],
    queryFn: async () => {
      const { data } = await supabase
        .from("faqs")
        .select("id, question, answer, order_index")
        .eq("school_id", sid)
        .eq("is_published", true)
        .order("order_index");
      return data ?? [];
    },
  });
  const items = q.data ?? [];
  return (
    <section id="faqs" className="relative py-24 md:py-32">
      <div className="mx-auto max-w-4xl px-6 md:px-8">
        <SectionHeader badge="FREQUENTLY_ASKED_QUESTIONS" title="Questions? We have answers." />
        <div className="mt-14">
          {items.length === 0 ? (
            <div className="space-y-3">
              {[1, 2, 3].map((n) => (
                <DashedBox key={n} label="QUESTION" />
              ))}
              <p className="mt-2 text-center text-xs text-white/30">
                Add FAQs in Admin → CMS → FAQs
              </p>
            </div>
          ) : (
            <Accordion type="single" collapsible className="divide-y divide-white/[0.06]">
              {items.map((f) => (
                <AccordionItem key={f.id} value={f.id as string} className="border-0">
                  <AccordionTrigger className="text-left font-display text-base font-semibold text-white hover:no-underline">
                    {f.question as string}
                  </AccordionTrigger>
                  <AccordionContent className="text-sm leading-relaxed text-white/70">
                    {f.answer as string}
                  </AccordionContent>
                </AccordionItem>
              ))}
            </Accordion>
          )}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */

export function SportsSection({ school }: { school: SchoolRow }) {
  const sid = school.id;
  const q = useQuery({
    queryKey: ["pub-sports", sid],
    queryFn: async () => {
      const { data } = await supabase
        .from("school_sports")
        .select(
          "id, sport_name, sport_category, gender_category, age_groups, coach_name, training_days, training_time, achievements, facilities_description, order_index",
        )
        .eq("school_id", sid)
        .eq("is_active", true)
        .order("order_index");
      return data ?? [];
    },
  });
  const items = q.data ?? [];
  if (items.length === 0) return null;
  return (
    <section id="sports" className="relative py-24 md:py-32">
      <div className="mx-auto max-w-7xl px-6 md:px-8">
        <SectionHeader
          badge="SPORTS"
          title="Sports & Athletics"
          subtitle="Disciplines coached, schedules, and championships"
        />
        <div className="mt-14 grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {items.map((s, i) => (
            <Reveal key={s.id} delay={i * 60}>
              <GlassCard className="p-7">
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-lg font-semibold text-white">{s.sport_name}</h3>
                  {s.sport_category && (
                    <span className="rounded-full border border-white/10 bg-white/[0.04] px-2 py-0.5 text-[10px] uppercase tracking-wider text-white/50">
                      {s.sport_category}
                    </span>
                  )}
                </div>
                {s.coach_name && (
                  <p className="mt-2 text-xs text-white/50">Coach: {s.coach_name}</p>
                )}
                {(s.training_days || s.training_time) && (
                  <p className="mt-2 text-sm text-white/70">
                    {[s.training_days, s.training_time].filter(Boolean).join(" • ")}
                  </p>
                )}
                {s.age_groups && <p className="mt-1 text-xs text-white/50">Ages: {s.age_groups}</p>}
                {s.facilities_description && (
                  <p className="mt-3 text-sm leading-relaxed text-white/60">
                    {s.facilities_description}
                  </p>
                )}
                {s.achievements && (
                  <p className="mt-3 rounded-lg border border-white/10 bg-white/[0.03] p-3 text-xs italic text-white/60">
                    🏆 {s.achievements}
                  </p>
                )}
              </GlassCard>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Meals                                                               */
/* ------------------------------------------------------------------ */

export function MealsSection({ school }: { school: SchoolRow }) {
  const sid = school.id;
  const q = useQuery({
    queryKey: ["pub-meals", sid],
    queryFn: async () => {
      const { data } = await supabase
        .from("school_meals")
        .select("*")
        .eq("school_id", sid)
        .eq("meal_service_enabled", true)
        .maybeSingle();
      return data;
    },
  });
  const m = q.data;
  if (!m) return null;
  const services: Array<{ label: string; time: string | null; menu: string | null }> = [];
  if (m.breakfast_enabled)
    services.push({
      label: "Breakfast",
      time: m.breakfast_time,
      menu: m.breakfast_menu_description,
    });
  if (m.lunch_enabled)
    services.push({ label: "Lunch", time: m.lunch_time, menu: m.lunch_menu_description });
  if (m.snack_enabled) services.push({ label: "Snacks", time: m.snack_time, menu: null });

  const dietary = [
    m.has_vegetarian_option && "Vegetarian",
    m.has_halal_option && "Halal",
    m.has_allergy_accommodation && "Allergy-aware",
    m.dietitian_on_staff && "Dietitian on staff",
  ].filter(Boolean) as string[];

  return (
    <section id="meals" className="relative py-24 md:py-32">
      <div className="mx-auto max-w-7xl px-6 md:px-8">
        <SectionHeader
          badge="MEALS"
          title="Meals & Nutrition"
          subtitle="Daily menus, dietary options, and fees"
        />
        <div className="mt-14 grid gap-6 lg:grid-cols-2">
          <Reveal>
            <GlassCard className="p-7">
              <h3 className="font-display text-lg font-semibold text-white">Daily Service</h3>
              <div className="mt-4 space-y-4">
                {services.length === 0 ? (
                  <p className="text-sm text-white/50">Schedule will appear here.</p>
                ) : (
                  services.map((s) => (
                    <div
                      key={s.label}
                      className="rounded-xl border border-white/10 bg-white/[0.03] p-4"
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-semibold text-white">{s.label}</span>
                        {s.time && <span className="text-xs text-white/60">{s.time}</span>}
                      </div>
                      {s.menu && (
                        <p className="mt-2 text-sm leading-relaxed text-white/60">{s.menu}</p>
                      )}
                    </div>
                  ))
                )}
              </div>
            </GlassCard>
          </Reveal>
          <Reveal delay={100}>
            <GlassCard className="p-7">
              <h3 className="font-display text-lg font-semibold text-white">Details</h3>
              <dl className="mt-4 space-y-3 text-sm">
                {m.meal_provider && (
                  <div className="flex justify-between gap-4 border-b border-white/5 pb-2">
                    <dt className="text-white/50">Provider</dt>
                    <dd className="text-white/80">{m.meal_provider}</dd>
                  </div>
                )}
                {m.monthly_meal_fee != null && (
                  <div className="flex justify-between gap-4 border-b border-white/5 pb-2">
                    <dt className="text-white/50">Monthly fee</dt>
                    <dd className="text-white/80">
                      {m.meal_fee_currency || "NGN"} {Number(m.monthly_meal_fee).toLocaleString()}
                    </dd>
                  </div>
                )}
                {m.hygiene_certification && (
                  <div className="flex justify-between gap-4 border-b border-white/5 pb-2">
                    <dt className="text-white/50">Hygiene</dt>
                    <dd className="text-right text-white/80">{m.hygiene_certification}</dd>
                  </div>
                )}
                {m.last_inspection_date && (
                  <div className="flex justify-between gap-4 border-b border-white/5 pb-2">
                    <dt className="text-white/50">Last inspection</dt>
                    <dd className="text-white/80">
                      {new Date(m.last_inspection_date as string).toLocaleDateString()}
                    </dd>
                  </div>
                )}
              </dl>
              {dietary.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {dietary.map((d) => (
                    <span
                      key={d}
                      className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/70"
                    >
                      {d}
                    </span>
                  ))}
                </div>
              )}
              {m.allergy_accommodation_detail && (
                <p className="mt-4 text-xs italic text-white/50">
                  {m.allergy_accommodation_detail}
                </p>
              )}
            </GlassCard>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Transport                                                           */
/* ------------------------------------------------------------------ */

export function TransportSection({ school }: { school: SchoolRow }) {
  const sid = school.id;
  const q = useQuery({
    queryKey: ["pub-transport", sid],
    queryFn: async () => {
      const { data } = await supabase
        .from("school_transport")
        .select("*")
        .eq("school_id", sid)
        .eq("transport_enabled", true)
        .maybeSingle();
      return data;
    },
  });
  const t = q.data;
  if (!t) return null;
  const features = [
    t.live_tracking_enabled && "Live GPS tracking",
    t.buses_air_conditioned && "Air-conditioned buses",
    t.driver_background_checked && "Background-checked drivers",
  ].filter(Boolean) as string[];

  return (
    <section id="transport" className="relative py-24 md:py-32">
      <div className="mx-auto max-w-7xl px-6 md:px-8">
        <SectionHeader
          badge="TRANSPORT"
          title="School Transport"
          subtitle="Routes, fleet, and live tracking for parents"
        />
        <div className="mt-14 grid gap-6 lg:grid-cols-3">
          <Reveal>
            <GlassCard className="p-7">
              <h3 className="font-display text-lg font-semibold text-white">Fleet</h3>
              <p className="mt-3 text-3xl font-bold text-white">{t.fleet_size ?? "—"}</p>
              <p className="mt-1 text-xs text-white/50">buses in service</p>
              {t.transport_provider && (
                <p className="mt-3 text-sm text-white/70">{t.transport_provider}</p>
              )}
            </GlassCard>
          </Reveal>
          <Reveal delay={80}>
            <GlassCard className="p-7">
              <h3 className="font-display text-lg font-semibold text-white">Schedule</h3>
              <dl className="mt-4 space-y-3 text-sm">
                {t.morning_pickup_start && (
                  <div className="flex justify-between border-b border-white/5 pb-2">
                    <dt className="text-white/50">Pickup start</dt>
                    <dd className="text-white/80">{t.morning_pickup_start}</dd>
                  </div>
                )}
                {t.morning_arrival_time && (
                  <div className="flex justify-between border-b border-white/5 pb-2">
                    <dt className="text-white/50">Morning arrival</dt>
                    <dd className="text-white/80">{t.morning_arrival_time}</dd>
                  </div>
                )}
                {t.afternoon_departure_time && (
                  <div className="flex justify-between border-b border-white/5 pb-2">
                    <dt className="text-white/50">Afternoon departure</dt>
                    <dd className="text-white/80">{t.afternoon_departure_time}</dd>
                  </div>
                )}
                {t.monthly_transport_fee != null && (
                  <div className="flex justify-between border-b border-white/5 pb-2">
                    <dt className="text-white/50">Monthly fee</dt>
                    <dd className="text-white/80">
                      NGN {Number(t.monthly_transport_fee).toLocaleString()}
                    </dd>
                  </div>
                )}
              </dl>
            </GlassCard>
          </Reveal>
          <Reveal delay={160}>
            <GlassCard className="p-7">
              <h3 className="font-display text-lg font-semibold text-white">Coverage</h3>
              {t.coverage_areas ? (
                <p className="mt-3 text-sm leading-relaxed text-white/70">{t.coverage_areas}</p>
              ) : (
                <p className="mt-3 text-sm text-white/40">Routes will appear here.</p>
              )}
              {features.length > 0 && (
                <div className="mt-4 flex flex-wrap gap-2">
                  {features.map((f) => (
                    <span
                      key={f}
                      className="rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-xs text-white/70"
                    >
                      {f}
                    </span>
                  ))}
                </div>
              )}
              {t.safety_features && (
                <p className="mt-4 text-xs italic text-white/50">{t.safety_features}</p>
              )}
            </GlassCard>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Find Us Map                                                         */
/* ------------------------------------------------------------------ */

export function FindUsMapSection({ school }: { school: SchoolRow }) {
  if (!school.show_map_on_website) return null;
  const raw = (school.google_maps_embed_url as string | null) ?? "";
  if (!raw) return null;
  const match = raw.match(/src=["']([^"']+)["']/);
  const src = match ? match[1] : raw;
  return (
    <section id="find-us" className="relative py-20">
      <div className="mx-auto max-w-7xl px-6 md:px-8">
        <SectionHeader badge="FIND_US" title="Find Us on the Map" />
        <Reveal>
          <div className="mt-10 overflow-hidden rounded-3xl border border-white/[0.08]">
            <iframe
              src={src}
              title={`${school.name} location`}
              className="h-[460px] w-full"
              loading="lazy"
              referrerPolicy="no-referrer-when-downgrade"
              allowFullScreen
            />
          </div>
        </Reveal>
      </div>
    </section>
  );
}

export function ContactSection({ school }: { school: SchoolRow }) {
  const items = [
    {
      Icon: Phone,
      label: "Phone",
      value: school.phone as string | null,
      placeholder: "PHONE NUMBER",
    },
    {
      Icon: Mail,
      label: "Email",
      value: school.email as string | null,
      placeholder: "EMAIL ADDRESS",
    },
    {
      Icon: MapPin,
      label: "Address",
      value: school.address as string | null,
      placeholder: "SCHOOL ADDRESS",
    },
    {
      Icon: Clock,
      label: "Office Hours",
      value: school.office_hours as string | null,
      placeholder: "OFFICE HOURS",
    },
  ];
  const [form, setForm] = useState({ name: "", email: "", subject: "", message: "" });
  const rawEmbed = (school.google_maps_embed_url as string | null) ?? "";
  const embedMatch = rawEmbed.match(/src=["']([^"']+)["']/);
  const embedSrc = embedMatch ? embedMatch[1] : rawEmbed;
  const showMap = !!(school.show_map_on_website && embedSrc);
  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.email || !form.message) {
      toast.error("Please fill in your name, email, and message.");
      return;
    }
    toast.success("Message received. We will be in touch soon.");
    setForm({ name: "", email: "", subject: "", message: "" });
  };
  return (
    <section id="contact" className="relative py-24 md:py-32">
      <div className="mx-auto max-w-6xl px-6 text-center md:px-8">
        <SectionHeader
          badge="CONTACT_US"
          title="Get In Touch"
          subtitle="We'd love to hear from you"
        />
        <div className="mt-14 grid gap-8 justify-items-center text-left lg:grid-cols-2 lg:justify-items-stretch">
          <Reveal>
            <div className="mx-auto w-full max-w-md space-y-4 lg:max-w-xl">
              {items.map((it, i) => (
                <GlassCard key={i} className="flex items-start gap-4 p-5">
                  <div className="grid h-10 w-10 place-items-center rounded-xl bg-white/5 text-white/70">
                    <it.Icon className="h-5 w-5" />
                  </div>
                  <div className="flex-1">
                    <div className="text-[10px] font-semibold uppercase tracking-[0.25em] text-white/40">
                      {it.label}
                    </div>
                    {it.value ? (
                      <div className="mt-1 whitespace-pre-line break-words text-sm text-white/80">
                        {it.value}
                      </div>
                    ) : (
                      <DashedBox
                        label={it.placeholder}
                        hint="Add in Admin → Settings"
                        className="mt-2 h-16"
                      />
                    )}
                  </div>
                </GlassCard>
              ))}
            </div>
          </Reveal>
          <Reveal delay={100}>
            <GlassCard className="mx-auto w-full max-w-xl p-7">
              <form className="grid gap-4" onSubmit={onSubmit}>
                <input
                  className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none"
                  placeholder="Your name"
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                />
                <input
                  type="email"
                  className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none"
                  placeholder="Email address"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
                <input
                  className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none"
                  placeholder="Subject"
                  value={form.subject}
                  onChange={(e) => setForm({ ...form, subject: e.target.value })}
                />
                <textarea
                  rows={5}
                  className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-white placeholder:text-white/30 focus:border-white/30 focus:outline-none"
                  placeholder="Your message"
                  value={form.message}
                  onChange={(e) => setForm({ ...form, message: e.target.value })}
                />
                <button
                  type="submit"
                  className="mx-auto rounded-full px-8 py-3 text-sm font-semibold text-white shadow-lg transition-transform hover:scale-105"
                  style={{ background: "var(--tenant-primary, #3b82f6)" }}
                >
                  Send Message
                </button>
              </form>
            </GlassCard>
          </Reveal>
        </div>
        {showMap && (
          <Reveal delay={200}>
            <div className="mt-12 overflow-hidden rounded-3xl border border-white/[0.08] text-left">
              <iframe
                src={embedSrc}
                title={`${school.name} location`}
                className="h-[420px] w-full"
                loading="lazy"
                referrerPolicy="no-referrer-when-downgrade"
                allowFullScreen
              />
            </div>
          </Reveal>
        )}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Gallery                                                             */
/* ------------------------------------------------------------------ */

export function GallerySection({ school }: { school: SchoolRow }) {
  const sid = school.id;
  const q = useQuery({
    queryKey: ["pub-gallery", sid],
    queryFn: async () => {
      const { data } = await supabase
        .from("school_gallery" as never)
        .select("id, title, caption, image_url, order_index")
        .eq("school_id", sid)
        .eq("is_published", true)
        .order("order_index");
      return (data ?? []) as Array<{
        id: string;
        title: string | null;
        caption: string | null;
        image_url: string;
      }>;
    },
  });
  const items = q.data ?? [];
  return (
    <section id="gallery" className="relative py-24 md:py-32">
      <div className="mx-auto max-w-7xl px-6 md:px-8">
        <SectionHeader
          badge="GALLERY"
          title="Life at Our School"
          subtitle="Moments from classrooms, sports, events and everyday learning"
        />
        <div className="mt-14 -mx-6 md:-mx-8">
          <div
            className="flex snap-x snap-mandatory gap-5 overflow-x-auto scroll-smooth px-6 pb-4 md:px-8"
            style={{ scrollbarWidth: "thin" }}
          >
            {(items.length === 0
              ? Array.from({ length: 10 }).map((_, i) => ({
                  placeholder: true as const,
                  i,
                  g: null,
                }))
              : items.slice(0, 10).map((g, i) => ({ placeholder: false as const, i, g }))
            ).map((entry) =>
              entry.placeholder ? (
                <div
                  key={`ph-${entry.i}`}
                  className="w-[78%] shrink-0 snap-center sm:w-[45%] lg:w-[32%]"
                >
                  <Reveal delay={entry.i * 60}>
                    <DashedBox
                      label="PHOTO"
                      hint="Add in Admin → CMS → Gallery"
                      className="h-64 sm:h-72"
                    />
                  </Reveal>
                </div>
              ) : (
                <div
                  key={entry.g!.id}
                  className="w-[78%] shrink-0 snap-center sm:w-[45%] lg:w-[32%]"
                >
                  <Reveal delay={entry.i * 60}>
                    <GlassCard className="overflow-hidden p-0">
                      <div className="relative h-64 w-full overflow-hidden sm:h-72">
                        <img
                          src={entry.g!.image_url}
                          alt={entry.g!.title ?? "Gallery photo"}
                          className="h-full w-full object-cover transition-transform duration-500 hover:scale-105"
                          loading="lazy"
                        />
                      </div>
                      {(entry.g!.title || entry.g!.caption) && (
                        <div className="p-4">
                          {entry.g!.title && (
                            <h3 className="font-display text-sm font-semibold text-white">
                              {entry.g!.title}
                            </h3>
                          )}
                          {entry.g!.caption && (
                            <p className="mt-1 text-xs text-white/60">{entry.g!.caption}</p>
                          )}
                        </div>
                      )}
                    </GlassCard>
                  </Reveal>
                </div>
              ),
            )}
          </div>
          <p className="mt-3 px-6 text-center text-xs text-white/50 md:px-8">Swipe to see more →</p>
        </div>
      </div>
    </section>
  );
}

/**
 * Public site shared atoms: layout primitives, badges, ornaments,
 * social links, top navigation, and footer.
 *
 * All section components in ./sections.tsx import from here.
 * The composer (./site.tsx) imports Navbar + Footer + useSocialLinks
 * from here as well.
 */
import { useEffect, useMemo, useState } from "react";
import { Link } from "@tanstack/react-router";
import { PLATFORM_NAME } from "@/lib/platform";
import {
  INSTALLED_RUNTIME_NAME as SCHOLAR_RUNTIME_NAME,
  INSTALLED_RUNTIMES,
} from "@/lib/runtime/installed-runtimes";
import { filterOrganizationPublicSections } from "@/lib/sherivs/organization-public";
import { Menu, X, Facebook, Twitter, Instagram, Youtube, Linkedin } from "lucide-react";
import type { SchoolRow } from "@/contexts/app-context";

/* ------------------------------------------------------------------ */
/* Atoms                                                               */
/* ------------------------------------------------------------------ */

export function SectionBadge({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.04] px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.25em] text-white/50">
      {label}
    </span>
  );
}

export function GlassCard({
  children,
  className = "",
  as: Tag = "div",
}: {
  children: React.ReactNode;
  className?: string;
  as?: keyof React.JSX.IntrinsicElements;
}) {
  return (
    <Tag
      className={
        "group relative overflow-hidden rounded-3xl border border-white/[0.07] bg-white/[0.03] " +
        "backdrop-blur-xl backdrop-saturate-150 transition-all duration-500 " +
        "hover:-translate-y-1 hover:border-[var(--tenant-primary)]/30 hover:bg-white/[0.06] " +
        "hover:shadow-[0_24px_48px_rgba(0,0,0,0.5),inset_0_1px_0_rgba(255,255,255,0.1)] " +
        className
      }
      style={{ transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)" }}
    >
      {children}
    </Tag>
  );
}

export function DashedBox({
  label,
  hint,
  className = "",
}: {
  label: string;
  hint?: string;
  className?: string;
}) {
  return (
    <div
      className={
        "rounded-2xl border border-dashed border-white/10 bg-white/[0.01] p-6 text-center " +
        className
      }
    >
      <div className="text-[10px] font-semibold uppercase tracking-[0.25em] text-white/30">
        {label}
      </div>
      {hint && <div className="mt-2 text-xs text-white/30">{hint}</div>}
    </div>
  );
}

export function Initial({
  name,
  size = 40,
  className = "",
}: {
  name?: string | null;
  size?: number;
  className?: string;
}) {
  const ch = (name?.trim()?.[0] ?? "?").toUpperCase();
  return (
    <div
      className={"grid place-items-center rounded-full font-bold text-white shrink-0 " + className}
      style={{
        width: size,
        height: size,
        background: "var(--tenant-primary, #3b82f6)",
        fontSize: size * 0.4,
      }}
    >
      {ch}
    </div>
  );
}

/* IntersectionObserver fade-up */
export function Reveal({ children, delay = 0 }: { children: React.ReactNode; delay?: number }) {
  const [visible, setVisible] = useState(false);
  const ref = (el: HTMLDivElement | null) => {
    if (!el || visible) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { threshold: 0.1 },
    );
    io.observe(el);
  };
  return (
    <div
      ref={ref}
      style={{
        transitionDelay: `${delay}ms`,
        transitionTimingFunction: "cubic-bezier(0.16, 1, 0.3, 1)",
      }}
      className={
        "transition-all duration-700 " +
        (visible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8")
      }
    >
      {children}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Social links                                                        */
/* ------------------------------------------------------------------ */

type SocialLink = { name: string; url: string; Icon: React.ComponentType<{ className?: string }> };

export function TikTokIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} aria-hidden="true">
      <path d="M19.59 6.69a4.83 4.83 0 0 1-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 0 1-5.2 1.74 2.89 2.89 0 0 1 2.31-4.64 2.93 2.93 0 0 1 .88.13V9.4a6.84 6.84 0 0 0-1-.05A6.33 6.33 0 0 0 5.8 20.1a6.34 6.34 0 0 0 10.86-4.43V8.66a8.16 8.16 0 0 0 4.77 1.52V6.73a4.85 4.85 0 0 1-1.84-.04Z" />
    </svg>
  );
}

export function useSocialLinks(school: SchoolRow | null): SocialLink[] {
  return useMemo(() => {
    if (!school || !school.social_media_enabled) return [];
    const items: Array<{ url: unknown; name: string; Icon: SocialLink["Icon"] }> = [
      { url: school.social_facebook_url, name: "Facebook", Icon: Facebook },
      { url: school.social_twitter_url, name: "Twitter", Icon: Twitter },
      { url: school.social_instagram_url, name: "Instagram", Icon: Instagram },
      { url: school.social_youtube_url, name: "YouTube", Icon: Youtube },
      { url: school.social_linkedin_url, name: "LinkedIn", Icon: Linkedin },
      { url: school.social_tiktok_url, name: "TikTok", Icon: TikTokIcon },
    ];
    return items
      .filter((i) => typeof i.url === "string" && i.url)
      .map((i) => ({ url: i.url as string, name: i.name, Icon: i.Icon }));
  }, [school]);
}

export function SocialRow({ links, className = "" }: { links: SocialLink[]; className?: string }) {
  if (links.length === 0) return null;
  return (
    <div className={"flex items-center gap-3 " + className}>
      {links.map(({ name, url, Icon }) => (
        <a
          key={name}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={name}
          className="text-white/60 transition-colors duration-200 hover:text-white"
        >
          <Icon className="h-[18px] w-[18px]" />
        </a>
      ))}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Navbar                                                              */
/* ------------------------------------------------------------------ */

const NAV_SECTIONS: Array<{ id: string; label: string; flag: keyof SchoolRow }> = [
  { id: "home", label: "Home", flag: "section_hero_enabled" as keyof SchoolRow },
  { id: "about", label: "About", flag: "section_about_enabled" as keyof SchoolRow },
  { id: "academics", label: "Academics", flag: "section_programs_enabled" as keyof SchoolRow },
  { id: "facilities", label: "Facilities", flag: "section_facilities_enabled" as keyof SchoolRow },
  { id: "staff", label: "Staff", flag: "section_faculty_enabled" as keyof SchoolRow },
  {
    id: "admissions-cta",
    label: "Admissions",
    flag: "section_admissions_enabled" as keyof SchoolRow,
  },
  { id: "news", label: "News", flag: "section_news_enabled" as keyof SchoolRow },
  { id: "blog", label: "Blog", flag: "section_blog_enabled" as keyof SchoolRow },
  { id: "contact", label: "Contact", flag: "section_contact_enabled" as keyof SchoolRow },
];

export function Navbar({ school, socials }: { school: SchoolRow; socials: SocialLink[] }) {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 80);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const educationRuntime = INSTALLED_RUNTIMES.some((runtime) => runtime.id === "runtime:scholar");
  const links = filterOrganizationPublicSections(NAV_SECTIONS, { educationRuntime }).filter(
    (n) => n.id === "home" || school[n.flag] !== false,
  );

  return (
    <header
      className={
        "fixed top-0 left-0 right-0 z-50 transition-all duration-300 " +
        (scrolled
          ? "bg-[rgba(10,15,30,0.95)] backdrop-blur-2xl border-b border-white/[0.06]"
          : "bg-transparent border-b border-transparent")
      }
    >
      <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4 md:px-8">
        <a href="#home" className="flex items-center gap-3">
          {school.logo_url ? (
            <img
              src={school.logo_url as string}
              alt={`${school.name} logo`}
              className="h-9 w-9 rounded-lg object-cover"
            />
          ) : (
            <Initial name={school.name} size={36} />
          )}
          <span className="font-display text-base font-semibold tracking-tight text-white">
            {school.name}
          </span>
        </a>

        <nav className="hidden items-center gap-7 lg:flex">
          {links.map((l) => (
            <a
              key={l.id}
              href={`#${l.id}`}
              className="text-sm text-white/70 transition-colors hover:text-white"
            >
              {l.label}
            </a>
          ))}
        </nav>

        <div className="hidden items-center gap-4 md:flex">
          <SocialRow links={socials} />
          <Link
            to="/admissions"
            className="rounded-full px-4 py-2 text-sm font-semibold text-white shadow-lg transition-transform hover:scale-105"
            style={{ background: "var(--tenant-primary, #3b82f6)" }}
          >
            Apply Now
          </Link>
          <Link
            to="/login"
            className="rounded-full border border-white/15 px-4 py-2 text-sm text-white/80 transition-colors hover:bg-white/5"
          >
            Staff Login
          </Link>
        </div>

        <button
          className="lg:hidden text-white/80"
          aria-label={open ? "Close menu" : "Open menu"}
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <X className="h-6 w-6" /> : <Menu className="h-6 w-6" />}
        </button>
      </div>

      {open && (
        <div className="lg:hidden border-t border-white/[0.06] bg-[rgba(10,15,30,0.97)] backdrop-blur-2xl">
          <div className="mx-auto max-w-7xl px-6 py-4">
            <nav className="flex flex-col gap-3">
              {links.map((l) => (
                <a
                  key={l.id}
                  href={`#${l.id}`}
                  onClick={() => setOpen(false)}
                  className="rounded-lg px-3 py-2 text-sm text-white/80 hover:bg-white/5"
                >
                  {l.label}
                </a>
              ))}
              <div className="mt-2 flex gap-2">
                <Link
                  to="/admissions"
                  className="flex-1 rounded-full px-4 py-2 text-center text-sm font-semibold text-white"
                  style={{ background: "var(--tenant-primary, #3b82f6)" }}
                >
                  Apply Now
                </Link>
                <Link
                  to="/login"
                  className="flex-1 rounded-full border border-white/15 px-4 py-2 text-center text-sm text-white/80"
                >
                  Login
                </Link>
              </div>
              <SocialRow links={socials} className="mt-3" />
            </nav>
          </div>
        </div>
      )}
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Background ornaments                                                */
/* ------------------------------------------------------------------ */

export function BackgroundOrbs() {
  return (
    <>
      <div
        aria-hidden
        className="pointer-events-none absolute -top-32 -right-32 h-[600px] w-[600px] rounded-full"
        style={{
          background:
            "radial-gradient(circle, color-mix(in oklab, var(--tenant-primary, #3b82f6) 8%, transparent), transparent 70%)",
          filter: "blur(120px)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-32 -left-32 h-[600px] w-[600px] rounded-full"
        style={{
          background:
            "radial-gradient(circle, color-mix(in oklab, var(--tenant-secondary, #8b5cf6) 6%, transparent), transparent 70%)",
          filter: "blur(120px)",
        }}
      />
    </>
  );
}

export function Particles() {
  const particles = Array.from({ length: 12 }, (_, i) => ({
    id: i,
    left: Math.random() * 100,
    top: Math.random() * 100,
    delay: Math.random() * 6,
    duration: 6 + Math.random() * 6,
  }));
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {particles.map((p) => (
        <span
          key={p.id}
          className="absolute h-1 w-1 rounded-full bg-white/40"
          style={{
            left: `${p.left}%`,
            top: `${p.top}%`,
            animation: `floaty ${p.duration}s ${p.delay}s ease-in-out infinite`,
          }}
        />
      ))}
      <style>{`@keyframes floaty {
        0%,100% { transform: translateY(0); opacity: .4 }
        50% { transform: translateY(-30px); opacity: 1 }
      }`}</style>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Generic "labelled" section helper                                   */
/* ------------------------------------------------------------------ */

export function SectionHeader({
  badge,
  title,
  subtitle,
}: {
  badge: string;
  title: string;
  subtitle?: string;
}) {
  return (
    <Reveal>
      <div className="flex flex-col items-center text-center">
        <SectionBadge label={badge} />
        <h2 className="mt-4 font-display text-4xl font-bold tracking-tight text-white">{title}</h2>
        {subtitle && <p className="mt-3 max-w-2xl text-base text-white/60">{subtitle}</p>}
      </div>
    </Reveal>
  );
}

/* ------------------------------------------------------------------ */
/* Footer                                                              */
/* ------------------------------------------------------------------ */

export function Footer({ school, socials }: { school: SchoolRow; socials: SocialLink[] }) {
  const year = new Date().getFullYear();
  const educationRuntime = INSTALLED_RUNTIMES.some((runtime) => runtime.id === "runtime:scholar");
  const enabledLinks = filterOrganizationPublicSections(NAV_SECTIONS, { educationRuntime }).filter(
    (n) => n.id === "home" || school[n.flag] !== false,
  );
  return (
    <footer className="relative border-t border-white/[0.06] bg-[rgba(8,12,24,0.6)] py-20">
      <div className="mx-auto grid max-w-7xl gap-10 px-6 md:px-8 lg:grid-cols-4">
        <div>
          <div className="flex items-center gap-3">
            {school.logo_url ? (
              <img
                src={school.logo_url as string}
                alt={school.name}
                className="h-9 w-9 rounded-lg object-cover"
              />
            ) : (
              <Initial name={school.name} size={36} />
            )}
            <span className="font-display text-base font-semibold text-white">{school.name}</span>
          </div>
          <p className="mt-4 text-sm text-white/60">
            {(school.about as string | null)?.slice(0, 120) ?? (
              <span className="italic text-white/30">[ ADD SCHOOL TAGLINE IN SETTINGS ]</span>
            )}
          </p>
          <SocialRow links={socials} className="mt-5" />
          <p className="mt-6 text-[10px] uppercase tracking-widest text-white/30">
            Organization access
          </p>
        </div>
        <div>
          <div className="mb-4 text-[10px] font-semibold uppercase tracking-[0.25em] text-white/40">
            Quick Links
          </div>
          <ul className="space-y-2 text-sm">
            {enabledLinks.map((l) => (
              <li key={l.id}>
                <a href={`#${l.id}`} className="text-white/60 hover:text-white">
                  → {l.label}
                </a>
              </li>
            ))}
          </ul>
        </div>
        <div>
          <div className="mb-4 text-[10px] font-semibold uppercase tracking-[0.25em] text-white/40">
            Portal Access
          </div>
          <Link
            to="/login"
            className="inline-flex items-center justify-center rounded-xl bg-[var(--tenant-primary)] px-4 py-2.5 text-sm font-semibold text-white shadow-lg shadow-[var(--tenant-primary)]/20 transition hover:opacity-90"
          >
            Login to Portal
          </Link>
          <p className="mt-3 text-xs leading-relaxed text-white/40">
            Students, teachers, parents, and staff all use the same login. You will be directed to
            your personal portal automatically.
          </p>
          <Link
            to="/admissions"
            className="mt-4 inline-block text-sm text-white/60 hover:text-white"
          >
            → Apply for admission
          </Link>
        </div>
        <div>
          <div className="mb-4 text-[10px] font-semibold uppercase tracking-[0.25em] text-white/40">
            Contact
          </div>
          <ul className="space-y-2 text-sm text-white/60">
            {school.phone ? <li>{school.phone as string}</li> : null}
            {school.email ? <li>{school.email as string}</li> : null}
            {school.address ? <li>{school.address as string}</li> : null}
            {!school.phone && !school.email && !school.address && (
              <li className="italic text-white/30">[ ADD CONTACT DETAILS IN SETTINGS ]</li>
            )}
          </ul>
        </div>
      </div>
      <div className="mx-auto mt-12 flex max-w-7xl flex-col items-center justify-between gap-3 border-t border-white/[0.04] px-6 pt-6 text-xs text-white/40 md:flex-row md:px-8">
        <div>
          © {year} {school.name}. All rights reserved.
        </div>
        <div className="flex gap-4">
          {school.section_privacy_enabled !== false && <span>Privacy Policy</span>}
          {school.section_rules_enabled !== false && <span>School Rules</span>}
          <span>Terms</span>
        </div>
        <div>
          Built on {PLATFORM_NAME} · {SCHOLAR_RUNTIME_NAME} runtime
        </div>
      </div>
    </footer>
  );
}

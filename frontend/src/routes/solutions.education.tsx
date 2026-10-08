import { createFileRoute, Link } from "@tanstack/react-router";
import { SherivsPublicShell } from "@/components/sherivs/public-shell";
import { INSTALLED_RUNTIMES } from "@/lib/runtime/installed-runtimes";
import { SHERIVS_PUBLIC_ORIGIN } from "@/lib/sherivs-brand";

export const Route = createFileRoute("/solutions/education")({
  component: EducationPage,
  head: () => ({
    meta: [
      { title: "Sherivs for education" },
      {
        name: "description",
        content:
          "Sherivs for education: the installed education runtime on the governed Sherivs kernel — identity, workspaces, AI and audit from the platform, sector domain from the runtime.",
      },
      { property: "og:title", content: "Sherivs for education" },
      { property: "og:type", content: "website" },
      { property: "og:url", content: `${SHERIVS_PUBLIC_ORIGIN}/solutions/education` },
    ],
    links: [{ rel: "canonical", href: `${SHERIVS_PUBLIC_ORIGIN}/solutions/education` }],
  }),
});

function EducationPage() {
  const runtime = INSTALLED_RUNTIMES[0];
  return (
    <SherivsPublicShell>
      <div className="mx-auto w-full max-w-6xl px-4 py-14 sm:px-6 sm:py-20">
        <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
          Solutions · Education
        </p>
        <h1 className="mt-3 max-w-3xl font-display text-3xl font-bold tracking-tight text-balance sm:text-5xl">
          Sherivs {runtime.name}: the education runtime on governed rails.
        </h1>
        <p className="mt-5 max-w-3xl text-sm leading-relaxed text-muted-foreground sm:text-base">
          {runtime.description}. Sherivs {runtime.name} adapts the platform to institutions of
          learning — their people, programs, calendars, communications and operations — while
          inheriting identity, workspaces, AI governance and audit from the Sherivs kernel.
        </p>
        <ul className="mt-10 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[
            {
              title: "People and roles",
              body: "Administrators, educators, families and learners each get the workspace their role entitles them to — nothing more, nothing less.",
            },
            {
              title: "Programs and calendars",
              body: "Timetables, events and academic rhythms run on the platform calendar primitive: timezones, recurrence and conflicts included.",
            },
            {
              title: "Communications",
              body: "Announcements, messages and notifications scoped by role and relationship — broadcasts reach exactly who policy allows.",
            },
            {
              title: "Operational truth",
              body: "Attendance, fees, facilities and reports read from the same canonical records — not from five conflicting exports.",
            },
            {
              title: "Governed assistance",
              body: "Tutors, teaching assistants and administrative aides operate inside the AI workforce boundary: authorized context, cited answers, audited actions.",
            },
            {
              title: "Oversight with evidence",
              body: "Every consequential flow — admissions, assessments, finance — carries approvals, evidence and audit trail by construction.",
            },
          ].map((item) => (
            <li
              key={item.title}
              className="rounded-xl border border-border p-5 transition-colors hover:bg-muted/30"
            >
              <h2 className="font-display text-base font-semibold">{item.title}</h2>
              <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{item.body}</p>
            </li>
          ))}
        </ul>
        <div className="mt-10 flex flex-wrap items-center gap-3">
          <Link
            to="/request-demo"
            className="rounded-md bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground hover:opacity-90"
          >
            Request a demo
          </Link>
          <Link
            to="/platform"
            className="rounded-md border border-border px-5 py-2.5 text-sm font-semibold hover:bg-accent"
          >
            How the kernel works
          </Link>
        </div>
      </div>
    </SherivsPublicShell>
  );
}

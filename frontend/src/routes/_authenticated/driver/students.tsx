/**
 * Driver — full roster page for the assigned bus.
 *
 * Same data shape as the dashboard's students section, but full-page with a
 * live-filtering search input. Mobile rows have ≥48px tap targets.
 */
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Search, Users } from "lucide-react";

import { PortalPage, GlassCard, EmptyState } from "@/components/portal-shell";
import { SkeletonPage } from "@/components/skeleton";
import { PageHeader } from "@/components/page-header";
import {
  getMyDriverBus,
  type DriverBusFull,
  type DriverStudent,
} from "@/lib/runtime/scholar/driver-portal.functions";

export const Route = createFileRoute("/_authenticated/driver/students")({
  component: DriverStudentsPage,
});

function DriverStudentsPage() {
  const getBus = useServerFn(getMyDriverBus);
  const { data: bus, isLoading } = useQuery<DriverBusFull | null>({
    queryKey: ["driver", "my-bus"],
    queryFn: () => getBus(),
  });

  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    if (!bus) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return bus.students;
    return bus.students.filter((s) => {
      const name = (s.full_name ?? "").toLowerCase();
      const adm = (s.admission_number ?? "").toLowerCase();
      return name.includes(needle) || adm.includes(needle);
    });
  }, [bus, q]);

  if (isLoading) return <SkeletonPage />;

  if (!bus) {
    return (
      <PortalPage title="Students">
        <EmptyState
          icon={<Users className="size-7" />}
          title="No bus assigned"
          description="A school administrator must assign you to a bus before students appear here."
        />
      </PortalPage>
    );
  }

  return (
    <PortalPage title="Students on this bus">
      <PageHeader
        title="Students on this bus"
        subtitle={`Bus ${bus.bus_number}${bus.route_name ? " • " + bus.route_name : ""}`}
      />

      <GlassCard>
        <label className="relative block">
          <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[color:var(--text-muted)]" />
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by name or admission number…"
            aria-label="Search students"
            className="w-full rounded-xl border border-[color:var(--glass-border)] bg-[color:var(--glass-bg)] py-3 pl-9 pr-3 text-sm outline-none transition focus:border-[color:var(--tenant-primary,theme(colors.emerald.400))]"
          />
        </label>

        <div className="mt-3 text-xs text-[color:var(--text-muted)]">
          {filtered.length} of {bus.students.length}{" "}
          {bus.students.length === 1 ? "student" : "students"}
        </div>

        {bus.students.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              icon={<Users className="size-6" />}
              title="No students assigned"
              description="Contact your school administrator to assign students to your bus."
            />
          </div>
        ) : filtered.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              icon={<Search className="size-6" />}
              title="No matches"
              description={`No students match "${q}".`}
            />
          </div>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {filtered.map((s) => (
              <StudentRow key={s.id} student={s} />
            ))}
          </ul>
        )}
      </GlassCard>
    </PortalPage>
  );
}

function StudentRow({ student }: { student: DriverStudent }) {
  const name = student.full_name ?? "Unnamed student";
  const initial = (name.trim()[0] ?? "?").toUpperCase();
  return (
    <li className="flex min-h-12 items-center gap-3 rounded-xl border border-[color:var(--glass-border)] bg-[color:var(--glass-bg)] px-3 py-2">
      {student.avatar_url ? (
        <img
          src={student.avatar_url}
          alt=""
          className="size-10 shrink-0 rounded-full object-cover"
        />
      ) : (
        <div className="grid size-10 shrink-0 place-items-center rounded-full bg-white/5 text-sm font-semibold text-white/70">
          {initial}
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium">{name}</div>
        {student.admission_number && (
          <div className="truncate text-xs text-[color:var(--text-muted)]">
            {student.admission_number}
          </div>
        )}
      </div>
    </li>
  );
}

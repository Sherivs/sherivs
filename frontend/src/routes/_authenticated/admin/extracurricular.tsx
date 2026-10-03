import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Trophy } from "lucide-react";
import { PortalPage, EmptyCard, SectionGrid, StatCard } from "@/components/portal-shell";
import { loadExtracurricularOverview } from "@/lib/runtime/scholar/portal-overview.functions";

export const Route = createFileRoute("/_authenticated/admin/extracurricular")({
  ssr: false,
  component: AdminExtracurricularPage,
});

function AdminExtracurricularPage() {
  const overview = useServerFn(loadExtracurricularOverview);

  const sports = useQuery({
    queryKey: ["admin-extracurricular-overview"],
    queryFn: () => overview(),
    retry: false,
  });

  return (
    <PortalPage
      title="Extracurricular & Activities"
      subtitle="Real sports programs for this tenant"
    >
      {sports.isError ? (
        <EmptyCard
          title="Extracurricular overview could not be loaded"
          body={
            sports.error instanceof Error
              ? sports.error.message
              : "Sports programs are not available right now. No numbers are invented in their place."
          }
        />
      ) : sports.isPending ? (
        <EmptyCard
          title="Loading extracurricular…"
          body="Reading real sports programs for this tenant."
        />
      ) : (
        <div className="space-y-6">
          <SectionGrid>
            <StatCard label="Sports programs" value={String(sports.data.totalPrograms)} />
            <StatCard label="Active programs" value={String(sports.data.activePrograms)} />
          </SectionGrid>

          {sports.data.programs.length === 0 ? (
            <EmptyCard
              title="No sports programs yet"
              body="This tenant has not recorded any sports programs. When programs are added to the school's sports register they will appear here — this page shows no count in the meantime rather than a placeholder zero."
            />
          ) : (
            <div className="uos-card p-6">
              <h3 className="font-semibold flex items-center gap-2 mb-4">
                <Trophy className="h-5 w-5" />
                Sports register
              </h3>
              <ul className="divide-y divide-border">
                {sports.data.programs.map((program) => (
                  <li
                    key={program.sport_name}
                    className="flex items-center justify-between gap-4 py-3"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium truncate">{program.sport_name}</p>
                      <p className="text-xs text-muted-foreground truncate">
                        {program.sport_category?.trim() || "Uncategorized"}
                        {program.coach_name
                          ? ` · Coach: ${program.coach_name}`
                          : " · No coach recorded"}
                      </p>
                    </div>
                    <span
                      className={
                        program.is_active
                          ? "text-xs font-medium text-green-700"
                          : "text-xs font-medium text-muted-foreground"
                      }
                    >
                      {program.is_active ? "Active" : "Inactive"}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <EmptyCard
            title="Honest state of this page"
            body="This register is read live from this tenant's school_sports rows. Club management, event scheduling and engagement analytics require schemas that do not exist yet — they are planned capability — not in V1 — so this page renders no create or schedule controls rather than disabled fakes."
          />
        </div>
      )}
    </PortalPage>
  );
}

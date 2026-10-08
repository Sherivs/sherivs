import { createFileRoute } from "@tanstack/react-router";
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PortalPage } from "@/components/portal-shell";
import { RoleGuard } from "@/components/role-guard";
import {
  classifyFacilityTwinKind,
  facilityTwinAttribute,
  SCHOLAR_FACILITY_METRICS,
} from "@/lib/runtime/scholar-facility-twin";

export const Route = createFileRoute("/_authenticated/admin/facilities")({
  ssr: false,
  component: () => (
    <RoleGuard allow={["admin", "principal"]}>
      <FacilitiesPage />
    </RoleGuard>
  ),
});

interface FacilityRow {
  id: string;
  name: string;
  description: string | null;
}

/**
 * Facilities & twin estate — each school facility is bound to a kernel twin
 * kind (Phase 16 vocabulary) and shown with the observation attributes it can
 * publish. Pure binding surface: no writes, no authorization impact.
 */
function FacilitiesPage() {
  const { school } = useApp();
  const schoolId = school?.id;

  const { data, isLoading } = useQuery({
    queryKey: ["facility-twin-estate", schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      const { data: rows, error } = await supabase
        .from("school_facilities")
        .select("id, name, description")
        .eq("school_id", schoolId!)
        .order("order_index");
      if (error) throw new Error(error.message);
      return (rows ?? []) as FacilityRow[];
    },
  });

  const estate = useMemo(() => {
    const rows = data ?? [];
    const counts = new Map<string, number>();
    for (const row of rows) {
      const kind = classifyFacilityTwinKind(row.name, row.description ?? "");
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
    return { rows, counts: [...counts.entries()] };
  }, [data]);

  return (
    <PortalPage
      title="Facilities & twin estate"
      subtitle="Every facility is bound to a Sherivs twin kind so sensors, inspections and occupancy can report against it. An installed runtime consumes the kernel twin vocabulary; it never redefines it."
    >
      {estate.counts.length > 0 && (
        <div className="mb-5 flex flex-wrap gap-2">
          {estate.counts.map(([kind, count]) => (
            <span
              key={kind}
              className="rounded-full border border-border bg-muted/20 px-3 py-1 text-[11px] font-medium"
            >
              {kind} · {count}
            </span>
          ))}
        </div>
      )}

      <div className="uos-card divide-y divide-border">
        {isLoading ? (
          <div className="p-4 text-sm text-muted-foreground">Loading…</div>
        ) : estate.rows.length === 0 ? (
          <div className="p-4 text-sm text-muted-foreground">
            No facilities yet. Add facilities to see their twin bindings.
          </div>
        ) : (
          estate.rows.map((row) => {
            const kind = classifyFacilityTwinKind(row.name, row.description ?? "");
            return (
              <div key={row.id} className="p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{row.name}</span>
                  <span className="rounded-full border border-border bg-background px-2 py-0.5 font-mono text-[10px] text-muted-foreground">
                    twin: {kind}
                  </span>
                </div>
                {row.description && (
                  <p className="mt-1 text-xs text-muted-foreground">{row.description}</p>
                )}
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {SCHOLAR_FACILITY_METRICS.map((metric) => (
                    <span
                      key={metric}
                      className="rounded-full bg-muted/30 px-2 py-0.5 text-[10px] text-muted-foreground"
                    >
                      {facilityTwinAttribute(metric)}
                    </span>
                  ))}
                </div>
              </div>
            );
          })
        )}
      </div>
    </PortalPage>
  );
}

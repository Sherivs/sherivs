import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Bus, RefreshCw, AlertTriangle, Users } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import {
  PortalPage,
  EmptyState,
  FeatureLockedCard,
  PortalPageSkeleton,
} from "@/components/portal-shell";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { isFeatureActive, type TierName } from "@/lib/subscription-tiers";

export const Route = createFileRoute("/_authenticated/parent/bus-tracking")({
  ssr: false,
  component: ParentBusTrackingPage,
});

type Child = { id: string; full_name: string; class_name: string | null };
type BusRow = {
  id: string;
  bus_number: string;
  route_name: string | null;
  driver_id: string | null;
  current_status: string | null;
  current_latitude: number | null;
  current_longitude: number | null;
  last_location_update: string | null;
  assigned_students: any;
};

function StatusBlock({ status }: { status: string | null }) {
  if (status === "en_route") {
    return (
      <div className="flex items-center gap-3">
        <span className="relative flex w-3 h-3">
          <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75 animate-ping" />
          <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
        </span>
        <span className="text-emerald-300 font-medium text-lg">🟢 Bus is on the way</span>
      </div>
    );
  }
  if (status === "at_school") {
    return <span className="text-blue-300 font-medium text-lg">🔵 Bus has arrived at school</span>;
  }
  if (status === "returning") {
    return <span className="text-amber-300 font-medium text-lg">🟡 Bus is returning</span>;
  }
  if (status === "maintenance") {
    return <span className="text-rose-300 font-medium text-lg">🔧 Bus in maintenance</span>;
  }
  return <span className="text-white/60 font-medium text-lg">⚪ Bus not yet departed</span>;
}

function StatusBadge({ status }: { status: string | null }) {
  const map: Record<string, { cls: string; label: string }> = {
    en_route: { cls: "bg-emerald-500/15 text-emerald-300", label: "En route" },
    at_school: { cls: "bg-blue-500/15 text-blue-300", label: "At school" },
    returning: { cls: "bg-amber-500/15 text-amber-300", label: "Returning" },
    idle: { cls: "bg-white/10 text-white/70", label: "Idle" },
    maintenance: { cls: "bg-rose-500/15 text-rose-300", label: "Maintenance" },
  };
  const m = map[status ?? "idle"] ?? map.idle;
  return <Badge className={`${m.cls} border-0`}>{m.label}</Badge>;
}

function ParentBusTrackingPage() {
  const { profile, school } = useApp();
  const schoolId = profile?.school_id ?? "";
  const parentId = profile?.id ?? "";

  const tier = (school?.subscription_tier ?? "trial") as TierName;
  const activeFeatures = (school?.active_features as Record<string, boolean> | undefined) ?? {};
  const canTrack =
    isFeatureActive(tier, activeFeatures, "bus_live_tracking") ||
    isFeatureActive(tier, activeFeatures, "transport_basic");

  const qc = useQueryClient();
  const [refreshedAt, setRefreshedAt] = useState(() => new Date());

  const childrenQ = useQuery<Child[]>({
    queryKey: ["parent-children", parentId, schoolId],
    enabled: !!parentId && !!schoolId && canTrack,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("parent_student_map")
        .select("student_id, students:students(id, full_name, class_name)")
        .eq("parent_id", parentId)
        .eq("school_id", schoolId);
      if (error) throw error;
      return (data ?? [])
        .map((row: any) => row.students)
        .filter(Boolean)
        .map((s: any) => ({
          id: s.id,
          full_name: s.full_name,
          class_name: s.class_name ?? null,
        }));
    },
  });

  const childIds = useMemo(() => (childrenQ.data ?? []).map((c) => c.id), [childrenQ.data]);

  const busesQ = useQuery<BusRow[]>({
    queryKey: ["parent-buses", schoolId, childIds.join(",")],
    enabled: !!schoolId && canTrack && childIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transport_buses")
        .select(
          "id, bus_number, route_name, driver_id, current_status, current_latitude, current_longitude, last_location_update, assigned_students",
        )
        .eq("school_id", schoolId)
        .eq("is_active", true);
      if (error) throw error;
      return (data ?? []).filter((b: any) => {
        const assigned = Array.isArray(b.assigned_students) ? b.assigned_students : [];
        return assigned.some((sid: string) => childIds.includes(sid));
      });
    },
  });

  const driverIds = useMemo(
    () =>
      Array.from(new Set((busesQ.data ?? []).map((b) => b.driver_id).filter(Boolean))) as string[],
    [busesQ.data],
  );

  const driversQ = useQuery({
    queryKey: ["parent-bus-drivers", driverIds.join(",")],
    enabled: driverIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("users")
        .select("id, full_name")
        .in("id", driverIds);
      if (error) throw error;
      const map = new Map<string, string>();
      (data ?? []).forEach((u: any) => map.set(u.id, u.full_name));
      return map;
    },
  });

  // Realtime: subscribe per bus
  const busIds = useMemo(() => (busesQ.data ?? []).map((b) => b.id), [busesQ.data]);

  useEffect(() => {
    if (!canTrack || busIds.length === 0) return;
    const channels = busIds.map((id) =>
      supabase
        .channel(`bus-${id}`)
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "transport_buses",
            filter: `id=eq.${id}`,
          },
          (payload) => {
            qc.setQueryData<BusRow[]>(["parent-buses", schoolId, childIds.join(",")], (prev) =>
              (prev ?? []).map((b) => (b.id === id ? { ...b, ...(payload.new as any) } : b)),
            );
          },
        )
        .subscribe(),
    );
    return () => {
      channels.forEach((c) => supabase.removeChannel(c));
    };
  }, [busIds, canTrack, qc, schoolId, childIds]);

  if (!canTrack) {
    return (
      <PortalPage title="Bus Tracking" subtitle="Live updates for your child's bus">
        <FeatureLockedCard
          featureName="Live Bus Tracking"
          requiredTier="Growth"
          description="Track your child's school bus in real time."
        />
      </PortalPage>
    );
  }

  const handleRefresh = async () => {
    await Promise.all([childrenQ.refetch(), busesQ.refetch()]);
    setRefreshedAt(new Date());
  };

  if (childrenQ.isLoading || busesQ.isLoading) return <PortalPageSkeleton />;

  const children = childrenQ.data ?? [];
  const buses = busesQ.data ?? [];

  return (
    <PortalPage
      title="Bus Tracking"
      subtitle="Live updates for your child's school bus"
      actions={
        <div className="flex items-center gap-3">
          <span className="text-xs text-white/40 hidden sm:inline">
            Last refreshed: {formatDistanceToNow(refreshedAt, { addSuffix: true })}
          </span>
          <Button size="sm" variant="outline" onClick={handleRefresh}>
            <RefreshCw className="w-4 h-4 mr-2" /> Refresh
          </Button>
        </div>
      }
    >
      {children.length === 0 ? (
        <EmptyState
          icon={<Users className="w-6 h-6 text-white/50" />}
          title="No children linked to your account"
          description="Contact your school administrator to link your children."
        />
      ) : buses.length === 0 ? (
        <EmptyState
          icon={<Bus className="w-6 h-6 text-white/50" />}
          title="No bus assigned to your children"
          description="Your children have not been assigned to a school bus yet."
        />
      ) : (
        <div className="grid gap-4">
          {buses.map((bus) => {
            const driverName = bus.driver_id
              ? (driversQ.data?.get(bus.driver_id) ?? "Unknown driver")
              : "Unknown driver";
            const lastUpdate = bus.last_location_update ? new Date(bus.last_location_update) : null;
            const minsSince = lastUpdate ? (Date.now() - lastUpdate.getTime()) / 60000 : null;
            const stale = minsSince !== null && minsSince > 10;
            const assigned = Array.isArray(bus.assigned_students)
              ? (bus.assigned_students as string[])
              : [];
            const myChildren = children.filter((c) => assigned.includes(c.id));

            return (
              <div key={bus.id} className="glass-card p-6">
                <div className="flex items-start justify-between gap-3 flex-wrap">
                  <div>
                    <div className="text-3xl font-bold text-white tracking-tight">
                      {bus.bus_number}
                    </div>
                    <div className="text-sm text-white/60 mt-1">
                      {bus.route_name ?? "Route not set"}
                    </div>
                    <div className="text-xs text-white/40 mt-1">
                      Driver: <span className="text-white/70">{driverName}</span>
                    </div>
                  </div>
                  <StatusBadge status={bus.current_status} />
                </div>

                <div className="mt-5 p-4 rounded-xl bg-white/5 border border-white/10">
                  <StatusBlock status={bus.current_status} />
                </div>

                <div className="mt-4 text-sm">
                  {lastUpdate ? (
                    <div className="space-y-1">
                      <div className="text-white/60">
                        Last location update:{" "}
                        <span className="text-white">
                          {formatDistanceToNow(lastUpdate, { addSuffix: true })}
                        </span>
                      </div>
                      {stale && (
                        <div className="flex items-center gap-2 text-amber-300 text-xs">
                          <AlertTriangle className="w-3.5 h-3.5" />
                          Location may be outdated
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-white/50">Location not yet available</div>
                  )}
                </div>

                {myChildren.length > 0 && (
                  <div className="mt-5 pt-4 border-t border-white/10">
                    <div className="text-xs uppercase tracking-wider text-white/50 mb-2">
                      Your {myChildren.length === 1 ? "child" : "children"} on this bus:
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {myChildren.map((c) => (
                        <div
                          key={c.id}
                          className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-sm"
                        >
                          <span className="text-white font-medium">{c.full_name}</span>
                          {c.class_name && (
                            <span className="text-white/50 ml-2 text-xs">{c.class_name}</span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <p className="mt-4 text-xs text-white/40">
                  For urgent inquiries contact the school office.
                </p>
              </div>
            );
          })}
        </div>
      )}
    </PortalPage>
  );
}

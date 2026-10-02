/**
 * Driver dashboard — live route tracking with embedded map, route history,
 * realtime status sync, parent arrival notifications, and GPS throttle
 * control.
 *
 * - getMyDriverBus loads the signed-in driver's bus (driver_id = auth.uid()).
 * - watchPosition pushes coords to transport_buses, throttled by the
 *   driver-selected interval (5s / 10s / 30s / 60s).
 * - Route history is captured client-side as the driver moves (last 50 fixes).
 * - Supabase realtime channel on transport_buses keeps status/coords fresh
 *   even if multiple devices are signed in as the driver.
 * - "Mark arrived" calls notifyBusArrival → inserts notifications for every
 *   parent of every assigned student.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { PreviewPublicSiteCard } from "@/components/preview-public-site";
import {
  AlertCircle,
  ArrowRight,
  Bell,
  Bus,
  Clock,
  Gauge,
  HelpCircle,
  History,
  MapPin,
  Play,
  Radio,
  Square,
  Users,
} from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import {
  PortalPage,
  GlassCard,
  StatCard,
  SectionGrid,
  EmptyState,
} from "@/components/portal-shell";
import { SkeletonPage } from "@/components/skeleton";
import { PageHeader } from "@/components/page-header";
import {
  getMyDriverBus,
  notifyBusArrival,
  pushDriverLocation,
  setDriverBusStatus,
  type DriverBusFull,
  type DriverBusStatus,
  type DriverStudent,
} from "@/lib/runtime/scholar/driver-portal.functions";

export const Route = createFileRoute("/_authenticated/driver/dashboard")({
  component: DriverDashboard,
});

const STATUS_META: Record<DriverBusStatus, { label: string; chip: string; dot: string }> = {
  idle: { label: "Idle", chip: "bg-white/5 text-white/70 border-white/10", dot: "bg-white/40" },
  en_route: {
    label: "On Route",
    chip: "bg-emerald-500/15 text-emerald-300 border-emerald-500/30",
    dot: "bg-emerald-400",
  },
  at_school: {
    label: "At School",
    chip: "bg-blue-500/15 text-blue-300 border-blue-500/30",
    dot: "bg-blue-400",
  },
  returning: {
    label: "Returning",
    chip: "bg-amber-500/15 text-amber-300 border-amber-500/30",
    dot: "bg-amber-400",
  },
  maintenance: {
    label: "Maintenance",
    chip: "bg-red-500/15 text-red-300 border-red-500/30",
    dot: "bg-red-400",
  },
};

const THROTTLE_OPTIONS: { label: string; ms: number }[] = [
  { label: "5s", ms: 5_000 },
  { label: "10s", ms: 10_000 },
  { label: "30s", ms: 30_000 },
  { label: "60s", ms: 60_000 },
];

type Fix = { lat: number; lng: number; at: number };

function DriverDashboard() {
  const qc = useQueryClient();
  const getBus = useServerFn(getMyDriverBus);
  const pushLoc = useServerFn(pushDriverLocation);
  const setStatus = useServerFn(setDriverBusStatus);
  const notifyArrival = useServerFn(notifyBusArrival);

  const { data: bus, isLoading } = useQuery<DriverBusFull | null>({
    queryKey: ["driver", "my-bus"],
    queryFn: () => getBus(),
    refetchInterval: 30_000,
  });

  const [tracking, setTracking] = useState(false);
  const [throttleMs, setThrottleMs] = useState<number>(5_000);
  const [coords, setCoords] = useState<Fix | null>(null);
  const [history, setHistory] = useState<Fix[]>([]);
  const [permError, setPermError] = useState<null | "denied" | "unsupported" | "other">(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const watchIdRef = useRef<number | null>(null);
  const lastPushRef = useRef<number>(0);
  const throttleRef = useRef<number>(throttleMs);
  useEffect(() => {
    throttleRef.current = throttleMs;
  }, [throttleMs]);

  const pushMut = useMutation({
    mutationFn: (c: { lat: number; lng: number }) =>
      pushLoc({ data: { latitude: c.lat, longitude: c.lng } }),
    onError: (e: Error) => setErrorMsg(e.message),
  });

  const statusMut = useMutation({
    mutationFn: (s: DriverBusStatus) => setStatus({ data: { status: s } }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["driver", "my-bus"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const arrivalMut = useMutation({
    mutationFn: (milestone: "arrived_school" | "departing_school" | "arrived_stop") =>
      notifyArrival({ data: { milestone } }),
    onSuccess: (r) => toast.success(`Notified ${r.notified} parent${r.notified === 1 ? "" : "s"}`),
    onError: (e: Error) => toast.error(e.message),
  });

  // ---- Realtime: keep bus row fresh across devices ----
  useEffect(() => {
    if (!bus?.id) return;
    const channel = supabase
      .channel(`driver-bus-${bus.id}`)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "transport_buses", filter: `id=eq.${bus.id}` },
        () => {
          void qc.invalidateQueries({ queryKey: ["driver", "my-bus"] });
        },
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [bus?.id, qc]);

  function clearWatcher() {
    if (watchIdRef.current !== null && typeof navigator !== "undefined") {
      navigator.geolocation.clearWatch(watchIdRef.current);
    }
    watchIdRef.current = null;
  }

  function startTracking() {
    setErrorMsg(null);
    setPermError(null);
    if (typeof navigator === "undefined" || !navigator.geolocation) {
      setPermError("unsupported");
      return;
    }
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const now = Date.now();
        const fix: Fix = { lat, lng, at: now };
        setCoords(fix);
        if (now - lastPushRef.current >= throttleRef.current) {
          lastPushRef.current = now;
          setHistory((h) => [fix, ...h].slice(0, 50));
          pushMut.mutate({ lat, lng });
        }
      },
      (err) => {
        if (err.code === err.PERMISSION_DENIED) setPermError("denied");
        else setPermError("other");
        setErrorMsg(err.message);
        clearWatcher();
        setTracking(false);
      },
      { enableHighAccuracy: true, maximumAge: 5_000, timeout: 20_000 },
    );
    watchIdRef.current = id;
    setTracking(true);
    statusMut.mutate("en_route");
  }

  function stopTracking() {
    clearWatcher();
    setTracking(false);
    statusMut.mutate("idle", { onSuccess: () => toast.success("Route ended") });
  }

  useEffect(() => () => clearWatcher(), []);

  if (isLoading) return <SkeletonPage />;

  if (!bus) {
    return (
      <PortalPage title="Driver dashboard">
        <EmptyState
          icon={<Bus className="size-7" />}
          title="No bus assigned"
          description="A school administrator must assign you to a bus before you can start tracking."
        />
      </PortalPage>
    );
  }

  const status = bus.current_status;
  const meta = STATUS_META[status];
  const canStart = !tracking && (status === "idle" || status === "at_school");
  const assignedCount = bus.assigned_students.length;
  const capacity = bus.capacity ?? 0;
  const remaining = Math.max(0, capacity - assignedCount);

  // Prefer live coords; otherwise fall back to last persisted server values.
  const liveLat = coords?.lat ?? bus.current_latitude ?? null;
  const liveLng = coords?.lng ?? bus.current_longitude ?? null;
  const lastSeen = coords
    ? new Date(coords.at).toLocaleTimeString()
    : bus.last_location_update
      ? new Date(bus.last_location_update).toLocaleTimeString()
      : null;

  return (
    <PortalPage title={`Bus ${bus.bus_number}`}>
      <PreviewPublicSiteCard />
      <PageHeader
        title={`Bus ${bus.bus_number}`}
        subtitle={bus.route_name ?? "No route assigned"}
        action={
          <span
            className={`inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-semibold ${meta.chip}`}
          >
            <span
              className={`size-2 rounded-full ${meta.dot} ${tracking ? "animate-pulse" : ""}`}
            />
            {meta.label}
          </span>
        }
      />

      <SectionGrid>
        <StatCard label="Students on bus" value={assignedCount} />
        <StatCard label="Bus capacity" value={capacity || "—"} />
        <StatCard label="Remaining seats" value={remaining} />
        <StatCard label="Status" value={meta.label} />
      </SectionGrid>

      {/* ---- LIVE MAP ---- */}
      <GlassCard>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-[color:var(--text-muted)]">
            <MapPin className="size-4" />
            Live map
          </div>
          {lastSeen && (
            <div className="flex items-center gap-1.5 text-xs text-[color:var(--text-muted)]">
              <Clock className="size-3.5" /> Updated {lastSeen}
            </div>
          )}
        </div>
        <div className="mt-3 overflow-hidden rounded-xl border border-[color:var(--glass-border)] bg-black/40">
          <LiveMap lat={liveLat} lng={liveLng} />
        </div>
        {liveLat !== null && liveLng !== null && (
          <a
            href={`https://www.google.com/maps/search/?api=1&query=${liveLat},${liveLng}`}
            target="_blank"
            rel="noreferrer"
            className="mt-3 inline-flex items-center gap-1.5 text-sm text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]"
          >
            <MapPin className="size-4" /> Open in Google Maps
          </a>
        )}
      </GlassCard>

      {/* ---- TRACKING CONTROLS ---- */}
      <GlassCard>
        <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-[color:var(--text-muted)]">
          <Radio className={`size-4 ${tracking ? "animate-pulse text-emerald-400" : ""}`} />
          Route tracking
        </div>

        {permError === "unsupported" && (
          <AlertBox tone="red">Your device does not support GPS tracking.</AlertBox>
        )}
        {permError === "denied" && (
          <AlertBox tone="amber">
            Location access is required to track your bus. Please allow location access in your
            browser settings.
            <a
              href="https://support.google.com/chrome/answer/142065"
              target="_blank"
              rel="noreferrer"
              className="mt-2 inline-flex items-center gap-1.5 text-xs font-semibold text-amber-300 hover:text-amber-200"
            >
              <HelpCircle className="size-3.5" /> How to enable location
            </a>
          </AlertBox>
        )}
        {permError === "other" && errorMsg && <AlertBox tone="red">{errorMsg}</AlertBox>}

        {/* GPS throttle slider */}
        <div className="mt-4 rounded-xl border border-[color:var(--glass-border)] bg-white/[0.02] p-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs font-semibold text-[color:var(--text-secondary)]">
              <Gauge className="size-4" /> GPS update interval
            </div>
            <span className="font-mono text-xs text-[color:var(--text-muted)]">
              every{" "}
              {THROTTLE_OPTIONS.find((o) => o.ms === throttleMs)?.label ?? `${throttleMs / 1000}s`}
            </span>
          </div>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {THROTTLE_OPTIONS.map((opt) => (
              <button
                key={opt.ms}
                type="button"
                onClick={() => setThrottleMs(opt.ms)}
                className={`rounded-lg border px-3 py-1.5 text-xs font-semibold transition ${
                  throttleMs === opt.ms
                    ? "border-emerald-500/40 bg-emerald-500/15 text-emerald-200"
                    : "border-[color:var(--glass-border)] bg-white/5 text-[color:var(--text-secondary)] hover:bg-white/10"
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-[color:var(--text-muted)]">
            Shorter intervals drain battery faster but give parents a smoother live feed.
          </p>
        </div>

        <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="text-sm text-[color:var(--text-secondary)]">
            {tracking ? (
              <span className="inline-flex items-center gap-2">
                <span className="size-2 animate-pulse rounded-full bg-emerald-400" />
                Tracking active — pushing every {throttleMs / 1000}s
              </span>
            ) : (
              "Start the route to broadcast your live location to parents."
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            {canStart && (
              <button
                type="button"
                onClick={startTracking}
                className="uos-btn-primary inline-flex items-center justify-center gap-2 rounded-xl px-4 py-3 text-sm font-semibold"
              >
                <Play className="size-4" /> Start Route
              </button>
            )}
            {tracking && (
              <button
                type="button"
                onClick={stopTracking}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-red-500 px-4 py-3 text-sm font-semibold text-white hover:bg-red-600"
              >
                <Square className="size-4" /> End Route
              </button>
            )}
          </div>
        </div>

        {/* Arrival notifications */}
        <div className="mt-4 grid gap-2 sm:grid-cols-3">
          <ArrivalButton
            label="Mark arrived at school"
            disabled={arrivalMut.isPending}
            onClick={() => {
              statusMut.mutate("at_school");
              arrivalMut.mutate("arrived_school");
            }}
          />
          <ArrivalButton
            label="Departing school"
            disabled={arrivalMut.isPending}
            onClick={() => {
              statusMut.mutate("returning");
              arrivalMut.mutate("departing_school");
            }}
          />
          <ArrivalButton
            label="Reached a stop"
            disabled={arrivalMut.isPending}
            onClick={() => arrivalMut.mutate("arrived_stop")}
          />
        </div>

        {(coords || bus.current_latitude !== null) && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <div className="text-xs text-[color:var(--text-muted)]">Latitude</div>
              <div className="font-mono text-sm tabular-nums">
                {(coords?.lat ?? bus.current_latitude)?.toFixed(6) ?? "—"}
              </div>
            </div>
            <div>
              <div className="text-xs text-[color:var(--text-muted)]">Longitude</div>
              <div className="font-mono text-sm tabular-nums">
                {(coords?.lng ?? bus.current_longitude)?.toFixed(6) ?? "—"}
              </div>
            </div>
          </div>
        )}
      </GlassCard>

      {/* ---- ROUTE HISTORY ---- */}
      <GlassCard>
        <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-[color:var(--text-muted)]">
          <History className="size-4" /> Route history (this session)
        </div>
        {history.length === 0 ? (
          <p className="mt-3 text-sm text-[color:var(--text-muted)]">
            No GPS fixes captured yet. Start the route to build a breadcrumb trail.
          </p>
        ) : (
          <ol className="mt-3 max-h-72 space-y-1.5 overflow-y-auto pr-1">
            {history.map((h, i) => (
              <li
                key={`${h.at}-${i}`}
                className="flex items-center justify-between gap-3 rounded-lg border border-[color:var(--glass-border)] bg-white/[0.02] px-3 py-1.5 text-xs"
              >
                <span className="font-mono tabular-nums text-[color:var(--text-secondary)]">
                  {new Date(h.at).toLocaleTimeString()}
                </span>
                <span className="font-mono tabular-nums text-[color:var(--text-muted)]">
                  {h.lat.toFixed(5)}, {h.lng.toFixed(5)}
                </span>
                <a
                  href={`https://www.google.com/maps/search/?api=1&query=${h.lat},${h.lng}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-emerald-300 hover:text-emerald-200"
                >
                  Map
                </a>
              </li>
            ))}
          </ol>
        )}
      </GlassCard>

      {/* ---- ROSTER ---- */}
      <GlassCard>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-[color:var(--text-muted)]">
            <Users className="size-4" />
            {assignedCount} {assignedCount === 1 ? "student" : "students"} on this bus
          </div>
          {assignedCount > 0 && (
            <Link
              to="/driver/students"
              className="inline-flex items-center gap-1 text-xs font-semibold text-[color:var(--text-secondary)] hover:text-[color:var(--text-primary)]"
            >
              View all <ArrowRight className="size-3.5" />
            </Link>
          )}
        </div>

        {assignedCount === 0 ? (
          <div className="mt-4">
            <EmptyState
              icon={<Users className="size-6" />}
              title="No students assigned"
              description="Contact your school administrator to assign students to your bus."
            />
          </div>
        ) : (
          <ul className="mt-4 flex flex-col gap-2">
            {bus.students.slice(0, 6).map((s) => (
              <StudentRow key={s.id} student={s} />
            ))}
            {bus.students.length > 6 && (
              <li className="pt-1 text-xs text-[color:var(--text-muted)]">
                + {bus.students.length - 6} more
              </li>
            )}
          </ul>
        )}
      </GlassCard>
    </PortalPage>
  );
}

function LiveMap({ lat, lng }: { lat: number | null; lng: number | null }) {
  const src = useMemo(() => {
    if (lat === null || lng === null) return null;
    // ~600m square around the bus
    const d = 0.005;
    const bbox = `${lng - d}%2C${lat - d}%2C${lng + d}%2C${lat + d}`;
    return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat}%2C${lng}`;
  }, [lat, lng]);

  if (!src) {
    return (
      <div className="grid h-64 place-items-center text-sm text-[color:var(--text-muted)]">
        Waiting for the first GPS fix…
      </div>
    );
  }
  return (
    <iframe
      title="Live bus location"
      src={src}
      className="h-64 w-full border-0 md:h-80"
      loading="lazy"
      referrerPolicy="no-referrer-when-downgrade"
    />
  );
}

function ArrivalButton({
  label,
  onClick,
  disabled,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-[color:var(--glass-border)] bg-white/[0.03] px-3 py-2 text-xs font-semibold text-[color:var(--text-secondary)] transition hover:bg-white/[0.07] disabled:opacity-50"
    >
      <Bell className="size-3.5" /> {label}
    </button>
  );
}

function AlertBox({ tone, children }: { tone: "red" | "amber"; children: React.ReactNode }) {
  const cls =
    tone === "red"
      ? "border-red-500/30 bg-red-500/5 text-red-200"
      : "border-amber-500/30 bg-amber-500/5 text-amber-200";
  return (
    <div className={`mt-4 flex items-start gap-3 rounded-xl border p-4 text-sm ${cls}`}>
      <AlertCircle className="mt-0.5 size-5 shrink-0" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
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
          className="size-9 shrink-0 rounded-full object-cover"
        />
      ) : (
        <div className="grid size-9 shrink-0 place-items-center rounded-full bg-white/5 text-sm font-semibold text-white/70">
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

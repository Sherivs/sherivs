import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Bus as BusIcon, Users, Pencil, Power, X, Search } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import {
  PortalPage,
  StatCard,
  SectionGrid,
  EmptyState,
  FeatureLockedCard,
  CardListSkeleton,
} from "@/components/portal-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { isFeatureActive } from "@/lib/subscription-tiers";

export const Route = createFileRoute("/_authenticated/admin/bus-management")({
  ssr: false,
  component: BusManagementPage,
});

type BusRow = {
  id: string;
  school_id: string;
  bus_number: string;
  registration_plate: string | null;
  bus_type: string | null;
  capacity: number | null;
  driver_id: string | null;
  current_status: string | null;
  current_latitude: number | null;
  current_longitude: number | null;
  last_location_update: string | null;
  route_name: string | null;
  assigned_students: string[] | null;
  is_active: boolean | null;
};

type Driver = { id: string; full_name: string };
type Student = { id: string; full_name: string; class_id: string | null };

const BUS_TYPES = [
  { value: "minibus", label: "Mini Bus" },
  { value: "standard", label: "Standard Bus" },
  { value: "coach", label: "Coach" },
  { value: "other", label: "Other" },
];

const STATUS_META: Record<string, { label: string; cls: string }> = {
  idle: { label: "Idle", cls: "bg-white/10 text-white/80 border-white/30" },
  en_route: {
    label: "On Route 🟢",
    cls: "bg-emerald-500/20 text-emerald-300 border-emerald-500/40",
  },
  at_school: { label: "At School", cls: "bg-blue-500/20 text-blue-300 border-blue-500/40" },
  returning: { label: "Returning", cls: "bg-amber-500/20 text-amber-300 border-amber-500/40" },
  maintenance: { label: "Maintenance", cls: "bg-red-500/20 text-red-300 border-red-500/40" },
};

function asStudentIds(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x): x is string => typeof x === "string");
  return [];
}

function BusManagementPage() {
  const { school, profile } = useApp();
  const qc = useQueryClient();
  const schoolId = school?.id ?? profile?.school_id ?? "";

  const tier = (school?.subscription_tier as string | null) ?? "trial";
  const features = (school?.active_features ?? {}) as Record<string, unknown>;
  const hasTransport =
    isFeatureActive(tier, features, "transport_basic") ||
    isFeatureActive(tier, features, "bus_live_tracking");

  const busesQ = useQuery<BusRow[]>({
    queryKey: ["fleet-buses", schoolId],
    enabled: !!schoolId && hasTransport,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transport_buses")
        .select(
          "id, school_id, bus_number, registration_plate, bus_type, capacity, driver_id, current_status, current_latitude, current_longitude, last_location_update, route_name, assigned_students, is_active",
        )
        .eq("school_id", schoolId)
        .order("bus_number");
      if (error) throw new Error(error.message);
      return (data ?? []).map((b: any) => ({
        ...b,
        assigned_students: asStudentIds(b.assigned_students),
      })) as BusRow[];
    },
  });

  const driversQ = useQuery<Driver[]>({
    queryKey: ["fleet-drivers", schoolId],
    enabled: !!schoolId && hasTransport,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("users")
        .select("id, full_name")
        .eq("school_id", schoolId)
        .eq("role", "driver")
        .eq("is_active", true)
        .order("full_name");
      if (error) throw new Error(error.message);
      return (data ?? []) as Driver[];
    },
  });

  const studentsQ = useQuery<Student[]>({
    queryKey: ["fleet-students", schoolId],
    enabled: !!schoolId && hasTransport,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("students")
        .select("id, full_name, class_id, status, is_active")
        .eq("school_id", schoolId)
        .eq("is_active", true)
        .order("full_name");
      if (error) throw new Error(error.message);
      return ((data ?? []) as any[])
        .filter((s) => s.status !== "graduated" && s.status !== "withdrawn")
        .map((s) => ({ id: s.id, full_name: s.full_name, class_id: s.class_id })) as Student[];
    },
  });

  // Realtime updates
  useEffect(() => {
    if (!schoolId || !hasTransport) return;
    const channel = supabase
      .channel(`fleet-${schoolId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "transport_buses",
          filter: `school_id=eq.${schoolId}`,
        },
        () => {
          qc.invalidateQueries({ queryKey: ["fleet-buses", schoolId] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [schoolId, hasTransport, qc]);

  if (!hasTransport) {
    return (
      <PortalPage title="Bus management" subtitle="Fleet operations and live tracking">
        <FeatureLockedCard
          featureName="Bus Management"
          requiredTier="Growth"
          description="Manage your school's transport fleet, assign drivers, and track buses in real time."
        />
      </PortalPage>
    );
  }

  const buses = (busesQ.data ?? []).filter((b) => b.is_active);
  const drivers = driversQ.data ?? [];
  const students = studentsQ.data ?? [];

  const onRoute = buses.filter((b) => b.current_status === "en_route").length;
  const idle = buses.filter((b) => b.current_status === "idle" || !b.current_status).length;
  const totalAssigned = buses.reduce((sum, b) => sum + (b.assigned_students?.length ?? 0), 0);

  const assignedAcrossFleet = new Set<string>();
  for (const b of buses) for (const sid of b.assigned_students ?? []) assignedAcrossFleet.add(sid);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["fleet-buses", schoolId] });

  return (
    <PortalPage
      title="Bus management"
      subtitle="Fleet overview, driver assignments, and live bus status"
      actions={
        <BusFormSheet mode="add" schoolId={schoolId} drivers={drivers} onSaved={invalidate} />
      }
    >
      <SectionGrid>
        <StatCard label="Total buses" value={buses.length} />
        <StatCard label="On route" value={onRoute} />
        <StatCard label="Students transported" value={totalAssigned} />
        <StatCard label="Available" value={idle} />
      </SectionGrid>

      <div className="mt-6">
        {busesQ.isLoading ? (
          <CardListSkeleton rows={3} />
        ) : buses.length === 0 ? (
          <EmptyState
            icon={<BusIcon className="w-6 h-6" />}
            title="No buses in your fleet"
            description="Add your first bus to begin managing student transport."
            action={
              <BusFormSheet mode="add" schoolId={schoolId} drivers={drivers} onSaved={invalidate} />
            }
          />
        ) : (
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {buses.map((b) => (
              <BusCard
                key={b.id}
                bus={b}
                drivers={drivers}
                students={students}
                assignedAcrossFleet={assignedAcrossFleet}
                onChange={invalidate}
              />
            ))}
          </div>
        )}
      </div>
    </PortalPage>
  );
}

function BusCard({
  bus,
  drivers,
  students,
  assignedAcrossFleet,
  onChange,
}: {
  bus: BusRow;
  drivers: Driver[];
  students: Student[];
  assignedAcrossFleet: Set<string>;
  onChange: () => void;
}) {
  const status = bus.current_status ?? "idle";
  const meta = STATUS_META[status] ?? STATUS_META.idle;
  const driver = drivers.find((d) => d.id === bus.driver_id);
  const assignedCount = bus.assigned_students?.length ?? 0;
  const capacity = bus.capacity ?? 0;

  const lastUpdate = bus.last_location_update
    ? `Updated ${formatDistanceToNow(new Date(bus.last_location_update), { addSuffix: true })}`
    : "Location unknown";

  const [confirmOff, setConfirmOff] = useState(false);

  const deactivate = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("transport_buses")
        .update({ is_active: false })
        .eq("id", bus.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Bus deactivated");
      setConfirmOff(false);
      onChange();
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  return (
    <div className="glass-card p-4 flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="text-2xl font-bold tracking-tight">{bus.bus_number}</div>
          <div className="text-xs text-muted-foreground">
            {bus.registration_plate ?? "No plate"}
          </div>
        </div>
        <Badge variant="outline" className={meta.cls}>
          {meta.label}
        </Badge>
      </div>

      <div className="text-sm space-y-1">
        <div className="text-muted-foreground">{bus.route_name ?? "No route set"}</div>
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-muted-foreground">Driver:</span>
          <span className="text-sm">{driver?.full_name ?? "Unassigned"}</span>
        </div>
        <div className="text-xs text-muted-foreground">{lastUpdate}</div>
        <div className="text-xs">
          <span className="font-semibold">{assignedCount}</span>
          <span className="text-muted-foreground"> / {capacity || "—"} students</span>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5 pt-1">
        <BusFormSheet
          mode="edit"
          schoolId={bus.school_id}
          drivers={drivers}
          bus={bus}
          onSaved={onChange}
        />
        <StudentsSheet
          bus={bus}
          students={students}
          assignedAcrossFleet={assignedAcrossFleet}
          onChange={onChange}
        />
        <Button size="sm" variant="ghost" onClick={() => setConfirmOff(true)}>
          <Power className="size-3.5 mr-1" /> Deactivate
        </Button>
      </div>

      <AlertDialog open={confirmOff} onOpenChange={setConfirmOff}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Deactivate this bus?</AlertDialogTitle>
            <AlertDialogDescription>
              It will no longer appear in tracking. You can re-activate it later from the database.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deactivate.mutate()}>Deactivate</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function BusFormSheet({
  mode,
  schoolId,
  drivers,
  bus,
  onSaved,
}: {
  mode: "add" | "edit";
  schoolId: string;
  drivers: Driver[];
  bus?: BusRow;
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const initial = useMemo(
    () => ({
      bus_number: bus?.bus_number ?? "",
      registration_plate: bus?.registration_plate ?? "",
      bus_type: bus?.bus_type ?? "standard",
      capacity: String(bus?.capacity ?? 30),
      driver_id: bus?.driver_id ?? "__none",
      route_name: bus?.route_name ?? "",
    }),
    [bus],
  );
  const [form, setForm] = useState(initial);

  useEffect(() => {
    if (open) setForm(initial);
  }, [open, initial]);

  const save = useMutation({
    mutationFn: async () => {
      const num = form.bus_number.trim();
      if (!num) throw new Error("Bus number is required");
      const cap = Number(form.capacity);
      if (!Number.isFinite(cap) || cap < 1 || cap > 100)
        throw new Error("Capacity must be between 1 and 100");

      const payload = {
        bus_number: num,
        registration_plate: form.registration_plate.trim() || null,
        bus_type: form.bus_type,
        capacity: cap,
        driver_id: form.driver_id === "__none" ? null : form.driver_id,
        route_name: form.route_name.trim() || null,
      };

      if (mode === "add") {
        const { error } = await supabase.from("transport_buses").insert({
          school_id: schoolId,
          ...payload,
          assigned_students: [],
          is_active: true,
          current_status: "idle",
        });
        if (error) throw new Error(error.message);
      } else if (bus) {
        const { error } = await supabase.from("transport_buses").update(payload).eq("id", bus.id);
        if (error) throw new Error(error.message);
      }
    },
    onSuccess: () => {
      toast.success(mode === "add" ? "Bus added" : "Bus updated");
      setOpen(false);
      onSaved();
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  const noDrivers = drivers.length === 0;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        {mode === "add" ? (
          <Button size="sm">
            <Plus className="mr-1.5 size-4" /> Add bus
          </Button>
        ) : (
          <Button size="sm" variant="outline">
            <Pencil className="size-3.5 mr-1" /> Edit
          </Button>
        )}
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-lg h-dvh sm:h-auto overflow-y-auto">
        <SheetHeader>
          <SheetTitle>{mode === "add" ? "Register a bus" : `Edit ${bus?.bus_number}`}</SheetTitle>
        </SheetHeader>
        <form
          className="space-y-4 mt-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Bus number</Label>
              <Input
                value={form.bus_number}
                onChange={(e) => setForm({ ...form, bus_number: e.target.value })}
                placeholder="BUS-001"
                required
              />
            </div>
            <div>
              <Label>Registration plate</Label>
              <Input
                value={form.registration_plate}
                onChange={(e) => setForm({ ...form, registration_plate: e.target.value })}
                placeholder="LAG-123-AB"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Bus type</Label>
              <Select
                value={form.bus_type}
                onValueChange={(v) => setForm({ ...form, bus_type: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {BUS_TYPES.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label>Capacity</Label>
              <Input
                type="number"
                min={1}
                max={100}
                value={form.capacity}
                onChange={(e) => setForm({ ...form, capacity: e.target.value })}
              />
            </div>
          </div>

          <div>
            <Label>Assign driver</Label>
            {noDrivers ? (
              <p className="text-xs text-amber-300 mt-1">
                No drivers found — add driver accounts first.
              </p>
            ) : (
              <Select
                value={form.driver_id}
                onValueChange={(v) => setForm({ ...form, driver_id: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none">Unassigned</SelectItem>
                  {drivers.map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.full_name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          </div>

          <div>
            <Label>Route name</Label>
            <Input
              value={form.route_name}
              onChange={(e) => setForm({ ...form, route_name: e.target.value })}
              placeholder="Ikeja - Lekki Route"
            />
          </div>

          <Button type="submit" disabled={save.isPending} className="w-full">
            {save.isPending ? "Saving…" : mode === "add" ? "Add bus" : "Save changes"}
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function StudentsSheet({
  bus,
  students,
  assignedAcrossFleet,
  onChange,
}: {
  bus: BusRow;
  students: Student[];
  assignedAcrossFleet: Set<string>;
  onChange: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [picked, setPicked] = useState<string>("");

  const assigned = bus.assigned_students ?? [];
  const assignedSet = new Set(assigned);
  const assignedStudents = students.filter((s) => assignedSet.has(s.id));

  const available = students.filter(
    (s) =>
      !assignedAcrossFleet.has(s.id) && s.full_name.toLowerCase().includes(search.toLowerCase()),
  );

  const capacity = bus.capacity ?? 0;
  const atCapacity = capacity > 0 && assigned.length >= capacity;

  const mutate = useMutation({
    mutationFn: async (next: string[]) => {
      const { error } = await supabase
        .from("transport_buses")
        .update({ assigned_students: next })
        .eq("id", bus.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      onChange();
      setPicked("");
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  const add = () => {
    if (!picked) return;
    if (atCapacity) {
      toast.error("Bus is at capacity");
      return;
    }
    mutate.mutate([...assigned, picked]);
    toast.success("Student added");
  };

  const remove = (sid: string) => {
    mutate.mutate(assigned.filter((x) => x !== sid));
    toast.success("Student removed");
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button size="sm" variant="outline">
          <Users className="size-3.5 mr-1" /> View Students
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-lg h-dvh sm:h-auto overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Students on {bus.bus_number}</SheetTitle>
        </SheetHeader>

        <div className="mt-4 space-y-4">
          <div className="text-xs text-muted-foreground">
            {assigned.length} assigned · capacity {capacity || "—"}
          </div>

          <div className="space-y-1.5">
            {assignedStudents.length === 0 ? (
              <p className="text-sm text-muted-foreground">No students assigned yet.</p>
            ) : (
              assignedStudents.map((s) => (
                <div
                  key={s.id}
                  className="flex items-center justify-between rounded-md border border-border px-3 py-2"
                >
                  <div className="text-sm">{s.full_name}</div>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label={`Remove ${s.full_name}`}
                    onClick={() => remove(s.id)}
                  >
                    <X className="size-4" />
                  </Button>
                </div>
              ))
            )}
          </div>

          <div className="pt-4 border-t border-border space-y-2">
            <Label>Add student</Label>
            <div className="relative">
              <Search className="absolute left-2 top-2.5 size-3.5 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search students…"
                className="pl-7"
              />
            </div>
            <Select value={picked} onValueChange={setPicked}>
              <SelectTrigger>
                <SelectValue
                  placeholder={available.length ? "Select a student" : "No eligible students"}
                />
              </SelectTrigger>
              <SelectContent>
                {available.slice(0, 200).map((s) => (
                  <SelectItem key={s.id} value={s.id}>
                    {s.full_name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              onClick={add}
              disabled={!picked || mutate.isPending || atCapacity}
              className="w-full"
            >
              {atCapacity ? "At capacity" : "Add to bus"}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

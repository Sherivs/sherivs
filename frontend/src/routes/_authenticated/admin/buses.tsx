import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Bus, MapPin, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import {
  PortalPage,
  GlassCard,
  EmptyCard,
  StatCard,
  SectionGrid,
  CardListSkeleton,
} from "@/components/portal-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

export const Route = createFileRoute("/_authenticated/admin/buses")({
  ssr: false,
  component: AdminBusesPage,
});

type Bus = {
  id: string;
  bus_number: string;
  route_name: string | null;
  registration_plate: string | null;
  capacity: number | null;
  bus_type: string | null;
  driver_id: string | null;
  current_status: string | null;
  current_latitude: number | null;
  current_longitude: number | null;
  last_location_update: string | null;
  is_active: boolean | null;
};

type Driver = { id: string; full_name: string };

function AdminBusesPage() {
  const { profile } = useApp();
  const qc = useQueryClient();
  const schoolId = profile?.school_id ?? "";

  const busesQ = useQuery<Bus[]>({
    queryKey: ["admin-buses", schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("transport_buses")
        .select(
          "id, bus_number, route_name, registration_plate, capacity, bus_type, driver_id, current_status, current_latitude, current_longitude, last_location_update, is_active",
        )
        .eq("school_id", schoolId)
        .order("bus_number");
      if (error) throw new Error(error.message);
      return (data ?? []) as Bus[];
    },
  });

  const driversQ = useQuery<Driver[]>({
    queryKey: ["admin-drivers", schoolId],
    enabled: !!schoolId,
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

  const buses = busesQ.data ?? [];
  const drivers = driversQ.data ?? [];
  const driverName = (id: string | null) => drivers.find((d) => d.id === id)?.full_name ?? null;

  const onRoute = buses.filter((b) => b.current_status === "on_route").length;
  const active = buses.filter((b) => b.is_active).length;
  const unassigned = buses.filter((b) => !b.driver_id).length;

  return (
    <PortalPage
      title="Bus management"
      subtitle="Manage your fleet, assign drivers, and monitor live status."
      actions={
        <AddBusDialog
          schoolId={schoolId}
          drivers={drivers}
          onSaved={() => qc.invalidateQueries({ queryKey: ["admin-buses"] })}
        />
      }
    >
      <SectionGrid>
        <StatCard label="Total buses" value={buses.length} />
        <StatCard label="Active" value={active} />
        <StatCard label="On route now" value={onRoute} />
        <StatCard
          label="No driver"
          value={unassigned}
          hint={unassigned > 0 ? "Assign drivers below" : undefined}
        />
      </SectionGrid>

      {busesQ.isLoading ? (
        <CardListSkeleton rows={3} />
      ) : buses.length === 0 ? (
        <EmptyCard
          title="No buses registered"
          body="Click 'Add bus' to register your first vehicle."
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2">
          {buses.map((b) => (
            <BusCard
              key={b.id}
              bus={b}
              drivers={drivers}
              driverName={driverName(b.driver_id)}
              onChange={() => qc.invalidateQueries({ queryKey: ["admin-buses"] })}
            />
          ))}
        </div>
      )}
    </PortalPage>
  );
}

function BusCard({
  bus,
  drivers,
  driverName,
  onChange,
}: {
  bus: Bus;
  drivers: Driver[];
  driverName: string | null;
  onChange: () => void;
}) {
  const assign = useMutation({
    mutationFn: async (driverId: string | null) => {
      const { error } = await supabase
        .from("transport_buses")
        .update({ driver_id: driverId })
        .eq("id", bus.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Driver updated");
      onChange();
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });
  const toggleActive = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("transport_buses")
        .update({ is_active: !bus.is_active })
        .eq("id", bus.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Updated");
      onChange();
    },
  });
  const remove = useMutation({
    mutationFn: async () => {
      if (!confirm(`Delete bus ${bus.bus_number}?`)) throw new Error("cancelled");
      const { error } = await supabase.from("transport_buses").delete().eq("id", bus.id);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Bus deleted");
      onChange();
    },
    onError: (e: any) => {
      if (e.message !== "cancelled") toast.error(e.message);
    },
  });

  return (
    <GlassCard>
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <Bus className="size-4 text-primary" />
            <h3 className="font-display text-lg font-semibold">{bus.bus_number}</h3>
            <Badge variant={bus.is_active ? "default" : "secondary"}>
              {bus.is_active ? "Active" : "Inactive"}
            </Badge>
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {bus.route_name ?? "No route"} · {bus.registration_plate ?? "No plate"} · Capacity{" "}
            {bus.capacity ?? "—"}
          </div>
        </div>
        <Button size="icon" variant="ghost" onClick={() => remove.mutate()} aria-label="Delete bus">
          <Trash2 className="size-4" />
        </Button>
      </div>
      <div className="mt-3 space-y-2 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground w-16">Driver:</span>
          <Select
            value={bus.driver_id ?? "__none"}
            onValueChange={(v) => assign.mutate(v === "__none" ? null : v)}
          >
            <SelectTrigger className="h-8 text-xs">
              <SelectValue>{driverName ?? "Unassigned"}</SelectValue>
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
        </div>
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <MapPin className="size-3" />
          {bus.current_latitude && bus.current_longitude ? (
            <>
              {bus.current_latitude.toFixed(4)}, {bus.current_longitude.toFixed(4)} ·{" "}
              {bus.current_status ?? "idle"} ·{" "}
              {bus.last_location_update
                ? new Date(bus.last_location_update).toLocaleTimeString()
                : "—"}
            </>
          ) : (
            "No GPS data yet"
          )}
        </div>
        <Button size="sm" variant="outline" onClick={() => toggleActive.mutate()}>
          {bus.is_active ? "Mark inactive" : "Mark active"}
        </Button>
      </div>
    </GlassCard>
  );
}

function AddBusDialog({
  schoolId,
  drivers,
  onSaved,
}: {
  schoolId: string;
  drivers: Driver[];
  onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    bus_number: "",
    route_name: "",
    registration_plate: "",
    capacity: "30",
    bus_type: "minibus",
    driver_id: "__none",
  });
  const save = useMutation({
    mutationFn: async () => {
      if (!form.bus_number.trim()) throw new Error("Bus number required");
      const { error } = await supabase.from("transport_buses").insert({
        school_id: schoolId,
        bus_number: form.bus_number.trim(),
        route_name: form.route_name.trim() || null,
        registration_plate: form.registration_plate.trim() || null,
        capacity: Number(form.capacity) || null,
        bus_type: form.bus_type,
        driver_id: form.driver_id === "__none" ? null : form.driver_id,
        is_active: true,
        current_status: "off_duty",
      });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      toast.success("Bus added");
      setOpen(false);
      setForm({
        bus_number: "",
        route_name: "",
        registration_plate: "",
        capacity: "30",
        bus_type: "minibus",
        driver_id: "__none",
      });
      onSaved();
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm">
          <Plus className="mr-1.5 size-4" /> Add bus
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Register a bus</DialogTitle>
        </DialogHeader>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
          className="space-y-3"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <Label>Bus number</Label>
              <Input
                value={form.bus_number}
                onChange={(e) => setForm({ ...form, bus_number: e.target.value })}
                required
              />
            </div>
            <div>
              <Label>Registration plate</Label>
              <Input
                value={form.registration_plate}
                onChange={(e) => setForm({ ...form, registration_plate: e.target.value })}
              />
            </div>
          </div>
          <div>
            <Label>Route name</Label>
            <Input
              value={form.route_name}
              onChange={(e) => setForm({ ...form, route_name: e.target.value })}
              placeholder="e.g. Lekki – Phase 1"
            />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <div>
              <Label>Capacity</Label>
              <Input
                type="number"
                min="1"
                value={form.capacity}
                onChange={(e) => setForm({ ...form, capacity: e.target.value })}
              />
            </div>
            <div>
              <Label>Type</Label>
              <Select
                value={form.bus_type}
                onValueChange={(v) => setForm({ ...form, bus_type: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="minibus">Minibus</SelectItem>
                  <SelectItem value="coaster">Coaster</SelectItem>
                  <SelectItem value="full_bus">Full bus</SelectItem>
                  <SelectItem value="van">Van</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
          <div>
            <Label>Assign driver</Label>
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
          </div>
          <Button type="submit" disabled={save.isPending} className="w-full">
            {save.isPending ? "Saving…" : "Add bus"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

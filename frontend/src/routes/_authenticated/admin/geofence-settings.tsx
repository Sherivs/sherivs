import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Crosshair, MapPin, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PortalPage, GlassCard, EmptyState } from "@/components/portal-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
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
import { distanceMeters } from "@/lib/geofence";

export const Route = createFileRoute("/_authenticated/admin/geofence-settings")({
  ssr: false,
  component: GeofenceSettingsPage,
});

const schema = z.object({
  campus_name: z.string().trim().min(1, "Campus name is required").max(80),
  latitude: z.coerce.number().min(-90, "Latitude must be -90 to 90").max(90),
  longitude: z.coerce.number().min(-180, "Longitude must be -180 to 180").max(180),
  radius_meters: z.coerce.number().int().min(20, "Minimum 20m").max(5000, "Maximum 5000m"),
});
type FormValues = z.input<typeof schema>;

type Fence = {
  id: string;
  campus_name: string | null;
  latitude: number;
  longitude: number;
  radius_meters: number | null;
  is_active: boolean | null;
};

function GeofenceSettingsPage() {
  const { school } = useApp();
  const schoolId = school?.id;
  const qc = useQueryClient();
  const [selected, setSelected] = useState<Fence | null>(null);
  const [pendingDelete, setPendingDelete] = useState<Fence | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);

  const fences = useQuery({
    queryKey: ["school-geofences", schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("school_geofence")
        .select("id, campus_name, latitude, longitude, radius_meters, is_active")
        .eq("school_id", schoolId!)
        .order("campus_name");
      if (error) throw error;
      return (data ?? []).map((f) => ({
        ...f,
        latitude: Number(f.latitude),
        longitude: Number(f.longitude),
      })) as Fence[];
    },
  });

  const teachers = useQuery({
    queryKey: ["teacher-enrollment-status", schoolId],
    enabled: !!schoolId,
    queryFn: async () => {
      const { data: staff, error } = await supabase
        .from("users")
        .select("id, full_name, email")
        .eq("school_id", schoolId!)
        .eq("role", "teacher")
        .eq("is_active", true)
        .order("full_name");
      if (error) throw error;
      const { data: bio } = await supabase
        .from("teacher_biometrics")
        .select("user_id, enrollment_status, device_model, enrolled_at")
        .eq("school_id", schoolId!);
      const map = new Map((bio ?? []).map((b) => [b.user_id, b]));
      return (staff ?? []).map((t) => ({ ...t, bio: map.get(t.id) ?? null }));
    },
  });

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      campus_name: "Main Campus",
      latitude: "" as never,
      longitude: "" as never,
      radius_meters: 150,
    },
  });

  useEffect(() => {
    if (selected) {
      form.reset({
        campus_name: selected.campus_name ?? "Main Campus",
        latitude: selected.latitude as never,
        longitude: selected.longitude as never,
        radius_meters: selected.radius_meters ?? 150,
      });
    }
  }, [selected, form]);

  const save = useMutation({
    mutationFn: async (values: FormValues) => {
      if (!schoolId) throw new Error("Missing school context");
      const parsed = schema.parse(values);
      const { error } = await supabase.from("school_geofence").upsert(
        {
          school_id: schoolId,
          campus_name: parsed.campus_name,
          latitude: parsed.latitude,
          longitude: parsed.longitude,
          radius_meters: parsed.radius_meters,
          is_active: true,
        },
        { onConflict: "school_id,campus_name" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Geofence saved");
      void qc.invalidateQueries({ queryKey: ["school-geofences", schoolId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not save geofence"),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from("school_geofence")
        .delete()
        .eq("id", id)
        .eq("school_id", schoolId!);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Campus boundary deleted");
      setPendingDelete(null);
      setSelected(null);
      void qc.invalidateQueries({ queryKey: ["school-geofences", schoolId] });
    },
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not delete boundary"),
  });

  const notify = useMutation({
    mutationFn: async (teacher: { id: string; full_name: string }) => {
      if (!schoolId) throw new Error("Missing school context");
      const { error } = await supabase.from("notifications").insert({
        school_id: schoolId,
        user_id: teacher.id,
        title: "Complete your biometric enrollment",
        message:
          "Please open the teacher portal and finish biometric enrollment so you can sign in for attendance.",
        type: "system",
      });
      if (error) throw error;
    },
    onSuccess: () => toast.success("Enrollment reminder sent"),
    onError: (e) => toast.error(e instanceof Error ? e.message : "Could not send reminder"),
  });

  const useMyLocation = () => {
    if (!navigator.geolocation) return toast.error("Location is not available in this browser");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        form.setValue("latitude", pos.coords.latitude as never);
        form.setValue("longitude", pos.coords.longitude as never);
        toast.success("Filled in your current coordinates");
      },
      () => toast.error("Could not read your location"),
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  const testLocation = () => {
    const lat = Number(form.getValues("latitude"));
    const lng = Number(form.getValues("longitude"));
    const radius = Number(form.getValues("radius_meters")) || 150;
    if (!Number.isFinite(lat) || !Number.isFinite(lng))
      return toast.error("Enter coordinates first");
    if (!navigator.geolocation) return toast.error("Location is not available in this browser");
    setTesting(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setTesting(false);
        const d = Math.round(distanceMeters(pos.coords.latitude, pos.coords.longitude, lat, lng));
        setTestResult(
          d <= radius
            ? `✅ Inside the geofence — ${d}m from the campus centre (radius ${radius}m).`
            : `❌ Outside the geofence — ${d}m away (radius ${radius}m).`,
        );
      },
      () => {
        setTesting(false);
        toast.error("Could not read your location");
      },
      { enableHighAccuracy: true, timeout: 15000 },
    );
  };

  const lat = Number(form.watch("latitude"));
  const lng = Number(form.watch("longitude"));
  const hasCoords = Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0);
  const delta = 0.004;
  const bbox = hasCoords ? `${lng - delta},${lat - delta},${lng + delta},${lat + delta}` : null;

  return (
    <PortalPage
      title="Geofence settings"
      subtitle="Define the campus boundary used for staff attendance verification"
      actions={
        <Button
          variant="outline"
          onClick={() => {
            setSelected(null);
            form.reset({
              campus_name: "",
              latitude: "" as never,
              longitude: "" as never,
              radius_meters: 150,
            });
          }}
        >
          New campus
        </Button>
      }
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <GlassCard className="p-5">
          <h2 className="font-display text-base font-semibold">Campus boundary</h2>
          <form className="mt-4 space-y-4" onSubmit={form.handleSubmit((v) => save.mutate(v))}>
            <Field label="Campus name" error={form.formState.errors.campus_name?.message}>
              <Input {...form.register("campus_name")} placeholder="Main Campus" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Latitude" error={form.formState.errors.latitude?.message}>
                <Input {...form.register("latitude")} inputMode="decimal" placeholder="6.5244" />
              </Field>
              <Field label="Longitude" error={form.formState.errors.longitude?.message}>
                <Input {...form.register("longitude")} inputMode="decimal" placeholder="3.3792" />
              </Field>
            </div>
            <Field label="Radius (metres)" error={form.formState.errors.radius_meters?.message}>
              <Input {...form.register("radius_meters")} inputMode="numeric" />
            </Field>
            <div className="flex flex-wrap gap-2">
              <Button className="w-full sm:w-auto" type="submit" disabled={save.isPending}>
                {save.isPending ? "Saving…" : "Save geofence"}
              </Button>
              <Button type="button" variant="outline" onClick={useMyLocation}>
                <Crosshair className="mr-1.5 size-4" /> Use my location
              </Button>
              <Button type="button" variant="outline" onClick={testLocation} disabled={testing}>
                {testing ? "Testing…" : "Test Current Location"}
              </Button>
            </div>
            {testResult && (
              <p className="rounded-xl border border-white/10 bg-white/5 p-3 text-sm">
                {testResult}
              </p>
            )}
          </form>
        </GlassCard>

        <GlassCard className="overflow-hidden p-0">
          {bbox ? (
            <iframe
              title="Campus location map"
              className="h-[320px] w-full border-0"
              loading="lazy"
              src={`https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat},${lng}`}
            />
          ) : (
            <div className="grid h-[320px] place-items-center p-6 text-center text-sm text-[color:var(--text-secondary)]">
              <div>
                <MapPin className="mx-auto size-8 opacity-50" />
                <p className="mt-2">Enter coordinates to preview the campus on the map.</p>
              </div>
            </div>
          )}
        </GlassCard>
      </div>

      <GlassCard className="p-5">
        <h2 className="font-display text-base font-semibold">Configured campuses</h2>
        {fences.isLoading ? (
          <Skeleton className="mt-4 h-24 w-full rounded-xl" />
        ) : fences.isError ? (
          <RetryBox onRetry={() => void fences.refetch()} />
        ) : (fences.data ?? []).length === 0 ? (
          <EmptyState
            icon={<MapPin className="size-6" />}
            title="No campus boundary yet"
            description="Add coordinates above so teachers can verify their location at sign-in."
          />
        ) : (
          <ul className="mt-4 divide-y divide-white/10">
            {fences.data!.map((f) => (
              <li key={f.id} className="flex flex-wrap items-center justify-between gap-2 py-3">
                <div className="min-w-0">
                  <p className="font-medium">{f.campus_name}</p>
                  <p className="text-xs text-[color:var(--text-secondary)]">
                    {f.latitude.toFixed(5)}, {f.longitude.toFixed(5)} · radius {f.radius_meters}m
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setSelected(f)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setPendingDelete(f)}>
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </GlassCard>

      <GlassCard className="p-5">
        <h2 className="font-display text-base font-semibold">Teacher biometric enrollment</h2>
        {teachers.isLoading ? (
          <Skeleton className="mt-4 h-24 w-full rounded-xl" />
        ) : teachers.isError ? (
          <RetryBox onRetry={() => void teachers.refetch()} />
        ) : (teachers.data ?? []).length === 0 ? (
          <EmptyState
            title="No active teachers"
            description="Add teachers to track enrollment status."
          />
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-white/10 text-left text-xs uppercase tracking-wide text-[color:var(--text-secondary)]">
                  <th className="py-2">Teacher</th>
                  <th className="py-2">Status</th>
                  <th className="py-2">Device</th>
                  <th className="py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {teachers.data!.map((t) => {
                  const status = t.bio?.enrollment_status ?? "not_started";
                  return (
                    <tr key={t.id} className="border-b border-white/5">
                      <td className="py-2">
                        <div className="font-medium">{t.full_name}</div>
                        <div className="text-xs text-[color:var(--text-secondary)]">{t.email}</div>
                      </td>
                      <td className="py-2">
                        <span
                          className={`rounded-full px-2 py-0.5 text-xs ${
                            status === "enrolled"
                              ? "bg-emerald-500/15 text-emerald-400"
                              : status === "suspended"
                                ? "bg-rose-500/15 text-rose-400"
                                : "bg-amber-500/15 text-amber-400"
                          }`}
                        >
                          {status === "not_started" ? "Not started" : status}
                        </span>
                      </td>
                      <td className="py-2 text-xs text-[color:var(--text-secondary)]">
                        {t.bio?.device_model ?? "—"}
                      </td>
                      <td className="py-2 text-right">
                        {status !== "enrolled" && (
                          <Button
                            size="sm"
                            variant="outline"
                            disabled={notify.isPending}
                            onClick={() => notify.mutate({ id: t.id, full_name: t.full_name })}
                          >
                            Resend enrollment
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>

      <AlertDialog open={!!pendingDelete} onOpenChange={(o) => !o && setPendingDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this campus boundary?</AlertDialogTitle>
            <AlertDialogDescription>
              Teachers will no longer be able to verify their location against “
              {pendingDelete?.campus_name}”.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => pendingDelete && remove.mutate(pendingDelete.id)}>
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PortalPage>
  );
}

function Field({
  label,
  error,
  children,
}: {
  label: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase tracking-wide text-[color:var(--text-secondary)]">
        {label}
      </Label>
      {children}
      {error && <p className="text-xs text-rose-400">{error}</p>}
    </div>
  );
}

function RetryBox({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="mt-4 rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 text-sm">
      <p>Something went wrong loading this section.</p>
      <Button size="sm" variant="outline" className="mt-2" onClick={onRetry}>
        Retry
      </Button>
    </div>
  );
}

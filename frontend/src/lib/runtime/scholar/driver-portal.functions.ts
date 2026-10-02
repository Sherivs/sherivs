/**
 * Driver portal server functions.
 *
 * Reads the signed-in driver's bus (driver_id = auth.uid()), pushes
 * location updates, sets bus status, and fetches the student roster
 * stored in transport_buses.assigned_students (a jsonb array of student ids).
 *
 * All writes are guarded by RLS (school_id = get_my_school_id()) AND the
 * driver_id = userId filter so a misrouted call still no-ops gracefully.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { SystemClock, TimeAuthority } from "../../kernel/time-authority";

/** J-023: time enters only via the kernel time-authority — no direct wall-clock sampling. */
const timeAuthority = new TimeAuthority(new SystemClock());

export type DriverBusStatus = "idle" | "en_route" | "at_school" | "returning" | "maintenance";

export type DriverStudent = {
  id: string;
  admission_number: string | null;
  full_name: string | null;
  avatar_url: string | null;
};

export type DriverBusFull = {
  id: string;
  school_id: string;
  bus_number: string;
  registration_plate: string | null;
  capacity: number | null;
  route_name: string | null;
  current_status: DriverBusStatus;
  current_latitude: number | null;
  current_longitude: number | null;
  last_location_update: string | null;
  assigned_students: string[];
  students: DriverStudent[];
};

const Coords = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

const StatusInput = z.object({
  status: z.enum(["idle", "en_route", "at_school", "returning", "maintenance"]),
});

function parseAssigned(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((x): x is string => typeof x === "string");
}

export const getMyDriverBus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DriverBusFull | null> => {
    const { supabase, userId } = context;

    const { data: bus, error } = await supabase
      .from("transport_buses")
      .select(
        "id, school_id, bus_number, registration_plate, capacity, route_name, current_status, current_latitude, current_longitude, last_location_update, assigned_students",
      )
      .eq("driver_id", userId)
      .eq("is_active", true)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!bus) return null;

    const assigned = parseAssigned(bus.assigned_students);

    let students: DriverStudent[] = [];
    if (assigned.length > 0) {
      const { data: rows, error: sErr } = await supabase
        .from("students")
        .select("id, admission_number, users!students_user_id_fkey(full_name, avatar_url)")
        .in("id", assigned)
        .eq("school_id", bus.school_id);
      if (sErr) throw new Error(sErr.message);
      students = (rows ?? []).map(
        (r: {
          id: string;
          admission_number: string | null;
          users: { full_name: string | null; avatar_url: string | null } | null;
        }) => ({
          id: r.id,
          admission_number: r.admission_number,
          full_name: r.users?.full_name ?? null,
          avatar_url: r.users?.avatar_url ?? null,
        }),
      );
    }

    return {
      id: bus.id,
      school_id: bus.school_id,
      bus_number: bus.bus_number,
      registration_plate: bus.registration_plate,
      capacity: bus.capacity,
      route_name: bus.route_name,
      current_status: (bus.current_status ?? "idle") as DriverBusStatus,
      current_latitude: bus.current_latitude !== null ? Number(bus.current_latitude) : null,
      current_longitude: bus.current_longitude !== null ? Number(bus.current_longitude) : null,
      last_location_update: bus.last_location_update,
      assigned_students: assigned,
      students,
    };
  });

export const pushDriverLocation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => Coords.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("transport_buses")
      .update({
        current_latitude: data.latitude,
        current_longitude: data.longitude,
        last_location_update: timeAuthority.now().at,
        current_status: "en_route",
      })
      .eq("driver_id", userId)
      .eq("is_active", true);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const setDriverBusStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => StatusInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("transport_buses")
      .update({ current_status: data.status })
      .eq("driver_id", userId)
      .eq("is_active", true);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

/**
 * Notify parents of every assigned student that the bus has reached a
 * milestone (arrived at school, departing, reached a stop). Caller decides
 * when to fire it (e.g. on the driver tapping "Mark arrived").
 */
const NotifyInput = z.object({
  milestone: z.enum(["arrived_school", "departing_school", "arrived_stop"]),
  custom_message: z.string().trim().max(280).optional(),
});

export const notifyBusArrival = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => NotifyInput.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;

    const { data: bus, error: bErr } = await supabase
      .from("transport_buses")
      .select("id, school_id, bus_number, route_name, assigned_students")
      .eq("driver_id", userId)
      .eq("is_active", true)
      .maybeSingle();
    if (bErr) throw new Error(bErr.message);
    if (!bus) return { notified: 0 };

    const studentIds = parseAssigned(bus.assigned_students);
    if (studentIds.length === 0) return { notified: 0 };

    const { data: maps, error: mErr } = await supabase
      .from("parent_student_map")
      .select("parent_id")
      .eq("school_id", bus.school_id)
      .in("student_id", studentIds);
    if (mErr) throw new Error(mErr.message);

    const parentIds = Array.from(
      new Set((maps ?? []).map((m) => m.parent_id as string).filter(Boolean)),
    );
    if (parentIds.length === 0) return { notified: 0 };

    const titleMap = {
      arrived_school: `Bus ${bus.bus_number} has arrived at school`,
      departing_school: `Bus ${bus.bus_number} is departing school`,
      arrived_stop: `Bus ${bus.bus_number} has reached a stop`,
    } as const;

    const rows = parentIds.map((uid) => ({
      school_id: bus.school_id,
      user_id: uid,
      title: titleMap[data.milestone],
      message:
        data.custom_message ??
        `${titleMap[data.milestone]}${bus.route_name ? ` — ${bus.route_name}` : ""}.`,
      type: "transport",
      action_url: "/parent/bus",
      is_read: false,
    }));

    const { error: iErr } = await supabase.from("notifications").insert(rows);
    if (iErr) throw new Error(iErr.message);
    return { notified: rows.length };
  });

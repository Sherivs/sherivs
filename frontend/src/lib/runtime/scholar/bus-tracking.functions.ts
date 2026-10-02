/**
 * Bus tracking server functions.
 *
 * - getMyBus: driver fetches their assigned bus (if any).
 * - updateBusLocation: driver pushes GPS coordinates (called on watchPosition).
 * - setMyBusStatus: driver toggles current_status (on_route/idle/off_duty).
 *
 * All writes are scoped by `driver_id = auth.uid()` on the RLS side. We
 * mirror that here so a misrouted call still no-ops gracefully.
 */
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

const Coords = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

const StatusInput = z.object({
  status: z.enum(["on_route", "idle", "off_duty"]),
});

export type DriverBus = {
  id: string;
  bus_number: string;
  route_name: string | null;
  registration_plate: string | null;
  capacity: number | null;
  current_status: string | null;
  current_latitude: number | null;
  current_longitude: number | null;
  last_location_update: string | null;
};

export const getMyBus = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }): Promise<DriverBus | null> => {
    const { supabase, userId } = context;
    const { data, error } = await supabase
      .from("transport_buses")
      .select(
        "id, bus_number, route_name, registration_plate, capacity, current_status, current_latitude, current_longitude, last_location_update",
      )
      .eq("driver_id", userId)
      .eq("is_active", true)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return (data as DriverBus) ?? null;
  });

export const updateBusLocation = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((i: unknown) => Coords.parse(i))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    const { error } = await supabase
      .from("transport_buses")
      .update({
        current_latitude: data.latitude,
        current_longitude: data.longitude,
        last_location_update: new Date().toISOString(),
      })
      .eq("driver_id", userId)
      .eq("is_active", true);
    if (error) throw new Error(error.message);
    return { ok: true as const };
  });

export const setMyBusStatus = createServerFn({ method: "POST" })
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

/**
 * Singleton settings forms: school_meals (one row per school) and
 * school_transport (one row per school).
 *
 * Uses the same shadcn primitives as the rest of admin; values flow through
 * facilities.functions.ts server fns so RLS + admin role checks run server-side.
 */
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { z } from "zod";

import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { upsertSchoolMeals, upsertSchoolTransport } from "@/lib/runtime/scholar/facilities.functions";

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex items-center justify-between gap-4 rounded-md border border-border bg-background/40 px-4 py-3">
      <div>
        <div className="text-sm">{label}</div>
        {hint && <div className="text-xs text-muted-foreground">{hint}</div>}
      </div>
      <Switch checked={checked} onCheckedChange={(v) => onChange(Boolean(v))} />
    </label>
  );
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const numStr = (v: unknown) => (typeof v === "number" ? String(v) : typeof v === "string" ? v : "");
const bool = (v: unknown, fallback = false) => (typeof v === "boolean" ? v : fallback);

/* -------------------- Meals -------------------- */

type MealsForm = {
  meal_service_enabled: boolean;
  meal_provider: string;
  meal_provider_type: "" | "in_house" | "contracted" | "both";
  breakfast_enabled: boolean;
  breakfast_time: string;
  breakfast_menu_description: string;
  lunch_enabled: boolean;
  lunch_time: string;
  lunch_menu_description: string;
  snack_enabled: boolean;
  snack_time: string;
  has_vegetarian_option: boolean;
  has_halal_option: boolean;
  has_allergy_accommodation: boolean;
  allergy_accommodation_detail: string;
  monthly_meal_fee: string;
  meal_fee_currency: string;
  dietitian_on_staff: boolean;
  hygiene_certification: string;
  last_inspection_date: string;
  meal_rating_by_students: string;
};

export function MealsTab() {
  const { school } = useApp();
  const qc = useQueryClient();
  const upsert = useServerFn(upsertSchoolMeals);
  const queryKey = ["school_meals", school?.id];

  const q = useQuery({
    queryKey,
    enabled: !!school?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("school_meals")
        .select("*")
        .eq("school_id", school!.id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data as Record<string, unknown> | null;
    },
  });

  const [form, setForm] = useState<MealsForm | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!q.data && q.isSuccess) {
      setForm({
        meal_service_enabled: false,
        meal_provider: "",
        meal_provider_type: "",
        breakfast_enabled: false,
        breakfast_time: "",
        breakfast_menu_description: "",
        lunch_enabled: true,
        lunch_time: "",
        lunch_menu_description: "",
        snack_enabled: false,
        snack_time: "",
        has_vegetarian_option: false,
        has_halal_option: true,
        has_allergy_accommodation: false,
        allergy_accommodation_detail: "",
        monthly_meal_fee: "",
        meal_fee_currency: "NGN",
        dietitian_on_staff: false,
        hygiene_certification: "",
        last_inspection_date: "",
        meal_rating_by_students: "",
      });
    } else if (q.data) {
      const r = q.data;
      setForm({
        meal_service_enabled: bool(r.meal_service_enabled),
        meal_provider: str(r.meal_provider),
        meal_provider_type: (str(r.meal_provider_type) as MealsForm["meal_provider_type"]) || "",
        breakfast_enabled: bool(r.breakfast_enabled),
        breakfast_time: str(r.breakfast_time),
        breakfast_menu_description: str(r.breakfast_menu_description),
        lunch_enabled: bool(r.lunch_enabled, true),
        lunch_time: str(r.lunch_time),
        lunch_menu_description: str(r.lunch_menu_description),
        snack_enabled: bool(r.snack_enabled),
        snack_time: str(r.snack_time),
        has_vegetarian_option: bool(r.has_vegetarian_option),
        has_halal_option: bool(r.has_halal_option, true),
        has_allergy_accommodation: bool(r.has_allergy_accommodation),
        allergy_accommodation_detail: str(r.allergy_accommodation_detail),
        monthly_meal_fee: numStr(r.monthly_meal_fee),
        meal_fee_currency: str(r.meal_fee_currency) || "NGN",
        dietitian_on_staff: bool(r.dietitian_on_staff),
        hygiene_certification: str(r.hygiene_certification),
        last_inspection_date: str(r.last_inspection_date),
        meal_rating_by_students: str(r.meal_rating_by_students),
      });
    }
  }, [q.data, q.isSuccess]);

  if (!form) {
    return <div className="uos-card p-6 text-sm text-muted-foreground">Loading…</div>;
  }

  const set = <K extends keyof MealsForm>(k: K, v: MealsForm[K]) =>
    setForm((s) => (s ? { ...s, [k]: v } : s));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await upsert({
        data: {
          ...form,
          meal_provider_type: form.meal_provider_type || null,
          monthly_meal_fee: form.monthly_meal_fee === "" ? null : Number(form.monthly_meal_fee),
          last_inspection_date: form.last_inspection_date || null,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      });
      toast.success("Meal settings saved");
      qc.invalidateQueries({ queryKey });
    } catch (e2) {
      const msg =
        e2 instanceof z.ZodError
          ? e2.issues.map((i) => i.message).join(", ")
          : e2 instanceof Error
            ? e2.message
            : "Failed to save";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="uos-card space-y-6 p-6">
      <ToggleRow
        label="Meal service enabled"
        hint="Show meals on the public site and on the parent portal."
        checked={form.meal_service_enabled}
        onChange={(v) => set("meal_service_enabled", v)}
      />

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Provider name">
          <Input
            value={form.meal_provider}
            onChange={(e) => set("meal_provider", e.target.value)}
            maxLength={160}
          />
        </Field>
        <Field label="Provider type">
          <select
            value={form.meal_provider_type}
            onChange={(e) =>
              set("meal_provider_type", e.target.value as MealsForm["meal_provider_type"])
            }
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">—</option>
            <option value="in_house">In-house</option>
            <option value="contracted">Contracted</option>
            <option value="both">Both</option>
          </select>
        </Field>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <ToggleRow
          label="Breakfast"
          checked={form.breakfast_enabled}
          onChange={(v) => set("breakfast_enabled", v)}
        />
        <ToggleRow
          label="Lunch"
          checked={form.lunch_enabled}
          onChange={(v) => set("lunch_enabled", v)}
        />
        <ToggleRow
          label="Snack"
          checked={form.snack_enabled}
          onChange={(v) => set("snack_enabled", v)}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Breakfast time">
          <Input
            value={form.breakfast_time}
            onChange={(e) => set("breakfast_time", e.target.value)}
            placeholder="7:30 AM"
          />
        </Field>
        <Field label="Lunch time">
          <Input
            value={form.lunch_time}
            onChange={(e) => set("lunch_time", e.target.value)}
            placeholder="12:30 PM"
          />
        </Field>
        <Field label="Snack time">
          <Input
            value={form.snack_time}
            onChange={(e) => set("snack_time", e.target.value)}
            placeholder="3:00 PM"
          />
        </Field>
      </div>

      <Field label="Breakfast menu">
        <Textarea
          value={form.breakfast_menu_description}
          onChange={(e) => set("breakfast_menu_description", e.target.value)}
          rows={3}
          maxLength={2000}
        />
      </Field>
      <Field label="Lunch menu">
        <Textarea
          value={form.lunch_menu_description}
          onChange={(e) => set("lunch_menu_description", e.target.value)}
          rows={3}
          maxLength={2000}
        />
      </Field>

      <div className="grid gap-3 md:grid-cols-2">
        <ToggleRow
          label="Vegetarian option"
          checked={form.has_vegetarian_option}
          onChange={(v) => set("has_vegetarian_option", v)}
        />
        <ToggleRow
          label="Halal option"
          checked={form.has_halal_option}
          onChange={(v) => set("has_halal_option", v)}
        />
        <ToggleRow
          label="Allergy accommodation"
          checked={form.has_allergy_accommodation}
          onChange={(v) => set("has_allergy_accommodation", v)}
        />
        <ToggleRow
          label="Dietitian on staff"
          checked={form.dietitian_on_staff}
          onChange={(v) => set("dietitian_on_staff", v)}
        />
      </div>

      {form.has_allergy_accommodation && (
        <Field label="Allergy accommodation details">
          <Textarea
            value={form.allergy_accommodation_detail}
            onChange={(e) => set("allergy_accommodation_detail", e.target.value)}
            rows={2}
            maxLength={1000}
          />
        </Field>
      )}

      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Monthly meal fee">
          <Input
            type="number"
            value={form.monthly_meal_fee}
            onChange={(e) => set("monthly_meal_fee", e.target.value)}
            min={0}
            step="0.01"
          />
        </Field>
        <Field label="Currency">
          <Input
            value={form.meal_fee_currency}
            onChange={(e) => set("meal_fee_currency", e.target.value)}
            maxLength={8}
          />
        </Field>
        <Field label="Last inspection date">
          <Input
            type="date"
            value={form.last_inspection_date}
            onChange={(e) => set("last_inspection_date", e.target.value)}
          />
        </Field>
      </div>

      <Field label="Hygiene certification">
        <Input
          value={form.hygiene_certification}
          onChange={(e) => set("hygiene_certification", e.target.value)}
          maxLength={200}
        />
      </Field>
      <Field label="Student rating summary">
        <Textarea
          value={form.meal_rating_by_students}
          onChange={(e) => set("meal_rating_by_students", e.target.value)}
          rows={2}
          maxLength={400}
        />
      </Field>

      <div className="flex justify-end">
        <Button className="w-full sm:w-auto" type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save meal settings"}
        </Button>
      </div>
    </form>
  );
}

/* -------------------- Transport -------------------- */

type TransportForm = {
  transport_enabled: boolean;
  fleet_size: string;
  transport_provider: string;
  provider_type: "" | "school_owned" | "contracted" | "mixed";
  coverage_areas: string;
  morning_pickup_start: string;
  morning_arrival_time: string;
  afternoon_departure_time: string;
  live_tracking_enabled: boolean;
  tracking_provider: string;
  parent_tracking_app: string;
  monthly_transport_fee: string;
  annual_transport_fee: string;
  safety_features: string;
  driver_background_checked: boolean;
  buses_air_conditioned: boolean;
};

export function TransportTab() {
  const { school } = useApp();
  const qc = useQueryClient();
  const upsert = useServerFn(upsertSchoolTransport);
  const queryKey = ["school_transport", school?.id];

  const q = useQuery({
    queryKey,
    enabled: !!school?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("school_transport")
        .select("*")
        .eq("school_id", school!.id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return data as Record<string, unknown> | null;
    },
  });

  const [form, setForm] = useState<TransportForm | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!q.data && q.isSuccess) {
      setForm({
        transport_enabled: false,
        fleet_size: "",
        transport_provider: "",
        provider_type: "",
        coverage_areas: "",
        morning_pickup_start: "",
        morning_arrival_time: "",
        afternoon_departure_time: "",
        live_tracking_enabled: false,
        tracking_provider: "",
        parent_tracking_app: "",
        monthly_transport_fee: "",
        annual_transport_fee: "",
        safety_features: "",
        driver_background_checked: true,
        buses_air_conditioned: false,
      });
    } else if (q.data) {
      const r = q.data;
      setForm({
        transport_enabled: bool(r.transport_enabled),
        fleet_size: numStr(r.fleet_size),
        transport_provider: str(r.transport_provider),
        provider_type: (str(r.provider_type) as TransportForm["provider_type"]) || "",
        coverage_areas: str(r.coverage_areas),
        morning_pickup_start: str(r.morning_pickup_start),
        morning_arrival_time: str(r.morning_arrival_time),
        afternoon_departure_time: str(r.afternoon_departure_time),
        live_tracking_enabled: bool(r.live_tracking_enabled),
        tracking_provider: str(r.tracking_provider),
        parent_tracking_app: str(r.parent_tracking_app),
        monthly_transport_fee: numStr(r.monthly_transport_fee),
        annual_transport_fee: numStr(r.annual_transport_fee),
        safety_features: str(r.safety_features),
        driver_background_checked: bool(r.driver_background_checked, true),
        buses_air_conditioned: bool(r.buses_air_conditioned),
      });
    }
  }, [q.data, q.isSuccess]);

  if (!form) {
    return <div className="uos-card p-6 text-sm text-muted-foreground">Loading…</div>;
  }

  const set = <K extends keyof TransportForm>(k: K, v: TransportForm[K]) =>
    setForm((s) => (s ? { ...s, [k]: v } : s));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await upsert({
        data: {
          ...form,
          provider_type: form.provider_type || null,
          fleet_size: form.fleet_size === "" ? null : Number(form.fleet_size),
          monthly_transport_fee:
            form.monthly_transport_fee === "" ? null : Number(form.monthly_transport_fee),
          annual_transport_fee:
            form.annual_transport_fee === "" ? null : Number(form.annual_transport_fee),
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      });
      toast.success("Transport settings saved");
      qc.invalidateQueries({ queryKey });
    } catch (e2) {
      const msg =
        e2 instanceof z.ZodError
          ? e2.issues.map((i) => i.message).join(", ")
          : e2 instanceof Error
            ? e2.message
            : "Failed to save";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={onSubmit} className="uos-card space-y-6 p-6">
      <ToggleRow
        label="Transport service enabled"
        hint="Show transport on the public site and parent portal."
        checked={form.transport_enabled}
        onChange={(v) => set("transport_enabled", v)}
      />

      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Fleet size">
          <Input
            type="number"
            min={0}
            value={form.fleet_size}
            onChange={(e) => set("fleet_size", e.target.value)}
          />
        </Field>
        <Field label="Provider">
          <Input
            value={form.transport_provider}
            onChange={(e) => set("transport_provider", e.target.value)}
            maxLength={160}
          />
        </Field>
        <Field label="Provider type">
          <select
            value={form.provider_type}
            onChange={(e) => set("provider_type", e.target.value as TransportForm["provider_type"])}
            className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
          >
            <option value="">—</option>
            <option value="school_owned">School-owned</option>
            <option value="contracted">Contracted</option>
            <option value="mixed">Mixed</option>
          </select>
        </Field>
      </div>

      <Field label="Coverage areas" hint="Comma-separated list of routes / neighborhoods.">
        <Textarea
          value={form.coverage_areas}
          onChange={(e) => set("coverage_areas", e.target.value)}
          rows={3}
          maxLength={2000}
        />
      </Field>

      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Morning pickup start">
          <Input
            value={form.morning_pickup_start}
            onChange={(e) => set("morning_pickup_start", e.target.value)}
            placeholder="6:00 AM"
          />
        </Field>
        <Field label="Morning arrival time">
          <Input
            value={form.morning_arrival_time}
            onChange={(e) => set("morning_arrival_time", e.target.value)}
            placeholder="7:30 AM"
          />
        </Field>
        <Field label="Afternoon departure">
          <Input
            value={form.afternoon_departure_time}
            onChange={(e) => set("afternoon_departure_time", e.target.value)}
            placeholder="3:30 PM"
          />
        </Field>
      </div>

      <div className="grid gap-3 md:grid-cols-2">
        <ToggleRow
          label="Live GPS tracking"
          hint="Buses publish locations to parents in real time."
          checked={form.live_tracking_enabled}
          onChange={(v) => set("live_tracking_enabled", v)}
        />
        <ToggleRow
          label="Buses air-conditioned"
          checked={form.buses_air_conditioned}
          onChange={(v) => set("buses_air_conditioned", v)}
        />
        <ToggleRow
          label="Driver background checked"
          checked={form.driver_background_checked}
          onChange={(v) => set("driver_background_checked", v)}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Tracking provider">
          <Input
            value={form.tracking_provider}
            onChange={(e) => set("tracking_provider", e.target.value)}
            maxLength={160}
          />
        </Field>
        <Field label="Parent tracking app">
          <Input
            value={form.parent_tracking_app}
            onChange={(e) => set("parent_tracking_app", e.target.value)}
            maxLength={160}
          />
        </Field>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Monthly transport fee">
          <Input
            type="number"
            min={0}
            step="0.01"
            value={form.monthly_transport_fee}
            onChange={(e) => set("monthly_transport_fee", e.target.value)}
          />
        </Field>
        <Field label="Annual transport fee">
          <Input
            type="number"
            min={0}
            step="0.01"
            value={form.annual_transport_fee}
            onChange={(e) => set("annual_transport_fee", e.target.value)}
          />
        </Field>
      </div>

      <Field label="Safety features">
        <Textarea
          value={form.safety_features}
          onChange={(e) => set("safety_features", e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder="Seat belts, CCTV, fire extinguisher, first-aid kit…"
        />
      </Field>

      <div className="flex justify-end">
        <Button className="w-full sm:w-auto" type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save transport settings"}
        </Button>
      </div>
    </form>
  );
}

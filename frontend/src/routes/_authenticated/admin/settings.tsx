import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { z } from "zod";

import { useApp } from "@/contexts/app-context";
import { supabase } from "@/integrations/supabase/client";
import { SCHOOL_CLIENT_COLUMNS } from "@/lib/runtime/scholar/school-columns";
import { PortalPage } from "@/components/portal-shell";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import {
  SECTION_FLAG_KEYS,
  updateSchoolSettings,
  type SchoolSettingsTab,
} from "@/lib/runtime/scholar/school-settings.functions";

export const Route = createFileRoute("/_authenticated/admin/settings")({
  ssr: false,
  component: SchoolSettingsPage,
});

type SchoolRow = Record<string, unknown> & { id: string; name: string };

function SchoolSettingsPage() {
  const { school, refresh } = useApp();
  const [fresh, setFresh] = useState<SchoolRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!school?.id) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from("schools")
        .select(SCHOOL_CLIENT_COLUMNS)
        .eq("id", school.id)
        .maybeSingle();
      if (!cancelled) {
        if (error) toast.error(error.message);
        setFresh((data as unknown as SchoolRow | null) ?? null);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [school?.id]);

  if (!school) {
    return (
      <PortalPage title="School settings">
        <div className="uos-empty p-8 text-center text-sm text-muted-foreground">
          No school in scope. Sign in as a school admin.
        </div>
      </PortalPage>
    );
  }

  if (loading || !fresh) {
    return (
      <PortalPage title="School settings" subtitle={`Editing ${school.name}`}>
        <div className="uos-card p-6 text-sm text-muted-foreground">Loading settings…</div>
      </PortalPage>
    );
  }

  const onSaved = async () => {
    await refresh();
    const { data } = await supabase.from("schools").select(SCHOOL_CLIENT_COLUMNS).eq("id", school.id).maybeSingle();
    setFresh((data as unknown as SchoolRow | null) ?? null);
  };

  return (
    <PortalPage
      title="School settings"
      subtitle={`Edit your public website and branding for ${school.name}`}
    >
      <div className="mb-4 flex flex-wrap items-center gap-3 text-xs">
        <Link
          to="/admin/dashboard"
          className="rounded-md border border-border px-3 py-1.5 text-muted-foreground hover:bg-muted/40"
        >
          ← Back to dashboard
        </Link>
        <a
          href={`/?school=${school.slug}`}
          target="_blank"
          rel="noreferrer"
          className="rounded-md border border-border px-3 py-1.5 text-muted-foreground hover:bg-muted/40"
        >
          View public site ↗
        </a>
      </div>

      <Tabs defaultValue="profile" className="w-full">
        <TabsList className="grid w-full grid-cols-2 md:grid-cols-7">
          <TabsTrigger value="profile">1. Profile</TabsTrigger>
          <TabsTrigger value="branding">2. Branding</TabsTrigger>
          <TabsTrigger value="sections">3. Sections</TabsTrigger>
          <TabsTrigger value="hero">4. Hero</TabsTrigger>
          <TabsTrigger value="about">5. About</TabsTrigger>
          <TabsTrigger value="location">6. Location</TabsTrigger>
          <TabsTrigger value="payments">7. Payments</TabsTrigger>
        </TabsList>

        <TabsContent value="profile" className="mt-6">
          <ProfileTab row={fresh} onSaved={onSaved} />
        </TabsContent>
        <TabsContent value="branding" className="mt-6">
          <BrandingTab row={fresh} onSaved={onSaved} />
        </TabsContent>
        <TabsContent value="sections" className="mt-6">
          <SectionsTab row={fresh} onSaved={onSaved} />
        </TabsContent>
        <TabsContent value="hero" className="mt-6">
          <HeroTab row={fresh} onSaved={onSaved} />
        </TabsContent>
        <TabsContent value="about" className="mt-6">
          <AboutTab row={fresh} onSaved={onSaved} />
        </TabsContent>
        <TabsContent value="location" className="mt-6">
          <LocationTab row={fresh} onSaved={onSaved} />
        </TabsContent>
        <TabsContent value="payments" className="mt-6">
          <PaymentsTab row={fresh} onSaved={onSaved} />
        </TabsContent>
      </Tabs>
    </PortalPage>
  );
}

/* ---------------- shared form helpers ---------------- */

function useSaveTab<T extends SchoolSettingsTab>(tab: T) {
  const fn = useServerFn(updateSchoolSettings);
  const [saving, setSaving] = useState(false);
  const save = async (values: Record<string, unknown>, onSaved: () => void | Promise<void>) => {
    setSaving(true);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await fn({ data: { tab, values } as any });
      toast.success("Saved");
      await onSaved();
    } catch (e) {
      const msg =
        e instanceof z.ZodError
          ? e.issues.map((i) => i.message).join(", ")
          : e instanceof Error
            ? e.message
            : "Failed to save";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };
  return { save, saving };
}

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

function FormCard({
  children,
  onSubmit,
  saving,
}: {
  children: React.ReactNode;
  onSubmit: (e: React.FormEvent<HTMLFormElement>) => void;
  saving: boolean;
}) {
  return (
    <form onSubmit={onSubmit} className="uos-card p-6 space-y-6">
      {children}
      <div className="flex justify-end">
        <Button className="w-full sm:w-auto" type="submit" disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>
    </form>
  );
}

const str = (v: unknown) => (typeof v === "string" ? v : "");
const num = (v: unknown) => (typeof v === "number" ? String(v) : "");

/* ---------------- Tab 1: Profile ---------------- */

function ProfileTab({ row, onSaved }: { row: SchoolRow; onSaved: () => Promise<void> }) {
  const { save, saving } = useSaveTab("profile");
  const [form, setForm] = useState({
    name: str(row.name),
    email: str(row.email),
    phone: str(row.phone),
    address: str(row.address),
    motto: str(row.motto),
    founded_year: num(row.founded_year),
    website_url: str(row.website_url),
    office_hours: str(row.office_hours),
  });
  const set =
    (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((s) => ({ ...s, [k]: e.target.value }));

  return (
    <FormCard
      saving={saving}
      onSubmit={(e) => {
        e.preventDefault();
        save(
          {
            ...form,
            founded_year: form.founded_year === "" ? null : Number(form.founded_year),
          },
          onSaved,
        );
      }}
    >
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="School name">
          <Input value={form.name} onChange={set("name")} required maxLength={120} />
        </Field>
        <Field label="Public email">
          <Input type="email" value={form.email} onChange={set("email")} maxLength={255} />
        </Field>
        <Field label="Phone">
          <Input value={form.phone} onChange={set("phone")} maxLength={40} />
        </Field>
        <Field label="Website URL">
          <Input
            type="url"
            value={form.website_url}
            onChange={set("website_url")}
            placeholder="https://"
          />
        </Field>
        <Field label="Founded year">
          <Input
            type="number"
            value={form.founded_year}
            onChange={set("founded_year")}
            min={1800}
            max={new Date().getFullYear() + 1}
          />
        </Field>
        <Field label="Office hours">
          <Input value={form.office_hours} onChange={set("office_hours")} maxLength={160} />
        </Field>
        <Field label="Motto">
          <Input value={form.motto} onChange={set("motto")} maxLength={160} />
        </Field>
      </div>
      <Field label="Address">
        <Textarea value={form.address} onChange={set("address")} maxLength={300} rows={2} />
      </Field>
    </FormCard>
  );
}

/* ---------------- Tab 2: Branding ---------------- */

function BrandingTab({ row, onSaved }: { row: SchoolRow; onSaved: () => Promise<void> }) {
  const { save, saving } = useSaveTab("branding");
  const [form, setForm] = useState({
    logo_url: str(row.logo_url),
    primary_color: str(row.primary_color),
    secondary_color: str(row.secondary_color),
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((s) => ({ ...s, [k]: e.target.value }));

  return (
    <FormCard
      saving={saving}
      onSubmit={(e) => {
        e.preventDefault();
        save(form, onSaved);
      }}
    >
      <Field label="Logo URL" hint="Square image, hosted publicly. Storage uploads ship next.">
        <Input type="url" value={form.logo_url} onChange={set("logo_url")} placeholder="https://" />
      </Field>
      <div className="grid gap-4 md:grid-cols-2">
        <Field
          label="Primary color"
          hint="Hex (e.g. #1d4ed8). Drives accents across the public site."
        >
          <div className="flex items-center gap-3">
            <Input
              value={form.primary_color}
              onChange={set("primary_color")}
              placeholder="#000000"
              maxLength={7}
            />
            <input
              type="color"
              value={form.primary_color || "#000000"}
              onChange={set("primary_color")}
              className="h-10 w-12 rounded border border-border bg-transparent"
              aria-label="Pick primary color"
            />
          </div>
        </Field>
        <Field label="Secondary color">
          <div className="flex items-center gap-3">
            <Input
              value={form.secondary_color}
              onChange={set("secondary_color")}
              placeholder="#000000"
              maxLength={7}
            />
            <input
              type="color"
              value={form.secondary_color || "#000000"}
              onChange={set("secondary_color")}
              className="h-10 w-12 rounded border border-border bg-transparent"
              aria-label="Pick secondary color"
            />
          </div>
        </Field>
      </div>
    </FormCard>
  );
}

/* ---------------- Tab 3: Section toggles ---------------- */

const SECTION_LABELS: Record<(typeof SECTION_FLAG_KEYS)[number], string> = {
  section_hero_enabled: "Hero",
  section_about_enabled: "About",
  section_programs_enabled: "Programs",
  section_facilities_enabled: "Facilities",
  section_faculty_enabled: "Faculty",
  section_news_enabled: "News",
  section_testimonials_enabled: "Testimonials",
  section_faqs_enabled: "FAQs",
  section_contact_enabled: "Contact",
  section_why_us_enabled: "Why us",
  section_blog_enabled: "Blog",
  section_admissions_enabled: "Admissions",
  section_rules_enabled: "School rules",
  section_privacy_enabled: "Privacy policy",
};

function SectionsTab({ row, onSaved }: { row: SchoolRow; onSaved: () => Promise<void> }) {
  const { save, saving } = useSaveTab("sections");
  const initial = useMemo(
    () =>
      Object.fromEntries(SECTION_FLAG_KEYS.map((k) => [k, Boolean(row[k] ?? true)])) as Record<
        (typeof SECTION_FLAG_KEYS)[number],
        boolean
      >,
    [row],
  );
  const [form, setForm] = useState(initial);
  useEffect(() => setForm(initial), [initial]);

  return (
    <FormCard
      saving={saving}
      onSubmit={(e) => {
        e.preventDefault();
        save(form, onSaved);
      }}
    >
      <p className="text-sm text-muted-foreground">
        Turn public-site sections on or off. Sections without content already render a placeholder —
        disable the toggle to hide them entirely.
      </p>
      <div className="grid gap-3 md:grid-cols-2">
        {SECTION_FLAG_KEYS.map((key) => (
          <label
            key={key}
            className="flex items-center justify-between gap-4 rounded-md border border-border bg-background/40 px-4 py-3"
          >
            <span className="text-sm">{SECTION_LABELS[key]}</span>
            <Switch
              checked={form[key]}
              onCheckedChange={(v) => setForm((s) => ({ ...s, [key]: Boolean(v) }))}
            />
          </label>
        ))}
      </div>
    </FormCard>
  );
}

/* ---------------- Tab 4: Hero ---------------- */

function HeroTab({ row, onSaved }: { row: SchoolRow; onSaved: () => Promise<void> }) {
  const { save, saving } = useSaveTab("hero");
  const [form, setForm] = useState({
    hero_headline: str(row.hero_headline),
    hero_subheadline: str(row.hero_subheadline),
    hero_cta_text: str(row.hero_cta_text),
  });
  const set =
    (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((s) => ({ ...s, [k]: e.target.value }));

  return (
    <FormCard
      saving={saving}
      onSubmit={(e) => {
        e.preventDefault();
        save(form, onSaved);
      }}
    >
      <Field label="Headline" hint="Big sentence at the top of the public site.">
        <Input value={form.hero_headline} onChange={set("hero_headline")} maxLength={160} />
      </Field>
      <Field label="Subheadline">
        <Textarea
          value={form.hero_subheadline}
          onChange={set("hero_subheadline")}
          rows={3}
          maxLength={320}
        />
      </Field>
      <Field label="Call-to-action button text" hint="Leave blank to hide the button.">
        <Input value={form.hero_cta_text} onChange={set("hero_cta_text")} maxLength={40} />
      </Field>
    </FormCard>
  );
}

/* ---------------- Tab 5: About / Mission ---------------- */

function AboutTab({ row, onSaved }: { row: SchoolRow; onSaved: () => Promise<void> }) {
  const { save, saving } = useSaveTab("about");
  const [form, setForm] = useState({
    about: str(row.about),
    school_vision: str(row.school_vision),
    school_mission: str(row.school_mission),
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLTextAreaElement>) =>
    setForm((s) => ({ ...s, [k]: e.target.value }));

  return (
    <FormCard
      saving={saving}
      onSubmit={(e) => {
        e.preventDefault();
        save(form, onSaved);
      }}
    >
      <Field label="About the school">
        <Textarea value={form.about} onChange={set("about")} rows={6} maxLength={4000} />
      </Field>
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Vision">
          <Textarea
            value={form.school_vision}
            onChange={set("school_vision")}
            rows={5}
            maxLength={2000}
          />
        </Field>
        <Field label="Mission">
          <Textarea
            value={form.school_mission}
            onChange={set("school_mission")}
            rows={5}
            maxLength={2000}
          />
        </Field>
      </div>
    </FormCard>
  );
}

/* ---------------- Tab 6: Payments (Paystack) ---------------- */

function PaymentsTab({ row, onSaved }: { row: SchoolRow; onSaved: () => Promise<void> }) {
  const { save, saving } = useSaveTab("payments");
  const [form, setForm] = useState({
    paystack_public_key: str(row.paystack_public_key),
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((s) => ({ ...s, [k]: e.target.value }));

  return (
    <FormCard
      saving={saving}
      onSubmit={(e) => {
        e.preventDefault();
        save(form, onSaved);
      }}
    >
      <div className="rounded-md border border-border bg-muted/30 p-4 text-xs text-muted-foreground">
        <p className="font-semibold text-foreground">Paystack is wired centrally.</p>
        <p className="mt-1">
          The platform handles transaction signing and webhooks. Add your
          <span className="font-mono"> pk_test_… </span> or
          <span className="font-mono"> pk_live_… </span> public key here so it can appear on
          receipts and future Paystack Inline checkouts. The secret key is stored privately on the
          server — never paste it into the UI.
        </p>
      </div>
      <Field
        label="Paystack public key"
        hint="Starts with pk_test_ or pk_live_. Leave blank to use platform defaults."
      >
        <Input
          value={form.paystack_public_key}
          onChange={set("paystack_public_key")}
          placeholder="pk_test_…"
          maxLength={120}
          autoComplete="off"
          spellCheck={false}
        />
      </Field>
    </FormCard>
  );
}

/* ---------------- Tab 7: Location & Maps ---------------- */

function LocationTab({ row, onSaved }: { row: SchoolRow; onSaved: () => Promise<void> }) {
  const { save, saving } = useSaveTab("location");
  const [form, setForm] = useState({
    geofence_latitude:
      typeof row.geofence_latitude === "number"
        ? String(row.geofence_latitude)
        : str(row.geofence_latitude),
    geofence_longitude:
      typeof row.geofence_longitude === "number"
        ? String(row.geofence_longitude)
        : str(row.geofence_longitude),
    geofence_radius_meters:
      typeof row.geofence_radius_meters === "number"
        ? String(row.geofence_radius_meters)
        : str(row.geofence_radius_meters) || "200",
    google_maps_embed_url: str(row.google_maps_embed_url),
    show_map_on_website: Boolean(row.show_map_on_website ?? false),
  });
  const [locating, setLocating] = useState(false);

  const useCurrentLocation = () => {
    if (!("geolocation" in navigator)) {
      toast.error("Geolocation is not supported in this browser");
      return;
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setForm((s) => ({
          ...s,
          geofence_latitude: pos.coords.latitude.toFixed(6),
          geofence_longitude: pos.coords.longitude.toFixed(6),
        }));
        setLocating(false);
        toast.success("Location captured from your device");
      },
      (err) => {
        setLocating(false);
        toast.error(err.message || "Could not get your location");
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const previewSrc = (() => {
    const raw = form.google_maps_embed_url.trim();
    if (!raw) return "";
    const m = raw.match(/src=["']([^"']+)["']/);
    return m ? m[1] : raw;
  })();

  return (
    <FormCard
      saving={saving}
      onSubmit={(e) => {
        e.preventDefault();
        save(
          {
            geofence_latitude:
              form.geofence_latitude === "" ? null : Number(form.geofence_latitude),
            geofence_longitude:
              form.geofence_longitude === "" ? null : Number(form.geofence_longitude),
            geofence_radius_meters:
              form.geofence_radius_meters === "" ? null : Number(form.geofence_radius_meters),
            google_maps_embed_url: form.google_maps_embed_url,
            show_map_on_website: form.show_map_on_website,
          },
          onSaved,
        );
      }}
    >
      <div className="rounded-md border border-border bg-muted/30 p-4 text-xs text-muted-foreground">
        <p className="font-semibold text-foreground">Location & geofencing</p>
        <p className="mt-1">
          The school's coordinates anchor staff and student clock-in checks. Only users within the
          configured radius can clock in or out from a device. The embed URL (and toggle below)
          controls the &ldquo;Find Us&rdquo; map on your public site.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Field label="Latitude" hint="-90 to 90">
          <Input
            type="number"
            step="any"
            value={form.geofence_latitude}
            onChange={(e) => setForm((s) => ({ ...s, geofence_latitude: e.target.value }))}
            placeholder="6.524379"
          />
        </Field>
        <Field label="Longitude" hint="-180 to 180">
          <Input
            type="number"
            step="any"
            value={form.geofence_longitude}
            onChange={(e) => setForm((s) => ({ ...s, geofence_longitude: e.target.value }))}
            placeholder="3.379206"
          />
        </Field>
        <Field label="Geofence radius (m)" hint="10–10000 meters around the point">
          <Input
            type="number"
            min={10}
            max={10000}
            value={form.geofence_radius_meters}
            onChange={(e) => setForm((s) => ({ ...s, geofence_radius_meters: e.target.value }))}
            placeholder="200"
          />
        </Field>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button type="button" variant="outline" onClick={useCurrentLocation} disabled={locating}>
          {locating ? "Locating…" : "Use my current location"}
        </Button>
        {form.geofence_latitude && form.geofence_longitude && (
          <a
            href={`https://www.google.com/maps?q=${form.geofence_latitude},${form.geofence_longitude}`}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center rounded-md border border-border px-3 py-2 text-xs text-muted-foreground hover:bg-muted/40"
          >
            Open in Google Maps ↗
          </a>
        )}
      </div>

      <Field
        label="Google Maps embed"
        hint="Paste the full <iframe> snippet from Google Maps → Share → Embed a map, or just the src URL."
      >
        <Textarea
          value={form.google_maps_embed_url}
          onChange={(e) => setForm((s) => ({ ...s, google_maps_embed_url: e.target.value }))}
          rows={3}
          placeholder='<iframe src="https://www.google.com/maps/embed?pb=..." …></iframe>'
        />
      </Field>

      {previewSrc && (
        <div className="overflow-hidden rounded-lg border border-border">
          <iframe
            src={previewSrc}
            title="Map preview"
            className="h-72 w-full"
            loading="lazy"
            referrerPolicy="no-referrer-when-downgrade"
          />
        </div>
      )}

      <label className="flex items-center justify-between gap-4 rounded-md border border-border bg-background/40 px-4 py-3">
        <div>
          <div className="text-sm font-medium">Show &ldquo;Find Us&rdquo; map on website</div>
          <div className="text-xs text-muted-foreground">
            Renders the embed under the Contact section of your public site.
          </div>
        </div>
        <Switch
          checked={form.show_map_on_website}
          onCheckedChange={(v) => setForm((s) => ({ ...s, show_map_on_website: Boolean(v) }))}
        />
      </label>
    </FormCard>
  );
}

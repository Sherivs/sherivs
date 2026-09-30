/**
 * Shared settings page available to every signed-in role.
 *
 * - Profile: name, phone, address, avatar URL, emergency contact.
 * - Security: change password via Supabase auth.
 * - Privacy: digital-twin opt-out (any role can disable AI calls
 *   that reference their data).
 *
 * Super-admins have their own /super-admin/settings, but this route
 * is still reachable for them — they only see the password card.
 */
import { useEffect, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { Save, Shield, User2, Lock, Bot } from "lucide-react";

import { PortalPage, GlassCard, PortalPageSkeleton } from "@/components/portal-shell";
import { useApp } from "@/contexts/app-context";
import { supabase } from "@/integrations/supabase/client";
import {
  getMyProfile,
  setDigitalTwinOptOut,
  updateMyProfile,
  type MyProfile,
} from "@/lib/profile.functions";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
});

function SettingsPage() {
  const { superAdmin } = useApp();
  const qc = useQueryClient();

  const getProfileFn = useServerFn(getMyProfile);
  const updateProfileFn = useServerFn(updateMyProfile);
  const setOptOutFn = useServerFn(setDigitalTwinOptOut);

  const { data: profile, isLoading } = useQuery<MyProfile | null>({
    queryKey: ["me", "profile"],
    queryFn: () => getProfileFn(),
    enabled: !superAdmin,
  });

  const saveProfile = useMutation({
    mutationFn: (patch: Partial<MyProfile>) =>
      updateProfileFn({
        data: {
          full_name: patch.full_name,
          phone: patch.phone ?? null,
          address: patch.address ?? null,
          emergency_contact_name: patch.emergency_contact_name ?? null,
          emergency_contact: patch.emergency_contact ?? null,
          avatar_url: patch.avatar_url ?? null,
        },
      }),
    onSuccess: () => {
      toast.success("Profile saved");
      void qc.invalidateQueries({ queryKey: ["me", "profile"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const optOutMut = useMutation({
    mutationFn: (opt_out: boolean) => setOptOutFn({ data: { opt_out } }),
    onSuccess: () => {
      toast.success("Privacy preference saved");
      void qc.invalidateQueries({ queryKey: ["me", "profile"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!superAdmin && isLoading) {
    return <PortalPageSkeleton title="Settings" rows={3} showStats={false} />;
  }

  return (
    <PortalPage title="Settings" subtitle="Manage your profile, password, and privacy">
      {!superAdmin && profile && (
        <ProfileCard
          profile={profile}
          saving={saveProfile.isPending}
          onSave={(p) => saveProfile.mutate(p)}
        />
      )}
      {!superAdmin && profile && (
        <PrivacyCard
          optedOut={!!profile.digital_twin_opt_out}
          saving={optOutMut.isPending}
          onChange={(v) => optOutMut.mutate(v)}
        />
      )}
      <PasswordCard />
    </PortalPage>
  );
}

function ProfileCard({
  profile,
  saving,
  onSave,
}: {
  profile: MyProfile;
  saving: boolean;
  onSave: (p: Partial<MyProfile>) => void;
}) {
  const [form, setForm] = useState<Partial<MyProfile>>(profile);
  useEffect(() => setForm(profile), [profile]);

  return (
    <GlassCard className="flex flex-col gap-4">
      <SectionTitle icon={<User2 className="size-4" />} title="Profile" />
      <form
        className="grid gap-4 sm:grid-cols-2"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(form);
        }}
      >
        <Field label="Full name">
          <input
            className="uos-input"
            required
            value={form.full_name ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))}
          />
        </Field>
        <Field label="Email">
          <input className="uos-input" value={profile.email ?? ""} disabled />
        </Field>
        <Field label="Phone">
          <input
            className="uos-input"
            value={form.phone ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
          />
        </Field>
        <Field label="Avatar URL">
          <input
            className="uos-input"
            placeholder="https://…"
            value={form.avatar_url ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, avatar_url: e.target.value }))}
          />
        </Field>
        <Field label="Address" className="sm:col-span-2">
          <textarea
            rows={2}
            className="uos-input"
            value={form.address ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
          />
        </Field>
        <Field label="Emergency contact name">
          <input
            className="uos-input"
            value={form.emergency_contact_name ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, emergency_contact_name: e.target.value }))}
          />
        </Field>
        <Field label="Emergency contact phone">
          <input
            className="uos-input"
            value={form.emergency_contact ?? ""}
            onChange={(e) => setForm((f) => ({ ...f, emergency_contact: e.target.value }))}
          />
        </Field>
        <div className="sm:col-span-2 flex justify-end">
          <button
            type="submit"
            disabled={saving}
            className="uos-btn-primary inline-flex items-center gap-2 disabled:opacity-50"
          >
            <Save className="size-4" />
            {saving ? "Saving…" : "Save profile"}
          </button>
        </div>
      </form>
    </GlassCard>
  );
}

function PrivacyCard({
  optedOut,
  saving,
  onChange,
}: {
  optedOut: boolean;
  saving: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <GlassCard className="flex flex-col gap-4">
      <SectionTitle icon={<Bot className="size-4" />} title="AI & privacy" />
      <p className="text-sm text-[color:var(--text-secondary)]">
        The platform may use a Digital Twin to draft AI-assisted summaries and parent calls based on
        your linked data. Opting out blocks the school from including you in any AI-generated
        communication.
      </p>
      <label className="flex items-center justify-between gap-4 rounded-xl border border-[color:var(--glass-border)] bg-[color:var(--glass-bg)] px-4 py-3">
        <span className="text-sm font-medium">Opt out of Digital Twin AI calls</span>
        <input
          type="checkbox"
          className="size-5 accent-[color:var(--tenant-primary)]"
          checked={optedOut}
          disabled={saving}
          onChange={(e) => onChange(e.target.checked)}
        />
      </label>
    </GlassCard>
  );
}

function PasswordCard() {
  const [pw1, setPw1] = useState("");
  const [pw2, setPw2] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (pw1.length < 8) return toast.error("Password must be at least 8 characters");
    if (pw1 !== pw2) return toast.error("Passwords do not match");
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password: pw1 });
    setBusy(false);
    if (error) return toast.error(error.message);
    setPw1("");
    setPw2("");
    toast.success("Password updated");
  }

  return (
    <GlassCard className="flex flex-col gap-4">
      <SectionTitle icon={<Lock className="size-4" />} title="Change password" />
      <form className="grid gap-4 sm:grid-cols-2" onSubmit={submit}>
        <Field label="New password">
          <input
            type="password"
            className="uos-input"
            value={pw1}
            onChange={(e) => setPw1(e.target.value)}
            minLength={8}
            required
          />
        </Field>
        <Field label="Confirm new password">
          <input
            type="password"
            className="uos-input"
            value={pw2}
            onChange={(e) => setPw2(e.target.value)}
            minLength={8}
            required
          />
        </Field>
        <div className="sm:col-span-2 flex justify-end">
          <button
            type="submit"
            disabled={busy}
            className="uos-btn-primary inline-flex items-center gap-2 disabled:opacity-50"
          >
            <Shield className="size-4" />
            {busy ? "Updating…" : "Update password"}
          </button>
        </div>
      </form>
    </GlassCard>
  );
}

function SectionTitle({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className="flex items-center gap-2 text-sm uppercase tracking-widest text-[color:var(--text-muted)]">
      {icon}
      {title}
    </div>
  );
}

function Field({
  label,
  children,
  className = "",
}: {
  label: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`flex flex-col gap-1.5 ${className}`}>
      <span className="text-xs uppercase tracking-widest text-[color:var(--text-muted)]">
        {label}
      </span>
      {children}
    </label>
  );
}

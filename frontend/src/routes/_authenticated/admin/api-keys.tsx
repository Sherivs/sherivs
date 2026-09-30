import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PortalPage, SectionGrid, StatCard, FeatureLockedCard } from "@/components/portal-shell";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { isFeatureActive } from "@/lib/subscription-tiers";

export const Route = createFileRoute("/_authenticated/admin/api-keys")({
  ssr: false,
  component: ApiKeysPage,
});

type Row = {
  id?: string;
  school_id: string;
  active_payment_provider: string | null;
  paystack_public_key: string | null;
  paystack_secret_key_encrypted: string | null;
  flutterwave_public_key: string | null;
  flutterwave_secret_key_encrypted: string | null;
  stripe_publishable_key: string | null;
  stripe_secret_key_encrypted: string | null;
  whatsapp_phone_id: string | null;
  whatsapp_token_encrypted: string | null;
  africas_talking_username: string | null;
  africas_talking_key_encrypted: string | null;
};

const EMPTY = (schoolId: string): Row => ({
  school_id: schoolId,
  active_payment_provider: "paystack",
  paystack_public_key: "",
  paystack_secret_key_encrypted: null,
  flutterwave_public_key: "",
  flutterwave_secret_key_encrypted: null,
  stripe_publishable_key: "",
  stripe_secret_key_encrypted: null,
  whatsapp_phone_id: "",
  whatsapp_token_encrypted: null,
  africas_talking_username: "",
  africas_talking_key_encrypted: null,
});

function ApiKeysPage() {
  const { school } = useApp();
  const qc = useQueryClient();

  const tier = (school?.subscription_tier as string | null) ?? "trial";
  const active = (school?.active_features as Record<string, unknown> | null) ?? null;
  const canPaystack = isFeatureActive(tier, active, "paystack_payments");
  const canFlutterwave = isFeatureActive(tier, active, "flutterwave_payments");
  const canStripe = isFeatureActive(tier, active, "stripe_payments");
  const canWhatsApp = isFeatureActive(tier, active, "whatsapp_notifications");
  const canSms = isFeatureActive(tier, active, "sms_notifications");

  const q = useQuery<Row | null>({
    queryKey: ["school-api-keys", school?.id],
    enabled: !!school?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("school_api_keys")
        .select("*")
        .eq("school_id", school!.id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      return (data as Row | null) ?? null;
    },
  });

  const [form, setForm] = useState<Row | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!school?.id) return;
    setForm(q.data ? { ...EMPTY(school.id), ...q.data } : EMPTY(school.id));
  }, [school?.id, q.data]);

  if (!school) {
    return (
      <PortalPage title="API keys & integrations">
        <div className="uos-empty p-8 text-center text-sm text-muted-foreground">
          No school in scope.
        </div>
      </PortalPage>
    );
  }

  if (!form) {
    return (
      <PortalPage title="API keys & integrations">
        <div className="uos-card p-6 text-sm text-muted-foreground">Loading…</div>
      </PortalPage>
    );
  }

  const set = <K extends keyof Row>(k: K, v: Row[K]) => setForm((s) => (s ? { ...s, [k]: v } : s));

  async function save() {
    if (!form) return;
    setSaving(true);
    const payload = {
      school_id: form.school_id,
      active_payment_provider: form.active_payment_provider,
      paystack_public_key: form.paystack_public_key || null,
      flutterwave_public_key: form.flutterwave_public_key || null,
      stripe_publishable_key: form.stripe_publishable_key || null,
      whatsapp_phone_id: form.whatsapp_phone_id || null,
      africas_talking_username: form.africas_talking_username || null,
    };
    const { error } = await supabase
      .from("school_api_keys")
      .upsert(payload, { onConflict: "school_id" });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success("API keys saved");
    void qc.invalidateQueries({ queryKey: ["school-api-keys", school?.id] });
  }

  const hasSecret = (v: string | null) => (v && v.length > 0 ? "Set" : "Not set");
  const configured = [
    form.paystack_public_key,
    form.flutterwave_public_key,
    form.stripe_publishable_key,
    form.whatsapp_phone_id,
    form.africas_talking_username,
  ].filter((v) => v && v.length > 0).length;

  return (
    <PortalPage
      title="API keys & integrations"
      subtitle="Connect payment, messaging, and identity providers for this school."
    >
      <SectionGrid>
        <StatCard label="Active payment provider" value={form.active_payment_provider ?? "—"} />
        <StatCard label="Configured integrations" value={configured} />
        <StatCard label="Plan" value={tier} />
        <StatCard label="School" value={school.name} />
      </SectionGrid>

      <div className="mt-6 flex items-center justify-end">
        <Button onClick={save} disabled={saving}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <section className="uos-card p-5 space-y-4">
          <header className="flex items-center justify-between">
            <h3 className="font-display text-base font-semibold">Payments</h3>
            <div className="min-w-[160px]">
              <Select
                value={form.active_payment_provider ?? "paystack"}
                onValueChange={(v) => set("active_payment_provider", v)}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="paystack">Paystack</SelectItem>
                  <SelectItem value="flutterwave">Flutterwave</SelectItem>
                  <SelectItem value="stripe">Stripe</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </header>

          {canPaystack ? (
            <ProviderBlock
              name="Paystack"
              publicLabel="Paystack public key"
              publicPlaceholder="pk_test_…"
              publicValue={form.paystack_public_key ?? ""}
              onPublicChange={(v) => set("paystack_public_key", v)}
              secretStatus={hasSecret(form.paystack_secret_key_encrypted)}
            />
          ) : (
            <FeatureLockedCard title="Paystack" requiredPlan="Starter" />
          )}

          {canFlutterwave ? (
            <ProviderBlock
              name="Flutterwave"
              publicLabel="Flutterwave public key"
              publicPlaceholder="FLWPUBK_TEST-…"
              publicValue={form.flutterwave_public_key ?? ""}
              onPublicChange={(v) => set("flutterwave_public_key", v)}
              secretStatus={hasSecret(form.flutterwave_secret_key_encrypted)}
            />
          ) : (
            <FeatureLockedCard title="Flutterwave" requiredPlan="Growth" />
          )}

          {canStripe ? (
            <ProviderBlock
              name="Stripe"
              publicLabel="Stripe publishable key"
              publicPlaceholder="pk_test_…"
              publicValue={form.stripe_publishable_key ?? ""}
              onPublicChange={(v) => set("stripe_publishable_key", v)}
              secretStatus={hasSecret(form.stripe_secret_key_encrypted)}
            />
          ) : (
            <FeatureLockedCard title="Stripe" requiredPlan="Professional" />
          )}
        </section>

        <section className="uos-card p-5 space-y-4">
          <h3 className="font-display text-base font-semibold">Messaging</h3>

          {canWhatsApp ? (
            <div className="space-y-3 rounded-md border border-border p-4">
              <div className="text-sm font-semibold">WhatsApp Business</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Phone number ID">
                  <Input
                    value={form.whatsapp_phone_id ?? ""}
                    onChange={(e) => set("whatsapp_phone_id", e.target.value)}
                    placeholder="e.g. 1234567890"
                  />
                </Field>
                <Field label="Token (server-side)">
                  <Input value={hasSecret(form.whatsapp_token_encrypted)} disabled />
                </Field>
              </div>
            </div>
          ) : (
            <FeatureLockedCard title="WhatsApp" requiredPlan="Growth" />
          )}

          {canSms ? (
            <div className="space-y-3 rounded-md border border-border p-4">
              <div className="text-sm font-semibold">Africa's Talking SMS</div>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Username">
                  <Input
                    value={form.africas_talking_username ?? ""}
                    onChange={(e) => set("africas_talking_username", e.target.value)}
                  />
                </Field>
                <Field label="API key (server-side)">
                  <Input value={hasSecret(form.africas_talking_key_encrypted)} disabled />
                </Field>
              </div>
            </div>
          ) : (
            <FeatureLockedCard title="SMS" requiredPlan="Growth" />
          )}

          <p className="text-xs text-muted-foreground">
            Secret values are stored encrypted on the server and never shown here. Contact platform
            support to rotate a secret.
          </p>
        </section>
      </div>
    </PortalPage>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function ProviderBlock({
  name,
  publicLabel,
  publicPlaceholder,
  publicValue,
  onPublicChange,
  secretStatus,
}: {
  name: string;
  publicLabel: string;
  publicPlaceholder: string;
  publicValue: string;
  onPublicChange: (v: string) => void;
  secretStatus: string;
}) {
  return (
    <div className="rounded-md border border-border p-4 space-y-3">
      <div className="text-sm font-semibold">{name}</div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label={publicLabel}>
          <Input
            value={publicValue}
            onChange={(e) => onPublicChange(e.target.value)}
            placeholder={publicPlaceholder}
            autoComplete="off"
            spellCheck={false}
          />
        </Field>
        <Field label="Secret key (server-side)">
          <Input value={secretStatus} disabled />
        </Field>
      </div>
    </div>
  );
}

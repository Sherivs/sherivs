/**
 * Add School form — used inside the Super Admin portal.
 *
 * Calls `createSchoolWithAdmin` (server fn, super-admin-gated). On success,
 * surfaces the temp credentials so the operator can hand them to the new
 * school admin.
 */
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQueryClient } from "@tanstack/react-query";
import { createSchoolWithAdmin, type CreateSchoolResult } from "@/lib/provisioning.functions";

const TIERS = ["trial", "starter", "growth", "professional", "enterprise"] as const;

export function AddSchoolForm({ onCreated }: { onCreated?: (r: CreateSchoolResult) => void }) {
  const create = useServerFn(createSchoolWithAdmin);
  const qc = useQueryClient();

  const [schoolName, setSchoolName] = useState("");
  const [schoolEmail, setSchoolEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [adminFullName, setAdminFullName] = useState("");
  const [adminEmail, setAdminEmail] = useState("");
  const [tier, setTier] = useState<(typeof TIERS)[number]>("trial");
  const [monthlyFee, setMonthlyFee] = useState<number | "">(0);

  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [result, setResult] = useState<CreateSchoolResult | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await create({
        data: {
          schoolName,
          schoolEmail: schoolEmail || undefined,
          phone: phone || undefined,
          address: address || undefined,
          adminFullName,
          adminEmail,
          subscriptionTier: tier,
          monthlyFee: monthlyFee === "" ? 0 : monthlyFee,
        },
      });
      setResult(r);
      // reset form
      setSchoolName("");
      setSchoolEmail("");
      setPhone("");
      setAddress("");
      setAdminFullName("");
      setAdminEmail("");
      setTier("trial");
      setMonthlyFee(0);
      qc.invalidateQueries({ queryKey: ["recent-schools"] });
      qc.invalidateQueries({ queryKey: ["platform-stats"] });
      onCreated?.(r);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : "Failed to create school");
    } finally {
      setBusy(false);
    }
  }

  function copyAll() {
    if (!result) return;
    const text = [
      `School: ${result.schoolName}`,
      `Public URL (dev): ${window.location.origin}/${result.publicUrlSuffix}`,
      `Public URL (prod subdomain): https://${result.schoolSlug}.<your-domain>`,
      `Admin email: ${result.adminEmail}`,
      `Temporary password: ${result.tempPassword}`,
    ].join("\n");
    navigator.clipboard.writeText(text);
  }

  return (
    <div className="uos-card p-6">
      <header className="mb-5">
        <h2 className="font-display text-lg font-bold">Add a new school</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Provisions the tenant, creates the first admin account, and starts a subscription row.
        </p>
      </header>

      {result ? (
        <div className="space-y-4">
          <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-4 text-sm">
            <div className="font-semibold text-green-400">School created</div>
            <p className="mt-1 text-xs text-muted-foreground">
              Hand these credentials to the school admin. The temporary password cannot be retrieved
              again from here.
            </p>
          </div>
          <CredRow label="School name" value={result.schoolName} />
          <CredRow
            label="Public URL (dev preview)"
            value={`${window.location.origin}/${result.publicUrlSuffix}`}
          />
          <CredRow label="Admin email" value={result.adminEmail} />
          <CredRow label="Temporary password" value={result.tempPassword} mono />
          <div className="flex gap-2">
            <button
              onClick={copyAll}
              className="rounded-md border border-border px-3 py-2 text-sm hover:bg-accent"
            >
              Copy all
            </button>
            <a
              href={`/${result.publicUrlSuffix}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-md bg-primary px-3 py-2 text-sm font-semibold text-primary-foreground"
            >
              Open public site ↗
            </a>
            <button
              onClick={() => setResult(null)}
              className="ml-auto rounded-md px-3 py-2 text-sm text-muted-foreground hover:text-foreground"
            >
              Add another
            </button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="School name *">
              <input
                required
                minLength={2}
                value={schoolName}
                onChange={(e) => setSchoolName(e.target.value)}
                className="uos-input"
              />
            </Field>
            <Field label="School email">
              <input
                type="email"
                value={schoolEmail}
                onChange={(e) => setSchoolEmail(e.target.value)}
                className="uos-input"
              />
            </Field>
            <Field label="Phone">
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                className="uos-input"
              />
            </Field>
            <Field label="Subscription plan">
              <select
                value={tier}
                onChange={(e) => setTier(e.target.value as (typeof TIERS)[number])}
                className="uos-input"
              >
                {TIERS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Address" full>
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                className="uos-input"
              />
            </Field>
            <Field label="Admin full name *">
              <input
                required
                minLength={2}
                value={adminFullName}
                onChange={(e) => setAdminFullName(e.target.value)}
                className="uos-input"
              />
            </Field>
            <Field label="Admin email *">
              <input
                type="email"
                required
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                className="uos-input"
              />
            </Field>
            <Field label="Monthly fee (₦)">
              <input
                type="number"
                min={0}
                value={monthlyFee}
                onChange={(e) => setMonthlyFee(e.target.value === "" ? "" : Number(e.target.value))}
                className="uos-input"
              />
            </Field>
          </div>

          {err && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {err}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="rounded-md bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-60"
          >
            {busy ? "Creating…" : "Create school"}
          </button>
        </form>
      )}
    </div>
  );
}

function Field({
  label,
  full,
  children,
}: {
  label: string;
  full?: boolean;
  children: React.ReactNode;
}) {
  return (
    <label className={"block " + (full ? "sm:col-span-2" : "")}>
      <span className="block text-[11px] uppercase tracking-widest text-muted-foreground mb-1.5">
        {label}
      </span>
      {children}
    </label>
  );
}

function CredRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 rounded-md border border-border px-3 py-2 text-sm">
      <div className="min-w-0">
        <div className="text-[11px] uppercase tracking-widest text-muted-foreground">{label}</div>
        <div className={"mt-0.5 break-all " + (mono ? "font-mono" : "")}>{value}</div>
      </div>
      <button
        onClick={() => navigator.clipboard.writeText(value)}
        className="shrink-0 rounded-md border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
        title="Copy"
        type="button"
      >
        Copy
      </button>
    </div>
  );
}

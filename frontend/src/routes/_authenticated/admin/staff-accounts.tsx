import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";

import { PortalPage } from "@/components/portal-shell";
import { RoleGuard } from "@/components/role-guard";
import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import {
  createStaffAccount,
  resetStaffPassword,
  CREATABLE_STAFF_ROLES,
  type CreatableStaffRole,
  type CreateStaffAccountResult,
} from "@/lib/runtime/scholar/staff-accounts.functions";
import {
  SCHOLAR_WORKFORCE_KINDS,
  scholarWorkforceKindForMembershipKind,
} from "@/lib/runtime/scholar-workforce";
import { workforceFamilyLabel } from "@/lib/workforce-kinds";
import {
  assignWorkforcePosition,
  endWorkforcePosition,
  listWorkforcePositions,
} from "@/lib/runtime/scholar/workforce-positions.functions";
import {
  isOpenWorkforcePosition,
  summarizeWorkforcePositions,
  type WorkforcePositionView,
} from "@/lib/workforce-positions";

export const Route = createFileRoute("/_authenticated/admin/staff-accounts")({
  ssr: false,
  component: () => (
    <RoleGuard allow={["admin", "principal"]}>
      <StaffAccountsPage />
    </RoleGuard>
  ),
});

const LEGACY_ROLE_FALLBACK: Record<CreatableStaffRole, string> = {
  admin: "School administrator",
  principal: "Principal",
  teacher: "Teacher",
  bursar: "Bursar",
  parent: "Parent / guardian",
  student: "Student",
  driver: "Bus driver",
  hq: "HQ / platform operations",
};

/**
 * Membership kinds are the coarse access signal; where a real African post
 * exists in the Scholar workforce catalog (Head Teacher, Subject Teacher,
 * Bursar, Driver...), that canonical title is preferred for display.
 */
function roleDisplayLabel(r: CreatableStaffRole): string {
  return scholarWorkforceKindForMembershipKind(r)?.title ?? LEGACY_ROLE_FALLBACK[r] ?? r;
}

/** Catalog-driven position picker, grouped by workforce family. */
const POSITION_GROUPS: Array<{ label: string; kinds: Array<{ code: string; title: string }> }> = [];
for (const kind of SCHOLAR_WORKFORCE_KINDS) {
  const last = POSITION_GROUPS[POSITION_GROUPS.length - 1];
  if (!last || last.label !== workforceFamilyLabel(kind.family)) {
    POSITION_GROUPS.push({ label: workforceFamilyLabel(kind.family), kinds: [] });
  }
  POSITION_GROUPS[POSITION_GROUPS.length - 1].kinds.push({
    code: kind.kindCode,
    title: kind.title,
  });
}

function StaffAccountsPage() {
  const { school } = useApp();
  const qc = useQueryClient();
  const create = useServerFn(createStaffAccount);
  const reset = useServerFn(resetStaffPassword);
  const listPositions = useServerFn(listWorkforcePositions);

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<CreatableStaffRole>("teacher");
  const [positionCode, setPositionCode] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issued, setIssued] = useState<CreateStaffAccountResult | null>(null);

  const list = useQuery({
    queryKey: ["staff-accounts", school?.id],
    enabled: !!school?.id,
    queryFn: async () => {
      const { data } = await supabase
        .from("users")
        .select("id, full_name, email, role, is_active, created_at")
        .eq("school_id", school!.id)
        .order("created_at", { ascending: false })
        .limit(50);
      return data ?? [];
    },
  });

  const positions = useQuery({
    queryKey: ["workforce-positions", school?.id],
    enabled: !!school?.id,
    queryFn: async () => {
      return listPositions({ data: {} });
    },
  });
  const openPositionsFor = (userId: string) =>
    (positions.data ?? []).filter(
      (p) => p.identity_ref === userId && isOpenWorkforcePosition(p.status),
    );
  const roll = positions.data ? summarizeWorkforcePositions(positions.data) : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    setIssued(null);
    try {
      const result = await create({
        data: {
          fullName: fullName.trim(),
          email: email.trim(),
          role,
          positionCode: positionCode.trim() ? positionCode.trim() : null,
          phone: phone.trim() || null,
          password: password.trim() || null,
        },
      });
      setIssued(result);
      setFullName("");
      setEmail("");
      setPhone("");
      setPassword("");
      qc.invalidateQueries({ queryKey: ["staff-accounts"] });
      qc.invalidateQueries({ queryKey: ["workforce-positions"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create account");
    } finally {
      setBusy(false);
    }
  }

  async function handleReset(userId: string) {
    setError(null);
    try {
      const result = await reset({ data: { userId } });
      setIssued({
        userId: result.userId,
        email: result.email ?? "(unknown)",
        password: result.password,
        role,
        fullName: "Existing user",
        reused: true,
        positionCode: null,
        positionTitle: null,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to reset password");
    }
  }

  return (
    <PortalPage
      title="Staff & user accounts"
      subtitle="Create real portal logins for teachers, parents, students, drivers and every other role. Credentials are shown once — copy them for the person."
    >
      <div className="grid gap-6 lg:grid-cols-5">
        <form onSubmit={submit} className="uos-card lg:col-span-2 space-y-4 p-5">
          <h2 className="font-display text-lg font-semibold">Create account</h2>

          <Field label="Full name">
            <input
              required
              minLength={2}
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="uos-input"
            />
          </Field>
          <Field label="Email">
            <input
              required
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="uos-input"
              autoComplete="off"
            />
          </Field>
          <Field label="Role">
            <select
              value={role}
              onChange={(e) => setRole(e.target.value as CreatableStaffRole)}
              className="uos-input"
            >
              {CREATABLE_STAFF_ROLES.map((r) => (
                <option key={r} value={r}>
                  {roleDisplayLabel(r)}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Position at the school (optional)">
            <select
              value={positionCode}
              onChange={(e) => setPositionCode(e.target.value)}
              className="uos-input"
            >
              <option value="">No position — staff only</option>
              {POSITION_GROUPS.map((group) => (
                <optgroup key={group.label} label={group.label}>
                  {group.kinds.map((k) => (
                    <option key={k.code} value={k.code}>
                      {k.title}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-muted-foreground">
              The real post this person holds (Head of Department, Examination Officer, Lab
              Technician...). Access still comes from the role above; the position records workforce
              reality.
            </p>
          </Field>
          <Field label="Phone (optional)">
            <input value={phone} onChange={(e) => setPhone(e.target.value)} className="uos-input" />
          </Field>
          <Field label="Password (optional — leave blank to auto-generate)">
            <input
              type="text"
              minLength={8}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="Auto-generate"
              className="uos-input"
            />
          </Field>

          {error && (
            <div className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive-foreground">
              {error}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full rounded-md bg-primary px-4 py-2 font-semibold text-primary-foreground disabled:opacity-60"
          >
            {busy ? "Creating…" : "Create account"}
          </button>

          {issued && (
            <div className="rounded-md border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-widest text-emerald-500">
                ✓ {issued.reused ? "Password reset" : "Account created"}
              </div>
              <div className="space-y-1 text-xs">
                <Copyable label="Email" value={issued.email} />
                <Copyable label="Password" value={issued.password} />
                <div>
                  <span className="text-muted-foreground">Role:</span>{" "}
                  <span className="font-medium">{roleDisplayLabel(issued.role)}</span>
                </div>
                {issued.positionTitle && (
                  <div>
                    <span className="text-muted-foreground">Position:</span>{" "}
                    <span className="font-medium">{issued.positionTitle}</span>
                  </div>
                )}
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                These credentials work immediately on the sign-in page. This is the only time the
                password is displayed — copy it now.
              </p>
            </div>
          )}
        </form>

        <div className="lg:col-span-3">
          <h2 className="mb-3 font-display text-lg font-semibold">
            Existing accounts {school?.name ? `at ${school.name}` : ""}
          </h2>
          {roll && (
            <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                { label: "People with positions", value: roll.people },
                { label: "Open positions", value: roll.open },
                { label: "Families represented", value: roll.families },
                { label: "Primary posts", value: roll.primaries },
              ].map((s) => (
                <div
                  key={s.label}
                  className="rounded-lg border border-border bg-muted/20 px-3 py-2"
                >
                  <div className="font-display text-lg font-bold leading-none">{s.value}</div>
                  <div className="mt-1 text-[10px] uppercase tracking-widest text-muted-foreground">
                    {s.label}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="uos-card divide-y divide-border">
            {list.isLoading ? (
              <div className="p-4 text-sm text-muted-foreground">Loading…</div>
            ) : (list.data ?? []).length === 0 ? (
              <div className="p-4 text-sm text-muted-foreground">No accounts yet.</div>
            ) : (
              (list.data ?? []).map((u) => (
                <div key={u.id} className="flex items-center justify-between gap-3 p-3">
                  <div className="min-w-0">
                    <div className="truncate font-medium">{u.full_name}</div>
                    <div className="truncate text-xs text-muted-foreground">
                      {u.email} · {roleDisplayLabel(u.role as CreatableStaffRole)}
                    </div>
                    <PositionManager userId={u.id} positionRows={openPositionsFor(u.id)} />
                  </div>
                  <button
                    type="button"
                    onClick={() => handleReset(u.id)}
                    className="shrink-0 rounded-md border border-border px-3 py-1.5 text-xs font-medium hover:bg-muted/40"
                  >
                    Reset password
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </PortalPage>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {children}
    </label>
  );
}

function Copyable({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <span className="w-16 text-muted-foreground">{label}:</span>
      <code className="flex-1 rounded bg-muted/40 px-2 py-1 font-mono text-[11px]">{value}</code>
      <button
        type="button"
        onClick={() => {
          void navigator.clipboard.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1200);
        }}
        className="rounded border border-border px-2 py-1 text-[10px] hover:bg-muted/40"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

/**
 * Per-account position manager: shows the member's open positions (★ primary)
 * with one-tap end, plus a catalog-driven picker to assign an additional real
 * post. Writes go through the org-admin RPCs (assign/end), which re-derive the
 * tenant server-side; the UI only reflects workforce reality.
 */
function PositionManager({
  userId,
  positionRows,
}: {
  userId: string;
  positionRows: WorkforcePositionView[];
}) {
  const qc = useQueryClient();
  const assign = useServerFn(assignWorkforcePosition);
  const end = useServerFn(endWorkforcePosition);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["workforce-positions"] });
    qc.invalidateQueries({ queryKey: ["my-primary-position"] });
  };

  async function handleAssign() {
    if (!code) return;
    setBusy(true);
    setError(null);
    try {
      await assign({ data: { userId, kindCode: code } });
      setCode("");
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to assign position");
    } finally {
      setBusy(false);
    }
  }

  async function handleEnd(positionId: string) {
    setBusy(true);
    setError(null);
    try {
      await end({ data: { positionId } });
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to end position");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-1.5 space-y-1.5">
      {positionRows.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {positionRows.map((p) => (
            <span
              key={p.id}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[10px] font-medium"
            >
              {p.is_primary ? `★ ${p.kind_title}` : p.kind_title}
              <button
                type="button"
                aria-label={`End ${p.kind_title}`}
                title="End this position"
                disabled={busy}
                onClick={() => void handleEnd(p.id)}
                className="leading-none text-muted-foreground hover:text-destructive"
              >
                ×
              </button>
            </span>
          ))}
        </div>
      )}
      <div className="flex items-center gap-1.5">
        <select
          value={code}
          onChange={(e) => setCode(e.target.value)}
          aria-label="Add a position"
          className="h-7 min-w-0 flex-1 rounded-md border border-border bg-background px-2 text-xs"
        >
          <option value="">Add a position…</option>
          {POSITION_GROUPS.map((group) => (
            <optgroup key={group.label} label={group.label}>
              {group.kinds.map((k) => (
                <option key={k.code} value={k.code}>
                  {k.title}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <button
          type="button"
          disabled={!code || busy}
          onClick={() => void handleAssign()}
          className="shrink-0 rounded-md border border-border px-2.5 py-1 text-[11px] font-medium hover:bg-muted/40 disabled:opacity-50"
        >
          {busy ? "Saving…" : "Add"}
        </button>
      </div>
      {error && <p className="text-[10px] text-destructive">{error}</p>}
    </div>
  );
}

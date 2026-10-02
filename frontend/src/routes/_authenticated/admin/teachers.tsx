import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { toast } from "sonner";
import { z } from "zod";
import { Plus, Power } from "lucide-react";

import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { PortalPage } from "@/components/portal-shell";
import { PaginationBar } from "@/components/pagination-bar";
import { usePagination, PAGE_SIZE } from "@/hooks/use-pagination";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
import { inviteTeacher, setTeacherActive } from "@/lib/runtime/scholar/teachers.functions";

export const Route = createFileRoute("/_authenticated/admin/teachers")({
  ssr: false,
  component: TeachersPage,
});

type TeacherRow = {
  id: string;
  full_name: string;
  email: string | null;
  phone: string | null;
  subject_specialty: string | null;
  qualification: string | null;
  years_experience: number | null;
  is_active: boolean | null;
};

function TeachersPage() {
  const { school } = useApp();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);
  const [toggleTarget, setToggleTarget] = useState<TeacherRow | null>(null);

  const { page, from, to, nextPage, prevPage, goToPage, reset } = usePagination();

  const key = ["teachers", school?.id, page];
  const list = useQuery<{ rows: TeacherRow[]; count: number }>({
    queryKey: key,
    enabled: !!school?.id,
    queryFn: async () => {
      const { data, error, count } = await supabase
        .from("users")
        .select(
          "id, full_name, email, phone, subject_specialty, qualification, years_experience, is_active",
          { count: "exact" },
        )
        .eq("school_id", school!.id)
        .eq("role", "teacher")
        .order("full_name")
        .range(from, to);
      if (error) throw new Error(error.message);
      return { rows: (data ?? []) as TeacherRow[], count: count ?? 0 };
    },
  });

  const refresh = () => {
    reset();
    qc.invalidateQueries({ queryKey: ["teachers", school?.id] });
  };

  const rows = list.data?.rows ?? [];
  const total = list.data?.count ?? 0;

  return (
    <PortalPage title="Teachers" subtitle="Invite teachers and manage their access">
      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        <Link
          to="/admin/dashboard"
          className="rounded-md border border-border px-3 py-1.5 text-muted-foreground hover:bg-muted/40"
        >
          ← Back to dashboard
        </Link>
      </div>

      <div className="uos-card">
        <header className="flex items-center justify-between border-b border-border p-4">
          <div>
            <h2 className="font-display text-lg font-semibold">Teaching staff</h2>
            <p className="text-xs text-muted-foreground">{total} teachers</p>
          </div>
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="size-4" /> Invite teacher
          </Button>
        </header>

        {list.isLoading ? (
          <div className="p-8 text-center text-sm text-muted-foreground">Loading…</div>
        ) : total === 0 ? (
          <div className="p-10 text-center">
            <p className="text-sm text-muted-foreground">No teachers yet. Invite your first one.</p>
            <Button className="mt-4" size="sm" onClick={() => setOpen(true)}>
              <Plus className="size-4" /> Invite teacher
            </Button>
          </div>
        ) : (
          <>
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full text-sm">
                <thead className="bg-muted/30 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3">Name</th>
                    <th className="px-4 py-3">Email</th>
                    <th className="px-4 py-3">Subject</th>
                    <th className="px-4 py-3">Experience</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((t) => (
                    <tr key={t.id} className="border-t border-border">
                      <td className="px-4 py-3 font-medium">{t.full_name}</td>
                      <td className="px-4 py-3 text-muted-foreground">{t.email ?? "—"}</td>
                      <td className="px-4 py-3">{t.subject_specialty ?? "—"}</td>
                      <td className="px-4 py-3">
                        {t.years_experience != null ? `${t.years_experience} yrs` : "—"}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={t.is_active ? "text-emerald-400" : "text-muted-foreground"}
                        >
                          {t.is_active ? "Active" : "Disabled"}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Button size="sm" variant="ghost" onClick={() => setToggleTarget(t)}>
                          <Power className="size-4" />
                          {t.is_active ? "Disable" : "Enable"}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile card list */}
            <div className="space-y-3 p-4 sm:hidden">
              {rows.map((t) => (
                <div key={t.id} className="enterprise-card p-4">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <span className="truncate text-sm font-semibold">{t.full_name}</span>
                    <span
                      className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${
                        t.is_active
                          ? "bg-emerald-500/15 text-emerald-400"
                          : "bg-muted text-muted-foreground"
                      }`}
                    >
                      {t.is_active ? "Active" : "Disabled"}
                    </span>
                  </div>
                  <div className="space-y-1">
                    <div className="flex justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">Email</span>
                      <span className="truncate">{t.email ?? "—"}</span>
                    </div>
                    <div className="flex justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">Subject</span>
                      <span className="truncate">{t.subject_specialty ?? "—"}</span>
                    </div>
                    <div className="flex justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">Experience</span>
                      <span>{t.years_experience != null ? `${t.years_experience} yrs` : "—"}</span>
                    </div>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-3 w-full"
                    onClick={() => setToggleTarget(t)}
                  >
                    <Power className="size-4" />
                    {t.is_active ? "Disable" : "Enable"}
                  </Button>
                </div>
              ))}
            </div>
            <PaginationBar
              page={page}
              total={total}
              pageSize={PAGE_SIZE}
              onNext={nextPage}
              onPrev={prevPage}
              onPage={goToPage}
              isLoading={list.isFetching}
            />
          </>
        )}
      </div>

      <InviteTeacherDialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v) refresh();
        }}
        onCreated={(c) => setCreated(c)}
      />

      <AlertDialog open={!!created} onOpenChange={(v) => !v && setCreated(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Teacher invited</AlertDialogTitle>
            <AlertDialogDescription>
              Share these credentials securely. Ask the teacher to change their password on first
              sign-in.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {created && (
            <div className="space-y-2 rounded-md border border-border bg-muted/40 p-4 text-sm font-mono">
              <div>
                <span className="text-xs uppercase text-muted-foreground">Email</span>
                <div>{created.email}</div>
              </div>
              <div>
                <span className="text-xs uppercase text-muted-foreground">Temporary password</span>
                <div>{created.password}</div>
              </div>
            </div>
          )}
          <AlertDialogFooter>
            <AlertDialogAction onClick={() => setCreated(null)}>Done</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!toggleTarget} onOpenChange={(v) => !v && setToggleTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {toggleTarget?.is_active ? "Disable teacher access?" : "Re-enable teacher access?"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {toggleTarget?.is_active
                ? "They will no longer appear in faculty lists or be able to sign in via the app shell."
                : "They will appear in faculty lists and regain access."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <ToggleActiveButton
              row={toggleTarget}
              onDone={() => {
                setToggleTarget(null);
                refresh();
              }}
            />
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PortalPage>
  );
}

function ToggleActiveButton({ row, onDone }: { row: TeacherRow | null; onDone: () => void }) {
  const fn = useServerFn(setTeacherActive);
  const [saving, setSaving] = useState(false);
  if (!row) return null;
  return (
    <AlertDialogAction
      disabled={saving}
      onClick={async () => {
        setSaving(true);
        try {
          await fn({ data: { userId: row.id, isActive: !row.is_active } });
          toast.success(row.is_active ? "Teacher disabled" : "Teacher enabled");
          onDone();
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Failed");
        } finally {
          setSaving(false);
        }
      }}
    >
      {saving ? "Saving…" : row.is_active ? "Disable" : "Enable"}
    </AlertDialogAction>
  );
}

function InviteTeacherDialog({
  open,
  onOpenChange,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onCreated: (c: { email: string; password: string }) => void;
}) {
  const fn = useServerFn(inviteTeacher);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    phone: "",
    subjectSpecialty: "",
    qualification: "",
    yearsExperience: "",
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((s) => ({ ...s, [k]: e.target.value }));

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      const res = await fn({
        data: {
          fullName: form.fullName,
          email: form.email,
          phone: form.phone,
          subjectSpecialty: form.subjectSpecialty,
          qualification: form.qualification,
          yearsExperience: form.yearsExperience === "" ? null : Number(form.yearsExperience),
        },
      });
      toast.success("Teacher invited");
      onCreated({ email: res.email, password: res.tempPassword });
      setForm({
        fullName: "",
        email: "",
        phone: "",
        subjectSpecialty: "",
        qualification: "",
        yearsExperience: "",
      });
      onOpenChange(false);
    } catch (err) {
      const msg =
        err instanceof z.ZodError
          ? err.issues.map((i) => i.message).join(", ")
          : err instanceof Error
            ? err.message
            : "Failed";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Invite a teacher</DialogTitle>
          <DialogDescription>
            We create their account and return a one-time password to share securely.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="grid gap-4 md:grid-cols-2">
            <Labeled label="Full name">
              <Input value={form.fullName} onChange={set("fullName")} required maxLength={120} />
            </Labeled>
            <Labeled label="Email">
              <Input
                type="email"
                value={form.email}
                onChange={set("email")}
                required
                maxLength={255}
              />
            </Labeled>
            <Labeled label="Phone">
              <Input value={form.phone} onChange={set("phone")} maxLength={40} />
            </Labeled>
            <Labeled label="Subject specialty">
              <Input
                value={form.subjectSpecialty}
                onChange={set("subjectSpecialty")}
                maxLength={120}
              />
            </Labeled>
            <Labeled label="Qualification">
              <Input value={form.qualification} onChange={set("qualification")} maxLength={120} />
            </Labeled>
            <Labeled label="Years of experience">
              <Input
                type="number"
                min={0}
                max={80}
                value={form.yearsExperience}
                onChange={set("yearsExperience")}
              />
            </Labeled>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button className="w-full sm:w-auto" type="submit" disabled={saving}>
              {saving ? "Inviting…" : "Invite"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Labeled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs uppercase tracking-wide text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

/**
 * Generic, school-scoped CRUD list for admin-managed tables.
 *
 * Caller passes:
 *  - table name (typed against the schools’ tenant-owned tables)
 *  - column descriptors for the list
 *  - form field descriptors for the create/edit dialog
 *  - a zod schema for validation
 *
 * RLS enforces school isolation; we still set school_id on insert so the
 * "id IS NULL" path stays consistent client-side.
 */
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { z } from "zod";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Inbox } from "lucide-react";
import { EmptyState } from "@/components/portal-shell";
import { SkeletonTable } from "@/components/skeleton";

import { supabase } from "@/integrations/supabase/client";
import { useApp } from "@/contexts/app-context";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { PaginationBar } from "@/components/pagination-bar";
import { usePagination, PAGE_SIZE } from "@/hooks/use-pagination";
import { StudentSelect } from "@/components/admin/student-select";
import { ResponsiveTable, type ResponsiveColumn } from "@/components/responsive-table";
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

export type FieldDef =
  | {
      key: string;
      label: string;
      type: "text" | "number" | "email" | "url" | "date" | "time";
      placeholder?: string;
      required?: boolean;
      max?: number;
    }
  | {
      key: string;
      label: string;
      type: "textarea";
      placeholder?: string;
      required?: boolean;
      max?: number;
      rows?: number;
    }
  | { key: string; label: string; type: "switch"; hint?: string }
  | { key: string; label: string; type: "select"; options: { value: string; label: string }[] }
  | { key: string; label: string; type: "student"; placeholder?: string; required?: boolean }
  | { key: string; label: string; type: "image"; hint?: string; required?: boolean };

export type ColumnDef<Row> = {
  key: keyof Row | string;
  label: string;
  render?: (row: Row) => React.ReactNode;
  width?: string;
};

export type CrudConfig<Row extends { id: string }> = {
  /** Table name from Database['public']['Tables']. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  table: any;
  title: string;
  emptyHint: string;
  schema: z.ZodTypeAny;
  fields: FieldDef[];
  columns: ColumnDef<Row>[];
  orderBy?: { column: string; ascending: boolean };
  defaultValues?: Record<string, unknown>;
  /** Extra fields merged into the payload on create only (e.g. teacher_id, author_id). */
  extraInsertPayload?: Record<string, unknown>;
  /** Optional filter (e.g. teacher_id=me) added to the SELECT query. */
  selectFilter?: { column: string; value: string };
  /** Optional callback fired after a successful CREATE with the inserted row. */
  onAfterCreate?: (row: Record<string, unknown>) => void | Promise<void>;
};

export function CrudList<Row extends { id: string }>({ config }: { config: CrudConfig<Row> }) {
  const { school } = useApp();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<Row | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Row | null>(null);

  const { page, from, to, nextPage, prevPage, goToPage, reset } = usePagination(PAGE_SIZE);

  const queryKey = [
    config.table,
    school?.id,
    config.selectFilter?.column,
    config.selectFilter?.value,
    page,
  ];
  const list = useQuery<{ rows: Row[]; count: number }>({
    queryKey,
    enabled: !!school?.id,
    queryFn: async () => {
      let q = supabase
        .from(config.table)
        .select("*", { count: "exact" })
        .eq("school_id", school!.id);
      if (config.selectFilter) q = q.eq(config.selectFilter.column, config.selectFilter.value);
      if (config.orderBy)
        q = q.order(config.orderBy.column, { ascending: config.orderBy.ascending });
      q = q.range(from, to);
      const { data, error, count } = await q;
      if (error) throw new Error(error.message);
      return { rows: (data ?? []) as unknown as Row[], count: count ?? 0 };
    },
  });

  const refresh = () => {
    reset();
    qc.invalidateQueries({ queryKey: [config.table, school?.id] });
  };

  const total = list.data?.count ?? 0;
  const rows = list.data?.rows ?? [];

  return (
    <div className="uos-card">
      <header className="flex items-center justify-between border-b border-border p-4">
        <div>
          <h2 className="font-display text-lg font-semibold">{config.title}</h2>
          <p className="text-xs text-muted-foreground">{total} records</p>
        </div>
        <Button
          size="sm"
          onClick={() => {
            setEditing(null);
            setOpen(true);
          }}
        >
          <Plus className="size-4" /> Add
        </Button>
      </header>

      {list.isLoading ? (
        <div className="p-4">
          <SkeletonTable rows={6} />
        </div>
      ) : list.error ? (
        <div className="p-8 text-center text-sm text-red-400">{(list.error as Error).message}</div>
      ) : total === 0 ? (
        <div className="p-6 animate-fade-in">
          <EmptyState
            icon={<Inbox className="w-7 h-7" />}
            title={`No ${config.title.toLowerCase()} yet`}
            description={config.emptyHint}
            action={
              <Button
                size="sm"
                onClick={() => {
                  setEditing(null);
                  setOpen(true);
                }}
              >
                <Plus className="size-4" /> Add the first one
              </Button>
            }
          />
        </div>
      ) : (
        <>
          <div className="p-2 sm:p-0">
            <ResponsiveTable<Row>
              data={rows}
              rowKey={(r) => r.id}
              minWidth={Math.max(560, config.columns.length * 120)}
              columns={
                [
                  ...config.columns.map((c) => ({
                    key: String(c.key),
                    header: c.label,
                    className: "px-4 py-3 align-top portal-table-cell",
                    cell: (row: Row) =>
                      c.render
                        ? c.render(row)
                        : String((row as Record<string, unknown>)[c.key as string] ?? "—"),
                  })),
                  {
                    key: "__actions",
                    header: "Actions",
                    className: "px-4 py-3 text-right",
                    cell: (row: Row) => (
                      <div className="inline-flex gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Edit row"
                          className="min-h-11 min-w-11"
                          onClick={() => {
                            setEditing(row);
                            setOpen(true);
                          }}
                        >
                          <Pencil className="size-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          aria-label="Delete row"
                          className="min-h-11 min-w-11"
                          onClick={() => setConfirmDelete(row)}
                        >
                          <Trash2 className="size-4" />
                        </Button>
                      </div>
                    ),
                  },
                ] as ResponsiveColumn<Row>[]
              }
              mobileCard={(row) => (
                <div className="min-w-0">
                  <dl className="space-y-1.5">
                    {config.columns.map((c) => (
                      <div
                        key={String(c.key)}
                        className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)] gap-2 text-sm"
                      >
                        <dt className="truncate text-[11px] uppercase tracking-wide text-muted-foreground">
                          {c.label}
                        </dt>
                        <dd className="min-w-0 break-words">
                          {c.render
                            ? c.render(row)
                            : String((row as Record<string, unknown>)[c.key as string] ?? "—")}
                        </dd>
                      </div>
                    ))}
                  </dl>
                  <div className="mt-3 flex gap-2 border-t border-border/50 pt-2">
                    <Button
                      size="sm"
                      variant="outline"
                      className="min-h-11 flex-1"
                      onClick={() => {
                        setEditing(row);
                        setOpen(true);
                      }}
                    >
                      <Pencil className="size-4" /> Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="min-h-11 flex-1"
                      onClick={() => setConfirmDelete(row)}
                    >
                      <Trash2 className="size-4" /> Delete
                    </Button>
                  </div>
                </div>
              )}
            />
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

      <CrudFormDialog
        open={open}
        onOpenChange={setOpen}
        config={config}
        record={editing}
        schoolId={school?.id ?? null}
        onSaved={refresh}
      />

      <AlertDialog open={!!confirmDelete} onOpenChange={(v) => !v && setConfirmDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this record?</AlertDialogTitle>
            <AlertDialogDescription>
              This cannot be undone. Public-site visitors will no longer see it.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={async () => {
                if (!confirmDelete) return;
                const { error } = await supabase
                  .from(config.table)
                  .delete()
                  .eq("id", confirmDelete.id);
                if (error) toast.error(error.message);
                else toast.success("Deleted");
                setConfirmDelete(null);
                refresh();
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function CrudFormDialog<Row extends { id: string }>({
  open,
  onOpenChange,
  config,
  record,
  schoolId,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  config: CrudConfig<Row>;
  record: Row | null;
  schoolId: string | null;
  onSaved: () => void;
}) {
  const initial = useMemo(() => {
    const base: Record<string, unknown> = { ...(config.defaultValues ?? {}) };
    config.fields.forEach((f) => {
      const v = record ? (record as Record<string, unknown>)[f.key] : undefined;
      if (f.type === "switch") base[f.key] = Boolean(v ?? base[f.key] ?? false);
      else if (f.type === "number") base[f.key] = v == null ? "" : String(v);
      else base[f.key] = v == null ? "" : String(v);
    });
    return base;
  }, [record, config]);

  const [values, setValues] = useState(initial);
  const [saving, setSaving] = useState(false);
  // reset when dialog reopens with a different record
  useMemo(() => setValues(initial), [initial]);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!schoolId) return toast.error("No school in scope");
    setSaving(true);
    try {
      // normalise: empty string -> null, number-fields -> number
      const cleaned: Record<string, unknown> = {};
      for (const f of config.fields) {
        const raw = values[f.key];
        if (f.type === "switch") cleaned[f.key] = Boolean(raw);
        else if (f.type === "number")
          cleaned[f.key] = raw === "" || raw == null ? null : Number(raw);
        else cleaned[f.key] = raw === "" || raw == null ? null : raw;
      }
      const parsed = config.schema.parse(cleaned);
      const payload = { ...(parsed as object), school_id: schoolId };
      let error;
      let inserted: Record<string, unknown> | null = null;
      if (record) {
        ({ error } = await supabase.from(config.table).update(payload).eq("id", record.id));
      } else {
        const insertPayload = { ...payload, ...(config.extraInsertPayload ?? {}) };
        const res = await supabase.from(config.table).insert(insertPayload).select().single();
        error = res.error;
        inserted = (res.data ?? null) as Record<string, unknown> | null;
      }
      if (error) throw error;
      if (!record && inserted && config.onAfterCreate) {
        try {
          await config.onAfterCreate(inserted);
        } catch (e) {
          const m = e instanceof Error ? e.message : "Post-create hook failed";
          toast.error(m);
        }
      }
      toast.success(record ? "Updated" : "Created");
      onOpenChange(false);
      onSaved();
    } catch (err) {
      const msg =
        err instanceof z.ZodError
          ? err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" • ")
          : err instanceof Error
            ? err.message
            : "Failed to save";
      toast.error(msg);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{record ? "Edit" : "Add new"}</DialogTitle>
          <DialogDescription>{config.title}</DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          {config.fields.map((f) => (
            <div key={f.key} className="space-y-1.5">
              <Label htmlFor={f.key} className="text-xs uppercase tracking-wide text-muted-foreground">
                {f.label}
              </Label>
              {f.type === "textarea" ? (
                <Textarea
                  id={f.key}
                  value={String(values[f.key] ?? "")}
                  rows={f.rows ?? 4}
                  maxLength={f.max}
                  placeholder={f.placeholder}
                  onChange={(e) => setValues((s) => ({ ...s, [f.key]: e.target.value }))}
                />
              ) : f.type === "switch" ? (
                <div className="flex items-center justify-between rounded-md border border-border px-3 py-2">
                  <span className="text-sm text-muted-foreground">{f.hint ?? "Toggle"}</span>
                  <Switch
                    checked={Boolean(values[f.key])}
                    onCheckedChange={(v) => setValues((s) => ({ ...s, [f.key]: Boolean(v) }))}
                  />
                </div>
              ) : f.type === "select" ? (
                <select
                  id={f.key}
                  className="uos-input w-full"
                  value={String(values[f.key] ?? "")}
                  onChange={(e) => setValues((s) => ({ ...s, [f.key]: e.target.value }))}
                >
                  <option value="">—</option>
                  {f.options.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : f.type === "student" ? (
                <StudentSelect
                  value={String(values[f.key] ?? "")}
                  onChange={(id) => setValues((s) => ({ ...s, [f.key]: id }))}
                  placeholder={f.placeholder}
                />
              ) : f.type === "image" ? (
                <ImageUploadField
                  value={String(values[f.key] ?? "")}
                  onChange={(url) => setValues((s) => ({ ...s, [f.key]: url }))}
                  schoolId={schoolId}
                  hint={f.hint}
                />
              ) : (
                <Input
                  id={f.key}
                  type={f.type}
                  value={String(values[f.key] ?? "")}
                  placeholder={f.placeholder}
                  maxLength={f.max}
                  required={f.required}
                  onChange={(e) => setValues((s) => ({ ...s, [f.key]: e.target.value }))}
                />
              )}
            </div>
          ))}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button className="w-full sm:w-auto" type="submit" disabled={saving}>
              {saving ? "Saving…" : record ? "Save" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */
/* Raw image upload (Supabase Storage → school-media bucket)           */
/* ------------------------------------------------------------------ */

function ImageUploadField({
  value,
  onChange,
  schoolId,
  hint,
}: {
  value: string;
  onChange: (url: string) => void;
  schoolId: string | null;
  hint?: string;
}) {
  const [uploading, setUploading] = useState(false);

  const handleFile = async (file: File) => {
    if (!schoolId) return toast.error("No school in scope");
    if (!file.type.startsWith("image/")) return toast.error("Please pick an image file");
    if (file.size > 8 * 1024 * 1024) return toast.error("Image must be under 8 MB");
    setUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `${schoolId}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
      const { error } = await supabase.storage
        .from("school-media")
        .upload(path, file, { cacheControl: "31536000", upsert: false });
      if (error) throw error;
      // Signed URL with 10-year expiry so public visitors can render the image.
      const { data, error: signErr } = await supabase.storage
        .from("school-media")
        .createSignedUrl(path, 60 * 60 * 24 * 365 * 10);
      if (signErr) throw signErr;
      onChange(data.signedUrl);
      toast.success("Image uploaded");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="space-y-2">
      {value ? (
        <div className="relative overflow-hidden rounded-md border border-border">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={value} alt="preview" className="h-40 w-full object-cover" />
        </div>
      ) : (
        <div className="grid h-40 w-full place-items-center rounded-md border border-dashed border-border text-xs text-muted-foreground">
          No image yet
        </div>
      )}
      <div className="flex items-center gap-2">
        <label className="inline-flex cursor-pointer items-center rounded-md bg-primary px-3 py-1.5 text-xs font-semibold text-primary-foreground hover:opacity-90">
          {uploading ? "Uploading…" : value ? "Replace image" : "Upload image"}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            disabled={uploading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void handleFile(f);
              e.target.value = "";
            }}
          />
        </label>
        {value && (
          <Button type="button" size="sm" variant="ghost" onClick={() => onChange("")}>
            Remove
          </Button>
        )}
      </div>
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

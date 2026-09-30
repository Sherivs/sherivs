import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PortalPage, SectionGrid, StatCard, EmptyCard } from "@/components/portal-shell";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

export const Route = createFileRoute("/_authenticated/super-admin/platform-config")({
  ssr: false,
  component: PlatformConfigPage,
});

type Row = {
  id: string;
  key: string;
  value: unknown;
  updated_at: string | null;
  updated_by: string | null;
};

function PlatformConfigPage() {
  const qc = useQueryClient();
  const [newKey, setNewKey] = useState("");
  const [newValue, setNewValue] = useState("{\n  \n}");
  const [creating, setCreating] = useState(false);

  const q = useQuery<Row[]>({
    queryKey: ["platform-config"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("platform_config")
        .select("id, key, value, updated_at, updated_by")
        .order("key", { ascending: true });
      if (error) throw new Error(error.message);
      return (data ?? []) as Row[];
    },
  });

  async function create() {
    if (!newKey.trim()) return toast.error("Key is required");
    let parsed: unknown;
    try {
      parsed = JSON.parse(newValue);
    } catch {
      return toast.error("Value must be valid JSON");
    }
    setCreating(true);
    const { error } = await supabase
      .from("platform_config")
      .upsert({ key: newKey.trim(), value: parsed as never }, { onConflict: "key" });
    setCreating(false);
    if (error) return toast.error(error.message);
    toast.success("Saved");
    setNewKey("");
    setNewValue("{\n  \n}");
    void qc.invalidateQueries({ queryKey: ["platform-config"] });
  }

  async function remove(id: string) {
    const { error } = await supabase.from("platform_config").delete().eq("id", id);
    if (error) return toast.error(error.message);
    toast.success("Removed");
    void qc.invalidateQueries({ queryKey: ["platform-config"] });
  }

  const rows = q.data ?? [];

  return (
    <PortalPage
      title="Platform config"
      subtitle="Key/value flags that govern platform-wide behaviour."
    >
      <SectionGrid>
        <StatCard label="Total keys" value={rows.length} />
        <StatCard
          label="Last update"
          value={
            rows.length
              ? new Date(
                  rows.reduce((max, r) => {
                    const t = r.updated_at ? new Date(r.updated_at).getTime() : 0;
                    return t > max ? t : max;
                  }, 0),
                ).toLocaleDateString()
              : "—"
          }
        />
      </SectionGrid>

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <section className="uos-card p-5 lg:col-span-2">
          <h3 className="font-display text-base font-semibold">Add or update key</h3>
          <p className="mt-1 text-xs text-muted-foreground">
            Saving an existing key overwrites it. Value must be valid JSON.
          </p>
          <div className="mt-4 space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">Key</Label>
              <Input
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder="feature_global_ai_enabled"
                autoComplete="off"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs uppercase tracking-wide text-muted-foreground">
                Value (JSON)
              </Label>
              <Textarea
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                rows={8}
                className="font-mono text-xs"
              />
            </div>
            <Button onClick={create} disabled={creating}>
              {creating ? "Saving…" : "Save"}
            </Button>
          </div>
        </section>

        <section className="lg:col-span-3">
          <h3 className="font-display text-base font-semibold mb-3">Current keys</h3>
          {q.isLoading ? (
            <div className="uos-card p-6 text-sm text-muted-foreground">Loading…</div>
          ) : rows.length === 0 ? (
            <EmptyCard
              title="No platform config yet"
              body="Add a key on the left to introduce a platform-wide flag."
            />
          ) : (
            <div className="uos-card divide-y divide-border">
              {rows.map((r) => (
                <div key={r.id} className="p-4 space-y-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="font-mono text-sm font-semibold truncate">{r.key}</div>
                      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        Updated {r.updated_at ? new Date(r.updated_at).toLocaleString() : "—"}
                      </div>
                    </div>
                    <AlertDialog>
                      <AlertDialogTrigger asChild>
                        <Button variant="outline" size="sm">
                          Delete
                        </Button>
                      </AlertDialogTrigger>
                      <AlertDialogContent>
                        <AlertDialogHeader>
                          <AlertDialogTitle>Delete {r.key}?</AlertDialogTitle>
                          <AlertDialogDescription>
                            This removes the platform-wide flag. Code that reads this key will fall
                            back to its default.
                          </AlertDialogDescription>
                        </AlertDialogHeader>
                        <AlertDialogFooter>
                          <AlertDialogCancel>Cancel</AlertDialogCancel>
                          <AlertDialogAction onClick={() => remove(r.id)}>Delete</AlertDialogAction>
                        </AlertDialogFooter>
                      </AlertDialogContent>
                    </AlertDialog>
                  </div>
                  <pre className="overflow-x-auto rounded-md border border-border bg-background/40 p-3 text-xs">
                    {JSON.stringify(r.value, null, 2)}
                  </pre>
                </div>
              ))}
            </div>
          )}
        </section>
      </div>
    </PortalPage>
  );
}

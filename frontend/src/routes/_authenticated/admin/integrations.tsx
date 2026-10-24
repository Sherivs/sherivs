/**
 * Integration Hub (SHERIVS-090). A school admin connects the software the school already runs
 * (CSV/Excel exports, any system that can call a webhook, Google Classroom) so its records
 * appear inside Sherivs. Catalog -> connect -> map fields -> preview -> import -> run history.
 */
import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { useApp } from "@/contexts/app-context";
import { PortalPage } from "@/components/portal-shell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { rows, rpc, sdb } from "@/lib/scholar/rpc";
import {
  CANONICAL_ENTITIES,
  CANONICAL_FIELDS,
  batchKey,
  suggestMappings,
  type CanonicalEntity,
  type FieldMapping,
  type Transform,
} from "@/lib/integrations-hub/sdk";
import { chunk, parseDelimited, previewImport } from "@/lib/integrations-hub/connectors/csv";
import { readWorkbook, type WorkbookSheet } from "@/lib/integrations-hub/connectors/xlsx";
import { issueWebhookSecret } from "@/lib/integrations-hub/integrations.functions";

export const Route = createFileRoute("/_authenticated/admin/integrations")({
  ssr: false,
  component: IntegrationsPage,
});

type Manifest = {
  key: string;
  name: string;
  category: string;
  auth_type: string;
  entities: string[];
  status: string;
};
type Integration = {
  id: string;
  connector_key: string;
  display_name: string;
  mode: string;
  status: string;
  webhook_id: string;
  created_at: string;
};
type Run = {
  id: string;
  integration_id: string;
  entity: string;
  trigger: string;
  status: string;
  received: number;
  created: number;
  updated: number;
  unchanged: number;
  conflicts: number;
  started_at: string;
};
const MODES = [
  { v: "mirror", l: "Mirror: show their data in Sherivs, change nothing" },
  {
    v: "gradual",
    l: "Gradual: their system stays the source; Sherivs records are created and kept in sync",
  },
  { v: "cutover", l: "Full cutover: Sherivs becomes the system of record" },
];
const TRANSFORMS: Transform[] = [
  "none",
  "trim",
  "upper",
  "lower",
  "date_dmy",
  "date_iso",
  "phone_ng",
  "naira_kobo",
];

function IntegrationsPage() {
  const { school } = useApp();
  const org = school?.id ?? "";
  const qc = useQueryClient();
  const issue = useServerFn(issueWebhookSecret);
  const [selected, setSelected] = useState<string | null>(null);
  const catalog = useQuery({
    queryKey: ["connector-catalog"],
    queryFn: () => rows<Manifest>(sdb.from("connector_manifests").select("*").order("name")),
  });
  const list = useQuery({
    queryKey: ["integrations", org],
    enabled: !!org,
    queryFn: () =>
      rows<Integration>(
        sdb
          .from("integrations")
          .select("*")
          .eq("school_id", org)
          .order("created_at", { ascending: false }),
      ),
  });
  const runs = useQuery({
    queryKey: ["sync-runs", org],
    enabled: !!org,
    queryFn: () =>
      rows<Run>(
        sdb
          .from("sync_runs")
          .select("*")
          .eq("school_id", org)
          .order("started_at", { ascending: false })
          .limit(50),
      ),
  });
  const refresh = () =>
    Promise.all([
      qc.invalidateQueries({ queryKey: ["integrations", org] }),
      qc.invalidateQueries({ queryKey: ["sync-runs", org] }),
    ]);
  const current = (list.data ?? []).find((i) => i.id === selected) ?? null;

  async function connect(m: Manifest) {
    try {
      const id = await rpc<string>("integration_connect", {
        p_school: org,
        p_connector: m.key,
        p_name: m.name,
        p_mode: "mirror",
      });
      toast.success(`${m.name} connected in mirror mode`);
      await refresh();
      setSelected(id);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <PortalPage
      title="Integrations"
      subtitle="Bring the software your school already uses into Sherivs: one workspace for every staff member."
    >
      <section className="space-y-2">
        <h3 className="font-medium">Catalog</h3>
        <div className="grid gap-3 md:grid-cols-3">
          {(catalog.data ?? []).map((m) => (
            <div key={m.key} className="rounded-lg border p-3 space-y-1">
              <div className="flex items-center justify-between">
                <b>{m.name}</b>
                <span className="text-xs rounded bg-muted px-2">{m.status}</span>
              </div>
              <p className="text-xs text-muted-foreground">
                {m.category} · auth: {m.auth_type} · {m.entities.join(", ")}
              </p>
              <Button size="sm" disabled={!org || m.status === "stub"} onClick={() => connect(m)}>
                {m.status === "stub" ? "Coming soon" : "Connect"}
              </Button>
            </div>
          ))}
        </div>
      </section>

      <section className="space-y-2 mt-6">
        <h3 className="font-medium">Connected</h3>
        {(list.data ?? []).length === 0 && (
          <p className="text-sm text-muted-foreground">Nothing connected yet.</p>
        )}
        {(list.data ?? []).map((i) => (
          <div
            key={i.id}
            className={`flex flex-wrap items-center gap-2 rounded border p-2 text-sm ${selected === i.id ? "border-primary" : ""}`}
          >
            <b>{i.display_name}</b>
            <span className="text-muted-foreground">
              {i.connector_key} · {i.status}
            </span>
            <select
              className="rounded border bg-background p-1"
              value={i.mode}
              aria-label="Coexistence mode"
              onChange={(e) =>
                rpc("integration_update", { p_integration: i.id, p_mode: e.target.value }).then(
                  refresh,
                  (er) => toast.error(er.message),
                )
              }
            >
              {MODES.map((m) => (
                <option key={m.v} value={m.v}>
                  {m.l}
                </option>
              ))}
            </select>
            <Button size="sm" variant="outline" onClick={() => setSelected(i.id)}>
              Open
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                rpc("integration_update", {
                  p_integration: i.id,
                  p_status: i.status === "paused" ? "active" : "paused",
                }).then(refresh)
              }
            >
              {i.status === "paused" ? "Resume" : "Pause"}
            </Button>
            {i.connector_key === "rest-webhook" && (
              <Button
                size="sm"
                variant="outline"
                onClick={async () => {
                  try {
                    const r = await issue({ data: { id: i.id } });
                    window.prompt(
                      "Copy this signing secret now; it will not be shown again. Webhook URL: " +
                        location.origin +
                        r.webhookPath,
                      r.secret,
                    );
                  } catch (e) {
                    toast.error((e as Error).message);
                  }
                }}
              >
                Issue webhook secret
              </Button>
            )}
          </div>
        ))}
      </section>

      {current?.connector_key === "csv" && (
        <CsvWizard integrationId={current.id} onDone={refresh} />
      )}

      <section className="space-y-2 mt-6">
        <h3 className="font-medium">Run history</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-muted-foreground">
              <th>When</th>
              <th>Entity</th>
              <th>Trigger</th>
              <th>Status</th>
              <th>Received</th>
              <th>New</th>
              <th>Updated</th>
              <th>Unchanged</th>
              <th>Conflicts</th>
            </tr>
          </thead>
          <tbody>
            {(runs.data ?? []).map((r) => (
              <tr key={r.id} className="border-t">
                <td>{new Date(r.started_at).toLocaleString("en-NG")}</td>
                <td>{r.entity}</td>
                <td>{r.trigger}</td>
                <td>{r.status}</td>
                <td>{r.received}</td>
                <td>{r.created}</td>
                <td>{r.updated}</td>
                <td>{r.unchanged}</td>
                <td>{r.conflicts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </PortalPage>
  );
}

function CsvWizard({
  integrationId,
  onDone,
}: {
  integrationId: string;
  onDone: () => Promise<unknown>;
}) {
  const [entity, setEntity] = useState<CanonicalEntity>("student");
  const [parsed, setParsed] = useState<{
    headers: string[];
    rows: Record<string, string>[];
  } | null>(null);
  const [mappings, setMappings] = useState<FieldMapping[]>([]);
  const [busy, setBusy] = useState(false);
  const preview = useMemo(
    () => (parsed ? previewImport(parsed.rows, mappings) : null),
    [parsed, mappings],
  );

  const [sheets, setSheets] = useState<WorkbookSheet[]>([]);
  function pickSheet(p: { headers: string[]; rows: Record<string, string>[] }) {
    setParsed(p);
    setMappings(suggestMappings(p.headers, entity));
  }
  async function onFile(f: File) {
    if (/\.xls$/i.test(f.name)) {
      toast.error("Old .xls workbooks are not supported: save it as .xlsx or CSV UTF-8.");
      return;
    }
    try {
      if (/\.xlsx$/i.test(f.name)) {
        const wb = await readWorkbook(f);
        setSheets(wb);
        if (wb[0]) pickSheet(wb[0]);
        return;
      }
      setSheets([]);
      pickSheet(parseDelimited(await f.text()));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  function setTarget(target: string, source: string, transform: Transform) {
    setMappings((ms) => [
      ...ms.filter((m) => m.target !== target),
      ...(source ? [{ source, target, transform }] : []),
    ]);
  }
  async function runImport() {
    if (!preview) return;
    setBusy(true);
    try {
      await rpc("integration_set_mappings", {
        p_integration: integrationId,
        p_entity: entity,
        p_mappings: mappings,
      });
      let created = 0,
        updated = 0,
        unchanged = 0;
      for (const part of chunk(preview.records, 500)) {
        const r = await rpc<{ created: number; updated: number; unchanged: number }>(
          "integration_ingest",
          {
            p_integration: integrationId,
            p_entity: entity,
            p_records: part,
            p_idempotency_key: await batchKey("csv", part),
            p_trigger: "csv_upload",
          },
        );
        created += r.created ?? 0;
        updated += r.updated ?? 0;
        unchanged += r.unchanged ?? 0;
      }
      toast.success(`Imported: ${created} new, ${updated} updated, ${unchanged} unchanged`);
      await onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-6 space-y-3 rounded-lg border p-3">
      <h3 className="font-medium">CSV / Excel import</h3>
      <div className="flex flex-wrap gap-2 items-center">
        <select
          className="rounded border bg-background p-2 text-sm"
          value={entity}
          aria-label="What is in the file"
          onChange={(e) => {
            const en = e.target.value as CanonicalEntity;
            setEntity(en);
            if (parsed) setMappings(suggestMappings(parsed.headers, en));
          }}
        >
          {CANONICAL_ENTITIES.filter((e) => e !== "assignment").map((e) => (
            <option key={e} value={e}>
              {e}
            </option>
          ))}
        </select>
        <Input
          type="file"
          accept=".csv,.tsv,.txt,.xlsx"
          className="max-w-xs"
          onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])}
        />
        {sheets.length > 1 && (
          <select
            className="rounded border bg-background p-2 text-sm"
            aria-label="Sheet"
            onChange={(e) => pickSheet(sheets[Number(e.target.value)])}
          >
            {sheets.map((sh, i) => (
              <option key={sh.name} value={i}>
                {sh.name} ({sh.rows.length} rows)
              </option>
            ))}
          </select>
        )}
      </div>
      {parsed && (
        <>
          <p className="text-sm text-muted-foreground">
            {parsed.rows.length} rows, {parsed.headers.length} columns. Map each Sherivs field to a
            column in your file.
          </p>
          <div className="grid gap-1 md:grid-cols-2">
            {CANONICAL_FIELDS[entity].map((t) => {
              const m = mappings.find((x) => x.target === t);
              return (
                <div key={t} className="flex items-center gap-2 text-sm">
                  <span className="w-40">{t}</span>
                  <select
                    className="rounded border bg-background p-1"
                    value={m?.source ?? ""}
                    aria-label={`Source for ${t}`}
                    onChange={(e) => setTarget(t, e.target.value, m?.transform ?? "trim")}
                  >
                    <option value="">(not mapped)</option>
                    {parsed.headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                  <select
                    className="rounded border bg-background p-1"
                    value={m?.transform ?? "trim"}
                    aria-label={`Transform for ${t}`}
                    disabled={!m}
                    onChange={(e) => m && setTarget(t, m.source, e.target.value as Transform)}
                  >
                    {TRANSFORMS.map((x) => (
                      <option key={x} value={x}>
                        {x}
                      </option>
                    ))}
                  </select>
                </div>
              );
            })}
          </div>
          {preview && (
            <div className="text-sm space-y-1">
              <p>
                Preview: {preview.records.length} records ready · {preview.skipped} rows without an
                ID skipped · {preview.duplicates.length} duplicate IDs in file (last one wins)
              </p>
              <pre className="max-h-48 overflow-auto rounded bg-muted p-2 text-xs">
                {JSON.stringify(preview.records.slice(0, 5), null, 1)}
              </pre>
              <Button disabled={busy || preview.records.length === 0} onClick={runImport}>
                {busy ? "Importing..." : `Import ${preview.records.length} records`}
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

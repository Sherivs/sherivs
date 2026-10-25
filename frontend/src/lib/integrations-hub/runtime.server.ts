/**
 * SHERIVS-093 integration worker: scheduled pulls + outbound write-back delivery.
 * Called by /api/public/cron/integrations-sync (Bearer CRON_SECRET). Uses the service role, so every
 * write still goes through integration_ingest (school taken from the integration row) and the outbox
 * claim/ack RPCs (FOR UPDATE SKIP LOCKED leases, so overlapping cron runs never double-process).
 */
import { createHash } from "node:crypto";
import type { CredentialVault } from "@/lib/credential-vault/vault.server";
import type { CanonicalEntity, ConnectorRuntime } from "./sdk";
import { fedena } from "./connectors/fedena";
import { moodle } from "./connectors/moodle";
import { oneroster } from "./connectors/oneroster";
import { googleClassroom } from "./connectors/google-classroom";
import { signWebhook } from "./connectors/rest-webhook";
import type { FetchLike } from "./http.server";

export const CONNECTORS: Record<string, ConnectorRuntime> = {
  fedena,
  moodle,
  oneroster,
  "google-classroom": googleClassroom,
};

type Res = { data: unknown; error: { message: string } | null };
export interface WorkerDb {
  rpc(fn: string, args: Record<string, unknown>): PromiseLike<Res>;
  from(t: string): {
    select(c: string): { eq(k: string, v: string): { maybeSingle(): PromiseLike<Res> } };
  };
}
interface Job {
  id: string;
  integration_id: string;
  school_id: string;
  entity: string;
  direction: string;
  cursor: string | null;
}
interface Integration {
  id: string;
  school_id: string;
  connector_key: string;
  status: string;
  config: Record<string, unknown>;
  credential_provider: string | null;
  credential_name: string | null;
}
interface OutboxItem {
  id: number;
  integration_id: string;
  school_id: string;
  entity: string;
  op: string;
  sherivs_id: string;
  external_id: string | null;
  payload: unknown;
}

export interface WorkerDeps {
  db: WorkerDb;
  vault: CredentialVault;
  fetch: FetchLike;
  now?: () => number;
  maxPagesPerJob?: number;
  deadlineMs?: number;
}
export interface WorkerReport {
  jobs: number;
  pages: number;
  records: number;
  jobErrors: number;
  outboxSent: number;
  outboxFailed: number;
}

async function one<T>(p: PromiseLike<Res>): Promise<T> {
  const r = await p;
  if (r.error) throw new Error(r.error.message);
  return r.data as T;
}
async function loadIntegration(db: WorkerDb, id: string): Promise<Integration | null> {
  return one<Integration | null>(
    db
      .from("integrations")
      .select("id, school_id, connector_key, status, config, credential_provider, credential_name")
      .eq("id", id)
      .maybeSingle(),
  );
}
async function withSecret<T>(
  vault: CredentialVault,
  i: Integration,
  fn: (s: string | null) => Promise<T>,
): Promise<T> {
  if (!i.credential_provider || !i.credential_name) return fn(null);
  return vault.withCredential(i.school_id, i.credential_provider, i.credential_name, async (s) =>
    fn(s),
  );
}

export async function runPullJob(d: WorkerDeps, job: Job, report: WorkerReport): Promise<void> {
  const i = await loadIntegration(d.db, job.integration_id);
  const conn = i ? CONNECTORS[i.connector_key] : undefined;
  if (!i || i.school_id !== job.school_id || i.status !== "active" || !conn?.pull) return; // csv / webhook have nothing to pull
  let cursor = job.cursor;
  let err: string | null = null;
  try {
    await withSecret(d.vault, i, async (secret) => {
      for (let p = 0; p < (d.maxPagesPerJob ?? 20); p++) {
        const page = await conn.pull!({
          entity: job.entity as CanonicalEntity,
          cursor,
          secret,
          config: i.config ?? {},
          fetch: d.fetch,
        });
        report.pages++;
        if (page.records.length > 0) {
          const key =
            "pull-" +
            createHash("sha256")
              .update(`${job.id}|${cursor ?? ""}|${JSON.stringify(page.records)}`)
              .digest("hex")
              .slice(0, 40);
          await one(
            d.db.rpc("integration_ingest", {
              p_integration: i.id,
              p_entity: job.entity,
              p_records: page.records,
              p_idempotency_key: key,
              p_trigger: "schedule",
            }),
          );
          report.records += page.records.length;
        }
        cursor = page.cursor ?? cursor;
        if (page.done || (d.deadlineMs && (d.now ?? Date.now)() > d.deadlineMs)) break;
      }
    });
  } catch (e) {
    err = e instanceof Error ? e.message.slice(0, 200) : "pull failed";
    report.jobErrors++;
  }
  await one(d.db.rpc("integration_job_done", { p_job: job.id, p_cursor: cursor, p_error: err }));
}

export async function deliverOutboxItem(
  d: WorkerDeps,
  item: OutboxItem,
  report: WorkerReport,
): Promise<void> {
  let ok = false;
  let error: string | null = null;
  let externalId: string | null = null;
  try {
    const i = await loadIntegration(d.db, item.integration_id);
    const url = i?.config?.outbound_url;
    if (!i || i.school_id !== item.school_id) throw new Error("integration gone");
    if (i.connector_key !== "rest-webhook" || typeof url !== "string")
      throw new Error("no outbound target configured");
    const body = JSON.stringify({
      entity: item.entity,
      op: item.op,
      sherivs_id: item.sherivs_id,
      external_id: item.external_id,
      data: item.payload,
    });
    const ts = String(Math.floor((d.now ?? Date.now)() / 1000));
    const sig = await withSecret(d.vault, i, async (s) => {
      if (!s) throw new Error("no signing secret");
      return signWebhook(s, ts, body);
    });
    const r = await d.fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-sherivs-timestamp": ts,
        "x-sherivs-signature": sig,
        "idempotency-key": `sherivs-outbox-${item.id}`,
      },
      body,
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    try {
      const j = (await r.json()) as { external_id?: unknown };
      if (typeof j.external_id === "string") externalId = j.external_id;
    } catch {
      /* empty body is fine */
    }
    ok = true;
    report.outboxSent++;
  } catch (e) {
    error = e instanceof Error ? e.message.slice(0, 200) : "delivery failed";
    report.outboxFailed++;
  }
  await one(
    d.db.rpc("integration_outbox_ack", {
      p_id: item.id,
      p_ok: ok,
      p_error: error,
      p_external_id: externalId,
    }),
  );
}

export async function runIntegrationWorker(d: WorkerDeps): Promise<WorkerReport> {
  const report: WorkerReport = {
    jobs: 0,
    pages: 0,
    records: 0,
    jobErrors: 0,
    outboxSent: 0,
    outboxFailed: 0,
  };
  const jobs = await one<Job[]>(d.db.rpc("integration_claim_due_jobs", { p_limit: 25 }));
  for (const j of jobs.filter((x) => x.direction === "inbound")) {
    if (d.deadlineMs && (d.now ?? Date.now)() > d.deadlineMs) break;
    report.jobs++;
    await runPullJob(d, j, report);
  }
  const items = await one<OutboxItem[]>(d.db.rpc("integration_outbox_claim", { p_limit: 200 }));
  for (const it of items) {
    if (d.deadlineMs && (d.now ?? Date.now)() > d.deadlineMs) break; // unclaimed leases expire in 5 min and are retried
    await deliverOutboxItem(d, it, report);
  }
  return report;
}

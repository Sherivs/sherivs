/**
 * JARVIS-LIVE-01: database ports for the owner-alert tick (Authority: Owner; Origin: owner
 * instruction of 2026-11-16; Creator: Claude; Created: 2026-11-16; Status: Active).
 *
 * Talks to the owner_alerts, owner_alert_deliveries, owner_alert_channels and
 * owner_alert_settings tables (proposal JARVIS-LIVE-01). Until that migration is applied every
 * read fails, and the tick reports `not_configured` and does nothing. The client is the service
 * role: this module is server-only and is never imported by a route that accepts user input
 * without its own authorization.
 *
 * Signals read here:
 *  - open or contained rows in security_incidents      -> S1 (a security incident)
 *  - pending rows in jarvis_approval_requests          -> severity from the request's risk tier
 */
import type { QuietHours } from "../jarvis-executive/owner-alert";
import type { SeverityFacts } from "../jarvis-executive/severity";
import type { RolePackTier } from "../twin-engine/role-pack";
import type { OwnerExternalChannel } from "./alert-delivery";
import type { OwnerSignal, TickConfig, TickPorts, DeliveryStatus } from "./owner-alert-tick";

export const OWNER_ALERT_AGENT = "jarvis-executive";
const CHANNELS: readonly OwnerExternalChannel[] = ["voice", "whatsapp", "sms", "email"];
const TIERS: readonly RolePackTier[] = ["T0", "T1", "T2", "T3", "T4"];

type Row = Record<string, unknown>;
type Result<T = unknown> = { data: T | null; error: { code?: string; message: string } | null };

/** The slice of the Supabase client this module uses. */
export interface AlertDbClient {
  from(table: string): {
    select(columns: string, options?: { count?: "exact"; head?: boolean }): Query;
    insert(
      row: Row,
    ): { select(columns: string): { single(): PromiseLike<Result<Row>> } } & PromiseLike<Result>;
    update(row: Row): { eq(column: string, value: unknown): PromiseLike<Result> };
  };
  rpc(fn: string, args?: Record<string, unknown>): PromiseLike<Result>;
}
interface Query extends PromiseLike<Result<Row[]>> {
  eq(column: string, value: unknown): Query;
  in(column: string, values: readonly unknown[]): Query;
  gte(column: string, value: string): Query;
  order(column: string, options?: { ascending?: boolean }): Query;
  limit(n: number): Query;
  maybeSingle(): PromiseLike<Result<Row>>;
}

export interface OwnerAlertStoreOptions {
  readonly db: AlertDbClient;
  readonly consoleOrigin: string | null;
  readonly nowMs: () => number;
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");
/** Free-text fields become words only: no dots, slashes or colons that could form a link. */
const words = (v: unknown): string =>
  str(v)
    .replace(/[^A-Za-z0-9 _-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 60);

export function createOwnerAlertPorts(
  options: OwnerAlertStoreOptions,
  send: TickPorts["send"],
): TickPorts {
  const { db, consoleOrigin, nowMs } = options;

  async function must<T>(q: PromiseLike<Result<T>>): Promise<T> {
    const r = await q;
    if (r.error) throw new Error(r.error.code ?? "db_error");
    return r.data as T;
  }

  return {
    nowMs,
    send,

    async isPaused(): Promise<boolean> {
      const r = await db.rpc("is_agent_paused", { p_agent: OWNER_ALERT_AGENT });
      if (r.error) throw new Error("pause_check_failed");
      return r.data === true;
    },

    async loadConfig(): Promise<TickConfig | null> {
      const settings = await db
        .from("owner_alert_settings")
        .select(
          "mode, quiet_start_hour, quiet_end_hour, utc_offset_minutes, live_approval_ref, live_approved_by, live_channels, live_expires_at",
        )
        .maybeSingle();
      if (settings.error || !settings.data) return null;
      const channels = await must(db.from("owner_alert_channels").select("channel, enabled"));
      const ownerEnabled: Partial<Record<OwnerExternalChannel, boolean>> = {};
      for (const c of channels ?? []) {
        const name = str(c.channel) as OwnerExternalChannel;
        if (CHANNELS.includes(name)) ownerEnabled[name] = c.enabled === true;
      }
      const s = settings.data;
      const mode = s.mode === "live" ? "live" : "test";
      const start = s.quiet_start_hour;
      const end = s.quiet_end_hour;
      const quiet: QuietHours | null =
        typeof start === "number" && typeof end === "number"
          ? { startHour: start, endHour: end, utcOffsetMinutes: Number(s.utc_offset_minutes ?? 60) }
          : null;
      const live = Array.isArray(s.live_channels)
        ? (s.live_channels as unknown[]).filter((c): c is OwnerExternalChannel =>
            CHANNELS.includes(c as OwnerExternalChannel),
          )
        : [];
      const authorization =
        mode === "live" && s.live_approval_ref && s.live_approved_by && s.live_expires_at
          ? {
              approvalRef: str(s.live_approval_ref),
              approvedBy: str(s.live_approved_by),
              channels: live,
              expiresAt: str(s.live_expires_at),
            }
          : undefined;
      return { config: { mode, ownerEnabled }, authorization, quiet, consoleOrigin };
    },

    async readSignals(): Promise<readonly OwnerSignal[]> {
      const out: OwnerSignal[] = [];
      const incidents = await must(
        db
          .from("security_incidents")
          .select("id, severity, category, status, detected_at")
          .in("status", ["open", "contained"])
          .order("detected_at", { ascending: false })
          .limit(50),
      );
      for (const i of incidents ?? []) {
        const sev = str(i.severity);
        out.push({
          key: `incident:${str(i.id)}`,
          source: "security_incidents",
          title: `Security incident (${words(sev) || "unrated"}, ${words(i.category) || "uncategorised"})`,
          facts: {
            tier: "T1",
            scope: sev === "critical" || sev === "high" ? "platform" : "tenant",
            reversible: false,
            securityIncident: true,
            customerVisible: true,
          },
        });
      }
      const approvals = await must(
        db
          .from("jarvis_approval_requests")
          .select("approval_id, action_id, risk_tier, status, expires_at")
          .eq("status", "pending")
          .order("requested_at", { ascending: false })
          .limit(50),
      );
      for (const a of approvals ?? []) {
        const tier = str(a.risk_tier) as RolePackTier;
        const t: RolePackTier = TIERS.includes(tier) ? tier : "T3";
        // A pending request is nothing that has happened yet, so it is reversible and scoped to
        // the requester. The tier alone sets the urgency: T3 and above is S2, T2 is S3, below is S4.
        const facts: SeverityFacts = {
          tier: t,
          scope: "single_user",
          reversible: true,
          securityIncident: false,
          customerVisible: false,
        };
        out.push({
          key: `approval:${str(a.approval_id)}`,
          source: "jarvis_approval_requests",
          title: `Approval waiting (${t}): ${words(a.action_id) || "action"}`,
          facts,
        });
      }
      return out;
    },

    async upsertAlert(input) {
      // The latest alert for this key decides: if the owner acknowledged or resolved it, that
      // decision stands and no new alert is opened for the same thing.
      const latest = await db
        .from("owner_alerts")
        .select("id, status")
        .eq("dedupe_key", input.dedupeKey)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (latest.error) throw new Error("alert_read_failed");
      if (latest.data) {
        const status = str(latest.data.status);
        return {
          id: str(latest.data.id),
          status: status === "acknowledged" || status === "resolved" ? status : "open",
        };
      }
      const created = await db
        .from("owner_alerts")
        .insert({
          dedupe_key: input.dedupeKey,
          severity: input.severity,
          title: input.title.slice(0, 200),
          console_path: input.consolePath,
          source: input.source,
        })
        .select("id")
        .single();
      if (created.error || !created.data)
        throw new Error(created.error?.code ?? "alert_write_failed");
      return { id: str(created.data.id), status: "open" };
    },

    async history(dedupeKey, severity) {
      const mine = await must(
        db.from("owner_alerts").select("id").eq("dedupe_key", dedupeKey).limit(20),
      );
      const ids = (mine ?? []).map((r) => str(r.id));
      let lastSentMs: number | null = null;
      if (ids.length > 0) {
        const last = await db
          .from("owner_alert_deliveries")
          .select("attempted_at")
          .in("alert_id", ids)
          .eq("status", "sent")
          .eq("destination_kind", "registered_contact")
          .order("attempted_at", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (last.error) throw new Error("history_failed");
        if (last.data?.attempted_at) lastSentMs = Date.parse(str(last.data.attempted_at));
      }
      const sameSeverity = await must(
        db.from("owner_alerts").select("id").eq("severity", severity).limit(200),
      );
      const sevIds = (sameSeverity ?? []).map((r) => str(r.id));
      let sentInLastHour = 0;
      if (sevIds.length > 0) {
        const since = new Date(nowMs() - 3_600_000).toISOString();
        const recent = await must(
          db
            .from("owner_alert_deliveries")
            .select("id")
            .in("alert_id", sevIds)
            .eq("status", "sent")
            .eq("destination_kind", "registered_contact")
            .gte("attempted_at", since)
            .limit(200),
        );
        sentInLastHour = (recent ?? []).length;
      }
      return { lastSentMs: Number.isNaN(lastSentMs ?? 0) ? null : lastSentMs, sentInLastHour };
    },

    async claimDelivery(input) {
      const r = await db.from("owner_alert_deliveries").insert({
        alert_id: input.alertId,
        channel: input.channel,
        destination_kind: input.destinationKind,
        status: "claimed",
        idempotency_key: input.idempotencyKey,
      });
      if (!r.error) return true;
      if (r.error.code === "23505") return false;
      throw new Error(r.error.code ?? "claim_failed");
    },

    async finishDelivery(input: {
      idempotencyKey: string;
      status: DeliveryStatus;
      reasonCode: string | null;
      providerRef: string | null;
    }) {
      await must(
        db
          .from("owner_alert_deliveries")
          .update({
            status: input.status,
            reason_code: input.reasonCode,
            provider_ref: input.providerRef,
            attempted_at: new Date(nowMs()).toISOString(),
          })
          .eq("idempotency_key", input.idempotencyKey),
      );
    },
  };
}

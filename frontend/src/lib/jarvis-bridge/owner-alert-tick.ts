/**
 * JARVIS-LIVE-01: the owner-alert runtime tick (Authority: Owner; Origin: owner instruction of
 * 2026-11-16; Creator: Claude; Created: 2026-11-16; Status: Active).
 *
 * One tick reads signals, classifies each by severity (ENGINE-04), plans delivery through the
 * channel gates (ENGINE-09), and writes the alert and every delivery attempt through ports. It
 * contains no I/O of its own, so the same code runs against the database in production and
 * against memory in tests.
 *
 * Safety properties (each is pinned by a test):
 *  - a paused JARVIS does nothing;
 *  - the tick never contacts a person unless mode is live, the channel is enabled, and an
 *    unexpired authorization names that channel and an approver (planAlertDelivery);
 *  - in test mode an external channel only ever writes a delivery row marked test_sink;
 *  - an alert is a notification with a console link. It carries no approve link, code or secret;
 *  - every attempt is claimed by an idempotency key before it is sent, so an overlapping tick
 *    cannot send the same message twice;
 *  - a failing sender, store or signal source is reported by code and never throws out of the tick;
 *  - the report holds counts and codes only, never a destination or a message body.
 */
import { classifySeverity, type Severity, type SeverityFacts } from "../jarvis-executive/severity";
import type { QuietHours } from "../jarvis-executive/owner-alert";
import {
  planAlertDelivery,
  type DeliveryItem,
  type OwnerAlertConfig,
  type OwnerExternalChannel,
  type OwnerLiveAuthorization,
} from "./alert-delivery";

export interface OwnerSignal {
  /** Stable key for the thing being reported, for example `approval:<id>` or `incident:<id>`. */
  readonly key: string;
  readonly source: string;
  readonly title: string;
  readonly facts: SeverityFacts;
}

export interface TickConfig {
  readonly config: OwnerAlertConfig;
  readonly authorization?: OwnerLiveAuthorization;
  readonly quiet: QuietHours | null;
  /** Origin of the console, for example https://console.sherivs.com. Null means not configured. */
  readonly consoleOrigin: string | null;
}

export type DeliveryStatus = "sent" | "failed" | "skipped";

export interface SendRequest {
  readonly channel: OwnerExternalChannel;
  readonly severity: Severity;
  readonly body: string;
  readonly link: string;
  readonly idempotencyKey: string;
}

export type SendOutcome =
  | { readonly ok: true; readonly providerRef: string | null }
  | { readonly ok: false; readonly code: string };

export interface TickPorts {
  nowMs(): number;
  isPaused(): Promise<boolean>;
  loadConfig(): Promise<TickConfig | null>;
  readSignals(): Promise<readonly OwnerSignal[]>;
  /** Creates the alert, or returns the open one that already has this dedupe key. */
  upsertAlert(input: {
    dedupeKey: string;
    severity: Severity;
    title: string;
    consolePath: string;
    source: string;
  }): Promise<{ id: string; status: "open" | "acknowledged" | "resolved" }>;
  /** Last successful send for this dedupe key, and external sends of this severity in the last hour. */
  history(
    dedupeKey: string,
    severity: Severity,
  ): Promise<{ lastSentMs: number | null; sentInLastHour: number }>;
  /** Returns false when this idempotency key was already claimed. */
  claimDelivery(input: {
    alertId: string;
    channel: DeliveryItem["channel"];
    destinationKind: DeliveryItem["destination"]["kind"];
    idempotencyKey: string;
  }): Promise<boolean>;
  finishDelivery(input: {
    idempotencyKey: string;
    status: DeliveryStatus;
    reasonCode: string | null;
    providerRef: string | null;
  }): Promise<void>;
  /** Only ever called for a registered contact in live mode. */
  send(request: SendRequest): Promise<SendOutcome>;
}

export interface TickReport {
  readonly status: "ok" | "paused" | "not_configured" | "signals_unavailable";
  readonly signals: number;
  readonly alertsHandled: number;
  readonly suppressed: Readonly<Record<string, number>>;
  readonly delivered: Readonly<Record<string, number>>;
  readonly failed: Readonly<Record<string, number>>;
  readonly skipped: Readonly<Record<string, number>>;
  readonly errors: readonly string[];
}

export const MAX_SIGNALS_PER_TICK = 25;
/** A failed or still-open alert may be retried once per bucket. */
export const RETRY_BUCKET_MS = 15 * 60_000;

const SEVERITY_ORDER: Readonly<Record<Severity, number>> = { S1: 0, S2: 1, S3: 2, S4: 3 };

const bump = (m: Record<string, number>, k: string) => {
  m[k] = (m[k] ?? 0) + 1;
};

export function consolePathFor(key: string): string {
  return `/console/alerts?ref=${encodeURIComponent(key)}`;
}

export async function runOwnerAlertTick(ports: TickPorts): Promise<TickReport> {
  const suppressed: Record<string, number> = {};
  const delivered: Record<string, number> = {};
  const failed: Record<string, number> = {};
  const skipped: Record<string, number> = {};
  const errors: string[] = [];
  const report = (status: TickReport["status"], signals = 0, alertsHandled = 0): TickReport => ({
    status,
    signals,
    alertsHandled,
    suppressed,
    delivered,
    failed,
    skipped,
    errors,
  });

  if (await safe(() => ports.isPaused(), true, errors, "pause_check_failed")) {
    return report("paused");
  }
  const cfg = await safe(() => ports.loadConfig(), null, errors, "config_unavailable");
  if (!cfg || !cfg.consoleOrigin) return report("not_configured");

  let signals: readonly OwnerSignal[];
  try {
    signals = await ports.readSignals();
  } catch {
    errors.push("signals_unavailable");
    return report("signals_unavailable");
  }

  const ranked = signals
    .map((s) => ({ s, severity: classifySeverity(s.facts) }))
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
    .slice(0, MAX_SIGNALS_PER_TICK);

  let handled = 0;
  for (const { s, severity } of ranked) {
    try {
      const nowMs = ports.nowMs();
      const consolePath = consolePathFor(s.key);
      const alert = await ports.upsertAlert({
        dedupeKey: s.key,
        severity,
        title: s.title,
        consolePath,
        source: s.source,
      });
      // An acknowledged or resolved alert is the owner's decision: do not nag.
      if (alert.status !== "open") {
        bump(suppressed, "not_open");
        continue;
      }
      handled += 1;
      const hist = await ports.history(s.key, severity);
      const plan = planAlertDelivery(
        {
          severity,
          title: s.title,
          consoleOrigin: cfg.consoleOrigin,
          consolePath,
          nowMs,
          quiet: cfg.quiet,
          lastSentMs: hist.lastSentMs,
          sentInLastHour: hist.sentInLastHour,
          alertId: alert.id,
        },
        cfg.config,
        cfg.authorization,
      );
      if (!plan.send) {
        bump(suppressed, plan.reason);
        continue;
      }
      const bucket = Math.floor(nowMs / RETRY_BUCKET_MS);
      for (const skip of plan.skipped) {
        const key = `${alert.id}:${skip.channel}:skipped:${bucket}`;
        const claimed = await ports.claimDelivery({
          alertId: alert.id,
          channel: skip.channel,
          destinationKind: "registered_contact",
          idempotencyKey: key,
        });
        if (!claimed) continue;
        await ports.finishDelivery({
          idempotencyKey: key,
          status: "skipped",
          reasonCode: skip.code,
          providerRef: null,
        });
        bump(skipped, `${skip.channel}:${skip.code}`);
      }
      for (const d of plan.deliveries) {
        const key = `${d.idempotencyKey}:${bucket}`;
        const claimed = await ports.claimDelivery({
          alertId: alert.id,
          channel: d.channel,
          destinationKind: d.destination.kind,
          idempotencyKey: key,
        });
        if (!claimed) {
          bump(suppressed, "already_claimed");
          continue;
        }
        if (d.destination.kind !== "registered_contact") {
          // Console, or a synthetic sink in test mode: nothing leaves the system.
          await ports.finishDelivery({
            idempotencyKey: key,
            status: "sent",
            reasonCode: null,
            providerRef: d.destination.kind === "test_sink" ? d.destination.sink : "in_app",
          });
          bump(delivered, `${d.channel}:${d.destination.kind}`);
          continue;
        }
        const outcome = await safeSend(ports, {
          channel: d.channel as OwnerExternalChannel,
          severity,
          body: plan.body,
          link: plan.link,
          idempotencyKey: key,
        });
        if (outcome.ok) {
          await ports.finishDelivery({
            idempotencyKey: key,
            status: "sent",
            reasonCode: null,
            providerRef: outcome.providerRef,
          });
          bump(delivered, `${d.channel}:registered_contact`);
        } else {
          await ports.finishDelivery({
            idempotencyKey: key,
            status: "failed",
            reasonCode: outcome.code,
            providerRef: null,
          });
          bump(failed, `${d.channel}:${outcome.code}`);
        }
      }
    } catch {
      // One bad signal must not stop the rest; the code is enough to investigate.
      errors.push("signal_failed");
    }
  }
  return report("ok", signals.length, handled);
}

async function safeSend(ports: TickPorts, request: SendRequest): Promise<SendOutcome> {
  try {
    return await ports.send(request);
  } catch {
    return { ok: false, code: "sender_threw" };
  }
}

async function safe<T>(
  fn: () => Promise<T>,
  fallback: T,
  errors: string[],
  code: string,
): Promise<T> {
  try {
    return await fn();
  } catch {
    errors.push(code);
    return fallback;
  }
}

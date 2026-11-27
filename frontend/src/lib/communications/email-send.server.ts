/**
 * Sherivs — the one transactional email send (M22, ADR-151). Server only.
 *
 * Before M22 the ENGINE-23 notification worker cron and the JARVIS owner-alert sender each built
 * their own Resend command and adapter, and neither recorded delivery evidence. Both now call
 * {@link createTransactionalEmailSender}: the Resend adapter (`resend-email.server.ts`, the only
 * email adapter), its provider registry, and the `cg_delivery_evidence` sink, composed once.
 *
 * Dormant without configuration: without RESEND_API_KEY / RESEND_FROM_ADDRESS the adapter returns a
 * typed `provider_not_configured` result before any network call; without SUPABASE_URL /
 * SUPABASE_SERVICE_ROLE_KEY no evidence row is written (the result is unchanged).
 */
import type { NotificationCategory } from "../notifications/notification-contract";
import {
  isEmailDeliveryReceipt,
  type EmailDeliveryResult,
} from "../notifications/email-adapter-contract";
import { SystemClock, TimeAuthority } from "../kernel/time-authority";
import { deliveryEvidenceSinkFromEnv, type DeliveryEvidenceSink } from "./delivery-evidence.server";
import {
  createResendEmailAdapter,
  createResendEmailProviderRegistry,
  resendEmailConfigFromEnv,
} from "./resend-email.server";

const clock = new TimeAuthority(new SystemClock());

type Env = Record<string, string | undefined>;

export interface TransactionalEmail {
  /** Correlation id (notification/outbox row id or an idempotency key). */
  readonly id: string;
  /** Organization id, or `platform` for Sherivs' own mail. */
  readonly tenantRef: string;
  readonly recipientRef: string;
  readonly category: NotificationCategory;
  /** Address already resolved server-side. Never from a client or a model. */
  readonly to: string;
  readonly subject: string;
  readonly body: string;
}

export type TransactionalEmailOutcome =
  | { readonly ok: true; readonly providerMessageId: string | null }
  | { readonly ok: false; readonly code: string };

export function createTransactionalEmailSender(
  env: Env,
  evidence: DeliveryEvidenceSink | null = deliveryEvidenceSinkFromEnv(env),
): (mail: TransactionalEmail) => Promise<TransactionalEmailOutcome> {
  const adapter = createResendEmailAdapter(resendEmailConfigFromEnv(env), evidence);
  const registry = createResendEmailProviderRegistry(env);
  return async (mail) => {
    const result: EmailDeliveryResult = await adapter.send(
      {
        notification: {
          id: mail.id,
          tenantRef: mail.tenantRef,
          recipientRef: mail.recipientRef,
          audienceKind: "user",
          category: mail.category,
          subject: mail.subject,
          body: mail.body,
          actionRef: null,
          state: "queued",
          createdAt: clock.now().at,
        },
        recipientAddress: mail.to,
        subject: mail.subject,
        body: mail.body,
      },
      registry,
    );
    // Codes only: the provider's own wording can echo an address.
    return isEmailDeliveryReceipt(result)
      ? { ok: true, providerMessageId: result.providerMessageId ?? null }
      : { ok: false, code: result.code };
  };
}

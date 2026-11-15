/**
 * Approval action map (ENGINE-08, ENGINE-11). Pure data, safe to import from the console.
 */
import type { JarvisRiskActionId } from "../jarvis/risk-policy";

/**
 * Engine capability -> JARVIS risk-policy action. A capability is bridgeable only if
 * the JARVIS tier equals the capability tier (checked by `validateActionMap`).
 * `publish.social.post` has no JARVIS action yet and is deliberately absent.
 */
export const ACTION_MAP: Readonly<Record<string, JarvisRiskActionId>> = Object.freeze({
  "send.customer.message": "send_customer_communications",
  "request.refund": "spend_money",
  "request.deploy": "deploy_production",
  "request.access.grant": "invite_privileged_staff",
  "send.reply": "send_customer_communications",
  "send.outreach": "send_customer_communications",
  "notify.tenants": "send_customer_communications",
  "send.data.notice": "send_customer_communications",
  "publish.status.update": "send_customer_communications",
  "send.checkin": "send_customer_communications",
  "send.payment.reminder": "send_customer_communications",
  "send.welcome.pack": "send_customer_communications",
  "notify.designated.lead": "send_customer_communications",
  "send.newsletter": "send_customer_communications",
  "send.legal.notice": "send_customer_communications",
  "schedule.maintenance": "change_platform_configuration",
  "quarantine.worker": "change_platform_configuration",
  "request.credential.rotation": "access_secrets",
});

/** Gated capabilities that deliberately have no JARVIS action yet (ENGINE-11, ADR-089). */
export const UNMAPPED_BY_DESIGN: readonly string[] = Object.freeze(["publish.social.post"]);

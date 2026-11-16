# JARVIS owner alerts: turning them on

Authority: AGENTS.md §§12, 17, 26, 31; ADR-082, ADR-087.
Origin: Claude Code agent, mission E-002 (JARVIS-LIVE-01, owner instruction of 2026-11-16)
Creator: Claude Code agent
Created: 2026-11-16

Status: Built and tested in code. The database migration is proposed, not applied. Nothing here sends a real message until every step below is done.

## What it does

Every five minutes a scheduled call runs one tick. The tick reads open security incidents and pending approvals, rates each S1 to S4, and records an alert. S1 and S2 alerts may be sent to the owner by phone call, WhatsApp, SMS and email, each with one link to `/console/alerts`. The owner acknowledges alerts and approves requests there; approving needs a passkey. A phone, WhatsApp, SMS or email can never approve anything.

## The three gates in front of a real message

A real message is sent only when all three are true:

1. **Mode is live and an authorization is recorded.** `owner_alert_settings.mode = 'live'` with an approval reference, an approver, the channels named, and an expiry in the future.
2. **The channel is switched on** in `owner_alert_channels`.
3. **The server has the destination and the provider's credentials.** Missing either one returns a code (`contact_not_configured` or `provider_not_configured`) and makes no network call.

The migration seeds all four channels on, mode `test`, and no authorization. In test mode every external channel writes a row marked `test_sink` and sends nothing.

## Steps (owner)

1. **Apply the migration** `database/proposals/JARVIS-LIVE-01_owner_alert_store.sql` as `20261116000100_sherivs_jarvis_live01_owner_alert_store`. Rollback is the `DROP TABLE` line at the foot of the file.
2. **Set `CRON_SECRET`** in the Vercel project (production) if it is not set already.
3. **Schedule** `GET https://<site>/api/public/cron/jarvis-tick` every 5 minutes with header `Authorization: Bearer <CRON_SECRET>` from the same scheduler as the other cron routes. Without the secret it returns 401; with `CRON_SECRET` unset it returns 503.
4. **Open `/console/alerts`.** In test mode you should see alerts for any open incident or pending approval, with delivery rows marked "test only, nothing was sent".
5. **Add the destinations** as server environment variables (never in code or the database):

   | Variable               | Value                                                        |
   | ---------------------- | ------------------------------------------------------------ |
   | `OWNER_ALERT_EMAIL`    | your email address                                           |
   | `OWNER_ALERT_PHONE`    | your phone number in international format, for SMS and voice |
   | `OWNER_ALERT_WHATSAPP` | your WhatsApp number in international format                 |

6. **Add the provider credentials**:

   | Channel       | Variables                                                                                                                                                              |
   | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | Email         | `RESEND_API_KEY`, `RESEND_FROM_ADDRESS` (a verified sending domain)                                                                                                    |
   | WhatsApp      | `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `OWNER_ALERT_WHATSAPP_TEMPLATE` (an approved template with one text parameter), optional `OWNER_ALERT_WHATSAPP_LANGUAGE` |
   | SMS and voice | `TWILIO_ACCOUNT_SID` with either `TWILIO_AUTH_TOKEN` or `TWILIO_API_KEY` and `TWILIO_API_SECRET`, and `TWILIO_FROM_NUMBER`                                             |

   WhatsApp only delivers a business-initiated message through an approved template, so a template is required.

7. **Go live** by recording your authorization. Use a short expiry and renew it, so a forgotten switch cannot stay open:

   ```sql
   UPDATE public.owner_alert_settings
      SET mode = 'live',
          live_approval_ref = 'owner-decision-<date>',
          live_approved_by = 'human:<your name>',
          live_channels = ARRAY['voice','whatsapp','sms','email'],
          live_expires_at = now() + interval '7 days',
          updated_at = now()
    WHERE singleton;
   ```

   To go back to test mode: `UPDATE public.owner_alert_settings SET mode = 'test' WHERE singleton;`

8. **Prove it** with one real alert before relying on it, and confirm each channel arrives.

## Stopping it

- **Pause JARVIS:** the tick does nothing while `is_agent_paused('jarvis-executive')` is true.
- **Suspend the identity:** `UPDATE public.platform_service_identities SET status = 'suspended' WHERE code = 'jarvis';` The tick reports `suspended` and does nothing.
- **Switch one channel off:** `UPDATE public.owner_alert_channels SET enabled = false WHERE channel = 'sms';`
- **Stop the scheduler** or unset `CRON_SECRET`; the route refuses to run.

## What this does not do

- It does not create JARVIS a password, a human login or a passkey. JARVIS acts as the service principal `svc:jarvis` with a short list of permissions and a denied list it can never hold (deciding an approval, reading secrets, moving money). Credentials for outside systems are issued by the owner into the connector vault.
- It does not make alert wording legally approved. See `docs/compliance/counsel-review-pack-jarvis-and-agents.md`.
- It does not send anything from the three agents (safeguarding, legal, compliance). They remain in shadow.

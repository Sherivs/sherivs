-- Rollback for JARVIS-LIVE-01 (20261116000100). Removes the owner-alert store and the service identities.
-- Export owner_alert_deliveries first: it is the record of what the owner was told, and when.
DROP TABLE IF EXISTS public.owner_alert_deliveries, public.owner_alerts,
  public.owner_alert_channels, public.owner_alert_settings, public.platform_service_identities;

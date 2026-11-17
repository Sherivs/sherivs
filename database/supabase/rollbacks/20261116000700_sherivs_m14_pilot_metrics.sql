-- M14 rollback is intentionally non-destructive: keep recorded aggregates and their history.
-- Disable the write/read entry points; the tables stay in place, read-only and tenant-isolated.
REVOKE EXECUTE ON FUNCTION
  public.pilot_metric_record(uuid,text,date,date,bigint,bigint),
  public.pilot_metric_capture_attendance(uuid,date,date),
  public.pilot_metrics_report(uuid,date,date)
  FROM authenticated, service_role;

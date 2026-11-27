-- Rollback for GRP-01. Drops links, thresholds, metric registry and group markers (their rows are lost).
DELETE FROM public.wf_event_source WHERE event_type IN ('schedule.weekly', 'schedule.month_end', 'group.kpi_below_threshold');
DROP FUNCTION IF EXISTS public.wf_group_event_scan(timestamptz), public.org_group_threshold_set(uuid, text, bigint),
  public.org_group_aggregate(uuid, text), public.org_links_list(uuid), public.org_link_end(uuid), public.org_link_accept(uuid),
  public.org_link_propose(uuid, uuid), public.org_metric_register(text, text, text), public.org_group_root_mark(uuid, text);
DROP TABLE IF EXISTS public.org_group_threshold, public.org_metric, public.org_link, public.org_group_root;
DROP FUNCTION IF EXISTS public.org_link_guard();

-- GRP-01 (ADR-143 B, ADR-154): the group-level organisation. NOT APPLIED. Founder approval and a backup are required first.
-- A group is its own organisation. It holds no campus records. It sees each linked campus only through registered count
-- metrics, with counts of 1 to 4 suppressed and no total when any campus is suppressed. A campus link exists only after
-- the campus's own administrator accepts it, and either side can end it. Also emits the three scheduled group events.

CREATE TABLE public.org_group_root (
  org_id     uuid PRIMARY KEY REFERENCES public.schools (id) ON DELETE CASCADE,
  label      text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 120),
  marked_by  uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.org_link (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_org    uuid NOT NULL REFERENCES public.org_group_root (org_id) ON DELETE CASCADE,
  campus_org   uuid NOT NULL REFERENCES public.schools (id) ON DELETE CASCADE,
  proposed_by  uuid NOT NULL,
  proposed_at  timestamptz NOT NULL DEFAULT now(),
  accepted_by  uuid,
  accepted_at  timestamptz,
  ended_by     uuid,
  ended_at     timestamptz,
  CONSTRAINT org_link_not_self CHECK (group_org <> campus_org),
  CONSTRAINT org_link_accept_shape CHECK ((accepted_by IS NULL) = (accepted_at IS NULL)),
  CONSTRAINT org_link_end_after_accept CHECK (ended_at IS NULL OR ended_by IS NOT NULL)
);
-- One live link per pair; a campus may belong to one group at a time.
CREATE UNIQUE INDEX org_link_one_live_per_campus ON public.org_link (campus_org) WHERE ended_at IS NULL;
CREATE INDEX org_link_group_idx ON public.org_link (group_org) WHERE ended_at IS NULL;

-- Count metrics a group may ask of a campus. The function must be public.org_metric_*(uuid) returning bigint.
CREATE TABLE public.org_metric (
  code       text PRIMARY KEY CHECK (code ~ '^[a-z][a-z0-9_]{1,40}$'),
  label      text NOT NULL CHECK (length(btrim(label)) BETWEEN 1 AND 120),
  fn         text NOT NULL CHECK (fn ~ '^public\.org_metric_[a-z0-9_]{1,40}$'),
  enabled    boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- A threshold below which a campus raises an event. At least 5, so an event can never reveal a suppressed count.
CREATE TABLE public.org_group_threshold (
  group_org  uuid NOT NULL REFERENCES public.org_group_root (org_id) ON DELETE CASCADE,
  metric     text NOT NULL REFERENCES public.org_metric (code) ON DELETE CASCADE,
  below      bigint NOT NULL CHECK (below >= 5),
  set_by     uuid,
  PRIMARY KEY (group_org, metric)
);

CREATE FUNCTION public.org_link_guard() RETURNS trigger LANGUAGE plpgsql SECURITY INVOKER SET search_path = ''
AS $$
BEGIN
  IF TG_OP IN ('DELETE', 'TRUNCATE') THEN RAISE EXCEPTION 'org_link is never deleted' USING ERRCODE = '42501'; END IF;
  IF (NEW.id, NEW.group_org, NEW.campus_org, NEW.proposed_by, NEW.proposed_at)
     IS DISTINCT FROM (OLD.id, OLD.group_org, OLD.campus_org, OLD.proposed_by, OLD.proposed_at)
     OR (OLD.accepted_at IS NOT NULL AND NEW.accepted_at IS DISTINCT FROM OLD.accepted_at)
     OR (OLD.ended_at IS NOT NULL AND NEW.ended_at IS DISTINCT FROM OLD.ended_at) THEN
    RAISE EXCEPTION 'org_link: only acceptance and ending can be recorded, once' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER org_link_no_edit BEFORE UPDATE OR DELETE ON public.org_link
  FOR EACH ROW EXECUTE FUNCTION public.org_link_guard();
CREATE TRIGGER org_link_no_truncate BEFORE TRUNCATE ON public.org_link
  FOR EACH STATEMENT EXECUTE FUNCTION public.org_link_guard();

ALTER TABLE public.org_group_root ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_group_root FORCE ROW LEVEL SECURITY;
ALTER TABLE public.org_link ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_link FORCE ROW LEVEL SECURITY;
ALTER TABLE public.org_metric ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_metric FORCE ROW LEVEL SECURITY;
ALTER TABLE public.org_group_threshold ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_group_threshold FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.org_group_root, public.org_link, public.org_metric, public.org_group_threshold
  FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON public.org_group_root, public.org_link, public.org_metric, public.org_group_threshold TO service_role;
CREATE POLICY org_group_root_service_read ON public.org_group_root FOR SELECT TO service_role USING (true);
CREATE POLICY org_link_service_read ON public.org_link FOR SELECT TO service_role USING (true);
CREATE POLICY org_metric_service_read ON public.org_metric FOR SELECT TO service_role USING (true);
CREATE POLICY org_group_threshold_service_read ON public.org_group_threshold FOR SELECT TO service_role USING (true);

-- Platform setup: mark an existing organisation as a group, and register metrics.
CREATE FUNCTION public.org_group_root_mark(p_org uuid, p_label text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.is_super_admin(), false) THEN
    RAISE EXCEPTION 'group:platform_admin_only' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.org_group_root (org_id, label, marked_by) VALUES (p_org, p_label, auth.uid());
END $$;

CREATE FUNCTION public.org_metric_register(p_code text, p_label text, p_fn text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_proc regprocedure;
BEGIN
  IF auth.uid() IS NULL OR NOT coalesce(public.is_super_admin(), false) THEN
    RAISE EXCEPTION 'group:platform_admin_only' USING ERRCODE = '42501';
  END IF;
  v_proc := to_regprocedure(p_fn || '(uuid)');
  IF v_proc IS NULL OR (SELECT prorettype FROM pg_proc WHERE oid = v_proc) <> 'bigint'::regtype THEN
    RAISE EXCEPTION 'group:metric_function_must_return_bigint' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.org_metric (code, label, fn) VALUES (p_code, p_label, p_fn);
END $$;

-- Links: the group's administrator proposes, the campus's own administrator (never a platform admin) accepts.
CREATE FUNCTION public.org_link_propose(p_group uuid, p_campus uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_id uuid;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_administer_org(p_group)
     OR NOT EXISTS (SELECT 1 FROM public.org_group_root WHERE org_id = p_group) THEN
    RAISE EXCEPTION 'group:group_administrator_only' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.org_link (group_org, campus_org, proposed_by) VALUES (p_group, p_campus, auth.uid()) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

CREATE FUNCTION public.org_link_accept(p_link uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE l public.org_link;
BEGIN
  SELECT * INTO l FROM public.org_link WHERE id = p_link FOR UPDATE;
  IF l.id IS NULL OR auth.uid() IS NULL OR coalesce(public.is_super_admin(), false)
     OR NOT public.can_administer_org(l.campus_org) THEN
    RAISE EXCEPTION 'group:campus_administrator_only' USING ERRCODE = '42501';
  END IF;
  IF l.accepted_at IS NOT NULL OR l.ended_at IS NOT NULL THEN
    RAISE EXCEPTION 'group:link_not_open' USING ERRCODE = '42501';
  END IF;
  UPDATE public.org_link SET accepted_by = auth.uid(), accepted_at = now() WHERE id = p_link;
END $$;

-- Either side ends a link; sharing stops from that moment.
CREATE FUNCTION public.org_link_end(p_link uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE l public.org_link;
BEGIN
  SELECT * INTO l FROM public.org_link WHERE id = p_link FOR UPDATE;
  IF l.id IS NULL OR auth.uid() IS NULL
     OR NOT (public.can_administer_org(l.campus_org) OR public.can_administer_org(l.group_org)) THEN
    RAISE EXCEPTION 'group:not_allowed' USING ERRCODE = '42501';
  END IF;
  IF l.ended_at IS NOT NULL THEN RETURN; END IF;
  UPDATE public.org_link SET ended_by = auth.uid(), ended_at = now() WHERE id = p_link;
END $$;

CREATE FUNCTION public.org_links_list(p_org uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_administer_org(p_org) THEN
    RAISE EXCEPTION 'group:not_allowed' USING ERRCODE = '42501';
  END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id', l.id, 'group_org', l.group_org, 'campus_org', l.campus_org,
      'state', CASE WHEN l.ended_at IS NOT NULL THEN 'ended' WHEN l.accepted_at IS NOT NULL THEN 'accepted' ELSE 'proposed' END,
      'proposed_at', l.proposed_at, 'accepted_at', l.accepted_at, 'ended_at', l.ended_at) ORDER BY l.proposed_at DESC)
    FROM public.org_link l WHERE l.group_org = p_org OR l.campus_org = p_org), '[]'::jsonb);
END $$;

-- The aggregate layer. Counts only; 1 to 4 suppressed; no total when any campus is suppressed (no differencing).
CREATE FUNCTION public.org_group_aggregate(p_group uuid, p_metric text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  m public.org_metric; l record; v bigint; v_rows jsonb := '[]'::jsonb; v_total bigint := 0; v_suppressed boolean := false;
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_administer_org(p_group)
     OR NOT EXISTS (SELECT 1 FROM public.org_group_root WHERE org_id = p_group) THEN
    RAISE EXCEPTION 'group:group_administrator_only' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO m FROM public.org_metric WHERE code = p_metric AND enabled;
  IF m.code IS NULL THEN RAISE EXCEPTION 'group:unknown_metric' USING ERRCODE = '22023'; END IF;
  FOR l IN SELECT campus_org FROM public.org_link WHERE group_org = p_group AND accepted_at IS NOT NULL AND ended_at IS NULL
            ORDER BY campus_org LOOP
    EXECUTE format('SELECT %s($1)', m.fn) INTO v USING l.campus_org;
    v := coalesce(v, 0);
    v_total := v_total + v;
    IF v BETWEEN 1 AND 4 THEN v_suppressed := true; END IF;
    v_rows := v_rows || jsonb_build_object('campus_org', l.campus_org,
      'count', CASE WHEN v BETWEEN 1 AND 4 THEN NULL ELSE v END, 'suppressed', v BETWEEN 1 AND 4);
  END LOOP;
  RETURN jsonb_build_object('metric', m.code, 'campuses', v_rows,
    'total', CASE WHEN v_suppressed OR v_total BETWEEN 1 AND 4 THEN NULL ELSE v_total END,
    'total_suppressed', v_suppressed OR v_total BETWEEN 1 AND 4);
END $$;

CREATE FUNCTION public.org_group_threshold_set(p_group uuid, p_metric text, p_below bigint)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT public.can_administer_org(p_group)
     OR NOT EXISTS (SELECT 1 FROM public.org_group_root WHERE org_id = p_group) THEN
    RAISE EXCEPTION 'group:group_administrator_only' USING ERRCODE = '42501';
  END IF;
  INSERT INTO public.org_group_threshold (group_org, metric, below, set_by) VALUES (p_group, p_metric, p_below, auth.uid())
  ON CONFLICT (group_org, metric) DO UPDATE SET below = EXCLUDED.below, set_by = EXCLUDED.set_by;
END $$;

-- Events for the group workflows that need no campus feature: weekly brief, month-end summary, KPI below threshold.
INSERT INTO public.wf_event_source (event_type, domain, source_table, description, payload_keys) VALUES
  ('schedule.weekly', 'group', 'org_link', 'It is Monday 08:00 in Lagos and a group has linked campuses.', ARRAY['campuses', 'week']),
  ('schedule.month_end', 'group', 'org_link', 'It is the last day of the month, 08:00 in Lagos, for a group with linked campuses.', ARRAY['campuses', 'month']),
  ('group.kpi_below_threshold', 'group', 'org_group_threshold', 'A campus count fell below the threshold its group set.', ARRAY['campus_org', 'metric', 'threshold'])
ON CONFLICT (event_type) DO NOTHING;

CREATE FUNCTION public.wf_group_event_scan(p_now timestamptz DEFAULT now())
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  g record; t record; l record; m public.org_metric; v bigint;
  v_local timestamp := p_now AT TIME ZONE 'Africa/Lagos';
  v_day date := (p_now AT TIME ZONE 'Africa/Lagos')::date;
  v_n integer;
  v_weekly integer := 0; v_month integer := 0; v_kpi integer := 0;
BEGIN
  FOR g IN SELECT r.org_id, count(l2.id)::integer AS campuses
             FROM public.org_group_root r
             JOIN public.org_link l2 ON l2.group_org = r.org_id AND l2.accepted_at IS NOT NULL AND l2.ended_at IS NULL
            GROUP BY r.org_id LOOP
    -- 08:00 to 20:00 Lagos on the day: the dedupe key makes a late or repeated scan harmless.
    IF extract(hour FROM v_local) >= 8 THEN
      IF extract(isodow FROM v_local) = 1 THEN
        PERFORM public.wf_emit_event(g.org_id, 'schedule.weekly', 'org_link',
          'group.weekly:' || g.org_id::text || ':' || to_char(v_day, 'IYYY-"W"IW'), g.org_id::text,
          jsonb_build_object('campuses', g.campuses, 'week', to_char(v_day, 'IYYY-"W"IW')));
        v_weekly := v_weekly + 1;
      END IF;
      IF (v_day + 1) = date_trunc('month', v_day + 1)::date THEN
        PERFORM public.wf_emit_event(g.org_id, 'schedule.month_end', 'org_link',
          'group.month_end:' || g.org_id::text || ':' || to_char(v_day, 'YYYY-MM'), g.org_id::text,
          jsonb_build_object('campuses', g.campuses, 'month', to_char(v_day, 'YYYY-MM')));
        v_month := v_month + 1;
      END IF;
    END IF;
  END LOOP;
  -- KPI: one event per campus, metric and day, only when the true value is below the threshold. The payload carries
  -- no count, and thresholds are at least 5, so a suppressed count is never revealed.
  FOR t IN SELECT * FROM public.org_group_threshold LOOP
    SELECT * INTO m FROM public.org_metric WHERE code = t.metric AND enabled;
    CONTINUE WHEN m.code IS NULL;
    FOR l IN SELECT campus_org FROM public.org_link WHERE group_org = t.group_org AND accepted_at IS NOT NULL AND ended_at IS NULL LOOP
      EXECUTE format('SELECT %s($1)', m.fn) INTO v USING l.campus_org;
      IF coalesce(v, 0) < t.below THEN
        PERFORM public.wf_emit_event(t.group_org, 'group.kpi_below_threshold', 'org_group_threshold',
          'group.kpi:' || t.group_org::text || ':' || l.campus_org::text || ':' || t.metric || ':' || to_char(v_day, 'YYYY-MM-DD'),
          l.campus_org::text, jsonb_build_object('campus_org', l.campus_org, 'metric', t.metric, 'threshold', t.below));
        v_kpi := v_kpi + 1;
      END IF;
    END LOOP;
  END LOOP;
  RETURN jsonb_build_object('weekly', v_weekly, 'month_end', v_month, 'kpi_candidates', v_kpi);
END $$;

REVOKE ALL ON FUNCTION public.org_link_guard(), public.wf_group_event_scan(timestamptz) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.wf_group_event_scan(timestamptz) TO service_role;
REVOKE ALL ON FUNCTION public.org_group_root_mark(uuid, text), public.org_metric_register(text, text, text),
  public.org_link_propose(uuid, uuid), public.org_link_accept(uuid), public.org_link_end(uuid), public.org_links_list(uuid),
  public.org_group_aggregate(uuid, text), public.org_group_threshold_set(uuid, text, bigint) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.org_group_root_mark(uuid, text), public.org_metric_register(text, text, text),
  public.org_link_propose(uuid, uuid), public.org_link_accept(uuid), public.org_link_end(uuid), public.org_links_list(uuid),
  public.org_group_aggregate(uuid, text), public.org_group_threshold_set(uuid, text, bigint) TO authenticated;

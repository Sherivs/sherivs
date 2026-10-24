-- >>> generated ux2 by tools/workspace/catalog_src.py (do not hand-edit) >>>
UPDATE public.workspace_item_catalog c SET scope_dims = '{}', policy = NULL WHERE cardinality(c.scope_dims) > 0 OR c.policy IS NOT NULL;
UPDATE public.workspace_item_catalog c SET scope_dims = v.d, policy = v.p FROM (VALUES
  ('nav.my_results',ARRAY[]::text[],'students.results_online'),
  ('nav.ai_tutor',ARRAY[]::text[],'students.ai_tutor'),
  ('w.child_fees',ARRAY[]::text[],'parents.fees_online'),
  ('w.child_bus',ARRAY[]::text[],'parents.bus_tracking'),
  ('w.my_results',ARRAY[]::text[],'students.results_online'),
  ('w.ai_tutor',ARRAY[]::text[],'students.ai_tutor'),
  ('w.ai_lesson_helper',ARRAY[]::text[],'staff.ai_helper'),
  ('w.campus_overview',ARRAY['campus']::text[],NULL),
  ('w.shift_overview',ARRAY['shift']::text[],NULL),
  ('w.section_overview',ARRAY['section']::text[],NULL),
  ('w.level_overview',ARRAY['level','class','subject']::text[],NULL),
  ('w.house_overview',ARRAY['house','hostel']::text[],NULL),
  ('a.message_parents',ARRAY[]::text[],'staff.message_parents'),
  ('a.pay_fees',ARRAY[]::text[],'parents.fees_online'),
  ('a.ask_tutor',ARRAY[]::text[],'students.ai_tutor')
) v(k, d, p) WHERE c.key = v.k;
INSERT INTO public.workspace_policy_catalog (key, default_on, label_en, sort) VALUES
  ('workspace.personalise',true,'Staff, parents and students can personalise their home screen',0),
  ('students.ai_tutor',true,'Students can use the AI tutor',1),
  ('students.results_online',true,'Students see their results in the app once published',2),
  ('staff.ai_helper',true,'Teachers can use the AI lesson helper',3),
  ('staff.message_parents',true,'Teachers can message parents of their classes',4),
  ('parents.fees_online',true,'Parents see fees due and can pay in the app',5),
  ('parents.bus_tracking',true,'Parents can see live school bus location',6)
ON CONFLICT (key) DO UPDATE SET default_on=EXCLUDED.default_on, label_en=EXCLUDED.label_en, sort=EXCLUDED.sort;
-- <<< generated ux2 <<<

-- Rollback SHERIVS-A06
DROP FUNCTION IF EXISTS public.pickup_verify(uuid, text, text, uuid), public.custody_order_revoke(uuid),
  public.custody_order_add(uuid, text, text, uuid, text, text, date), public.guardian_rights_set(uuid, uuid, boolean, boolean),
  public.transfer_in_claim(text), public.transfer_cancel(uuid), public.transfer_out_issue(uuid, text, text, boolean),
  public.student_move_class(uuid, uuid, text), public._a06_student(uuid, text), public._a06_phone(text);
DROP TABLE IF EXISTS public.pickup_events, public.custody_orders, public.student_transfers, public.student_class_history;
ALTER TABLE public.parent_student_map DROP COLUMN IF EXISTS can_pickup, DROP COLUMN IF EXISTS has_custody;

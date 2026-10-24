-- Rollback SHERIVS-020. Drops message log, PIN cards and transcript requests; export first. Audit rows stay.
BEGIN;
DROP FUNCTION IF EXISTS public.admissions_funnel(uuid, text);
DROP FUNCTION IF EXISTS public.admissions_enroll(uuid, text, uuid);
DROP FUNCTION IF EXISTS public.admissions_record_acceptance(uuid, text);
DROP FUNCTION IF EXISTS public.admissions_offer(uuid, numeric, timestamptz, text);
DROP FUNCTION IF EXISTS public.admissions_interview(uuid, timestamptz, text);
DROP FUNCTION IF EXISTS public.admissions_record_score(uuid, numeric);
DROP FUNCTION IF EXISTS public.admissions_schedule_exam(uuid, timestamptz);
DROP FUNCTION IF EXISTS public._adm_move(uuid, text[], text, text, jsonb);
DROP TABLE IF EXISTS public.admission_stage_events;
ALTER TABLE public.admission_applications DROP COLUMN IF EXISTS acceptance_reference, DROP COLUMN IF EXISTS acceptance_fee_paid_at, DROP COLUMN IF EXISTS acceptance_fee,
  DROP COLUMN IF EXISTS offer_expires_at, DROP COLUMN IF EXISTS offered_by, DROP COLUMN IF EXISTS offer_letter, DROP COLUMN IF EXISTS scored_by,
  DROP COLUMN IF EXISTS entrance_exam_score, DROP COLUMN IF EXISTS entrance_exam_at, DROP COLUMN IF EXISTS stage;
DROP FUNCTION IF EXISTS public.verify_transcript(text);
DROP FUNCTION IF EXISTS public.issue_transcript(uuid, boolean);
DROP FUNCTION IF EXISTS public.request_transcript(uuid, uuid, text, int, text);
DROP TABLE IF EXISTS public.transcript_requests;
DROP FUNCTION IF EXISTS public.check_result(text, text, text);
DROP FUNCTION IF EXISTS public.generate_result_pins(uuid, text, text, int, int);
DROP TABLE IF EXISTS public.result_pins, public.result_pin_batches;
DROP FUNCTION IF EXISTS public.comms_inbound(uuid, text, text, text, text);
DROP FUNCTION IF EXISTS public.comms_delivery_receipt(uuid, text, text);
DROP FUNCTION IF EXISTS public.comms_send(uuid, text, text, text, jsonb, uuid, text, text, text);
DROP FUNCTION IF EXISTS public.comms_set_optin(uuid, text, text, text, text);
DROP FUNCTION IF EXISTS public.comms_render(text, jsonb);
DROP TABLE IF EXISTS public.comms_sender_numbers, public.inbound_messages, public.outbound_messages, public.comms_optins, public.comms_templates;
COMMIT;

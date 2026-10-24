-- Rollback SHERIVS-022. Drops only objects added by 022; restores the original consent purposes (rows using new purposes are removed first).
BEGIN;
DROP FUNCTION IF EXISTS public.offline_attendance_sync(text, jsonb), public.biometric_checkin(uuid, uuid, numeric), public.staff_biometric_consent(boolean),
  public.staff_qr_checkin(text, numeric, numeric), public.qr_attendance_token(uuid, int), public.geo_distance_m(numeric, numeric, numeric, numeric),
  public.cbt_submit(uuid, jsonb, int, timestamptz), public.cbt_sync(uuid, jsonb, int, timestamptz), public._cbt_attempt_mine(uuid), public.cbt_start(uuid),
  public.cbt_test_create(uuid, text, uuid, int, timestamptz, timestamptz, uuid[], int), public.cbt_question_add(uuid, text, text, jsonb, int, numeric), public.cbt_question_list(uuid, text),
  public.malpractice_decide(uuid, text, text), public.malpractice_report(uuid, uuid, text), public.exam_assign_invigilator(uuid, uuid, text), public.exam_generate_seating(uuid),
  public.exam_paper_add(uuid, uuid, text, timestamptz, timestamptz, text), public.exam_session_create(uuid, text, text, text, date, date), public._paper_school(uuid);
DROP TABLE IF EXISTS public.offline_sync_batches, public.attendance_check_ins, public.attendance_devices, public.staff_biometric_consents,
  public.cbt_attempts, public.cbt_tests, public.cbt_questions, public.malpractice_cases, public.exam_invigilators, public.exam_seating, public.exam_papers, public.exam_sessions;
DELETE FROM public.consent_records WHERE purpose IN ('biometric_attendance','location_attendance');
ALTER TABLE public.consent_records DROP CONSTRAINT IF EXISTS consent_records_purpose_check;
ALTER TABLE public.consent_records ADD CONSTRAINT consent_records_purpose_check CHECK (purpose IN ('core_education','photos_media','ai_processing','messaging_sms_whatsapp'));
COMMIT;

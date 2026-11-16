-- Published packs are immutable and undeletable; the guard allows only published -> retired.
BEGIN;
DELETE FROM public.platform_staff_roles WHERE role_code='platform_admin' AND staff_id=(SELECT id FROM public.super_admins WHERE is_active LIMIT 1);
DELETE FROM public.platform_staff WHERE id=(SELECT id FROM public.super_admins WHERE is_active LIMIT 1);
UPDATE public.cg_role_pack SET status='retired' WHERE version='1.0.0' AND status='published';
COMMIT;
-- Twin person/context rows created by the engine are kept (append-style); retire via the engine if needed.

# M9 part B: online refund second-person approval

Status: built (database), draft PR, NOT APPLIED. ADR-155.

- Migration `20261127000500_sherivs_m9b_online_refund_approval.sql` and rollback. Harness 20 checks pass. Registered in verify.yml.
- Remaining M9 part B: two cash paths, bursar and payroll screens, relief revocation, levies, Paystack posting into M07. Some functions exist (`fee_relief_revoke`, `fee_levy_create`, `cg_fee_post_relief`) and need a read before scoping.
- Needs: founder approval and backup before apply; Tumi's review.

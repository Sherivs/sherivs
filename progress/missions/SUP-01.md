# SUP-01: support access

Status: built (database), draft PR, NOT APPLIED. ADR-153 (from ADR-143 A).

- Migration `20261127000200_sherivs_sup01_support_access.sql`, rollback alongside. Tables `support_access_grant`, `support_access_audit`; eight functions.
- Harness `tests/integration/sup01-support-access.local.sql`: 48 checks pass on a scratch PostgreSQL 16 with the full migration chain.
- TypeScript: `supportWriteDigest` (matches SQL).
- Not built: screens; content-reading tools calling `support_access_log`; notices; retention purge.
- Needs: founder approval and backup before any apply; Tumi's review and the three open questions in ADR-153.

# Proposed SQL — not an apply path

These files are **review artifacts** for SHERIVS-RLS-IMPLEMENTATION-PREP-001.

They MUST NOT be copied into `database/supabase/migrations/` until a later
implementation mission is explicitly authorized, independently reviewed, and
applied to **staging first**.

`scripts/db-apply.mjs` and `scripts/db-apply-one.mjs` only read
`database/supabase/migrations/*.sql`. The `.sql.proposed` suffix is
intentional so those runners cannot pick these files up.

Production apply is GATE 6. This directory is not GATE 6.

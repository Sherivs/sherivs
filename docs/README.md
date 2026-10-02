# Docs

Documentation for CoreGrid Scholar.

- `stack.md` - verified technology stack
- `architecture/` - system overview, frontend, backend, database,
  multi-tenancy, AI, security, testing, observability, migration roadmap
- `migration-audit.md` - pre-migration audit (current architecture,
  technologies, risks, plan)
- `product-spec.md` - archived School OS-era product specification

Repository governance lives in the seven top-level control documents
(`CONSTITUTION.md`, `PRINCIPLES.md`, `REGISTRY.md`, `DEPENDENCY.md`,
`BOUNDARIES.md`, `DECISIONS.md`, `PROGRESS.md`).

Canonical architecture evidence (post-hardening, 2026-10-02):

- `architecture/proofs/` - machine-readable proof records, including
  `role-assignment-substrate.proof.json` (live-database substrate
  verification, 59/59), `CANONICAL_APPLY_RECORD_HARDENING.json` (9
  migrations verified, 0 findings), and phase acceptance proofs
- `architecture/coregrid-mvp-architecture/` - V1 MVP architecture, ADRs
  (including `adr/ADR-005_RETENTION_VS_IMMUTABLE_AUDIT.md`), the retention
  policy schedule (`RETENTION_POLICY_SCHEDULE.json` / `.md`), and
  ratification runbooks (`ratification/RLS_ISOLATION_BATTERY.md`, 36/36
  dual posture)
- `remaining-work.md` - tracks the open items from the 2026-10-02
  hardening waves

Top-level deliverables from the migration:

- `migration-report.md` - changes made during the migration
- `architecture-map.md` - current system to CoreGrid Scholar mapping
- `remaining-work.md` - future implementation roadmap

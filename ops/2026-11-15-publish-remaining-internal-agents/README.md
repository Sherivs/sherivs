# Publish the remaining 18 internal agents (2026-11-15)

Applied to production at the founder's instruction ("build the remaining 18 internal agents").

1. Migration `20261115000700_sherivs_engine11_13_platform_roles` adds 18 non-privileged platform roles (ENGINE-11, ENGINE-13 proposals, unchanged).
2. `apply.sql` publishes the 18 packs, all starting in shadow. With the earlier 7, production now holds 25 platform packs (24 departments plus JARVIS) and 6 school-role packs.

What this does not do: no agent runs. A department agent binds to a staff member who holds its role, and only the founder (platform_admin, no agent) exists. Go-live gates that remain are listed in the session report: staff or service identities, a runtime and scheduler, live connectors, evaluation suites, applying the workspace-scope proposal, and counsel review of the safeguarding, legal and compliance wording (ADR-091).

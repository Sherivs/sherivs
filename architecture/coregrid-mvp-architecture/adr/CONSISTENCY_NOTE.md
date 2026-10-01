# Cross-ADR Consistency Note — MISSION-R-03 Bundle (ADR-002..005)

Status: PROPOSED (accompanies ADR-002..005; bundle queued for operator ruling)
Author: GOVERNANCE ADR AUTHOR (MISSION-R-03, task T4)
Date: 2026-10-01
Scope: ADR-002_TRUST_WIRING.md, ADR-003_GLOBAL_SHELL_OWNERSHIP.md, ADR-004_RELOCATION_TIMING.md, ADR-005_RETENTION_VS_IMMUTABLE_AUDIT.md (ADR-001 is authored by the parallel strategist and outside this bundle's pairwise check except where noted).

## Verdict

No ADR in this bundle contradicts another, the mission-graph freezeRule, or the Constitution. Each ADR's recommendation is mutually reinforcing; the pairwise checks below record the analysis.

## Pairwise checks

1. **ADR-004 (relocation) vs the neutrality-guard baseline (COND-005 / MISSION-R-05).** Consistent and mutually dependent: ADR-004 requires the guard baseline to be recorded BEFORE any module moves (Timing Option T-C), and requires M-R-121 to reduce the server-function baseline to exactly zero — the baseline is a ratchet that may only shrink. This is exactly the ordering STREAM H prescribed ("safest sequence is after the org-model + runtime-registry substrate is applied") and matches the mission graph's dependency edges (M-R-121 depends on M-R-03 and M-R-120). No ADR authorizes an increase to the baseline.

2. **ADR-003 (shell ownership) vs ADR-004 (namespace/import direction).** Consistent: ADR-003's platform-owned shell consumes ADR-004's namespace ruling (Control-Plane modules to `lib/platform/`, never a runtime namespace; AGENTS §14) and ADR-004's import-direction rule (shell routes import runtimes only via `installed-runtimes.ts` adapters) is the mechanism that makes ADR-003's "registry-only contribution" enforceable. Neither ADR claims ownership of the other's surface: ADR-003 rules *who owns the shell*; ADR-004 rules *where code lives and which way imports point*.

3. **ADR-004 vs ADR-002 (trust wiring).** No interaction conflict: the relocated server-function modules are domain runtime code; the phase 08/09 trust wiring touches the security engine and trust fabric, not the lib-root contamination set. The shared constraint — fail-closed, evidence-citing decisions — is unaffected by where Scholar server functions reside.

4. **ADR-005 (retention/erasure) vs AGENTS §28 and the bundle.** ADR-005 resolves the §19-vs-§28 collision by redaction-with-tombstone, preserving §28 literally (nothing immutable is mutated or deleted). It does not depend on ADR-002/003/004 outcomes. One coordination point is recorded, not contradicted: legacy Scholar durable tables holding biometric-class personal data are governed by COND-009 disposition, which ADR-004 explicitly leaves out of scope and ADR-005 explicitly flags as an input to its shred-class UNKNOWN. The two ADRs point at the same boundary without disagreeing about it.

5. **ADR-003 vs ADR-005.** Shell notifications/profile surfaces display personal data; ADR-003's rule that the shell is presentation-not-policy (AGENTS §34) and ADR-005's rule that erasure reaches reader/projection layers are compatible: the shell reads through the redaction layer like any other surface. No ADR grants the shell a raw-data exception.

6. **Bundle vs ADR-001 (parallel strategist, tenant_id type / mission-owner territory).** This bundle takes no position on tenant_id type (COND-003) or mission/memory ownership (COND-001/002). ADR-005 lists COND-003 as an input to its cross-tenant erasure UNKNOWN, deferring to — not contradicting — the ADR-001 territory.

## FreezeRule check

All four ADRs are artifact-only (no code, no migration, no policy change), reversible, low blast radius, and each leaves its implementing mission (M-R-83, M-R-111, M-R-121, V1CAP-066 contract) gated on the operator's acceptance — matching MISSION-R-03's `humanApprovalsRequired` list one-for-one.

## Residual cross-bundle UNKNOWN

The freshness bound for trust evidence (ADR-002) and the retention durations (ADR-005) are both operator-ratable numbers; neither ADR depends on the other's number.

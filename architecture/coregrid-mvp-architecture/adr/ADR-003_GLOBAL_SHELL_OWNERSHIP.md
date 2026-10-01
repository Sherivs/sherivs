# ADR-003: Global Application Shell Ownership (GAP-008)

| Field | Value |
|---|---|
| Status | PROPOSED (operator rules; see Mission MISSION-R-03 humanApprovalsRequired: "GAP-008 shell ownership ruling (COND-004)") |
| Date | 2026-10-01 |
| Author | GOVERNANCE ADR AUTHOR (MISSION-R-03, wave 1) |
| Mission | MISSION-R-03 (task T2, first half) |
| Capabilities | V1CAP-085 (global shell neutralization contract) |
| Blocks | MISSION-R-111 (shell implementation, wave 2) may not be scheduled until this ADR is accepted (COND-004) |
| Cites | STREAM J J-047 + Experience fabric evidence + GAP-008 unresolved entry; STREAM I I-025/I-026/I-027; STREAM G G-068 contradiction; COND-004 in COREGRID_V1_V2_SCOPE_LOCK.json; COND-005 (phase-15 split) for guard scoping; AGENTS §14, §33, §34 |

## Context

GAP-008 asks who owns the global application shell — navigation, org switcher, global search, notifications, profile. The corpus records a direct contradiction (STREAM J Experience fabric): STREAM G G-068 buckets the shell **V1-shaped** ("structurally necessary: it is how one human reaches every loop surface") while the Campaign-52 ledger records it **BLOCKED pending ownership review**. J-047 (major) states the capability cannot be scheduled by Step 5/6 while ownership is open; a ruling artifact is required. Existing phase 24 (experience) modules are candidate owners. COND-004 confirms: "phase 24 proposed (J-047). Gates scheduling of V1CAP-085 global shell work."

The shell is architecturally sensitive for one reason: it is the **only universal surface every tenant, runtime, and role touches on every request**. Whatever owns it sits at the junction of AGENTS §14 (the Control Plane is NOT a tenant), §34 (the UI is not security), and the domain-neutrality program (J-037 / V1CAP-067 / MISSION-R-05 CI guard). STREAM I already caught the failure mode this ADR must prevent: the universal platform landing (`routes/platform.tsx`, I-026) renders Scholar-specific data by importing a Scholar module directly; the universal runtime surface (`routes/_authenticated/runtime.tsx`, I-027) is wired exclusively to Scholar server functions; Control-Plane modules live under `lib/scholar/` (I-025). The shell is where contamination spreads if ownership is left implicit.

## Options

### Option 1 — Platform-owned shell

A single platform-level owner (phase 24, per the J-047 proposal) owns all shell chrome: navigation frame, org switcher, global search, notifications, profile. Runtimes are data to the shell — they register nav contributions, search providers, and notification sources through a neutral registry (the `INSTALLED_NAV_CONTRIBUTION_SETS` / `installed-runtimes.ts` mechanism STREAM I names as the correct abstraction), and the shell renders from that registry only. No runtime module is ever imported by the shell directly.

- **Consequences:** strongest domain-neutrality posture — the shell is guard-scoped universal surface with a single vocabulary (RuntimeNavKind per I-013); contamination regressions are mechanically detectable because every shell import is classifiable; the Control Plane (AGENTS §14) gets its surfaces from the same neutral mechanism rather than a runtime namespace. Cost: phase 24 carries a contract obligation to keep the registry abstraction honest as the second runtime lands; shell evolution is gated on one owner (a scheduling bottleneck, but a legible one).

### Option 2 — Runtime-injected shell

Each runtime owns and injects its own shell regions (its navigation, its search, its notifications). The platform provides only a mount point.

- **Consequences:** maximal runtime autonomy and the least platform code — but it breaks the product premise GAP-008 exists for: cross-runtime surfaces (org switcher spanning runtimes, global search across domains, one notification inbox) are either duplicated per runtime or impossible. It re-creates the I-027 contamination class by design: the universal chrome becomes whatever the first (Scholar) runtime injected. Security posture weakens: the shell is an authorization-relevant surface (what a user can reach), and AGENTS §34 makes frontend enforcement non-authoritative — scattering shell ownership across runtimes scatters the audit surface for access-presentation regressions. Rejected on architecture grounds.

### Option 3 — Hybrid: platform-owned chrome, runtime-injected content

Platform owns the frame (layout, session boundary, org switcher, notification inbox plumbing); runtimes contribute content (nav entries, search sources, notification renderers) via the registry, but some surfaces (per-runtime dashboards) remain runtime-rendered inside the frame.

- **Consequences:** preserves the product surfaces with less platform contract-writing than Option 1, but the platform/runtime boundary becomes a moving line — every new shell feature relitigates "frame or content?", which is precisely the ambiguity GAP-008 exists to close. The neutrality guard's scope would have to track that line, weakening the guard (see below).

## Recommendation

**Option 1 — platform-owned shell, owned by phase 24**, with runtime content admitted only through the neutral registry. This matches the J-047 proposal ("Existing implementations (24 experience modules) are candidate owners"), completes the I-026/I-027 corrections ("Scholar remains data; the shell must not import a Scholar module directly"), and gives the domain-neutrality guard a clean rule. Governing constraints for MISSION-R-111:

1. **Registry-only contribution**: shell surfaces resolve via neutral vocabulary only (`RuntimeNavKind`, installed-runtimes registry, workspace-core/projection per the MISSION-R-111 T1 contract); direct imports of runtime-domain modules from shell/platform routes are guard violations.
2. **Shell is presentation, not policy**: per AGENTS §34, shell visibility is not authorization; every shell-reachable surface is independently backend-enforced (server function rule, AGENTS §27).
3. **Control Plane is not a runtime**: control-plane shell surfaces follow ADR-004's namespace ruling (platform namespace), never a runtime namespace (AGENTS §14).

**Impact on the domain-neutrality guard:** the shell becomes fully guard-scoped universal surface. This is the load-bearing consequence of Option 1 — because nothing runtime-domain may be imported into the shell, the guard's lib-root/route token scan gets a stable, mechanical boundary, and the baseline recorded by MISSION-R-05 can only shrink, never grow, from shell work. Options 2/3 would force the guard to carry per-runtime shell exemptions (Option 2) or a litigated frame/content boundary (Option 3), both of which reintroduce a mutable baseline. MISSION-R-111's acceptance ("guard baseline unchanged-or-reduced") is only cleanly checkable under Option 1.

## Golden Questions

- **WHO?** Phase 24 (experience) owns the shell as platform infrastructure; runtimes contribute data via the registry; the operator rules ownership (COND-004).
- **WHAT?** Navigation, org switcher, global search, notifications, profile — all platform-owned, registry-fed, neutral-vocabulary.
- **WHERE?** Shell chrome at platform level (phase 24 modules); contributions registered by runtimes (Scholar first); guard scope extended to shell routes in MISSION-R-05's baseline.
- **WHY?** G-068 says the shell is structurally necessary for V1 (human entry to every loop node, Outcome -> Observation); GAP-008 blocks scheduling until ownership is ruled (COND-004).
- **UNDER WHICH POLICY?** AGENTS §14 (Control Plane not a tenant), §33 (design system: Tailwind/shadcn/Radix/Lucide only), §34 (UI is not security), §23 workflow; J-047; I-025/I-026/I-027 corrections; RULING-1 (education modules are runtime content, not platform).

## UNKNOWNs

- Exact neutral registry surface (`INSTALLED_NAV_CONTRIBUTION_SETS` evolution) needed for search and notifications — the corpus evidences the mechanism for nav (I-026/I-027 corrections) but not for global search or notification sources; MISSION-R-111 T1 authors that contract.
- Whether the shell needs a platform-level search index or fans out to per-runtime search providers — product decision the operator may attach to the COND-004 ruling.
- Interaction with COND-005 (phase-15 code-boundary split): the guard baseline this ADR assumes may need re-recording if the phase-15 split moves hardware-* sources; no shell surface depends on the split, so this ADR stands either way.
- Command centre (J-048, MISSION-R-110) renders inside the shell frame — its withdrawal/rebuild is governed by phase 19 ownership, not by this ADR; only the frame contract is ruled here.

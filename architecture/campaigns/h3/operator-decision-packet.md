# OPERATOR DECISION PACKET — H3 Wave (Squad J, J-098)

| Field | Value |
|---|---|
| Artifact | Operator decision packet for open recorded conditions COND-003, COND-004, COND-005, COND-006, COND-009, and ledger gap J-049 (mobile membership / COND-010) |
| Mission | H3-098 / J-098, Operator Decision Packet Engineer (Squad J — Governance & documentation) |
| Status | PROPOSED — this packet decides nothing by itself; every ruling below is an operator act recorded only when signed |
| Date | 2026-10-03 |
| Author | H3-098 (AI agent). Per AGENTS §7/§12 this packet is AI-generated provenance and is untrusted until an operator signature exists on each DECISION slot. |
| Authority | AGENTS.md §7 (AI sovereignty boundary — rulings are human), §21 (AI output trust), §38 (change management), §42 (report format); H3-WAVE-CAMPAIGN.md Squad J |
| Grounding | Every claim cites in-repo evidence read 2026-10-03. No database was accessed; no secret value is printed; the packet is authored read-only against the rest of the tree. |

---

## How to use this packet

Each item states: (1) the **decision needed**, (2) the **options considered** with honest trade-offs, (3) a **recommendation** grounded in the ruling dossiers already authored in-repo, and (4) an **empty DECISION slot**. A decision of `approved` adopts the recommendation; `declined` rejects it (the declined path's consequences are stated per item); `deferred` leaves the recorded condition open with no effect on campaign law. The ruling itself must be recorded by the operator/coordinator in the appropriate authority file (scope-lock conditions, ADR status fields, mission graph) — this packet does not edit those files.

---

## Item 1 — COND-003: canonical `tenant_id` type (text vs uuid)

**Authoritative sources located:** `COREGRID_V1_V2_SCOPE_LOCK.json` conditions[COND-003]; ruling dossier `architecture/coregrid-mvp-architecture/adr/ADR-001_TENANT_ID_TYPE.md` (PROPOSED, operator ruling pending via MISSION-R-02); the deferral recorded verbatim at `database/supabase/migrations/20261001000000_coregrid_v1_org_model.sql` lines 32–37 ("that decision is deferred to the operator").

**Decision needed:** Resolve the tenant-id type divergence deferred at migration `20261001000000`: either opaque `text` refs (`CHECK length 1..128`, the substrate-wide convention across 22 inventoried `cg_*` sites per ADR-001 §3.1) or `uuid` keyed to `cg_tenant(id)`. The ruling gates finalization of V1CAP-013 neutral tenant-membership primitives (J-005 / MISSION-R-20) and is consumed by ADR-008's cross-tenant erasure ruling and the Squad D posture adjudications (`cg_tool_runtime_tool.md`, `cg_tool_runtime_invocation.md` both defer tenant-scoped policies to this ruling).

**Options considered:**

- **Option A — `text` as canonical (recommended by ADR-001).** Zero churn to authored migrations; matches the shipped code contract (`TenantId` branded string, `frontend/src/lib/tenant-core.ts:93`); the uuid→text seam is already the established direction in applied SQL. Trade-offs: no declarative FK to `cg_tenant(id)` — mitigated by ADR-001's additive `cg_tenant_ref` bridge migration (RLS enabled, zero policies, privileges revoked); type asymmetry becomes permanent vocabulary; the deferral comment must be superseded when the ruling lands.
- **Option B — `uuid` as canonical.** Gains declarative FK integrity (the strongest argument for it). Trade-offs: rewrites ~7 authored migrations (14+ columns plus composite same-tenant FKs), silently invalidates the recorded disposable-dev live-verification evidence, couples the kernel's optional tenant scope tag to L2 row existence (Constitution Part 24 layering), and still requires a bridge because the legacy Scholar runtime keys on `schools.id uuid`, which is a different table with different provenance. ADR-001 §4.2 verdict: the FK benefit is achievable under A via the bridge; B's costs are immediate and structural.

**Recommendation:** **Approve Option A** — adopt `text` (opaque `tenant_ref`) as canonical, with the additive `cg_tenant_ref` bridge as a mandatory part of the ruling (ADR-001 §7 transition plan, forward-only, RLS never weakened).

**DECISION (operator):** ☐ approved ☐ declined ☐ deferred

- Signature: ______________________  Date: __________
- Ruling recorded at (coordinator fills): ______________________________________

---

## Item 2 — COND-004: global shell ownership (GAP-008 / J-047)

**Authoritative sources located:** `COREGRID_V1_V2_SCOPE_LOCK.json` conditions[COND-004]; resolution ADR `architecture/coregrid-mvp-architecture/adr/ADR-010_GLOBAL_SHELL_OWNERSHIP.md` (PROPOSED, 2026-10-02, "operator rules; resolves the COND-004 / GAP-008 ownership review"); predecessor dossier `ADR-003_GLOBAL_SHELL_OWNERSHIP.md` (PROPOSED, 2026-10-01); STREAM J J-047 and STREAM G G-068 contradiction as cited by both ADRs.

**Decision needed:** Rule who owns the global application shell — navigation, org/tenant switcher, global search, notifications, profile — the only universal surface every tenant, runtime, and role touches on every request. The ruling gates scheduling of V1CAP-085 global shell work and MISSION-R-111 (shell implementation, whose acceptance requires an unchanged-or-shrinking neutrality-guard baseline).

**Options considered:**

- **Option 1 — Platform layer owns the shell; runtimes compose INTO it (ruled by ADR-010).** Phase 24 (experience) as platform infrastructure; runtime content admitted only through neutral contribution contracts (nav contribution sets, search providers, switcher directory entries), all resolved server-side. Trade-offs: one legible owner and a mechanically checkable neutrality boundary (every shell import classifiable; baseline can only shrink); cost is a single-owner contract obligation and a scheduling bottleneck. File evidence in ADR-010 shows the substrate is already mostly this shape (data-driven sidebar, registry-fed nav, submit-resolve switcher); the known violations (composition-root Scholar imports, the domain-coupled ⌘K search palette) are named and put inside the guard's scope.
- **Option 2 — Runtime-owned shells (rejected by both ADRs).** Trade-offs: cross-runtime surfaces (one switcher, one search, one inbox) become duplicated or impossible; the first runtime to inject defines the chrome; scattering shell ownership scatters the audit surface for access-presentation regressions (AGENTS §34 — the UI is not security).
- **Option 3 — Hybrid frame/content split (rejected by both ADRs).** Trade-offs: the moving frame/content line is precisely the ambiguity GAP-008 exists to close and would force per-runtime guard exemptions, breaking the shrink-only ratchet.

**Recommendation:** **Approve Option 1** per ADR-010, including its three contribution surfaces (navigation, switcher, search fan-out) and the "compose INTO, never OWN" boundary. Note for the operator: ADR-010's UNKNOWNs list the items the ruling deliberately leaves open (composition-root Scholar-import relocation timeline, live search-provider wiring, multi-runtime notification sources) — approval closes ownership, not those work items.

**DECISION (operator):** ☐ approved ☐ declined ☐ deferred

- Signature: ______________________  Date: __________
- Ruling recorded at (coordinator fills): ______________________________________

---

## Item 3 — COND-005: phase-15 code-boundary split (hardware classification → physical split)

**Authoritative sources located:** `COREGRID_V1_V2_SCOPE_LOCK.json` conditions[COND-005]; `COREGRID_V1_MISSION_GRAPH.json` residual-risk note ("COND-005 phase-15 code-boundary split … scopes M-R-05's guard baseline but blocks no mission start"); `STREAM_F_PHASE_EXTRACTION.json` unresolved entry ("RULING-6 resolves classification, not the code split") and its phase-15 V2 bucketing under RULING-6 (`architecture/COREGRID_CTO_DIRECTIVE_RECONCILIATION.json#RULING-6-PHASE-15`); guard baseline `architecture/coregrid-mvp-architecture/NEUTRALITY_GUARD_BASELINE.json`.

**Decision needed:** The phase-15 (hardware integration) **classification** is resolved — RULING-6 quarantined hardware to V2 (CLASSIFY ONLY, DELETE NOTHING). What remains open is the **physical code split**: which implemented hardware-adjacent modules are organizational asset records (plain kernel entity data on the phase-33 substrate, V1) versus device/telemetry code (V2-frozen). The split scopes the domain-neutrality guard's coverage (V1CAP-067 / MISSION-R-05 baseline) but blocks no mission start.

**Options considered:**

- **Option 1 — Rule the split line now, on the classification already in force.** Adopt the STREAM F disposition as the code-level rule: asset-record residue is plain `cg_entity` data on the kernel substrate; device/edge/telemetry code is V2-frozen behind contract; the neutrality-guard baseline is re-recorded only where the split moves sources (shrink-only). Trade-offs: removes the last ambiguity from the guard's scope before more V1 surface lands; cost is an inventory pass over hardware-adjacent modules, and it must respect §39 (no destructive refactoring — quarantine semantics: classify, delete nothing).
- **Option 2 — Leave the split open until a concrete driver appears.** Trade-offs: zero immediate cost, but the guard baseline carries a known-unresolved boundary indefinitely, and every new hardware-adjacent file re-litigates the same question; the mission graph must keep carrying the residual-risk note.
- **Option 3 — Reopen the classification (decline RULING-6).** Trade-offs: contradicts the recorded CTO ruling and the V1/V2-only lock; rejected here as unsound — this packet treats RULING-6 as settled authority and does not offer a path to unbuckle it.

**Recommendation:** **Approve Option 1**, sequenced after the higher-gate items in this packet (it blocks nothing, so it can also be deferred without harm — but ruling it closes the mission graph's residual-risk entry). The inventory itself is engineering work the operator should assign (it is not this packet's, nor any single H3 team's, owned deliverable).

**DECISION (operator):** ☐ approved ☐ declined ☐ deferred

- Signature: ______________________  Date: __________
- Ruling recorded at (coordinator fills): ______________________________________

---

## Item 4 — COND-006: BLK secret family provisioning (BLK-2/3/4/5)

**Authoritative sources located:** `COREGRID_V1_V2_SCOPE_LOCK.json` conditions[COND-006] ("operational secret provisioning via Cursor Dashboard (RULING-11)"); RULING-11 enforcement evidence in `architecture/coregrid-mvp-architecture/security/THREAT_MITIGATIONS_LT.md` (L-T-008, ENFORCED: "secrets are provisioned only via the Cursor Dashboard (RULING-11/COND-006), never in repo"); `COREGRID_V1_MISSION_GRAPH.json` humanApprovalsRequired entries (BLK-2/COND-006 for AI inference, BLK-3/COND-006 for deploy credentials, BLK-4/COND-006 for payments live keys); `STREAM_H_IMPLEMENTATION_MAP.json` unverifiedImplementations (AI gateway live path never executed — BLK-2; payments live path — BLK-4; deploy never executed — BLK-3; email record-only by design — BLK-5); H3-wave drill runbooks already authored and credential-gated: `docs/runbooks/ai-gateway-live-drill.md`, `deployment-monitoring-gate.md`, `payment-rail-drill.md`, `communication-probe.md` (plus the webhook signature drill).

**Decision needed:** Whether and when to provision the four operational secret families via the Cursor Dashboard (Secrets): **BLK-2** AI provider key (gates V1CAP-027 live inference), **BLK-3** deploy credentials (gates V1CAP-076 first BYOC deploy execution), **BLK-4** payments key (gates live payment verification under V1CAP-079), **BLK-5** email provider (gates delivery evidence under V1CAP-081). Per the scope lock, these block **live-verification evidence only, not engineering or implementation**; a recorded blocker never authorizes a bypass, and each gated mission names fallback work.

**Options considered:**

- **Option 1 — Provision per-family, test-mode first, each gated mission scheduled behind its key (recommended).** Provision BLK-2 (AI, restricted-scope key) and BLK-4 (payments **test-mode** keys only — the H3 payment-rail drill refuses live keys by design) first; BLK-3 when a deploy window is approved (it also carries a separate production-deploy approval per the mission graph); BLK-5 when delivery evidence is next on the critical path. Trade-offs: converts four `blocked` launch-criteria verdicts toward `proven` with real evidence; cost is real credential exposure surface — mitigated by the existing enforced controls (secret-redacting logger, key-scrubbing gateway, secret scan in `npm run verify`, per-agent credential broker J-007) and by the drills' BLOCKED_NO_CREDENTIAL fail-closed semantics.
- **Option 2 — Provision nothing this cycle; keep all four criteria honestly `blocked`.** Trade-offs: zero new exposure, but the launch record cannot advance past live-verification for AI, deploy, payments, or email; the drills remain rehearsed-but-unexecuted. Acceptable only if the operator intends no launch evidence this cycle.
- **Option 3 — Provision live/elevated keys (e.g. payments live keys, unrestricted AI key) to "finish faster".** **Rejected — do not offer for approval.** It contradicts RULING-11's discipline, the webhook drill's test-mode law, and AGENTS §30/§36 (payments: signature validation, idempotency, replay protection before live charges). Declining item 4 entirely is safer than this path.

**Recommendation:** **Approve Option 1**, family by family, with BLK-4 strictly test-mode and every provisioning act done via Cursor Dashboard Secrets (never committed, never printed). Each family may be approved or withheld independently — a partial decision is valid.

**DECISION (operator):** ☐ approved ☐ declined ☐ deferred

- Signature: ______________________  Date: __________
- Families approved (circle/annotate): BLK-2 / BLK-3 / BLK-4 (test-mode only) / BLK-5
- Ruling recorded at (coordinator fills): ______________________________________

---

## Item 5 — COND-009: legacy Scholar durable-tables disposition

**Authoritative sources located:** `COREGRID_V1_V2_SCOPE_LOCK.json` conditions[COND-009]; `STREAM_H_IMPLEMENTATION_MAP.json` `orphans[]` (durable-state orphans: public.hostel_*, library_*, discipline_records, clinic_visits, school_sports, school_meals, school_transport/transport_buses, school_ad_campaigns, admission_applications, staff_payroll/staff_leave, school_api_keys, teacher_biometrics, school_geofence, attendance_verification_log, study_sessions — "No REQUIREMENT → OWNER → CONTRACT chain exists… several duplicate concepts the cg_* substrate now owns") and the code orphans (audit.ts `schoolId` typing, subscription-tiers.ts, geofence.ts, messages-unread.ts/news-reads.ts, demo-provision.functions.ts, kernel-admin-client.ts); `COREGRID_V1_MISSION_GRAPH.json` residual-risk note ("retirement of orphan tables is a governance event requiring a ruling"); `ADR-009_CRYPTO_SHRED_DESIGNATION.md` (consumes COND-009's outcome through trigger T-1; survey found `teacher_biometrics` created twice by two orphan duplicate migrations) and `ADR-011_BACKUP_EXPIRY_DISCIPLINE.md` (biometric material persists in backups until expiry under tombstone-only erasure — the sharpest residual risk tied to this disposition); J-044 reconciliation — partially implemented in-tree at `frontend/src/lib/payments/legacy-reconciliation.ts` (H3 I-091 ownership).

**Decision needed:** Rule the disposition of the legacy Scholar durable tables and orphan code: **retire** (drop after evidence preservation), **migrate** (move residual truth into `cg_*` substrate tables), or **retain** (keep as Scholar-runtime slice under an explicit ownership chain). The ruling also decides the fate of `teacher_biometrics`/`school_geofence` (the crypto-shred candidate's inputs, per ADR-009) and unblocks the relocation set (MISSION-R-121 inherits the J-044/COND-013 reconciliation).

**Options considered:**

- **Option 1 — Dispose per family, not wholesale (recommended).** Rule in three named buckets: (a) **migrate-and-retire** for tables whose concepts the `cg_*` substrate now owns (e.g. `attendance_verification_log` vs `cg_observation`, per the STREAM H orphan note) with evidence-preserving export before any retirement; (b) **retain-as-Scholar-slice** for tables still consumed by the live Scholar runtime, with an explicit ownership/provenance chain added (closing the traceability-law violation) and a retirement date; (c) **immediate retire** for proven dead duplicates (e.g. the second `teacher_biometrics` creation). Trade-offs: most honest and least destructive (AGENTS §39 — search usages, preserve evidence); cost is that this is real migration/governance work, applied only by the coordinator per campaign law.
- **Option 2 — Retain everything indefinitely.** Trade-offs: zero migration risk, but the platform permanently carries orphan durable state with no requirement→owner→contract chain — a standing traceability-law violation (STREAM H authority: "No orphan code") and, for `teacher_biometrics`, a standing special-category-data retention exposure (ADR-011 residual risk R-3).
- **Option 3 — Retire everything not in the `cg_*` substrate.** Trade-offs: cleanest substrate, but the Scholar runtime is live and depends on much of this schema; wholesale retirement would break the only live-verified domain runtime and violate §39. Rejected.

**Recommendation:** **Approve Option 1** in principle and direct a per-family disposition schedule as the deliverable. Two hard sub-rulings to attach: (a) `teacher_biometrics` disposition must land before or together with any surface that ships new biometric rows (ADR-009 trigger T-1 makes a shred-class designation mandatory if raw templates are retained — today the column stores one-way hashes, and ADR-009 declined designation for V1); (b) the biometric-backup residual risk (ADR-011 R-3) is accepted and recorded unless the family is retired, since tombstone erasure cannot reach backups.

**DECISION (operator):** ☐ approved ☐ declined ☐ deferred

- Signature: ______________________  Date: __________
- Ruling recorded at (coordinator fills): ______________________________________

---

## Item 6 — J-049 (a.k.a. COND-010): mobile V1 membership confirmation

**Authoritative sources located:** `STREAM_J_GAP_DISCOVERY.json` J-049 entry ("phase 22's V1 basis is doctrinal (block-29 'Web + iOS + Android'), not a dependency edge — no V1 phase consumes 22… Decision artifact, not code"; proposedOwner: "CTO scope-lock decision; phase 22 if confirmed"; severity: minor); `COREGRID_V1_V2_SCOPE_LOCK.json` conditions[COND-010] ("Mobile V1 membership confirmation (J-049): F22 is doctrinally V1; CTO confirmation pending. Gates V1CAP-088 treatment; web V1CAP-087 unaffected"); `COREGRID_V1_RECONSTRUCTED_ARCHITECTURE.json` V1CAP-088 "Mobile client platform" (membership unconfirmed; shares contracts with web via G-072); `COREGRID_V1_MISSION_GRAPH.json` residual-risk note ("no mission covers V1CAP-088 treatment pending CTO confirmation; web surface (V1CAP-087/089) is unaffected"). The H3 campaign itself assigns no mission to mobile — consistent with the gap being a decision artifact, not code.

**Decision needed:** Confirm or re-bucket mobile (phase 22 / F22 / V1CAP-088) as **V1** or **V2**. This is a scope-membership ruling only: the human loop's client surface is already served by web (phase 23), no V1 phase depends on 22, and no code is written or removed by the ruling.

**Options considered:**

- **Option 1 — Re-bucket mobile to V2 (recommended at this scope lock).** Trade-offs: V1 scope loses its only unowned doctrinal commitment and every V1 capability gains a dependency-grounded owner — the same bar STREAM F applied everywhere else (web already provides the Outcome→Observation client surface; mobile's only V1 basis is a doctrinal line in a prior session's block-29). The contracts-sharing note (G-072) means a V2 mobile later inherits the web contracts at near-zero rework. Cost: if the product truly requires mobile at launch, this ruling would under-scope — that is a product fact the operator, not an agent, holds.
- **Option 2 — Confirm mobile as V1.** Trade-offs: honors the doctrinal block-29 line; cost is that V1 then carries a structurally unnecessary capability with no dependency edge, and the mission graph must gain a mission for V1CAP-088 (none currently covers it) — real wave-2+ scope on the critical path for no loop node.
- **Option 3 — Defer past this scope lock.** Trade-offs: keeps the platform carrying an unowned doctrinal commitment (the exact outcome J-049 exists to prevent); acceptable only with an explicit date/trigger for the ruling.

**Recommendation:** **Approve Option 1** (re-bucket to V2) unless the operator holds product evidence that mobile is launch-required; in that case approve Option 2 *and* direct that a V1CAP-088 mission be added to the mission graph so the commitment becomes owned. Either approval closes COND-010; the web surface (V1CAP-087/089) is unaffected per the scope lock.

**DECISION (operator):** ☐ approved ☐ declined ☐ deferred

- Signature: ______________________  Date: __________
- Ruling recorded at (coordinator fills): ______________________________________

---

## Packet-level notes

- **Provenance & trust:** this packet is AI-authored evidence aggregation (AGENTS §12/§21). Each item's recommendation restates an in-repo ruling dossier (ADR-001, ADR-010/ADR-003, STREAM F/RULING-6, RULING-11 + scope lock, STREAM H orphans + ADR-009/ADR-011, STREAM J J-049) — no recommendation originates from this packet alone, and no evidence was fabricated. One item, **COND-005**, has **no dedicated ADR file** in the tree; its grounding is the scope-lock condition, the mission-graph residual note, and STREAM F — stated explicitly rather than inferred.
- **Sequencing hint (non-binding):** COND-003 unblocks MISSION-R-20 (J-005) and several Squad D posture conversions; COND-004 unblocks V1CAP-085/MISSION-R-111; COND-006's four families each unblock one live-verification drill; COND-009 feeds MISSION-R-121 and the ADR-009 T-1 trigger; COND-005 and J-049 block nothing and can be ruled last without cost.
- **Recording law:** a signed decision takes effect only when the coordinator records it in the owning artifact (scope-lock conditions / ADR status fields / mission graph) and, where migrations follow, authors them through the normal campaign law (authored, never applied, by teams).

# Dependency Lockstep Policy

Document: `architecture/campaigns/h3/dependency-lockstep-policy.md`
Author: Team H3-086 (Dependency Lockstep Engineer, Squad H — Quality & CI hardening)
Date: 2026-10-03
Authority: AGENTS.md (CoreGrid ASI Engineering Constitution) §22 (Repository Discovery), §26 (API Governance), §28 (Database Law), §29 (Observability), §30 (Secrets), §31 (Testing Standard), §38 (Change Management), §42 (Agent Report Format); H3 Wave Campaign Law §7 (no new dependencies) and §9 (offline tests).
Status: POLICY — normative for all future waves unless superseded by a new ADR.

---

## 1. Purpose (WHY)

CoreGrid's security posture depends on the reproducibility of its dependency graph. An unpinned or drifting dependency graph violates the CoreGrid principles of correctness, auditability, and operational trustworthiness: a build performed on two different days from the same `package.json` can produce different software, which makes evidence unrepeatable and vulnerability response non-deterministic.

This policy defines the pinning rules, upgrade cadence, CVE-response procedure, and the freeze law for the H3 wave and its successors.

Golden Questions:
- **WHO?** Every team writes code against the frozen graph; the H3-000 coordinator (and future coordinator successors) is the only actor authorized to modify `package.json` / `package-lock.json`.
- **WHAT?** The pinned dependency graph: 77 direct dependencies + the transitive closure in `package-lock.json`.
- **WHERE?** `package.json`, `package-lock.json` (both frozen this wave); scripts under `scripts/verification/`.
- **WHY?** Reproducible builds, deterministic evidence, bounded blast radius for CVE response (Constitution §29, §31, §38).
- **UNDER WHICH POLICY?** This document, subordinate to AGENTS.md §4 governance hierarchy and the H3 Wave Campaign Law.

---

## 2. Current Dependency Facts (read-only census, 2026-10-03)

Source: `package.json` and `package-lock.json`, inspected READ-ONLY for this policy. No registry lookups were performed; all facts are repo-internal.

### 2.1 Direct dependency counts

| Class | Count |
|---|---|
| `dependencies` (runtime) | 58 |
| `devDependencies` (tooling) | 19 |
| **Total direct** | **77** |

### 2.2 Lockfile state

- Lockfile format: **lockfileVersion 3** (npm).
- Total installed package entries in the lockfile graph: **596** (plus the root entry).
- **Every one of the 596 entries carries a `resolved` URL and an `integrity` digest** — no un-resolved, linked, or floating entries. The graph is fully reproducible from the lockfile alone via a lockfile-respecting install (`npm ci`-equivalent semantics).

### 2.3 Range style census (the "floating ranges" question)

- **76 of 77 direct dependencies use caret (`^`) ranges** in `package.json`.
- **1 exception: `nitro` is exact-pinned to `3.0.260603-beta`** (devDependency). This is correct behavior: it is a beta-channel version and MUST remain exact-pinned because beta minor/patch releases are not semver-stable and caret semantics are meaningless on a pre-release channel.
- **No `*`, `latest`, `>=`, `x`, git-URL, or file-range specifiers exist.** There are no truly "floating" ranges — every caret range is anchored to a concrete version.

### 2.4 Notable locked versions

The lockfile resolves the caret ranges to these concrete versions (illustrative, highest-impact packages):

| Package | `package.json` range | Locked version |
|---|---|---|
| `react` / `react-dom` | `^19.2.0` | 19.2.8 |
| `typescript` | `^5.8.3` | 5.9.3 |
| `vite` | `^8.0.16` | 8.2.1 |
| `vitest` | `^3.2.4` | 3.2.4 |
| `zod` | `^4.4.3` | 4.4.3 |
| `tailwindcss` | `^4.2.1` | 4.3.3 |
| `@supabase/supabase-js` | `^2.108.2` | 2.112.3 |
| `@tanstack/react-router` | `^1.168.25` | 1.170.27 |
| `ai` | `^6.0.208` | 6.0.253 |
| `@ai-sdk/openai-compatible` | `^2.0.51` | 2.0.67 |
| `eslint` | `^9.32.0` | 9.39.5 |
| `prettier` | `^3.7.3` | 3.9.6 |
| `@playwright/test` | `^1.61.1` | 1.62.1 |
| `pg` | `^8.23.1` | 8.23.1 |
| `nitro` | `3.0.260603-beta` (exact) | 3.0.260603-beta |

The gap between some caret ranges and locked versions (e.g. `typescript` `^5.8.3` → 5.9.3) is expected caret behavior: the lockfile, not the manifest, defines the truth of any given build. The manifest only defines the upgrade ceiling family.

### 2.5 Risk classification of notable classes

- **Authorization/AI surface** (`zod`, `ai`, `@ai-sdk/*`, `@supabase/supabase-js`): security-critical; Zod contracts and the AI gateway are enforcement boundaries.
- **Data surface** (`pg`, `@supabase/supabase-js`): touches the multi-tenancy/RLS boundary; upgrades are change-management events (§38).
- **Build/test tooling** (`vite`, `vitest`, `typescript`, `eslint`, `prettier`, `@playwright/test`): affects evidence reproducibility but not runtime security.
- **UI primitives** (`@radix-ui/*`, `lucide-react`, `class-variance-authority`, `tailwind-merge`, etc.): the §33 design system; stable, low risk.

---

## 3. Pinning Rules (exact vs caret per dependency class)

The policy is **lockfile-truth with caret-band manifests**: the lockfile is the single source of build truth; the caret ranges in the manifest exist to make future coordinated upgrades possible without rewrite storms.

1. **All runtime `dependencies` — caret (`^`) ranges in the manifest; exact truth in the lockfile.**
   Rationale: 100-team-scale development needs the lockfile for reproducibility and the caret band for wave-coordinated upgrades. Exact-pinning 58 runtime deps would make every security patch a manifest change, which is the opposite of the intended lockstep.
2. **All `devDependencies` — caret (`^`) ranges, except pre-release packages.**
   Tooling upgrades are the least risky class; carets keep tooling maintainable.
3. **Pre-release / beta packages (e.g. `nitro`) — exact pin, no caret, no tilde.**
   Pre-release versions do not follow stable semver ordering under caret. An exact pin is mandatory. Downgrading a beta back to caret is prohibited without an ADR.
4. **Prohibited specifier forms:** `*`, `latest`, bare URLs, git deps, `>=`-only ranges, file ranges without hash. A dependency proposed in any of these forms is rejected at review.
5. **Lockfile law:**
   - The lockfile MUST be committed alongside the manifest; manifest and lockfile changes MUST land in the same change (no manifest-only bumps that leave the lockfile stale).
   - CI and agent environments MUST use lockfile-respecting installs (`npm ci`-equivalent); a non-lockfile install is a violation of this policy because it can silently mutate the resolved graph.
   - The lockfile MUST NOT be hand-edited; it is regenerated only by the coordinator's tooling during an authorized upgrade.
6. **No new dependencies during H3.** The manifest is frozen (see §6). When a future wave re-opens the manifest, any new dependency requires: (a) Zod-validated typed contract usage, (b) a stated replacement test proving the need, (c) coordinator approval, (d) this policy's cadence and audit rules applying to it from day one.

---

## 4. Upgrade Cadence

1. **Cadence: one lockstep window per wave (the H3 cadence, default for future waves).**
   At the start of each campaign wave, the coordinator may perform a single coordinated `package.json` + `package-lock.json` refresh: caret bands re-anchored to the new locked reality, lockfile regenerated, full verification battery run once, results recorded in the wave's progress ledger. Teams then build against the refreshed graph for the whole wave.
2. **Rationale for wave cadence rather than continuous upgrades:** mid-wave dependency drift invalidates evidence produced by teams who already finished their missions and creates un-reviewable cross-team diffs. A wave boundary is the natural atomic upgrade point (Constitution §38: changes need impact analysis, migration plan, rollback plan).
3. **In-wave upgrade exception (security only):** a dependency may be upgraded mid-wave ONLY under the CVE procedure in §5. No feature-driven mid-wave upgrades.
4. **Within a wave, a team MUST NOT:** change `package.json`, change `package-lock.json`, add devDependencies, add scripts to `package.json`, or re-run install tooling against the lockfile. Only the coordinator touches these files.
5. **Major-version upgrades** (semver major, or beta-channel moves) additionally require a short ADR recording the expected behavioral surface and the verification evidence, because majors are the class most likely to break the verify chain silently.

---

## 5. Audit Procedure (when a CVE lands)

This procedure is normative for the coordinator or an authorized operator. It is deliberately expressed offline-first; the only network-touching step is the advisory-query step itself, run by the authorized operator — never by concurrent team agents (Campaign Law §9 analog: registry access is serialized, not parallel).

**Trigger:** a CVE/advisory affecting any package in the 596-entry graph is announced (or `npm audit`-class tooling flags one during the next authorized window).

**Procedure:**

1. **Freeze** — no team acts on the advisory individually. The coordinator announces the affected package(s) and CVE id. No secrets, credentials, or advisory payloads are pasted into team channels (Constitution §30).
2. **Impact census (offline)** — determine, from `package-lock.json` alone, whether the vulnerable version range intersects the locked graph: read the locked version of the affected package and compare against the advisory's fixed/affected ranges. Determine which of the three risk classes in §2.5 the package belongs to (runtime/AI/data surface vs tooling vs UI).
3. **Exploitability check (offline)** — if the vulnerable code path is not imported by any server path (e.g. a vulnerable function in a build-time-only tool), record `AFFECTED-BUT-NOT-REACHABLE` with the import-path evidence. Do not skip the upgrade merely because of this; record it as risk reduction context.
4. **Authorized advisory query (network, serialized)** — the coordinator (only) runs the ecosystem advisory query (`npm audit --json`-class command against the advisory registry) to confirm the advisory's affected range and fixed version. This is the ONLY step that touches the network, and it MUST be serialized (no concurrent team agents run audit tooling).
5. **Upgrade decision** — apply §4.3: if the fix is within the existing caret band, it is a lockfile-only refresh by the coordinator. If it requires a caret re-anchor or a major bump, apply §4.5 (ADR) and the security invariants take precedence over the wave cadence (Constitution §4: security invariants rank first).
6. **Verify** — the coordinator runs the full verify chain (`npm run verify`) once, on the upgraded graph, and records the evidence in the progress ledger. Teams do not run the battery concurrently during this window (Campaign Law §9).
7. **Rollback plan** — record the previous lockfile hash and the revert procedure before starting step 5 (Constitution §38).
8. **Audit trail** — record: CVE id, affected package, locked-before version, locked-after version, reachability determination, verify evidence, rollback hash. Immutable record; never edited after the fact (Constitution §28).

**Time bound:** a CVE affecting a reachable runtime/AI/data-surface package is treated as an emergency (same-wave fix). Tooling-only CVEs may ride the next wave's lockstep window if unreachable.

---

## 6. Freeze Law

**The H3 wave froze `package.json`.** Record of the freeze:

- **Scope of freeze:** `package.json` AND `package-lock.json` are frozen for the entire H3 wave. No team may add, remove, re-version, or re-range any dependency; no team may modify scripts, re-run installs, or regenerate the lockfile.
- **Authority:** H3 Wave Campaign Law §3 (strictly disjoint file ownership — `package.json` is owned exclusively by the H3-000 coordinator) and §7 ("no new dependencies (package.json is frozen this wave)").
- **Consequence for teams:** all H3 work must be achieved with the existing 77-dependency graph. A mission that "needs a new dependency" is re-scoped: either solve it with existing capabilities (Zod, existing contracts, existing tooling) or report the gap in the team's §42 report as Remaining Work for a future wave to authorize.
- **Consequence for evidence:** because the graph is frozen, all H3 verification evidence is comparable across teams — every team builds from the identical 596-entry lockfile. This is what makes the wave's collective evidence trustworthy.
- **Un-freezing:** the freeze lifts only at a wave boundary, per §4.1, or by an explicit coordinator decision recorded in the wave ledger. Security exceptions follow §5 only.
- **Historical note:** this document's §2 census (taken 2026-10-03, during the freeze) is the baseline record of what the frozen graph contains; the successor lockstep window should diff its census against this one.

---

## 7. Compliance Checklist (for reviewers and future teams)

- [ ] Did this change touch `package.json` or `package-lock.json` without coordinator authority? → reject.
- [ ] Does any new specifier use a prohibited form (§3.4)? → reject.
- [ ] Is a beta package exact-pinned (§3.3)? → verify.
- [ ] Was the lockfile regenerated in the same change as the manifest (§3.5)? → verify.
- [ ] Did a CVE response follow §5 step-by-step with recorded evidence? → verify.
- [ ] Was any registry/network access performed by a team agent rather than the coordinator? → violation of §5.4 and Campaign Law §9.

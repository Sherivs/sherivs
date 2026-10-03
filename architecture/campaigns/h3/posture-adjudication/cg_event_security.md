# Posture Adjudication — `cg_event_security` (H3-035)

- **Team / Role:** H3-035, Posture Adjudication Engineer (Squad D — memory-audit/reconciliation family)
- **Date:** 2026-10-03
- **Adjudicated posture:** **ZERO-POLICY BY DESIGN — CONFIRMED, no change proposed, nothing applied.**
- **Method:** read-only. Battery script inspected and run offline only (`--dry-parse-scope`); posture JSONs read as data; ownership traced with `rg`. No database touched; no posture file, migration, or policy authored or modified.

## OWNERSHIP

| Question | Answer |
|---|---|
| Creating migration | `database/supabase/migrations/20261002000006_coregrid_v1_event_security.sql` (MISSION-R-81 / J-022, V1CAP-044). Creates `cg_event_security` (the per-event security contract), `cg_event_security_denial` and `cg_event_security_redaction` (append-only gate audits). |
| Posture authored by | The same migration §4 "Deny-by-default security posture" (lines 210–229): `ALTER TABLE public.cg_event_security ENABLE ROW LEVEL SECURITY;` + `REVOKE ALL ON public.cg_event_security FROM anon, authenticated;` — RLS enabled, **zero policies**, no client grants, for all three tables. The migration comment records the intent: "Zero policies are deliberate: security contracts and gate audit records are tenant-sensitive platform security data (Constitution §17/§35) and no tenant-scoped policy yet exists that provably cannot widen reads beyond a [legitimate need] … follow-up migration under explicit authorization, never silently." |
| Owning server path (writes/reads) | `frontend/src/lib/adapters/event-security-store.adapter.ts` (V1CAP-044 / J-022 / MISSION-R-81) — the ONLY place vendor/DB calls appear for this family (§24/§25). Header states verbatim: "Service-role access only: the tables are zero-policy deny-by-default (RLS enabled, all anon/authenticated privileges revoked)." It maps `SecuredEvent` contracts, `EventDenialRecord`s and `EventRedactionRecord`s onto substrate rows; writes append-only and idempotent (deterministic ids / ON CONFLICT DO NOTHING); tenant law fails closed (a tenant-less event is refused with `tenant_required`, never defaulted). |
| Posture file ownership of the entry | `scripts/verification/rls-table-postures-substrate.json` (H2-04) re-declares it zero-policy with rationale — the battery's single source of truth (`postureSource=rls-table-postures-substrate.json`). |
| Related real-time surface | Delivery-time visibility is enforced by the event routing/consumption gate (`cg_event_route_subscription`, policy-backed, and the kernel event-security contract `frontend/src/lib/kernel/event-security.ts`) — the gate decides deliverability; the substrate contract row itself is never a client-visible surface (§35). |

## EVIDENCE

1. **Battery scope (offline dry-parse, exit 0):**
   `cg_event_security posture=zero-policy forceRls=false policies=0 tenantColumn=n/a source=20261002000006_coregrid_v1_event_security.sql postureSource=rls-table-postures-substrate.json`
2. **Posture file** (`rls-table-postures-substrate.json`, lines 142–147): entry `{ name: "cg_event_security", posture: "zero-policy", rationale: "per-event security contracts are gate inputs, not client surfaces; visibility enforcement belongs to the consumption gate — unchanged deny-by-default" }`; listed in `batteryExpectations.zeroPolicyTables`.
3. **Migration text** (§4 lines 223–229): RLS enabled + `REVOKE ALL ... FROM anon, authenticated` for `cg_event_security`, `_denial`, `_redaction`; no policy statement authored.
4. **Adapter text** (`event-security-store.adapter.ts` header): service-role only, append-only idempotent writes, fail-closed tenant law.
5. **Family contrast (deliberate):** within the same migration family, `cg_event_security` is zero-policy while `cg_event_route_subscription` (routing plane) is policy-backed with SELECT+INSERT tenant policies and a §4.4 probe recipe. The policy layer reaches the tenant's subscription declarations; it never reaches the per-event security contracts. This split is recorded posture data, not drift.
6. **Unit pins:** `tests/unit/mh-04-substrate-policies.test.ts` and `tests/unit/adapter-event-security-store.test.ts` pin the migration text and the adapter's service-role-only contract. `docs/runbooks/incident-lockdown.md` cites the event-security posture in incident response.

## DECISION

**ZERO-POLICY BY DESIGN — CONFIRMED. The per-event security contract table stays deny-by-default (RLS enabled, zero policies, zero client grants). No policy migration is proposed for V1; nothing applied.**

## RATIONALE

1. **Gate inputs, not client surfaces (H2-04's recorded rationale, concurred).** A `cg_event_security` row is the security envelope of a delivered event: issuer identity, time-authority coordinates, SHA-256 digest chain linkage, visibility scope, emission authority. These are the *inputs the consumption gate evaluates* — the authority that decides whether a subscriber may receive an event. Publishing the contract rows to clients would let the evaluated data leak before (or instead of) the gate decision, inverting §35's enforcement order.
2. **Realtime security (§35).** Event delivery must respect tenant, authorization, subscriptions and privacy — and never broadcast unauthorized events. The posture guarantees the contracts can never be read (or subscribed-to) through the public data plane at all: zero grants to anon/authenticated/PUBLIC plus zero policies means no policy expression anywhere can evaluate true. The only legitimate exposure path is the service-role gate + routing pipeline.
3. **The owning server path is service-role-only and says so.** `event-security-store.adapter.ts` composes on a minimal service-role client and fails closed on tenant-less events. Zero-policy is exactly the contract the adapter is built against; a client SELECT policy would add a policy-expression surface with no declared V1 consumer.
4. **Platform security data deserves the strongest posture (§17).** The migration's own comment: no tenant-scoped policy "yet exists that provably cannot widen reads beyond" need — so the authors chose the posture that cannot widen anything. This adjudication confirms that choice as correct for V1: the digest-chain linkage rows are cross-event integrity evidence; tenant-scoped SELECT would expose chain coordinates without any validated purpose (§19 purpose limitation).
5. **Tamper-evidence synergy with its audit siblings.** `cg_event_security_denial` and `cg_event_security_redaction` are append-only gate audits whose posture entries document the deliberate §28 absence of any client write policy. The contract table sharing their zero-policy posture keeps the whole family uniformly unerazable and unreadable by client roles — a coherent tamper-evidence boundary.
6. **If the posture ever changes, the conversion path is defined:** one authorized migration per the `20261002000013` exemplar (FORCE RLS + exact declared SELECT-only policy on `tenant_id = public.get_my_tenant_id()` + declared least-privilege grants + a data-declared §4.4 probe recipe), under explicit authorization, never silently.

## CONSTITUTION SECTIONS

- **§17** Database security — RLS mandatory and enabled; the data plane itself (zero grants + zero policies) enforces, not the adapter alone.
- **§35** Realtime security — the decisive section: contracts are gate inputs; visibility enforcement belongs to the consumption gate; nothing leaks through the data plane.
- **§19** AI privacy law / purpose limitation — digest chains and authority coordinates are minimization-class data with no declared V1 client purpose.
- **§28** Immutable audit records — family-uniform append-only integrity enforced by absence of any client privilege.
- **§16/§26** Authorization model / API governance — no authenticated privilege exists; deny is unconditional and policy-free.
- **§24/§25** Architecture rule / external providers — DB access isolated in the adapter; posture consistent with the adapter's service-role-only composition.
- **§12** Provenance — posture entry carries `source=20261002000006_coregrid_v1_event_security.sql`, `postureSource=rls-table-postures-substrate.json`.

## PROPOSED-POLICY-IF-ANY

**None for V1.** If a future phase authorizes tenant-scoped inspection of security contracts (e.g. a tenant security console), the sanctioned direction is: FORCE RLS + SELECT-only `tenant_id = public.get_my_tenant_id()` policy + declared SELECT-only grants + §4.4 probe recipe, in one authorized migration using only the J-005/J-006 neutral predicate vocabulary. Until that gate exists, zero-policy deny-by-default is the adjudicated posture. Nothing is pre-authored here.
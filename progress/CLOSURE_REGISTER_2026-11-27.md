# Mission closure register (27 Nov 2026)

Every mission I opened before the audit, what is still open, and who or what it waits on. Taken from each PR's own "Not done / UNVERIFIED" section and checked CI (all M-series PRs were green on 19 Nov; none merged; no migration applied anywhere).

Owner key: **C** = Claude can build it; **F** = founder decision or input; **T** = Tumi (backend, hosted DB, review); **X** = needs an environment I do not have (browser, hosted Supabase, real provider).

| PR | Mission | Open items | Owner |
| --- | --- | --- | --- |
| 437 | M23 hardening | add `verify:route-budgets` to verify after allowlist review; `SHERIVS_HEALTH_URL`; trace collector choice; alert routing; restore drill; security review pack not attempted | F, T, C (security pack) |
| 438 | M2b role pack engine | permission resolver (§7.3) and cache; overrides and custom roles do not change effective permissions; CI job for the SQL test; one-pack-per-organisation rule vs multi-type groups | C, F |
| 439 | M5a interview graph | real role-pack and website template codes; regulator names unchecked; admissions interpretation | F, T |
| 448 | M2a role catalogue | 31 remaps, derived regulator codes, family expansion to confirm; types with no roles | F |
| 449 | M16 offline | Playwright offline run, Slow 3G, axe; no feature uses the outbox yet | X, C |
| 452 | M11a admissions model | JAMB format and CAPS vocabulary unverified; deferred ADR-111 items (portal, payments, import); 3 founder decisions | F, C |
| 459 | M22 comms | founder sets `SMS_PROVIDER`; delete Twilio adapter?; Meta billing assumption | F |
| 460 | M7 academic core | browser offline and a11y runs; students-table policy decision; assignments table absent | F, X |
| 461 | M6 provisioning | no published institution pack, so nothing can provision; invitations, self-serve UI; #435 audit-trigger issue | F, C, T |
| 462 | M4 role builder | live shell does not read custom widgets; blank-template decision | C, F |
| 463 | M9 finance | part B: online refund needs second-person approval; two cash paths; bursar screens, payroll screens, relief revocation, levies, Paystack posting into M07 | C (largest), F |
| 455, 467, 469, 471 | WF-06, 07, 08, 12 | hosted behaviour, concurrency tests, real rates, retention legal basis; approval-step resume and approver notification not built | C, T, X, F |
| 473-479, 505 | AIN-01 to 05 | graceful deferral of a refused step; model and cost budgets stored not enforced (no model route, decision 3); agent evidence per organisation | C, F |
| 506-511 | BP-01, WF-15a, CD-01..05 | review only | T |
| 512-522 | A1 to A7b, ADR-142/143, WF-15b/b2 | A3 server code (WebAuthn verify and step-up write); A4 (unblocked by ADR-143, now buildable); 6 group workflows need GRP-01; SUP-01; 7 scenarios (6 are one probable product defect, see A7b) | C, T |

## What blocks "complete"

1. **Decisions only the founder can make** (largest group): providers (SMS, AI route, voice), retention and rates, counsel for the minors decision, first pilot school, which institution pack ships first.
2. **Things that need a hosted environment**: browser, offline, accessibility and concurrency runs, Supabase and PostgREST behaviour.
3. **Things only Tumi can do**: backups and restore tests, applying any migration, independent review of all of the above.
4. **What I can build now, in order**: A3 server code; A4; the class-scope approval defect found in A7b; M9 part B pieces; M2b resolver; GRP-01 then the six group events; SUP-01; then the AIN-06 agents.

# Sherivs Simulation Lab

An isolated, local-only test lab: Postgres 17 (embedded binaries) with a minimal Supabase
bootstrap (`auth`, `storage`, roles), every repo migration applied, PostgREST for real
JWT/RLS traffic, and k6 for load. It never connects to production and never runs
`supabase link`. All people and institutions are synthetic (`*.sim.invalid`).

## Run
```bash
tools/sim-lab/up.sh                  # fresh DB + all migrations (add --with-proposed to include the sim-lab fix migration)
cd tools/sim-lab
node sim/gen.mjs                     # 5 Nigerian institution archetypes (SIM_SCALE=0.1 for a quick run)
node sim/scenarios.mjs               # 47 checks -> sim/scenario-results.json
node load/tokens.mjs && bin/postgrest load/postgrest.conf &   # local JWT secret is generated, never printed
cd load && PEAK=1000 ../bin/k6 run mix.js
```

## Archetypes (full scale)
| Institution | Kind | Plan | Students |
|---|---|---|---|
| Lagos private K-12 | nursery to SS3 | growth | 1,200 |
| Public secondary (Ikeja) | JSS1 to SS3 | starter | 2,500 |
| Faith boarding college | JSS1 to SS3 | professional | 700 |
| Federal polytechnic | ND/HND | professional | 5,000 |
| Federal university | 100L to 500L | enterprise | 12,000 |

About 33,000 users, 21,400 students and 162,000 results in total.

## Results (24 Oct 2026, 8-core box)
- Scenarios: 37/47 before fixes, 39/47 with `20261024000220_sherivs_015_sim_lab_fixes.sql.proposed`.
- RLS: a student reading their own results took 43 s with 162k results rows (policy helpers evaluated per row). After the fix: 43 ms; a parent's query went from 3.7 s to 0.4 ms.
- Load (results-day mix through PostgREST): before the fix, 99% of requests failed at 1,000 VUs.
  After: 1,000 VUs, 0% errors, p95 282 ms, 329 req/s; 2,000 VUs p95 2.9 s; 3,000 VUs p95 5.1 s, 0% errors
  (k6, PostgREST and Postgres were sharing one 8-core box, so the box itself is the ceiling).
See `results/` for raw JSON.

## SHERIVS-016 run (24 Oct 2026)
Migration `20261024000230_sherivs_016_lifecycle_grading_tiers_audit.sql` (not applied to prod):
82/82 scenarios pass (the 56 earlier ones, including the 6 previous failures, plus 26 new for
rollover/lifecycle, grading/CGPA, tier entitlements, append-only audit bridge, admin role mapping).
k6 1,000 VUs: 0% errors, p95 213 ms, 331 req/s (`results/k6-016-smoke-1000.json`).

## Track E run (24 Oct 2026): key flows at 3,000 / 5,000 VUs
`SIM_PG_PORT` now sets the Postgres port for every script (default 54329), and `BASE` sets the PostgREST URL for k6, so parallel labs don't collide.
New: `sim/seed-flows.mjs` (attendance + CBT seed), `load/flows.js` (login/results/CBT/fees/attendance mix, `SMOKE=1` for CI),
`sim/security-audit.mjs` (RLS/definer/grant/storage audit; `AUDIT_DB_URL` = read-only audit of another DB), `sim/rls-e-check.mjs`
(cross-student leak regression), `sim/explain-flows.mjs` (per-flow EXPLAIN as real users).
3,000 VUs: 49.7% errors / p95 13.97 s before, 0% / p95 581 ms after (1,416 req/s). 5,000 VUs after: 0.02% / p95 3.10 s (CPU-bound shared box).
216/216 scenarios pass with the three `sherivs_e_*` migrations. See `docs/security/track-e-findings.md`.

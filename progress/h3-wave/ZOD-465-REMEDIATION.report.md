# zod 4.4.3 → 4.6.5 upgrade — H3 finding remediation (§42 report)

Date: 2026-10-08 · Authority: explicit operator go-ahead (refoundation run record)
Classification: V1 dependency-security remediation (not frozen V2/V3 scope)

## Context

The Vercel deploy blocker fix (CVE-2026-102989, `@tanstack/react-start` →
1.168.60) re-resolved zod from 4.4.3 to 4.6.5. zod 4.6.5 changes one
security-relevant behavior: `strictObject` now DENIES a JSON-injected own
`__proto__` key with the typed `unrecognized_keys` issue instead of silently
stripping it (the old unknown-key membership check used `in`, which hit the
inherited `Object.prototype` accessor). The initial upgrade commit pinned zod
back to 4.4.3 to keep that change scoped; THIS change completes the upgrade
and remediates the recorded findings.

## Behavior change (empirically verified)

`z.strictObject({a: z.boolean()}).safeParse(JSON.parse('{"a":false,"__proto__":{"evil":true}}'))`
- zod 4.4.3: `success: true` (key silently stripped)
- zod 4.6.5: `success: false` — issue `{ code: "unrecognized_keys", path: [], message: 'Unrecognized key: "__proto__"' }`

This is strictly the behavior the strict-shape contracts promised (AGENTS §21
tamper-evidence): an input carrying a foreign injection key now fails closed
with a typed denial instead of parsing successfully.

## Findings remediated (4 findings across 4 missions — zero module changes)

Every affected finding was an observation about zod library behavior surfaced
through a read-only contract module; the remediation is the dependency
upgrade, no module was modified.

| Finding | Report | Old observed behavior | New behavior |
|---|---|---|---|
| F-076-07 | H3-076 | escalation/approval records with a `__proto__` own key parse as VALID (silent strip); typed denial did not fire; removed from the in-suite findings ledger (the attack no longer succeeds — ledger is successful-attacks-only) | `safeParse` FAILS with `unrecognized_keys` naming `__proto__`; approval path denies with `human_approval_invalid` |
| (unnamed probe) | H3-077 | own-property `__proto__` injection was INERT (decision derived only from context) | denied outright — `invalid_request_shape` |
| H3-078-F08 | H3-078 | batch carrying `__proto__` parsed as VALID instead of failing closed (impact bounded: payload dropped) | fails CLOSED with `invalid_shape`; finding text amended in the in-suite ledger to record the remediation |
| KR-3 | H3-080 | strict refusal evaded for the `__proto__` key name (silent strip) | typed `invalid_shape` refusal fires; probe test pins the denial |

The in-suite ledger amendment in H3-078 keeps the F08 entry (finding text now
states REMEDIATED + the fixed behavior) because that suite's integrity test
pins its FINDINGS map; the other three ledgers are untouched.

## Implemented

- `package.json`: `zod` pinned to exactly `4.6.5` (was `^4.4.3` resolving 4.4.3).
- `tests/unit/h3-076-governance-alignment-verification.test.ts`: the two
  silent-strip tests rewritten as typed-denial assertions; F-076-07 removed
  from the ledger and its integrity assertions (count 7 → 6, id list).
- `tests/unit/h3-077-universal-runtime-fabric-verification.test.ts`: proto
  injection probe rewritten to assert `invalid_request_shape` containment.
- `tests/unit/h3-078-zero-trust-defense-verification.test.ts`: F08 test
  rewritten as REMEDIATED (asserts `invalid_shape`); F08 ledger text amended.
- `tests/unit/h3-080-twin-civilization-verification.test.ts`: KR-3 probe
  rewritten as typed-denial assertion.
- `progress/h3-wave/H3-076.report.md`, `H3-077.report.md`,
  `H3-078.report.md`, `H3-080.report.md`: findings/known-risks annotated
  with the remediation (kept for ledger continuity — never silently deleted).

## Verification evidence

- `npm run typecheck` — clean
- `npm run test:unit` — 8,915 passed / 0 failed (4 mobile files fail to
  *collect* on pre-existing missing `mobile/node_modules`; unchanged)
- `npm run build` — clean
- `npm run verify:secrets` — PASS; `npm run verify:neutrality` — PASS
- Direct zod probe of the new denial (above) recorded in this report.

## Remaining Work

- None from this upgrade. Production DNS cutover to sherivs.com (step 17)
  requires registrar/DNS-provider access outside this repository; the repo
  side is cutover-ready (tenant resolver accepts `sherivs.com` /
  `app.sherivs.com`, metadata/sitemap/robots already point there, legacy
  hosts retained for compatibility).
